export type Grade='Mint'|'NM'|'Excellent'|'Good'|'Played'|'Poor'|'Damaged';

export interface GradeResult{
  grade:Grade;
  score:number;
  confidence:number;
  defects:string[];
  centering:number;
  subgrades:{centering:number;corners:number;edges:number;surface:number};
}

type QuadPoint={x:number;y:number};

function clamp(v:number,min=0,max=100){return Math.max(min,Math.min(max,v));}

function luma(data:Uint8ClampedArray,i:number){
  return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
}

function regionStats(image:ImageData,x0:number,y0:number,x1:number,y1:number){
  const {width,height,data}=image;
  const xa=Math.max(0,Math.floor(x0)),xb=Math.min(width,Math.ceil(x1));
  const ya=Math.max(0,Math.floor(y0)),yb=Math.min(height,Math.ceil(y1));
  let sum=0,sum2=0,n=0,clip=0;
  for(let y=ya;y<yb;y+=2)for(let x=xa;x<xb;x+=2){
    const v=luma(data,(y*width+x)*4);sum+=v;sum2+=v*v;n++;if(v>248||v<8)clip++;
  }
  const mean=n?sum/n:0;
  return {mean,contrast:n?Math.sqrt(Math.max(0,sum2/n-mean*mean)):0,clip:n?clip/n:0};
}

function edgeStrength(image:ImageData,x:number,y:number,axis:'x'|'y'){
  const {width,height,data}=image;
  const xx=Math.max(2,Math.min(width-3,Math.round(x)));
  const yy=Math.max(2,Math.min(height-3,Math.round(y)));
  const a=luma(data,(yy*width+xx)*4);
  const b=axis==='x'
    ?luma(data,(yy*width+xx-2)*4)
    :luma(data,((yy-2)*width+xx)*4);
  const c=axis==='x'
    ?luma(data,(yy*width+xx+2)*4)
    :luma(data,((yy+2)*width+xx)*4);
  return Math.abs(b-c)+Math.abs(a-(b+c)/2)*.25;
}

function estimateBorderMargin(image:ImageData,side:'left'|'right'|'top'|'bottom'){
  const {width,height}=image;
  const max=side==='left'||side==='right'?Math.floor(width*.28):Math.floor(height*.28);
  let best=0,bestPos=Math.max(1,Math.floor(max*.35));
  for(let p=2;p<max;p+=2){
    let score=0,count=0;
    if(side==='left'||side==='right'){
      const x=side==='left'?p:width-1-p;
      for(let y=Math.floor(height*.12);y<height*.88;y+=Math.max(2,Math.floor(height/90))){score+=edgeStrength(image,x,y,'x');count++}
    }else{
      const y=side==='top'?p:height-1-p;
      for(let x=Math.floor(width*.12);x<width*.88;x+=Math.max(2,Math.floor(width/90))){score+=edgeStrength(image,x,y,'y');count++}
    }
    const avg=count?score/count:0;
    if(avg>best){best=avg;bestPos=p;}
  }
  return {margin:bestPos/(side==='left'||side==='right'?width:height),strength:Math.min(1,best/55)};
}

function scoreCentering(image:ImageData){
  const l=estimateBorderMargin(image,'left').margin;
  const r=estimateBorderMargin(image,'right').margin;
  const t=estimateBorderMargin(image,'top').margin;
  const b=estimateBorderMargin(image,'bottom').margin;
  const lr=Math.abs(l-r)/Math.max(.001,l+r);
  const tb=Math.abs(t-b)/Math.max(.001,t+b);
  return clamp(100-(lr*100*.75+tb*100*.75));
}

function scoreCorners(image:ImageData){
  const {width,height}=image;
  const size=Math.max(8,Math.round(Math.min(width,height)*.13));
  const patches=[
    regionStats(image,0,0,size,size),
    regionStats(image,width-size,0,width,size),
    regionStats(image,width-size,height-size,width,height),
    regionStats(image,0,height-size,size,height)
  ];
  const contrast=patches.reduce((n,p)=>n+p.contrast,0)/4;
  const clipped=patches.reduce((n,p)=>n+p.clip,0)/4;
  return clamp(100-(Math.max(0,contrast-48)*.7)-(clipped*120));
}

function scoreEdges(image:ImageData){
  const {width,height}=image;
  const strips=[
    regionStats(image,0,0,Math.floor(width*.1),height),
    regionStats(image,Math.floor(width*.9),0,width,height),
    regionStats(image,0,0,width,Math.floor(height*.1)),
    regionStats(image,0,Math.floor(height*.9),width,height)
  ];
  const clipped=strips.reduce((n,p)=>n+p.clip,0)/4;
  const contrast=strips.reduce((n,p)=>n+p.contrast,0)/4;
  return clamp(100-(Math.max(0,contrast-52)*.45)-(clipped*100));
}

function scoreSurface(image:ImageData){
  const {width,height,data}=image;
  const step=Math.max(4,Math.floor(Math.min(width,height)/120));
  let sum=0,sum2=0,n=0,high=0;
  for(let y=step;y<height-step;y+=step)for(let x=step;x<width-step;x+=step){
    const i=(y*width+x)*4;
    const l=luma(data,i),rx=luma(data,(y*width+x+step)*4),dy=luma(data,((y+step)*width+x)*4);
    const g=Math.abs(l-rx)+Math.abs(l-dy);
    sum+=g;sum2+=g*g;n++;if(g>95)high++;
  }
  const mean=n?sum/n:0,variance=n?Math.sqrt(Math.max(0,sum2/n-mean*mean)):0;
  return clamp(100-Math.max(0,mean-24)*1.2-Math.max(0,variance-22)*.8-(n?high/n:0)*80);
}

function gradeFromScore(score:number):Grade{
  return score>=95?'Mint':score>=88?'NM':score>=78?'Excellent':score>=67?'Good':score>=54?'Played':score>=38?'Poor':'Damaged';
}

export function gradeImage(image:ImageData,quadArea:number,quad?:QuadPoint[]):GradeResult{
  const centering=scoreCentering(image);
  const corners=scoreCorners(image);
  const edges=scoreEdges(image);
  const surface=scoreSurface(image);
  const areaScore=clamp((quadArea/10000)*125);
  const score=Math.round(clamp(centering*.25+corners*.22+edges*.18+surface*.35+areaScore*.06));
  const defects:string[]=[];
  if(centering<88)defects.push('Centratura non uniforme');
  if(corners<82)defects.push('Angoli con possibile usura o irregolarità');
  if(edges<82)defects.push('Bordi con possibile usura');
  if(surface<82)defects.push('Superficie con possibili segni, riflessi o micro-irregolarità');
  const stats=regionStats(image,0,0,image.width,image.height);
  if(stats.clip>.08)defects.push('Possibile sovraesposizione');
  if(stats.contrast<16)defects.push('Contrasto basso: valutazione meno affidabile');
  if(quad&&quad.length===4){
    const xs=quad.map(p=>p.x),ys=quad.map(p=>p.y);
    const w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
    if(h>0&&w/h>.86)defects.push('Proporzioni della carta anomale');
  }
  const confidence=clamp(0.45+Math.min(.3,stats.contrast/100)+Math.min(.2,areaScore/500));
  return {
    grade:gradeFromScore(score),
    score,
    confidence:Number(confidence.toFixed(2)),
    defects,
    centering:Math.round(centering),
    subgrades:{centering:Math.round(centering),corners:Math.round(corners),edges:Math.round(edges),surface:Math.round(surface)}
  };
}

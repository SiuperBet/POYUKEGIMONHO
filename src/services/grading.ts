export type Grade='Mint'|'NM'|'Excellent'|'Good'|'Played'|'Poor'|'Damaged';
export type DefectSeverity='low'|'medium'|'high';

export interface GradeFinding{
  type:'scratch'|'crease'|'dent'|'whitening'|'corner'|'edge'|'surface'|'lighting'|'centering';
  severity:DefectSeverity;
  confidence:number;
  label:string;
  description:string;
}

export interface GradeResult{
  grade:Grade;
  score:number;
  confidence:number;
  defects:string[];
  findings:GradeFinding[];
  centering:number;
  subgrades:{centering:number;corners:number;edges:number;surface:number};
}

type QuadPoint={x:number;y:number};
function clamp(v:number,min=0,max=100){return Math.max(min,Math.min(max,v));}
function luma(data:Uint8ClampedArray,i:number){return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];}

function regionStats(image:ImageData,x0:number,y0:number,x1:number,y1:number){
  const {width,height,data}=image;
  const xa=Math.max(0,Math.floor(x0)),xb=Math.min(width,Math.ceil(x1)),ya=Math.max(0,Math.floor(y0)),yb=Math.min(height,Math.ceil(y1));
  let sum=0,sum2=0,n=0,clip=0;
  for(let y=ya;y<yb;y+=2)for(let x=xa;x<xb;x+=2){const v=luma(data,(y*width+x)*4);sum+=v;sum2+=v*v;n++;if(v>248||v<8)clip++}
  const mean=n?sum/n:0;
  return {mean,contrast:n?Math.sqrt(Math.max(0,sum2/n-mean*mean)):0,clip:n?clip/n:0};
}
function edgeStrength(image:ImageData,x:number,y:number,axis:'x'|'y'){
  const {width,height,data}=image,xx=Math.max(2,Math.min(width-3,Math.round(x))),yy=Math.max(2,Math.min(height-3,Math.round(y)));
  const a=luma(data,(yy*width+xx)*4);
  const b=axis==='x'?luma(data,(yy*width+xx-2)*4):luma(data,((yy-2)*width+xx)*4);
  const c=axis==='x'?luma(data,(yy*width+xx+2)*4):luma(data,((yy+2)*width+xx)*4);
  return Math.abs(b-c)+Math.abs(a-(b+c)/2)*.25;
}
function estimateBorderMargin(image:ImageData,side:'left'|'right'|'top'|'bottom'){
  const {width,height}=image,max=side==='left'||side==='right'?Math.floor(width*.28):Math.floor(height*.28);
  let best=0,bestPos=Math.max(1,Math.floor(max*.35));
  for(let p=2;p<max;p+=2){let score=0,count=0;
    if(side==='left'||side==='right'){const x=side==='left'?p:width-1-p;for(let y=Math.floor(height*.12);y<height*.88;y+=Math.max(2,Math.floor(height/90))){score+=edgeStrength(image,x,y,'x');count++}}
    else{const y=side==='top'?p:height-1-p;for(let x=Math.floor(width*.12);x<width*.88;x+=Math.max(2,Math.floor(width/90))){score+=edgeStrength(image,x,y,'y');count++}}
    const avg=count?score/count:0;if(avg>best){best=avg;bestPos=p}
  }
  return {margin:bestPos/(side==='left'||side==='right'?width:height),strength:Math.min(1,best/55)};
}
function scoreCentering(image:ImageData){
  const l=estimateBorderMargin(image,'left').margin,r=estimateBorderMargin(image,'right').margin,t=estimateBorderMargin(image,'top').margin,b=estimateBorderMargin(image,'bottom').margin;
  return clamp(100-((Math.abs(l-r)/Math.max(.001,l+r))*100*.75+(Math.abs(t-b)/Math.max(.001,t+b))*100*.75));
}
function scoreCorners(image:ImageData){
  const {width,height}=image,size=Math.max(8,Math.round(Math.min(width,height)*.13));
  const p=[regionStats(image,0,0,size,size),regionStats(image,width-size,0,width,size),regionStats(image,width-size,height-size,width,height),regionStats(image,0,height-size,size,height)];
  const contrast=p.reduce((n,x)=>n+x.contrast,0)/4,clipped=p.reduce((n,x)=>n+x.clip,0)/4;
  return clamp(100-Math.max(0,contrast-48)*.7-clipped*120);
}
function scoreEdges(image:ImageData){
  const {width,height}=image,p=[regionStats(image,0,0,width*.1,height),regionStats(image,width*.9,0,width,height),regionStats(image,0,0,width,height*.1),regionStats(image,0,height*.9,width,height)];
  const clipped=p.reduce((n,x)=>n+x.clip,0)/4,contrast=p.reduce((n,x)=>n+x.contrast,0)/4;
  return clamp(100-Math.max(0,contrast-52)*.45-clipped*100);
}
function scoreSurface(image:ImageData){
  const {width,height,data}=image,step=Math.max(4,Math.floor(Math.min(width,height)/120));
  let sum=0,sum2=0,n=0,high=0;
  for(let y=step;y<height-step;y+=step)for(let x=step;x<width-step;x+=step){const i=(y*width+x)*4,l=luma(data,i),rx=luma(data,(y*width+x+step)*4),dy=luma(data,((y+step)*width+x)*4),g=Math.abs(l-rx)+Math.abs(l-dy);sum+=g;sum2+=g*g;n++;if(g>95)high++}
  const mean=n?sum/n:0,variance=n?Math.sqrt(Math.max(0,sum2/n-mean*mean)):0;
  return clamp(100-Math.max(0,mean-24)*1.2-Math.max(0,variance-22)*.8-(n?high/n:0)*80);
}

/** Detects narrow high-frequency discontinuities that persist along a line. */
function detectSurfaceDefects(image:ImageData){
  const {width,height,data}=image;
  const step=Math.max(2,Math.floor(Math.min(width,height)/240));
  let scratch=0,dent=0,white=0,texture=0,n=0;
  const samples=Math.max(12,Math.floor(Math.min(width,height)/28));
  const lineHitsH=new Array(samples).fill(0),lineHitsV=new Array(samples).fill(0);
  for(let y=3;y<height-3;y+=step){
    for(let x=3;x<width-3;x+=step){
      const i=(y*width+x)*4;
      const c=luma(data,i);
      const l=luma(data,(y*width+x-2)*4),r=luma(data,(y*width+x+2)*4),u=luma(data,((y-2)*width+x)*4),d=luma(data,((y+2)*width+x)*4);
      const dx=Math.abs(l-r),dy=Math.abs(u-d),lap=Math.abs(4*c-l-r-u-d);
      const local=Math.abs(c-(l+r+u+d)/4);
      n++;
      if(lap>34&&local>18){scratch++;if(dx>dy)lineHitsV[Math.min(samples-1,Math.floor(y/height*samples))]++;else lineHitsH[Math.min(samples-1,Math.floor(x/width*samples))]++}
      if(lap>42&&local>24)dent++;
      if(c>245&&local>24)white++;
      if(lap>18)texture++;
    }
  }
  const longH=lineHitsH.filter(v=>v>=Math.max(3,Math.floor(samples*.18))).length/Math.max(1,samples);
  const longV=lineHitsV.filter(v=>v>=Math.max(3,Math.floor(samples*.18))).length/Math.max(1,samples);
  const scratchRate=scratch/Math.max(1,n),dentRate=dent/Math.max(1,n),whiteRate=white/Math.max(1,n),textureRate=texture/Math.max(1,n);
  return {
    scratchScore:clamp((scratchRate*900+Math.max(longH,longV)*120)),
    creaseScore:clamp(Math.max(longH,longV)*180+dentRate*500),
    dentScore:clamp(dentRate*850),
    whiteningScore:clamp(whiteRate*700),
    textureScore:clamp(textureRate*120)
  };
}
function gradeFromScore(score:number):Grade{
  return score>=95?'Mint':score>=88?'NM':score>=78?'Excellent':score>=67?'Good':score>=54?'Played':score>=38?'Poor':'Damaged';
}
function finding(type:GradeFinding['type'],severity:DefectSeverity,confidence:number,label:string,description:string):GradeFinding{
  return {type,severity,confidence:Number(clamp(confidence,0,1).toFixed(2)),label,description};
}

export function gradeImage(image:ImageData,quadArea:number,quad?:QuadPoint[]):GradeResult{
  const centering=scoreCentering(image),corners=scoreCorners(image),edges=scoreEdges(image),surface=scoreSurface(image);
  const defects:string[]=[];
  const findings:GradeFinding[]=[];
  const areaScore=clamp((quadArea/10000)*125);
  const micro=detectSurfaceDefects(image);

  if(centering<88){defects.push('Centratura non uniforme');findings.push(finding('centering',centering<70?'medium':'low',.78,'Centratura non uniforme','I margini rilevati non sono perfettamente bilanciati.'))}
  if(corners<82){defects.push('Angoli con possibile usura o irregolarità');findings.push(finding('corner',corners<65?'high':'medium',.72,'Possibile usura degli angoli','Contrasto e micro-irregolarità nelle quattro zone d’angolo.'))}
  if(edges<82){defects.push('Bordi con possibile usura');findings.push(finding('edge',edges<65?'high':'medium',.74,'Possibile usura dei bordi','Sono presenti variazioni anomale nelle fasce perimetrali.'))}
  if(surface<82){defects.push('Superficie con possibili segni o micro-irregolarità');findings.push(finding('surface',surface<65?'high':'medium',.7,'Irregolarità superficiali','La superficie presenta variazioni superiori a quelle attese.'))}

  if(micro.scratchScore>24){defects.push('Possibili graffi o segni lineari');findings.push(finding('scratch',micro.scratchScore>55?'high':'medium',Math.min(.94,.55+micro.scratchScore/180),'Possibili graffi','Sono state rilevate discontinuità sottili e persistenti compatibili con graffi o segni di sfregamento.'))}
  if(micro.creaseScore>28){defects.push('Possibile piegatura o pressione');findings.push(finding('crease',micro.creaseScore>60?'high':'medium',Math.min(.92,.55+micro.creaseScore/170),'Possibile piegatura','Sono state rilevate variazioni lineari/continue compatibili con una piega, pressione o deformazione.'))}
  if(micro.dentScore>25){defects.push('Possibili ammaccature o punti di pressione');findings.push(finding('dent',micro.dentScore>55?'high':'medium',Math.min(.9,.52+micro.dentScore/160),'Possibili ammaccature','Sono presenti variazioni locali compatibili con pressione o piccoli urti.'))}
  if(micro.whiteningScore>24){defects.push('Possibile whitening della superficie');findings.push(finding('whitening',micro.whiteningScore>55?'high':'medium',Math.min(.9,.55+micro.whiteningScore/180),'Possibile whitening','Sono presenti aree molto chiare e localizzate compatibili con perdita di colore o sfregamento.'))}

  const stats=regionStats(image,0,0,image.width,image.height);
  if(stats.clip>.08){defects.push('Possibile sovraesposizione');findings.push(finding('lighting','medium',.9,'Sovraesposizione','Le alte luci possono nascondere difetti reali; ripetere la scansione con luce uniforme.'))}
  if(stats.contrast<16){defects.push('Contrasto basso: valutazione meno affidabile');findings.push(finding('lighting','medium',.9,'Contrasto insufficiente','La qualità dell’immagine limita la capacità di rilevare micro-difetti.'))}
  if(quad&&quad.length===4){
    const xs=quad.map(p=>p.x),ys=quad.map(p=>p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
    if(h>0&&w/h>.86){defects.push('Proporzioni della carta anomale');findings.push(finding('surface','medium',.82,'Proporzioni anomale','La geometria acquisita non rispetta bene il rapporto atteso della carta.'))}
  }

  const defectPenalty=Math.min(28,
    micro.scratchScore*.08+micro.creaseScore*.12+micro.dentScore*.08+micro.whiteningScore*.06
  );
  const score=Math.round(clamp(centering*.22+corners*.2+edges*.17+surface*.28+areaScore*.07-defectPenalty));
  const qualityPenalty=Math.min(.22,findings.length*.025);
  const confidence=clamp(.52+Math.min(.25,stats.contrast/110)+Math.min(.13,areaScore/600)-qualityPenalty);

  return {
    grade:gradeFromScore(score),score,confidence:Number(confidence.toFixed(2)),defects:[...new Set(defects)],findings,centering:Math.round(centering),
    subgrades:{centering:Math.round(centering),corners:Math.round(corners),edges:Math.round(edges),surface:Math.round(surface)}
  };
}

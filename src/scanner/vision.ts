import type {Point} from '../scanner/geometry';

export type DetectedQuad={points:Point[];confidence:number};

function luma(data:Uint8ClampedArray,i:number){return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]}

type Edge={x:number;y:number;v:number;normal:number};

function intersections(a:{theta:number;rho:number},b:{theta:number;rho:number}){
  const c1=Math.cos(a.theta),s1=Math.sin(a.theta),c2=Math.cos(b.theta),s2=Math.sin(b.theta);
  const det=c1*s2-s1*c2;if(Math.abs(det)<.08)return null;
  return {x:(a.rho*s2-b.rho*s1)/det,y:(c1*b.rho-c2*a.rho)/det};
}

function lineScore(edges:Edge[],theta:number,rho:number,w:number,h:number){
  const c=Math.cos(theta),s=Math.sin(theta),normalTol=.68;
  let score=0,count=0,orientation=0;
  for(const e of edges){
    if(Math.abs(e.x*c+e.y*s-rho)<2.8){
      const rawDiff=Math.abs(Math.atan2(Math.sin(e.normal-theta),Math.cos(e.normal-theta)));
      const diff=Math.min(rawDiff,Math.PI-rawDiff);
      if(diff>normalTol)continue;
      const along=-e.x*s+e.y*c;
      if(along>-Math.max(w,h)*.55&&along<Math.max(w,h)*.55){
        score+=e.v*(1-diff/normalTol*.55);count++;orientation+=1;
      }
    }
  }
  if(count<7)return 0;
  return score*(Math.min(1,count/55))*(.72+.28*Math.min(1,orientation/80));
}

function detectPair(edges:Edge[],theta:number,w:number,h:number){
  const maxR=Math.hypot(w,h),step=5;
  const candidates:{rho:number;score:number}[]=[];
  for(let rho=-maxR;rho<=maxR;rho+=3){
    const score=lineScore(edges,theta,rho,w,h);
    if(score>0)candidates.push({rho,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const out:{rho:number;score:number}[]=[];
  for(const cnd of candidates){
    if(out.every(x=>Math.abs(x.rho-cnd.rho)>Math.max(w,h)*.055)){
      out.push(cnd);
      if(out.length===4)break;
    }
  }
  return out;
}

function quadMetrics(points:Point[],w:number,h:number){
  const p=points.map(p=>({x:p.x/w,y:p.y/h}));
  const d=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
  const widths=[d(p[0],p[1]),d(p[3],p[2])],heights=[d(p[0],p[3]),d(p[1],p[2])];
  const aspect=(widths.reduce((a,b)=>a+b,0)/2)/Math.max(.001,heights.reduce((a,b)=>a+b,0)/2);
  const parallel=Math.abs((widths[0]-widths[1])/(widths[0]+widths[1]+.001))+Math.abs((heights[0]-heights[1])/(heights[0]+heights[1]+.001));
  return {aspect,parallel};
}

export function detectCardQuad(image:ImageData):DetectedQuad|null{
 const {width,height}=image;
 const scale=Math.min(1,720/Math.max(width,height));
 const w=Math.max(160,Math.round(width*scale)),h=Math.max(160,Math.round(height*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 const src=document.createElement('canvas');src.width=width;src.height=height;
 src.getContext('2d')?.putImageData(image,0,0);ctx.drawImage(src,0,0,w,h);
 const d=ctx.getImageData(0,0,w,h).data;
 const gray=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=luma(d,(y*w+x)*4);
 const edges:Edge[]=[];
 for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2){
  const gx=-gray[(y-1)*w+x-1]-2*gray[y*w+x-1]-gray[(y+1)*w+x-1]+gray[(y-1)*w+x+1]+2*gray[y*w+x+1]+gray[(y+1)*w+x+1];
  const gy=-gray[(y-1)*w+x-1]-2*gray[(y-1)*w+x]-gray[(y-1)*w+x+1]+gray[(y+1)*w+x-1]+2*gray[(y+1)*w+x]+gray[(y+1)*w+x+1];
  const v=Math.hypot(gx,gy);
  if(v>42)edges.push({x,y,v,normal:Math.atan2(gy,gx)});
 }
 if(edges.length<70)return null;

 let best:{top:any;bottom:any;left:any;right:any;score:number;theta:number;perp:number}|null=null;
 for(let deg=-35;deg<=35;deg+=2){
  const t=deg*Math.PI/180,perp=t+Math.PI/2;
  const horiz=detectPair(edges,perp,w,h).filter(x=>Math.abs(x.rho-h/2)<h*.49).slice(0,3);
  const vert=detectPair(edges,t,w,h).filter(x=>Math.abs(x.rho-w/2)<w*.49).slice(0,3);
  for(const a of horiz)for(const b of horiz)if(Math.abs(a.rho-b.rho)>h*.30){
   const top=a.rho<b.rho?a:b,bottom=a.rho<b.rho?b:a;
   for(const l of vert)for(const r of vert)if(Math.abs(l.rho-r.rho)>w*.18){
    const left=l.rho<r.rho?l:r,right=l.rho<r.rho?r:l;
    const pts=[intersections({theta:perp,rho:top.rho},{theta:t,rho:left.rho}),intersections({theta:perp,rho:top.rho},{theta:t,rho:right.rho}),intersections({theta:perp,rho:bottom.rho},{theta:t,rho:right.rho}),intersections({theta:perp,rho:bottom.rho},{theta:t,rho:left.rho})];
    if(pts.some(p=>!p||p.x<0||p.x>w||p.y<0||p.y>h))continue;
    const points=pts as Point[],m=quadMetrics(points,w,h);
    const area=Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%4];return s+p.x*q.y-q.x*p.y},0))/2;
    const targetAspect=.714;
    const aspectFit=Math.min(m.aspect/targetAspect,targetAspect/m.aspect);
    const ratio=aspectFit;
    if(ratio<.78||m.parallel>.34)continue;
    const coverage=Math.min(1,area/(w*h*.16));
    const score=(top.score+bottom.score+left.score+right.score)*ratio*coverage*(1-m.parallel*.65);
    if(!best||score>best.score)best={top,bottom,left,right,score,theta:t,perp};
   }
  }
 }
 if(!best)return null;
 const {top,bottom,left,right,theta,perp}=best;
 const pts=[intersections({theta:perp,rho:top.rho},{theta,rho:left.rho}),intersections({theta:perp,rho:top.rho},{theta,rho:right.rho}),intersections({theta:perp,rho:bottom.rho},{theta,rho:right.rho}),intersections({theta:perp,rho:bottom.rho},{theta,rho:left.rho})];
 if(pts.some(p=>!p))return null;
 const points=pts as Point[];
 const metrics=quadMetrics(points,w,h);
 const targetAspect=.714;
 const aspectFit=Math.min(metrics.aspect/targetAspect,targetAspect/metrics.aspect);
 const confidence=Math.min(1,.38+Math.min(.30,best.score/42000)+Math.min(.18,edges.length/(w*h)*6)+Math.max(0,.10-metrics.parallel*.18)+Math.max(0,(aspectFit-.78)*.70));
 return {points:points.map(p=>({x:p.x/w*100,y:p.y/h*100})),confidence};
}

function solve8(a:number[][],b:number[]):number[]{
 const n=8,m=a.map((r,i)=>[...r,b[i]]);
 for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(m[r][i])>Math.abs(m[p][i]))p=r;if(Math.abs(m[p][i])<1e-9)throw new Error('singular');[m[i],m[p]]=[m[p],m[i]];const d=m[i][i];for(let c=i;c<=n;c++)m[i][c]/=d;for(let r=0;r<n;r++)if(r!==i){const f=m[r][i];for(let c=i;c<=n;c++)m[r][c]-=f*m[i][c]}}
 return m.map(r=>r[n]);
}
export function perspectiveWarp(source:HTMLCanvasElement,points:Point[],outW=480,outH=672){
 const center=points.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
 const expanded=points.map(p=>({x:Math.max(0,Math.min(100,center.x+(p.x-center.x)*1.015)),y:Math.max(0,Math.min(100,center.y+(p.y-center.y)*1.015))}));
 const src=expanded.map(p=>({x:p.x/100*source.width,y:p.y/100*source.height}));
 const dst=[{x:0,y:0},{x:outW-1,y:0},{x:outW-1,y:outH-1},{x:0,y:outH-1}];
 const a:number[][]=[],b:number[]=[];
 for(let i=0;i<4;i++){const s=src[i],d=dst[i];a.push([d.x,d.y,1,0,0,0,-s.x*d.x,-s.x*d.y]);b.push(s.x);a.push([0,0,0,d.x,d.y,1,-s.y*d.x,-s.y*d.y]);b.push(s.y)}
 const [h11,h12,h13,h21,h22,h23,h31,h32]=solve8(a,b);
 const out=document.createElement('canvas');out.width=outW;out.height=outH;const ctx=out.getContext('2d',{willReadFrequently:true});if(!ctx)return source;
 const input=source.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,source.width,source.height);if(!input)return source;
 const pixels=ctx.createImageData(outW,outH),srcData=input.data;
 for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){const den=h31*x+h32*y+1,sx=(h11*x+h12*y+h13)/den,sy=(h21*x+h22*y+h23)/den,x0=Math.max(0,Math.min(source.width-1,Math.floor(sx))),y0=Math.max(0,Math.min(source.height-1,Math.floor(sy))),i=(y*outW+x)*4,j=(y0*source.width+x0)*4;pixels.data[i]=srcData[j];pixels.data[i+1]=srcData[j+1];pixels.data[i+2]=srcData[j+2];pixels.data[i+3]=255}
 ctx.putImageData(pixels,0,0);return out;
}

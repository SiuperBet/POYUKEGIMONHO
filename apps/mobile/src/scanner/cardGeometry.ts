import * as FileSystem from 'expo-file-system/legacy';
import jpeg from 'jpeg-js';

export type Point={x:number;y:number};
export type CardQuad={topLeft:Point;topRight:Point;bottomRight:Point;bottomLeft:Point};
export type GeometryResult={quad:CardQuad;confidence:number;ratio:number;centered:boolean;stableShape:boolean};

type Line={rho:number;theta:number;score:number};
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);

function b64ToBytes(input:string){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const clean=input.replace(/[^A-Za-z0-9+/=]/g,''); const out=new Uint8Array(Math.floor(clean.length*3/4));
  let buffer=0,bits=0,pos=0;
  for(const ch of clean){if(ch==='=')break;buffer=(buffer<<6)|chars.indexOf(ch);bits+=6;if(bits>=8){bits-=8;out[pos++]=(buffer>>bits)&255;}}
  return out.subarray(0,pos);
}
function intersection(a:Line,b:Line):Point|null{
  const ca=Math.cos(a.theta),sa=Math.sin(a.theta),cb=Math.cos(b.theta),sb=Math.sin(b.theta),det=ca*sb-sa*cb;
  if(Math.abs(det)<1e-5)return null;
  return {x:(a.rho*sb-sa*b.rho)/det,y:(ca*b.rho-a.rho*cb)/det};
}
function order(points:Point[]):CardQuad|null{
  if(points.length!==4)return null;
  const cx=points.reduce((s,p)=>s+p.x,0)/4,cy=points.reduce((s,p)=>s+p.y,0)/4;
  const sorted=[...points].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  const start=sorted.reduce((i,p,idx)=>p.x+p.y<sorted[i].x+sorted[i].y?idx:i,0),s=[...sorted.slice(start),...sorted.slice(0,start)];
  if(cross(s[0],s[1],s[2])<0){const [a,b,c,d]=s;return {topLeft:a,topRight:d,bottomRight:c,bottomLeft:b};}
  return {topLeft:s[0],topRight:s[1],bottomRight:s[2],bottomLeft:s[3]};
}
function hough(gray:Uint8Array,w:number,h:number):Line[]{
  const thetaCount=90,maxR=Math.ceil(Math.hypot(w,h)),strideR=maxR*2+1,bins=new Float32Array(thetaCount*strideR),edges:number[]=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const gx=-gray[(y-1)*w+x-1]+gray[(y-1)*w+x+1]-2*gray[y*w+x-1]+2*gray[y*w+x+1]-gray[(y+1)*w+x-1]+gray[(y+1)*w+x+1];
    const gy=-gray[(y-1)*w+x-1]-2*gray[(y-1)*w+x]-gray[(y-1)*w+x+1]+gray[(y+1)*w+x-1]+2*gray[(y+1)*w+x]+gray[(y+1)*w+x+1];
    if(Math.abs(gx)+Math.abs(gy)>135)edges.push(x,y);
  }
  const stride=Math.max(1,Math.ceil(edges.length/2/1400));
  for(let i=0;i<edges.length;i+=2*stride){const x=edges[i],y=edges[i+1];for(let t=0;t<thetaCount;t++){const th=t*Math.PI/thetaCount;bins[t*strideR+Math.round(x*Math.cos(th)+y*Math.sin(th))+maxR]++;}}
  const peaks:Line[]=[];
  for(let t=0;t<thetaCount;t++)for(let r=1;r<strideR-1;r++){
    const score=bins[t*strideR+r];if(score<7||score<bins[t*strideR+r-1]||score<bins[t*strideR+r+1])continue;
    const rho=r-maxR,theta=t*Math.PI/thetaCount;
    if(peaks.some(p=>{const da=Math.abs(Math.atan2(Math.sin(theta-p.theta),Math.cos(theta-p.theta)));return Math.min(da,Math.PI-da)<0.07&&Math.abs(rho-p.rho)<10;}))continue;
    peaks.push({rho,theta,score});
  }
  return peaks.sort((a,b)=>b.score-a.score).slice(0,28);
}
export async function detectCardGeometry(uri:string):Promise<GeometryResult|null>{
  const b64=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64}),raw=jpeg.decode(b64ToBytes(b64),{useTArray:true});
  const scale=Math.min(1,180/raw.width),w=Math.max(90,Math.round(raw.width*scale)),h=Math.max(90,Math.round(raw.height*scale)),gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(raw.width-1,Math.floor(x/scale)),sy=Math.min(raw.height-1,Math.floor(y/scale)),i=(sy*raw.width+sx)*4;gray[y*w+x]=(77*raw.data[i]+150*raw.data[i+1]+29*raw.data[i+2])>>8;}
  const lines=hough(gray,w,h),horiz=lines.filter(l=>{const t=((l.theta%Math.PI)+Math.PI)%Math.PI;return t<0.34||t>2.80;}),vert=lines.filter(l=>Math.abs((((l.theta%Math.PI)+Math.PI)%Math.PI)-Math.PI/2)<0.34);
  let best:{quad:CardQuad;score:number}|null=null;
  for(const top of horiz)for(const bottom of horiz)for(const left of vert)for(const right of vert){
    if(top===bottom||left===right)continue;
    const p1=intersection(top,left),p2=intersection(top,right),p3=intersection(bottom,right),p4=intersection(bottom,left);if(!p1||!p2||!p3||!p4)continue;
    if([p1,p2,p3,p4].some(p=>p.x<-w*.2||p.x>w*1.2||p.y<-h*.2||p.y>h*1.2))continue;
    const q=order([p1,p2,p3,p4]);if(!q)continue;
    const width=(dist(q.topLeft,q.topRight)+dist(q.bottomLeft,q.bottomRight))/2,height=(dist(q.topLeft,q.bottomLeft)+dist(q.topRight,q.bottomRight))/2;if(width<28||height<40)continue;
    // Reject quadrilaterals that are geometrically plausible but do not look
    // like the outer card: opposite sides must remain approximately parallel
    // and all four corners should stay safely inside the preview.
    const topLen=dist(q.topLeft,q.topRight),bottomLen=dist(q.bottomLeft,q.bottomRight);
    const leftLen=dist(q.topLeft,q.bottomLeft),rightLen=dist(q.topRight,q.bottomRight);
    const angle=(a:Point,b:Point)=>Math.atan2(b.y-a.y,b.x-a.x);
    const parallelGap=(a:number,b:number)=>{const d=Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));return Math.min(d,Math.PI-d);};
    const horizontalParallel=parallelGap(angle(q.topLeft,q.topRight),angle(q.bottomLeft,q.bottomRight));
    const verticalParallel=parallelGap(angle(q.topLeft,q.bottomLeft),angle(q.topRight,q.bottomRight));
    if(horizontalParallel>0.28||verticalParallel>0.28)continue;
    if(Math.min(topLen,bottomLen)/Math.max(topLen,bottomLen)<.62)continue;
    if(Math.min(leftLen,rightLen)/Math.max(leftLen,rightLen)<.62)continue;
    const margin=Math.min(q.topLeft.x,q.topRight.x,q.bottomRight.x,q.bottomLeft.x,w-q.topLeft.x,w-q.topRight.x,w-q.bottomRight.x,w-q.bottomLeft.x);
    const marginScore=clamp(1-Math.max(0,margin<3?3-margin:0)/3);
    const ratio=width/height; // A Pokémon/Yu-Gi-Oh! card is approximately 63:88. Reject inner artwork frames and furniture edges before scoring them as cards. if(ratio<.50||ratio>.95)continue; const ratioScore=clamp(1-Math.abs(ratio-63/88)/(63/88*.32)); const area=(Math.abs(cross(q.topLeft,q.topRight,q.bottomRight))+Math.abs(cross(q.topLeft,q.bottomRight,q.bottomLeft)))/(w*h); if(area<.025)continue; const areaScore=clamp(area/.18); const parallelScore=clamp(1-(horizontalParallel+verticalParallel)/.56); const lineScore=clamp((top.score+bottom.score+left.score+right.score)/150); const score=ratioScore*.62+areaScore*.12+parallelScore*.14+lineScore*.12;
    if(!best||score>best.score)best={quad:q,score};
  }
  if(!best)return null;
  const q=best.quad,cx=(q.topLeft.x+q.topRight.x+q.bottomRight.x+q.bottomLeft.x)/4/w,cy=(q.topLeft.y+q.topRight.y+q.bottomRight.y+q.bottomLeft.y)/4/h,width=(dist(q.topLeft,q.topRight)+dist(q.bottomLeft,q.bottomRight))/2,height=(dist(q.topLeft,q.bottomLeft)+dist(q.topRight,q.bottomRight))/2,ratio=width/height,confidence=clamp(best.score);
  return {quad:{topLeft:{x:q.topLeft.x/w,y:q.topLeft.y/h},topRight:{x:q.topRight.x/w,y:q.topRight.y/h},bottomRight:{x:q.bottomRight.x/w,y:q.bottomRight.y/h},bottomLeft:{x:q.bottomLeft.x/w,y:q.bottomLeft.y/h}},confidence,ratio,centered:Math.abs(cx-.5)<.13&&Math.abs(cy-.5)<.13,stableShape:confidence>=.58&&Math.abs(ratio-63/88)<.14};
}

import type {Point} from '../scanner/geometry';

export type DetectedQuad={points:Point[];confidence:number};

function luma(data:Uint8ClampedArray,i:number){return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]}

export function detectCardQuad(image:ImageData):DetectedQuad|null{
 const {width,height}=image;
 const scale=Math.min(1,720/Math.max(width,height));
 const w=Math.max(80,Math.round(width*scale)),h=Math.max(80,Math.round(height*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 const src=document.createElement('canvas');src.width=width;src.height=height;src.getContext('2d')?.putImageData(image,0,0);
 ctx.drawImage(src,0,0,w,h);const d=ctx.getImageData(0,0,w,h).data;
 const gray=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=luma(d,(y*w+x)*4);
 const edges:Array<{x:number;y:number;v:number}>=[];let sum=0;
 for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2){
  const gx=-gray[(y-1)*w+x-1]-2*gray[y*w+x-1]-gray[(y+1)*w+x-1]+gray[(y-1)*w+x+1]+2*gray[y*w+x+1]+gray[(y+1)*w+x+1];
  const gy=-gray[(y-1)*w+x-1]-2*gray[(y-1)*w+x]-gray[(y-1)*w+x+1]+gray[(y+1)*w+x-1]+2*gray[(y+1)*w+x]+gray[(y+1)*w+x+1];
  const v=Math.hypot(gx,gy);sum+=v;if(v>85)edges.push({x,y,v});
 }
 if(edges.length<40)return null;
 const mean=sum/((Math.floor(h/2)-2)*(Math.floor(w/2)-2));
 const minX=Math.min(...edges.map(e=>e.x)),maxX=Math.max(...edges.map(e=>e.x)),minY=Math.min(...edges.map(e=>e.y)),maxY=Math.max(...edges.map(e=>e.y));
 const ew=maxX-minX,eh=maxY-minY;
 if(ew<w*.32||eh<h*.38)return null;
 const aspect=ew/eh;
 if(aspect<.45||aspect>.9)return null;
 const points:[Point,Point,Point,Point]=[
  {x:minX/w*100,y:minY/h*100},{x:maxX/w*100,y:minY/h*100},
  {x:maxX/w*100,y:maxY/h*100},{x:minX/w*100,y:maxY/h*100}
 ];
 const density=Math.min(1,edges.length/(w*h*.08));
 const confidence=Math.min(1,.45+density*.25+Math.min(1,mean/90)*.2+(1-Math.abs(aspect-.72))*0.1);
 return {points,confidence};
}

function solve8(a:number[][],b:number[]):number[]{
 const n=8,m=a.map((r,i)=>[...r,b[i]]);
 for(let i=0;i<n;i++){
  let p=i;for(let r=i+1;r<n;r++)if(Math.abs(m[r][i])>Math.abs(m[p][i]))p=r;
  if(Math.abs(m[p][i])<1e-9)throw new Error('singular');
  [m[i],m[p]]=[m[p],m[i]];
  const d=m[i][i];for(let c=i;c<=n;c++)m[i][c]/=d;
  for(let r=0;r<n;r++)if(r!==i){const f=m[r][i];for(let c=i;c<=n;c++)m[r][c]-=f*m[i][c]}
 }
 return m.map(r=>r[n]);
}

export function perspectiveWarp(source:HTMLCanvasElement,points:Point[],outW=480,outH=672){
 const src=points.map(p=>({x:p.x/100*source.width,y:p.y/100*source.height}));
 const dst=[{x:0,y:0},{x:outW-1,y:0},{x:outW-1,y:outH-1},{x:0,y:outH-1}];
 const a:number[][]=[],b:number[]=[];
 for(let i=0;i<4;i++){const s=src[i],d=dst[i];a.push([d.x,d.y,1,0,0,0,-s.x*d.x,-s.x*d.y]);b.push(s.x);a.push([0,0,0,d.x,d.y,1,-s.y*d.x,-s.y*d.y]);b.push(s.y)}
 const [h11,h12,h13,h21,h22,h23,h31,h32]=solve8(a,b);
 const out=document.createElement('canvas');out.width=outW;out.height=outH;
 const ctx=out.getContext('2d',{willReadFrequently:true});if(!ctx)return source;
 const input=source.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,source.width,source.height);if(!input)return source;
 const pixels=ctx.createImageData(outW,outH),srcData=input.data;
 for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){
  const den=h31*x+h32*y+1,sx=(h11*x+h12*y+h13)/den,sy=(h21*x+h22*y+h23)/den;
  const x0=Math.max(0,Math.min(source.width-1,Math.floor(sx))),y0=Math.max(0,Math.min(source.height-1,Math.floor(sy)));
  const i=(y* outW+x)*4,j=(y0*source.width+x0)*4;
  pixels.data[i]=srcData[j];pixels.data[i+1]=srcData[j+1];pixels.data[i+2]=srcData[j+2];pixels.data[i+3]=255;
 }
 ctx.putImageData(pixels,0,0);return out;
}

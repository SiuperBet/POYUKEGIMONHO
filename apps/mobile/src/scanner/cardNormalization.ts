import * as FileSystem from 'expo-file-system/legacy';
import jpeg from 'jpeg-js';
import type {CardQuad} from './cardGeometry';

export type NormalizedCard={
  uri:string;width:number;height:number;sourceWidth:number;sourceHeight:number;quad:CardQuad;
  quality:{score:number;blurRisk:boolean;darkRisk:boolean;reflectionRisk:boolean};
};

const TARGET_W=630,TARGET_H=880;
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);

function b64ToBytes(input:string){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';const clean=input.replace(/[^A-Za-z0-9+/=]/g,'');const out=new Uint8Array(Math.floor(clean.length*3/4));let buffer=0,bits=0,pos=0;
  for(const ch of clean){if(ch==='=')break;buffer=(buffer<<6)|chars.indexOf(ch);bits+=6;if(bits>=8){bits-=8;out[pos++]=(buffer>>bits)&255;}}
  return out.subarray(0,pos);
}
function bytesToB64(bytes:Uint8Array){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;out+=chars[a>>2]+chars[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?chars[((b&15)<<2)|(c>>6)]:'=')+(i+2<bytes.length?chars[c&63]:'=');}return out;
}
function solveHomography(src:{x:number;y:number}[],dst:{x:number;y:number}[]){
  const A:number[][]=[],B:number[]=[];
  for(let i=0;i<4;i++){const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v);}
  for(let i=0;i<8;i++){let p=i;for(let r=i+1;r<8;r++)if(Math.abs(A[r][i])>Math.abs(A[p][i]))p=r;[A[i],A[p]]=[A[p],A[i]];[B[i],B[p]]=[B[p],B[i]];const pivot=A[i][i];if(Math.abs(pivot)<1e-9)throw new Error('HOMOGRAPHY_SINGULAR');for(let c=i;c<8;c++)A[i][c]/=pivot;B[i]/=pivot;for(let r=0;r<8;r++)if(r!==i){const f=A[r][i];if(!f)continue;for(let c=i;c<8;c++)A[r][c]-=f*A[i][c];B[r]-=f*B[i];}}
  return [...B,1];
}
function sample(data:Uint8Array,w:number,h:number,x:number,y:number){
  x=clamp(x,0,w-1);y=clamp(y,0,h-1);const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;
  const out=[0,0,0,255];for(let c=0;c<3;c++){const p00=data[(y0*w+x0)*4+c],p10=data[(y0*w+x1)*4+c],p01=data[(y1*w+x0)*4+c],p11=data[(y1*w+x1)*4+c];out[c]=Math.round((p00+(p10-p00)*fx)*(1-fy)+(p01+(p11-p01)*fx)*fy);}return out;
}
function quality(q:CardQuad){
  const top=dist(q.topLeft,q.topRight),bottom=dist(q.bottomLeft,q.bottomRight),left=dist(q.topLeft,q.bottomLeft),right=dist(q.topRight,q.bottomRight),ratio=((top+bottom)/2)/Math.max(1,(left+right)/2);
  const ratioScore=clamp(1-Math.abs(ratio-63/88)/(63/88*.28)),symmetry=1-clamp((Math.abs(top-bottom)/Math.max(top,bottom)+Math.abs(left-right)/Math.max(left,right))*.5);
  return {score:clamp(ratioScore*.7+symmetry*.3),blurRisk:false,darkRisk:false,reflectionRisk:false};
}
export async function normalizeCardImage(uri:string,quad:CardQuad):Promise<NormalizedCard>{
  const b64=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});
  const raw=jpeg.decode(b64ToBytes(b64),{useTArray:true,formatAsRGBA:true,tolerantDecoding:true,maxResolutionInMP:6});
  const src=[{x:quad.topLeft.x*(raw.width-1),y:quad.topLeft.y*(raw.height-1)},{x:quad.topRight.x*(raw.width-1),y:quad.topRight.y*(raw.height-1)},{x:quad.bottomRight.x*(raw.width-1),y:quad.bottomRight.y*(raw.height-1)},{x:quad.bottomLeft.x*(raw.width-1),y:quad.bottomLeft.y*(raw.height-1)}];
  const dst=[{x:0,y:0},{x:TARGET_W-1,y:0},{x:TARGET_W-1,y:TARGET_H-1},{x:0,y:TARGET_H-1}],h=solveHomography(dst,src),out=new Uint8Array(TARGET_W*TARGET_H*4);
  for(let y=0;y<TARGET_H;y++)for(let x=0;x<TARGET_W;x++){const d=h[6]*x+h[7]*y+1,sx=(h[0]*x+h[1]*y+h[2])/d,sy=(h[3]*x+h[4]*y+h[5])/d,p=sample(raw.data as Uint8Array,raw.width,raw.height,sx,sy),i=(y*TARGET_W+x)*4;out[i]=p[0];out[i+1]=p[1];out[i+2]=p[2];out[i+3]=255;}
  const encoded=jpeg.encode({data:out,width:TARGET_W,height:TARGET_H},94).data;
  const output=(FileSystem.cacheDirectory||FileSystem.documentDirectory||'')+'cardgrade-normalized-'+Date.now()+'.jpg';
  await FileSystem.writeAsStringAsync(output,bytesToB64(encoded),{encoding:FileSystem.EncodingType.Base64});
  return {uri:output,width:TARGET_W,height:TARGET_H,sourceWidth:raw.width,sourceHeight:raw.height,quad,quality:quality(quad)};
}

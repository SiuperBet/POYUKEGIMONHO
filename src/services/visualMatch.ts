import type {CatalogCard} from './catalog';

function hashCanvas(canvas:HTMLCanvasElement):number[]{
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return [];
 const size=16;const c=document.createElement('canvas');c.width=size;c.height=size;c.getContext('2d')!.drawImage(canvas,0,0,size,size);
 const d=c.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,size,size).data;
 const values:number[]=[];for(let i=0;i<d.length;i+=4)values.push(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]);
 const avg=values.reduce((a,b)=>a+b,0)/values.length;return values.map(v=>v>=avg?1:0);
}
function hamming(a:number[],b:number[]){if(!a.length||!b.length)return 1;let n=0;for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])n++;return n/Math.min(a.length,b.length)}
async function loadImage(url:string):Promise<HTMLImageElement|null>{
 return new Promise(resolve=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=url});
}
export async function rankVisualMatches(blob:Blob,candidates:CatalogCard[]){
 if(candidates.length<2)return candidates;
 const source=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=source.width;c.height=source.height;c.getContext('2d')!.drawImage(source,0,0);source.close();
 const target=hashCanvas(c);
 const scored=await Promise.all(candidates.map(async card=>{
  if(!card.image)return {card,score:1};const img=await loadImage(card.image);if(!img)return {card,score:1};
  const cc=document.createElement('canvas');cc.width=img.naturalWidth;cc.height=img.naturalHeight;cc.getContext('2d')!.drawImage(img,0,0);
  return {card,score:hamming(target,hashCanvas(cc))};
 }));
 return scored.sort((a,b)=>a.score-b.score).map(x=>x.card);
}

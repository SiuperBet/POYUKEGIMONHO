import {createWorker} from 'tesseract.js';

let workerPromise:Promise<any>|null=null;

async function worker(){
 if(!workerPromise)workerPromise=createWorker(['eng','ita']);
 return workerPromise;
}

async function makeVariant(source:Blob,top:number,height:number,mode:'name'|'number'|'full',threshold=false):Promise<Blob|null>{
 const img=await createImageBitmap(source);
 const scale=4;
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(img.width*scale));
 canvas.height=Math.max(1,Math.round(img.height*height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx){img.close();return null}
 ctx.drawImage(img,0,Math.round(-img.height*top*scale),canvas.width,img.height*scale);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<pixels.data.length;i+=4){
  const y=.2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2];
  let v=mode==='number'?(y>155?255:0):Math.max(0,Math.min(255,(y-118)*1.7+128));
  if(threshold&&mode!=='number')v=v>150?255:0;
  pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;
 }
 ctx.putImageData(pixels,0,0);img.close();
 return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
}

async function recognizePass(w:any,blob:Blob,psm:string,numberMode=false){
 await w.setParameters({
  tessedit_pageseg_mode:psm,
  preserve_interword_spaces:'1',
  tessedit_char_whitelist:numberMode?'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-/.':''
 });
 const result=await w.recognize(blob);
 return {text:String(result.data.text||'').replace(/\s+/g,' ').trim(),confidence:Number(result.data.confidence||0)/100};
}

export async function recognizeText(blob:Blob,onProgress?:(value:number)=>void){
 const w=await worker();
 const variants=await Promise.all([
  makeVariant(blob,0,.28,'full',false),
  makeVariant(blob,0,.28,'full',true)
 ]);
 let best={text:'',confidence:0};
 for(const v of variants.filter(Boolean) as Blob[]){
  try{const result=await recognizePass(w,v,'6');if(result.confidence>best.confidence||result.text.length>best.text.length)best=result;onProgress?.(best.confidence)}catch{}
 }
 return best;
}

export async function recognizeCardText(blob:Blob){
 const w=await worker();
 const specs=[
  {top:.015,height:.18,mode:'name' as const,psm:'7',threshold:false},
  {top:.04,height:.24,mode:'name' as const,psm:'11',threshold:true},
  {top:.72,height:.28,mode:'number' as const,psm:'7',threshold:false},
  {top:0,height:1,mode:'full' as const,psm:'11',threshold:false},
  {top:0,height:1,mode:'full' as const,psm:'6',threshold:true}
 ];
 const texts:string[]=[];let confidence=0;
 for(const spec of specs){
  const variant=await makeVariant(blob,spec.top,spec.height,spec.mode,spec.threshold);
  if(!variant)continue;
  try{
   const result=await recognizePass(w,variant,spec.psm,spec.mode==='number');
   if(result.text)texts.push(result.text);
   confidence=Math.max(confidence,result.confidence);
  }catch{}
 }
 return {text:[...new Set(texts)].join('\n'),confidence};
}

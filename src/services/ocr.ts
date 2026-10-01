import {createWorker} from 'tesseract.js';

let workerPromise:Promise<any>|null=null;

async function worker(){
 if(!workerPromise)workerPromise=createWorker(['eng','ita']);
 return workerPromise;
}

async function makeVariant(source:Blob,top:number,height:number,mode:'name'|'number'|'full'):Promise<Blob|null>{
 const img=await createImageBitmap(source);
 const scale=3;
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(img.width*scale));
 canvas.height=Math.max(1,Math.round(img.height*height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 ctx.drawImage(img,0,Math.round(-img.height*top*scale),canvas.width,img.height*scale);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<pixels.data.length;i+=4){
  const y=.2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2];
  const v=mode==='number'?(y>145?255:0):Math.max(0,Math.min(255,(y-128)*1.45+128));
  pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;
 }
 ctx.putImageData(pixels,0,0);
 img.close();
 return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
}

async function recognizePass(w:any,blob:Blob,psm:string){
 await w.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
 const result=await w.recognize(blob);
 return {text:String(result.data.text||'').trim(),confidence:Number(result.data.confidence||0)/100};
}

export async function recognizeText(blob:Blob,onProgress?:(value:number)=>void){
 const w=await worker();
 const result=await recognizePass(w,blob,'6');
 const confidence=result.confidence;
 onProgress?.(confidence);
 return {text:result.text,confidence};
}

export async function recognizeCardText(blob:Blob){
 const w=await worker();
 const passes=[
  {blob:await makeVariant(blob,0,.23,'name'),psm:'7'},
  {blob:await makeVariant(blob,.77,.23,'number'),psm:'6'},
  {blob:await makeVariant(blob,0,1,'full'),psm:'6'}
 ].filter(x=>x.blob) as Array<{blob:Blob;psm:string}>;
 const texts:string[]=[];
 let confidence=0;
 for(const pass of passes){
  try{
   const result=await recognizePass(w,pass.blob,pass.psm);
   if(result.text)texts.push(result.text);
   confidence=Math.max(confidence,result.confidence);
  }catch{}
 }
 return {text:[...new Set(texts)].join('\n'),confidence};
}

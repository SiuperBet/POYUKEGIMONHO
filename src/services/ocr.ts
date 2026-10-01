import {createWorker} from 'tesseract.js';

let workerPromise:Promise<any>|null=null;

async function worker(){
 if(!workerPromise)workerPromise=createWorker(['eng','ita']);
 return workerPromise;
}

async function regionBlob(source:Blob,top:number,height:number):Promise<Blob|null>{
 const img=await createImageBitmap(source);
 const scale=2.5;
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(img.width*scale));
 canvas.height=Math.max(1,Math.round(img.height*height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 ctx.filter='contrast(1.25) brightness(1.04)';
 ctx.drawImage(img,0,Math.round(-img.height*top*scale),canvas.width,img.height*scale);
 img.close();
 return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
}

export async function recognizeText(blob:Blob,onProgress?:(value:number)=>void){
 const w=await worker();
 const result=await w.recognize(blob);
 const confidence=result.data.confidence/100;
 onProgress?.(confidence);
 return {text:result.data.text.trim(),confidence};
}

export async function recognizeCardText(blob:Blob){
 const w=await worker();
 const regions=[
  await regionBlob(blob,0,.24),
  await regionBlob(blob,.76,.24)
 ].filter(Boolean) as Blob[];
 const texts:string[]=[];
 let confidence=0;
 for(const part of regions){
  const result=await w.recognize(part);
  texts.push(result.data.text.trim());
  confidence=Math.max(confidence,result.data.confidence/100);
 }
 return {text:texts.filter(Boolean).join('\n'),confidence};
}

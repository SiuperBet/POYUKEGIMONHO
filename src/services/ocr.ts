import {createWorker} from 'tesseract.js';

let workerPromise:ReturnType<typeof createWorker>|null=null;

export async function recognizeText(blob:Blob,onProgress?:(value:number)=>void){
  if(!workerPromise)workerPromise=createWorker('eng+ita');
  const worker=await workerPromise;
  const result=await worker.recognize(blob);
  const confidence=result.data.confidence/100;
  onProgress?.(confidence);
  return {text:result.data.text.trim(),confidence};
}

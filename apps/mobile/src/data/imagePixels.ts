import jpeg from 'jpeg-js';

export type DecodedPixels={width:number;height:number;data:Uint8Array};

function base64ToBytes(base64:string):Uint8Array{
  const clean=base64.replace(/^data:image\/\w+;base64,/,'');
  const binary=globalThis.atob(clean);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

export function decodeJpegBase64(base64:string):DecodedPixels{
  const decoded=jpeg.decode(base64ToBytes(base64),{useTArray:true,formatAsRGBA:true,tolerantDecoding:true,maxResolutionInMP:4});
  if(!decoded?.data||!decoded.width||!decoded.height)throw new Error('Decodifica JPEG fallita');
  return {width:decoded.width,height:decoded.height,data:decoded.data as Uint8Array};
}

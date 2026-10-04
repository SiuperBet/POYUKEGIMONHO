import type {DecodedPixels} from '../data/imagePixels';

export type CardQuality={
  score:number;
  blurRisk:boolean;
  darkRisk:boolean;
  reflectionRisk:boolean;
  clippedRisk:boolean;
  readable:boolean;
  metrics:{
    meanLuma:number;
    darkRatio:number;
    brightRatio:number;
    gradientEnergy:number;
    edgeEnergy:number;
  };
};

const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));

export function assessCardQuality(image:DecodedPixels):CardQuality{
  const {width,height,data}=image;
  const total=width*height;
  let sum=0,dark=0,bright=0,gradSum=0,edgeSum=0;
  const gray=new Uint8Array(total);

  for(let i=0,p=0;i<total;i++,p+=4){
    const y=0.2126*data[p]+0.7152*data[p+1]+0.0722*data[p+2];
    gray[i]=y;
    sum+=y;
    if(y<38)dark++;
    if(y>248)bright++;
  }

  for(let y=1;y<height-1;y++){
    for(let x=1;x<width-1;x++){
      const i=y*width+x;
      const gx=gray[i+1]-gray[i-1];
      const gy=gray[i+width]-gray[i-width];
      const g=Math.abs(gx)+Math.abs(gy);
      gradSum+=g;
      edgeSum+=Math.min(255,g);
    }
  }

  const meanLuma=sum/total;
  const darkRatio=dark/total;
  const brightRatio=bright/total;
  const gradientEnergy=gradSum/Math.max(1,(width-2)*(height-2));
  const edgeEnergy=edgeSum/Math.max(1,(width-2)*(height-2));

  // Thresholds are deliberately conservative: a card should be readable by OCR
  // and defect analysis, not merely "look like" a valid photo.
  const blurRisk=gradientEnergy<7.5 || edgeEnergy<5.5;
  const darkRisk=meanLuma<58 || darkRatio>0.22;
  const reflectionRisk=brightRatio>0.16;

  const lumaScore=clamp((meanLuma-38)/55);
  const darkScore=1-clamp(darkRatio/0.28);
  const brightScore=1-clamp(brightRatio/0.20);
  const detailScore=clamp((gradientEnergy-5)/16);
  const score=clamp(lumaScore*.22+darkScore*.22+brightScore*.18+detailScore*.38);
  const readable=score>=.56&&!blurRisk&&!darkRisk&&!reflectionRisk;

  return {
    score,blurRisk,darkRisk,reflectionRisk,clippedRisk:false,readable,
    metrics:{meanLuma,darkRatio,brightRatio,gradientEnergy,edgeEnergy}
  };
}

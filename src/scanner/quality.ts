export type QualityInput={areaRatio:number;aspectRatio:number;brightness:number;contrast:number;edgeConfidence:number};
export type QualityResult={ok:boolean;score:number;reasons:string[]};
export function evaluateQuality(input:QualityInput):QualityResult{
 const reasons:string[]=[];
 if(input.areaRatio<0.18)reasons.push('area-too-small');
 if(input.areaRatio>0.92)reasons.push('area-too-large');
 if(input.aspectRatio<0.52||input.aspectRatio>0.86)reasons.push('aspect-ratio');
 if(input.brightness<45||input.brightness>225)reasons.push('brightness');
 if(input.contrast<18)reasons.push('low-contrast');
 if(input.edgeConfidence<0.35)reasons.push('weak-edges');
 const score=Math.max(0,Math.min(1,(1-reasons.length/6)*.7+Math.min(1,input.edgeConfidence)*.3));
 return {ok:reasons.length===0,score,reasons};
}
export function estimateImageQuality(data:ImageData,width:number,height:number){
 let sum=0,sumSq=0,edge=0,count=0;
 const step=Math.max(1,Math.floor(Math.min(width,height)/160));
 for(let y=step;y<height-step;y+=step){for(let x=step;x<width-step;x+=step){const i=(y*width+x)*4;const r=data.data[i],g=data.data[i+1],b=data.data[i+2];const l=.2126*r+.7152*g+.0722*b;sum+=l;sumSq+=l*l;const j=((y+step)*width+x)*4;const l2=.2126*data.data[j]+.7152*data.data[j+1]+.0722*data.data[j+2];edge+=Math.abs(l-l2);count++;}}
 const brightness=count?sum/count:0;const contrast=count?Math.sqrt(Math.max(0,sumSq/count-brightness*brightness)):0;
 return {brightness,contrast,edgeConfidence:Math.min(1,edge/(Math.max(1,count)*42))};
}
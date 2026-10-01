export type Grade='Mint'|'NM'|'Excellent'|'Good'|'Played'|'Poor'|'Damaged';

export interface GradeResult{grade:Grade;score:number;confidence:number;defects:string[];centering:number}

export function gradeImage(image:ImageData,quadArea:number):GradeResult{
  let sum=0,sum2=0,brightPixels=0;
  const data=image.data;
  for(let i=0;i<data.length;i+=4){
    const v=(data[i]+data[i+1]+data[i+2])/3;
    sum+=v;sum2+=v*v;if(v>245||v<12)brightPixels++;
  }
  const n=Math.max(1,data.length/4);
  const mean=sum/n;
  const variance=Math.max(0,sum2/n-mean*mean);
  const contrast=Math.sqrt(variance);
  const clipped=brightPixels/n;
  const score=Math.max(0,Math.min(100,82+(contrast>28?8:0)-(clipped>0.08?15:0)+(quadArea>1800?5:0)));
  const grade:Grade=score>=96?'Mint':score>=90?'NM':score>=82?'Excellent':score>=72?'Good':score>=60?'Played':score>=45?'Poor':'Damaged';
  const defects:string[]=[];
  if(clipped>0.08)defects.push('Possibili alte luci/zone sovraesposte');
  if(contrast<18)defects.push('Contrasto basso: superficie difficile da valutare');
  return {grade,score,confidence:Math.min(.92,.55+contrast/120),defects,centering:Math.max(0,Math.min(100,98-Math.abs(50-50)))};
}

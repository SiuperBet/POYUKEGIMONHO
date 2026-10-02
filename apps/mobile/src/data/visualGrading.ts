import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';
import {Skia,ColorType,AlphaType} from '@shopify/react-native-skia';
import type {Condition} from './store';

export type VisualDefectType='graffi'|'pieghe'|'puntini_bianchi'|'sporco'|'imperfezioni';
export type VisualDefect={type:VisualDefectType;severity:'low'|'medium'|'high';score:number;confidence:number};
export type VisualAnalysis={condition:Condition;score:number;confidence:number;frontQuality:number;backQuality?:number;defects:VisualDefect[];hasBack:boolean;engine:'local-vision-assisted';notes:string[]};

function clamp(v:number,min=0,max=100){return Math.max(min,Math.min(max,v))}
function conditionFromScore(score:number):Condition{
  if(score>=97)return 'Mint'; if(score>=92)return 'NM'; if(score>=82)return 'Excellent'; if(score>=70)return 'Good'; if(score>=55)return 'Played'; if(score>=35)return 'Poor'; return 'Damaged';
}
function severity(score:number):VisualDefect['severity']{return score>=70?'high':score>=38?'medium':'low'}

async function inspect(uri:string){
  const small=await ImageManipulator.manipulateAsync(uri,[{resize:{width:480}}],{compress:0.9,format:SaveFormat.JPEG,base64:true});
  if(!small.base64)throw new Error('Immagine non disponibile');
  const image=Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(small.base64));
  if(!image)throw new Error('Decodifica immagine fallita');
  const width=image.width(),height=image.height();
  const pixels=image.readPixels(0,0,{width,height,colorType:ColorType.RGBA_8888,alphaType:AlphaType.Unpremul});
  if(!pixels)throw new Error('Pixel non disponibili');
  const gray=new Float32Array(width*height);
  let sum=0,sum2=0;
  for(let i=0,p=0;i<gray.length;i++,p+=4){const y=.299*pixels[p]+.587*pixels[p+1]+.114*pixels[p+2];gray[i]=y;sum+=y;sum2+=y*y}
  const mean=sum/gray.length;const variance=Math.max(0,sum2/gray.length-mean*mean);
  let gradient=0,lap=0,edgeWhite=0,edgeDark=0,thinLines=0,interiorHigh=0;
  const borderX=Math.max(2,Math.floor(width*.08)),borderY=Math.max(2,Math.floor(height*.08));
  let samples=0,interiorSamples=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,c=gray[i],dx=Math.abs(gray[i+1]-gray[i-1]),dy=Math.abs(gray[i+width]-gray[i-width]);
    const g=(dx+dy)*.5;gradient+=g;samples++;
    const l=Math.abs(4*c-gray[i-1]-gray[i+1]-gray[i-width]-gray[i+width]);lap+=l*l;
    const border=x<borderX||x>=width-borderX||y<borderY||y>=height-borderY;
    const p=i*4;const r=pixels[p],gch=pixels[p+1],b=pixels[p+2];const lum=.299*r+.587*gch+.114*b;const sat=Math.max(r,gch,b)-Math.min(r,gch,b);
    if(border){if(lum>220&&sat<35)edgeWhite++;if(lum<45)edgeDark++}
    const interior=x>borderX&&x<width-borderX&&y>borderY&&y<height-borderY;
    if(interior){interiorSamples++;if(l>42)interiorHigh++;if(g>28&&Math.max(dx,dy)/(dx+dy+1)>.72)thinLines++}
  }
  const blurMetric=clamp(Math.sqrt(lap/Math.max(1,samples))*2.3);
  const sharpness=clamp(blurMetric*1.35);
  const whiteRatio=clamp(edgeWhite/Math.max(1,(width*height)*.16)*100);
  const darkRatio=clamp(edgeDark/Math.max(1,(width*height)*.16)*100);
  const highRatio=clamp(interiorHigh/Math.max(1,interiorSamples)*100);
  const lineRatio=clamp(thinLines/Math.max(1,interiorSamples)*100);
  const quality=clamp(55+sharpness*.45-Math.max(0,Math.abs(mean-128)-100)*.2);
  const scratches=clamp((highRatio*.85+lineRatio*1.5)-18);
  const creases=clamp(lineRatio*3.2-7);
  const whitening=clamp(whiteRatio*1.8-7);
  const dirt=clamp(darkRatio*1.9-8);
  const imperfections=clamp((scratches*.35+creasessafe(creases)*.3+whitening*.2+dirt*.15));
  const score=clamp(quality-imperfections*.42);
  return {score,quality,sharpness,scratches,creases,whitening,dirt,imperfections}
}
function creasessafe(v:number){return Number.isFinite(v)?v:0}

export async function analyzeCardCondition(frontUri:string,backUri?:string):Promise<VisualAnalysis>{
  const front=await inspect(frontUri);
  const back=backUri?await inspect(backUri).catch(()=>undefined):undefined;
  const avg=back?(front.score*.58+back.score*.42):front.score;
  const defects:VisualDefect[]=[
    {type:'graffi',score:front.scratches+(back?.scratches||0)*.8,severity:'low',confidence:back?.score?0.58:0.42},
    {type:'pieghe',score:front.creases+(back?.creases||0)*.9,severity:'low',confidence:back?.score?0.62:0.4},
    {type:'puntini_bianchi',score:front.whitening+(back?.whitening||0)*.9,severity:'low',confidence:back?.score?0.65:0.45},
    {type:'sporco',score:front.dirt+(back?.dirt||0)*.8,severity:'low',confidence:back?.score?0.55:0.38},
    {type:'imperfezioni',score:front.imperfections+(back?.imperfections||0)*.7,severity:'low',confidence:back?.score?0.6:0.4}
  ].map(d=>({...d,severity:severity(d.score)} as VisualDefect));
  const significant=defects.filter(d=>d.score>=38).map(d=>d.type);
  const notes:string[]=[];
  if(!back)notes.push('Valutazione preliminare: il retro non è stato acquisito.');
  if(front.sharpness<35)notes.push('Foto fronte poco definita: ripetere la foto con più luce e meno movimento.');
  if(back&&back.sharpness<35)notes.push('Foto retro poco definita: ripetere la foto con più luce e meno movimento.');
  if(significant.length)notes.push('Sono state rilevate possibili imperfezioni superficiali; verificare i dettagli prima del grading finale.');
  if(!significant.length)notes.push('Nessuna anomalia superficiale forte rilevata dal controllo automatico.');
  const confidence=clamp((back?62:43)+(front.sharpness>55?10:0)+(back&&back.sharpness>55?10:0)-(significant.length?8:0),25,86);
  return {condition:conditionFromScore(avg),score:Math.round(avg),confidence:Math.round(confidence),frontQuality:Math.round(front.quality),backQuality:back?Math.round(back.quality):undefined,defects,hasBack:Boolean(back),engine:'local-vision-assisted',notes};
}

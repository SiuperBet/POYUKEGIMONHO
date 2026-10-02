import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';
import {Skia,ColorType,AlphaType} from '@shopify/react-native-skia';
import type {Condition,DefectRecord,ProfessionalAnalysis,InspectionPhoto} from './store';

export type VisualAnalysis={condition:Condition;score:number;confidence:number;frontQuality:number;backQuality?:number;defects:DefectRecord[];hasBack:boolean;engine:'local-vision-assisted';notes:string[];professional?:ProfessionalAnalysis};

function clamp(v:number,min=0,max=100){return Math.max(min,Math.min(max,v))}
function conditionFromScore(score:number):Condition{
  if(score>=97)return 'Mint'; if(score>=92)return 'NM'; if(score>=82)return 'Excellent'; if(score>=70)return 'Good'; if(score>=55)return 'Played'; if(score>=35)return 'Poor'; return 'Damaged';
}
function severity(score:number):DefectRecord['severity']{return score>=70?'high':score>=38?'medium':'low'}
function defect(id:string,type:DefectRecord['type'],score:number,confidence:number,side:'front'|'back'='front'):DefectRecord{return{id,type,side,severity:severity(score),confidence:Math.round(confidence*100),region:{x:.08,y:.08,width:.84,height:.84}}}

async function inspect(uri:string){
  const small=await ImageManipulator.manipulateAsync(uri,[{resize:{width:480}}],{compress:0.9,format:SaveFormat.JPEG,base64:true});
  if(!small.base64)throw new Error('Immagine non disponibile');
  const image=Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(small.base64)); if(!image)throw new Error('Decodifica immagine fallita');
  const width=image.width(),height=image.height();
  const pixels=image.readPixels(0,0,{width,height,colorType:ColorType.RGBA_8888,alphaType:AlphaType.Unpremul}); if(!pixels)throw new Error('Pixel non disponibili');
  const gray=new Float32Array(width*height); let sum=0,sum2=0;
  for(let i=0,p=0;i<gray.length;i++,p+=4){const y=.299*pixels[p]+.587*pixels[p+1]+.114*pixels[p+2];gray[i]=y;sum+=y;sum2+=y*y}
  const mean=sum/gray.length;const variance=Math.max(0,sum2/gray.length-mean*mean);
  let lap=0,edgeWhite=0,edgeDark=0,thinLines=0,interiorHigh=0,samples=0,interiorSamples=0;
  const borderX=Math.max(2,Math.floor(width*.08)),borderY=Math.max(2,Math.floor(height*.08));
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,c=gray[i],dx=Math.abs(gray[i+1]-gray[i-1]),dy=Math.abs(gray[i+width]-gray[i-width]),g=(dx+dy)*.5;
    const l=Math.abs(4*c-gray[i-1]-gray[i+1]-gray[i-width]-gray[i+width]);lap+=l*l;samples++;
    const border=x<borderX||x>=width-borderX||y<borderY||y>=height-borderY;const p=i*4;const r=pixels[p],gch=pixels[p+1],b=pixels[p+2];const lum=.299*r+.587*gch+.114*b;const sat=Math.max(r,gch,b)-Math.min(r,gch,b);
    if(border){if(lum>220&&sat<35)edgeWhite++;if(lum<45)edgeDark++}
    const interior=x>borderX&&x<width-borderX&&y>borderY&&y<height-borderY;
    if(interior){interiorSamples++;if(l>42)interiorHigh++;if(g>28&&Math.max(dx,dy)/(dx+dy+1)>.72)thinLines++}
  }
  const sharpness=clamp(Math.sqrt(lap/Math.max(1,samples))*3);
  const whiteRatio=clamp(edgeWhite/Math.max(1,(width*height)*.16)*100),darkRatio=clamp(edgeDark/Math.max(1,(width*height)*.16)*100);
  const highRatio=clamp(interiorHigh/Math.max(1,interiorSamples)*100),lineRatio=clamp(thinLines/Math.max(1,interiorSamples)*100);
  const quality=clamp(55+sharpness*.45-Math.max(0,Math.abs(mean-128)-100)*.2);
  const scratches=clamp((highRatio*.85+lineRatio*1.5)-18),creases=clamp(lineRatio*3.2-7),whitening=clamp(whiteRatio*1.8-7),dirt=clamp(darkRatio*1.9-8);
  const imperfections=clamp(scratches*.35+creases*.3+whitening*.2+dirt*.15);
  return {score:clamp(quality-imperfections*.42),quality,sharpness,scratches,creases,whitening,dirt,imperfections,variance}
}

export async function analyzeCardCondition(frontUri:string,backUri?:string):Promise<VisualAnalysis>{
  const front=await inspect(frontUri); const back=backUri?await inspect(backUri).catch(()=>undefined):undefined;
  const avg=back?(front.score*.58+back.score*.42):front.score;
  const defects:DefectRecord[]=[
    defect('auto-scratch-front','graffio',front.scratches,back?.score?0.68:0.45,'front'),
    defect('auto-line-front','riga',front.creases*.75,0.52,'front'),
    defect('auto-crease-front','piega',front.creases,0.55,'front'),
    defect('auto-white-front','puntino_bianco',front.whitening,0.58,'front'),
    defect('auto-dirt-front','sporco',front.dirt,0.52,'front'),
    defect('auto-edge-front','whitening',front.whitening*.85,0.6,'front'),
    ...(back?[defect('auto-scratch-back','graffio',back.scratches,0.64,'back'),defect('auto-crease-back','piega',back.creases,0.55,'back'),defect('auto-white-back','puntino_bianco',back.whitening,0.58,'back'),defect('auto-dirt-back','sporco',back.dirt,0.52,'back')]:[])
  ].map(d=>({...d,confidence:Math.max(15,d.confidence)}));
  const significant=defects.filter(d=>d.severity!=='low').map(d=>d.type);
  const notes:string[]=[];
  if(!back)notes.push('Valutazione preliminare: il retro non è stato acquisito.');
  if(front.sharpness<35)notes.push('Foto fronte poco definita: ripetere con più luce, distanza stabile e fuoco sulla carta.');
  if(back&&back.sharpness<35)notes.push('Foto retro poco definita: ripetere con più luce, distanza stabile e fuoco sulla carta.');
  if(significant.length)notes.push('Possibili difetti superficiali rilevati: verificare manualmente prima del grading finale.');
  else notes.push('Nessuna anomalia superficiale forte rilevata dal controllo automatico.');
  const confidence=clamp((back?62:43)+(front.sharpness>55?10:0)+(back&&back.sharpness>55?10:0)-(significant.length?8:0),25,86);
  return {condition:conditionFromScore(avg),score:Math.round(avg),confidence:Math.round(confidence),frontQuality:Math.round(front.quality),backQuality:back?Math.round(back.quality):undefined,defects,hasBack:Boolean(back),engine:'local-vision-assisted',notes};
}

export async function analyzeProfessionalInspection(photos:InspectionPhoto[]):Promise<ProfessionalAnalysis>{
  const front=photos.find(p=>p.purpose==='front'),back=photos.find(p=>p.purpose==='back');
  const extra=photos.filter(p=>p.id!==front?.id&&p.id!==back?.id);
  const frontStats=front?await inspect(front.uri).catch(()=>undefined):undefined;
  const backStats=back?await inspect(back.uri).catch(()=>undefined):undefined;
  const extras=await Promise.all(extra.map(p=>inspect(p.uri).catch(()=>undefined)));
  const validExtras=extras.filter(Boolean) as Awaited<ReturnType<typeof inspect>>[];
  const qualityAvg=[frontStats?.quality,backStats?.quality,...validExtras.map(x=>x.quality)].filter((x):x is number=>typeof x==='number');
  const q=qualityAvg.length?qualityAvg.reduce((a,b)=>a+b,0)/qualityAvg.length:0;
  const surface=Math.round(clamp((frontStats?.score||0)*.55+(backStats?.score||frontStats?.score||0)*.25+(validExtras.reduce((a,b)=>a+b.score,0)/Math.max(1,validExtras.length))*.2));
  const corners=Math.round(clamp(surface-(frontStats?.whitening||0)*.18));
  const edges=Math.round(clamp(surface-(frontStats?.whitening||0)*.28));
  const centering=Math.round(clamp(90+(q-70)*.12));
  const overall=Math.round(clamp(centering*.2+corners*.25+edges*.25+surface*.3));
  const notes:string[]=['Analisi professionale assistita: più acquisizioni vengono confrontate per ridurre gli errori della singola foto.'];
  if(photos.length<3)notes.push('Per una verifica più precisa aggiungere foto ravvicinate e con angolazione diversa.');
  if(validExtras.length)notes.push('Le acquisizioni aggiuntive vengono usate per controllare superficie, bordi e possibili micro-difetti.');
  return {mode:'professional',completed:Boolean(front&&photos.length>=2),photos,subgrades:{centering,corners,edges,surface},overall,confidence:Math.round(clamp(45+photos.length*6+(q>65?12:0),35,92)),alterationCheck:'review',notes};
}

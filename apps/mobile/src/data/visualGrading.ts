import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';
import {Skia,ColorType,AlphaType} from '@shopify/react-native-skia';
import type {Condition,DefectRecord,ProfessionalAnalysis,InspectionPhoto} from './store';

export type VisualAnalysis={condition:Condition;score:number;confidence:number;frontQuality:number;backQuality?:number;defects:DefectRecord[];hasBack:boolean;engine:'local-vision-assisted';notes:string[];professional?:ProfessionalAnalysis};

function clamp(v:number,min=0,max=100){return Math.max(min,Math.min(max,v))}
function conditionFromScore(score:number):Condition{
  if(score>=97)return 'Mint'; if(score>=92)return 'NM'; if(score>=82)return 'Excellent'; if(score>=70)return 'Good'; if(score>=55)return 'Played'; if(score>=35)return 'Poor'; return 'Damaged';
}
function severity(score:number):DefectRecord['severity']{return score>=78?'high':score>=52?'medium':'low'}
function makeDefect(id:string,type:DefectRecord['type'],score:number,confidence:number,side:'front'|'back',region:{x:number;y:number;width:number;height:number},note?:string):DefectRecord{
  return {id,type,side,severity:severity(score),confidence:Math.round(clamp(confidence)),score:Math.round(clamp(score)),source:'automatic',region,note};
}
type RegionStats={score:number;white:number;dark:number;edge:number;line:number;texture:number;confidence:number;region:{x:number;y:number;width:number;height:number}};
type ImageStats={
  score:number;quality:number;sharpness:number;glare:number;uniformity:number;
  scratches:number;creases:number;whitening:number;dirt:number;printLines:number;
  corners:RegionStats[];edges:RegionStats[];interior:RegionStats;
};

function regionBox(x:number,y:number,w:number,h:number){return{x,y,width:w,height:h}}
function analysePixels(pixels:Uint8Array,width:number,height:number,x0:number,y0:number,x1:number,y1:number):RegionStats{
  const sx=Math.max(0,Math.floor(x0)),sy=Math.max(0,Math.floor(y0)),ex=Math.min(width-1,Math.ceil(x1)),ey=Math.min(height-1,Math.ceil(y1));
  const rw=Math.max(1,ex-sx),rh=Math.max(1,ey-sy),gray=new Float32Array(rw*rh);
  let sum=0,sum2=0,edge=0,line=0,white=0,dark=0,texture=0,n=0;
  const at=(x:number,y:number)=>gray[(y-sy)*rw+(x-sx)];
  for(let y=sy;y<ey;y++)for(let x=sx;x<ex;x++){
    const p=(y*width+x)*4; const r=pixels[p],g=pixels[p+1],b=pixels[p+2]; const v=.299*r+.587*g+.114*b;
    gray[(y-sy)*rw+(x-sx)]=v;sum+=v;sum2+=v*v;n++;
  }
  const mean=sum/Math.max(1,n);
  for(let y=sy+1;y<ey-1;y++)for(let x=sx+1;x<ex-1;x++){
    const c=at(x,y),dx=Math.abs(at(x+1,y)-at(x-1,y)),dy=Math.abs(at(x,y+1)-at(x,y-1));
    const g=(dx+dy)*.5;
    if(g>24)edge++;
    const lap=Math.abs(4*c-at(x-1,y)-at(x+1,y)-at(x,y-1)-at(x,y+1));
    if(lap>42)texture++;
    if(g>30&&Math.max(dx,dy)/(dx+dy+1)>.76)line++;
    const p=(y*width+x)*4,r=pixels[p],gc=pixels[p+1],b=pixels[p+2],lum=.299*r+.587*gc+.114*b,sat=Math.max(r,gc,b)-Math.min(r,gc,b);
    if(lum>226&&sat<38)white++; if(lum<38)dark++;
  }
  const total=Math.max(1,(ex-sx-2)*(ey-sy-2));
  const variance=Math.max(0,sum2/Math.max(1,n)-mean*mean);
  const whitePct=white/total*100,darkPct=dark/total*100,edgePct=edge/total*100,linePct=line/total*100,texturePct=texture/total*100;
  const anomaly=clamp(texturePct*1.8+linePct*1.35+Math.max(0,whitePct-2)*1.8+Math.max(0,darkPct-4)*.8);
  const conf=clamp(40+Math.min(35,Math.sqrt(variance)*.9)+(n>4000?20:0));
  return {score:anomaly,white:clamp(whitePct*2.2),dark:clamp(darkPct*1.7),edge:clamp(edgePct*1.6),line:clamp(linePct*3),texture:clamp(texturePct*2),confidence:conf,region:regionBox(x0/width,y0/height,(x1-x0)/width,(y1-y0)/height)};
}

async function inspect(uri:string):Promise<ImageStats>{
  const small=await ImageManipulator.manipulateAsync(uri,[{resize:{width:640}}],{compress:0.92,format:SaveFormat.JPEG,base64:true});
  if(!small.base64)throw new Error('Immagine non disponibile');
  const image=Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(small.base64)); if(!image)throw new Error('Decodifica immagine fallita');
  const width=image.width(),height=image.height();
  const pixels=image.readPixels(0,0,{width,height,colorType:ColorType.RGBA_8888,alphaType:AlphaType.Unpremul}); if(!pixels)throw new Error('Pixel non disponibili');
  const all=analysePixels(pixels,width,height,0,0,width,height);
  const marginX=Math.max(3,Math.floor(width*.055)),marginY=Math.max(3,Math.floor(height*.055));
  const cw=width*.18,ch=height*.18;
  const corners=[
    analysePixels(pixels,width,height,marginX,marginY,marginX+cw,marginY+ch),
    analysePixels(pixels,width,height,width-marginX-cw,marginY,width-marginX,marginY+ch),
    analysePixels(pixels,width,height,marginX,height-marginY-ch,marginX+cw,height-marginY),
    analysePixels(pixels,width,height,width-marginX-cw,height-marginY-ch,width-marginX,height-marginY)
  ];
  const edges=[
    analysePixels(pixels,width,height,marginX,marginY,width-marginX,marginY+height*.055),
    analysePixels(pixels,width,height,width-marginX-width*.055,marginY,width-marginX, height-marginY),
    analysePixels(pixels,width,height,marginX,height-marginY-height*.055,width-marginX,height-marginY),
    analysePixels(pixels,width,height,marginX,marginY,marginX+width*.055,height-marginY)
  ];
  const inner=analysePixels(pixels,width,height,width*.12,height*.12,width*.88,height*.88);
  const sharpness=clamp(all.edge*1.5+all.texture*.8);
  const glare=clamp(Math.max(0,all.white-22));
  const uniformity=clamp(100-Math.abs(50-all.dark)-Math.abs(50-all.white)*.35);
  const scratches=clamp(inner.line*.9+inner.texture*.55-10);
  const creases=clamp(inner.line*1.25+inner.edge*.35-22);
  const whitening=clamp(corners.reduce((s,r)=>s+r.white,0)/4+edges.reduce((s,r)=>s+r.white,0)/4-12);
  const dirt=clamp((edges.reduce((s,r)=>s+r.dark,0)/4)*.8+(corners.reduce((s,r)=>s+r.dark,0)/4)*.45-8);
  const printLines=clamp(inner.line*.72-16);
  const quality=clamp(78+sharpness*.18-glare*.18-(all.texture>82?8:0));
  const imperfections=clamp(scratches*.34+creases*.28+whitening*.24+dirt*.14);
  return {
    score:clamp(quality-imperfections*.58),
    quality,sharpness,glare,uniformity,scratches,creases,whitening,dirt,printLines,corners,edges,interior:inner
  };
}

function defectsFromStats(stats:ImageStats,side:'front'|'back'):DefectRecord[]{
  const out:DefectRecord[]=[];
  const add=(id:string,type:DefectRecord['type'],score:number,baseConf:number,region:{x:number;y:number;width:number;height:number},note?:string)=>{
    if(score<28)return;
    const signal=Math.min(1,score/100);
    const confidence=baseConf*(0.55+signal*.45);
    out.push(makeDefect(id,type,score,confidence,side,region,note));
  };
  add('surface-scratch-'+side,'graffio',stats.scratches,stats.interior.confidence,stats.interior.region,'Segnale superficiale: richiede verifica con luce angolata.');
  add('surface-line-'+side,'riga',stats.printLines,stats.interior.confidence,stats.interior.region,'Possibile print line/riga: distinguere dal riflesso prima della conferma.');
  add('surface-crease-'+side,'piega',stats.creases,stats.interior.confidence,stats.interior.region,'Possibile piega/crease: confermare con foto inclinata.');
  add('surface-dirt-'+side,'sporco',stats.dirt,stats.interior.confidence,stats.interior.region);
  add('surface-print-'+side,'difetto_stampa',stats.printLines*.85,stats.interior.confidence,stats.interior.region);
  stats.corners.forEach((r,i)=>add('corner-'+side+'-'+i,'puntino_bianco',r.white,r.confidence,r.region,'Possibile whitening/punto bianco sull’angolo.'));
  stats.edges.forEach((r,i)=>add('edge-'+side+'-'+i,'whitening',r.white,r.confidence,r.region,'Possibile whitening/usura del bordo.'));
  return out;
}

export async function analyzeProfessionalInspection(photos:InspectionPhoto[]):Promise<ProfessionalAnalysis>{
  const front=photos.find(p=>p.purpose==='front');
  const back=photos.find(p=>p.purpose==='back');
  const extra=photos.filter(p=>p.id!==front?.id&&p.id!==back?.id);
  const frontStats=front?await inspect(front.uri).catch(()=>undefined):undefined;
  const backStats=back?await inspect(back.uri).catch(()=>undefined):undefined;
  const extraStats=(await Promise.all(extra.map(p=>inspect(p.uri).catch(()=>undefined)))).filter(Boolean) as ImageStats[];
  const allStats=[frontStats,backStats,...extraStats].filter(Boolean) as ImageStats[];
  const defects=[
    ...(frontStats?defectsFromStats(frontStats,'front'):[]),
    ...(backStats?defectsFromStats(backStats,'back'):[]),
    ...extraStats.flatMap((st,i)=>defectsFromStats(st,'front').map(d=>({...d,id:d.id+'-extra-'+i,confidence:Math.round(d.confidence*.82)})))
  ];
  const quality=allStats.length?allStats.reduce((s,x)=>s+x.quality,0)/allStats.length:0;
  const frontSurface=frontStats?.score??0;
  const backSurface=backStats?.score??frontSurface;
  const surface=Math.round(clamp(frontSurface*.55+backSurface*.25+(extraStats.length?extraStats.reduce((s,x)=>s+x.score,0)/extraStats.length*.2:frontSurface*.2)));
  const cornerAnomaly=frontStats?frontStats.corners.reduce((s,r)=>s+r.score,0)/4:100;
  const edgeAnomaly=frontStats?frontStats.edges.reduce((s,r)=>s+r.score,0)/4:100;
  const corners=Math.round(clamp(100-cornerAnomaly));
  const edges=Math.round(clamp(100-edgeAnomaly));
  const centering=50;
  const centeringStatus:'needs-card-geometry'='needs-card-geometry';
  const overall=Math.round(clamp(corners*.25+edges*.25+surface*.5));
  const requiresMorePhotos=!front||photos.length<3||quality<58||Boolean(frontStats&&frontStats.glare>38);
  const high=defects.filter(d=>d.severity==='high').length;
  const medium=defects.filter(d=>d.severity==='medium').length;
  const confidence=Math.round(clamp(42+photos.length*6+(quality>68?12:0)+(back?8:0)-high*5-medium*2,30,92));
  const notes:string[]=[
    'Analisi professionale locale: le fotografie vengono confrontate e i segnali ambigui non vengono trasformati automaticamente in difetti certi.',
    'La centratura della stampa richiede la geometria reale dei quattro lati della carta; non viene inventata da una sola foto.'
  ];
  if(!front)notes.push('Manca la foto frontale principale.');
  if(!back)notes.push('Aggiungere il retro per completare il controllo.');
  if(photos.length<3)notes.push('Aggiungere almeno una foto ravvicinata o inclinata per superficie, graffi e print line.');
  if(requiresMorePhotos)notes.push('La qualità delle acquisizioni non è sufficiente per chiudere il grading con alta confidenza.');
  if(defects.length)notes.push('I difetti rilevati sono evidenziati per zona e devono essere confermati quando il segnale può dipendere da riflessi o texture holo.');
  return {
    mode:'professional',
    completed:Boolean(front&&photos.length>=2),
    photos,
    centeringStatus,
    subgrades:{centering,corners,edges,surface},
    overall,
    confidence,
    alterationCheck:'review',
    defects,
    requiresMorePhotos,
    notes
  };
}

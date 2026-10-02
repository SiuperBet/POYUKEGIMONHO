import TextRecognition from '@react-native-ml-kit/text-recognition';
import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';
import {CatalogCard,Game,searchCards} from './catalog';

export type RecognitionResult={
  card:CatalogCard|null;
  confidence:number;
  text:string;
  number?:string;
  language?:string;
  candidates:CatalogCard[];
  status:'matched'|'possible'|'unknown';
  margin:number;
};

const normalize=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9/ ]/g,' ').replace(/\s+/g,' ').trim();

function extractNumber(text:string){
  const matches=text.match(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g)||[];
  return matches[0]?.replace(/\s+/g,'');
}

function detectLanguage(text:string){
  const t=normalize(text);
  if(/\b(pokemon|dresseur|evolutions|objet|energie)\b/.test(t))return 'Francese';
  if(/\b(pokemon|trainer|energy|evolutions)\b/.test(t))return 'Inglese';
  if(/\b(pokemon|trainer|energia|evoluzioni)\b/.test(t))return 'Italiano';
  if(/[\u3040-\u30ff\u4e00-\u9fff]/.test(text))return 'Giapponese';
  return undefined;
}

function scoreCandidate(card:CatalogCard,ocr:string,number?:string){
  const source=normalize(ocr);
  const name=normalize(card.name);
  const nameTokens=name.split(' ').filter(x=>x.length>2);
  const hits=nameTokens.filter(x=>source.includes(x)).length;
  let score=nameTokens.length?hits/nameTokens.length:0;
  if(number&&card.number){
    const a=number.replace(/\s/g,'');
    const b=card.number.replace(/\s/g,'');
    if(a===b)score+=0.55;
    else if(a.split('/')[0]===b.split('/')[0])score+=0.25;
  }
  return Math.min(1,score);
}

async function imageSignature(uri:string){
  try{
    const out=await ImageManipulator.manipulateAsync(uri,[{resize:{width:32,height:32}}],{compress:0.55,format:SaveFormat.JPEG,base64:true});
    if(!out.base64)return undefined;
    const raw=atob(out.base64); const bins=new Array(24).fill(0); const step=Math.max(1,Math.floor(raw.length/768));
    for(let i=0;i<raw.length;i+=step){bins[i%24]+=raw.charCodeAt(i)}
    const max=Math.max(...bins)||1; return bins.map(x=>x/max);
  }catch{return undefined}
}
async function visualSimilarity(a:string,b?:string){
  if(!b)return 0;
  const [sa,sb]=await Promise.all([imageSignature(a),imageSignature(b)]); if(!sa||!sb)return 0;
  let d=0; for(let i=0;i<sa.length;i++)d+=Math.abs(sa[i]-sb[i]); return Math.max(0,1-d/sa.length);
}

export async function recognizeCardImage(uri:string,game:Game='pokemon'):Promise<RecognitionResult>{
  const ocr=await TextRecognition.recognize(uri);
  const text=ocr.text||'';
  const number=extractNumber(text);
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=3&&x.length<=60);
  const queries=[...new Set(lines.filter(x=>!/^\d+[\s/]/.test(x)).slice(0,4))];
  const batches=await Promise.all(queries.map(q=>searchCards(game,q).catch(()=>[])));
  const candidates=[...new Map(batches.flat().map(c=>[c.id,c])).values()];
  const baseRanked=candidates.map(card=>({card,score:scoreCandidate(card,text,number)})).sort((a,b)=>b.score-a.score).slice(0,12);
  const ranked=(await Promise.all(baseRanked.map(async x=>({card:x.card,score:Math.min(1,x.score*.72+(await visualSimilarity(uri,x.card.image))*.28)})))).sort((a,b)=>b.score-a.score);
  const top=ranked[0];
  const second=ranked[1]?.score||0;
  const confidence=top?.score||0;
  const margin=Math.max(0,confidence-second);
  const status=confidence>=0.72&&margin>=0.10?'matched':confidence>=0.42?'possible':'unknown';
  return {card:status==='matched'?(top?.card||null):null,confidence,text,number,language:detectLanguage(text),candidates:ranked.slice(0,8).map(x=>x.card),status,margin};
}

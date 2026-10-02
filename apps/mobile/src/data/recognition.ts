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

function detectLanguageCode(text:string){
  if(/[\u3040-\u30ff]/.test(text))return 'ja' as const;
  if(/[\u4e00-\u9fff]/.test(text))return 'zh-cn' as const;
  const t=normalize(text);
  if(/\b(dresseur|evolutions|objet|energie)\b/.test(t))return 'fr' as const;
  if(/\b(entrenador|evoluciones|objeto|energia)\b/.test(t))return 'es' as const;
  if(/\b(allenatore|energia|evoluzioni|strumento)\b/.test(t))return 'it' as const;
  if(/\b(trainer|energy|evolutions)\b/.test(t))return 'en' as const;
  if(/\b(trainer|energie|entwicklungen)\b/.test(t))return 'de' as const;
  return undefined;
}
function detectLanguage(text:string){
  const code=detectLanguageCode(text);
  return code==='ja'?'Giapponese':code==='zh-cn'?'Cinese semplificato':code==='fr'?'Francese':code==='es'?'Spagnolo':code==='it'?'Italiano':code==='de'?'Tedesco':code==='en'?'Inglese':undefined;
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
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=3&&x.length<=80);
  const numberQuery=number||undefined;
  const queries=[...new Set([...(numberQuery?[numberQuery]:[]),...lines.filter(x=>!/^[\d+\s/]/.test(x)).slice(0,5)])];
  const detected=game==='pokemon'?detectLanguageCode(text):undefined;
  const languages=game==='pokemon'?[...(detected?[detected]:[]),'en','it','ja','zh-cn','zh-tw','fr','de','es','pt-br'].filter((v,i,a)=>a.indexOf(v)===i):[undefined];
  const batches=await Promise.all(queries.flatMap(q=>languages.map(lang=>searchCards(game,q,lang as any).catch(()=>[]))));
  let candidates=[...new Map(batches.flat().map(c=>[c.id,c])).values()];
  if(candidates.length===0&&numberQuery)candidates=await searchCards(game,numberQuery,game==='pokemon'?detected:undefined).catch(()=>[]);
  const baseRanked=candidates.map(card=>({card,score:scoreCandidate(card,text,number)})).sort((a,b)=>b.score-a.score).slice(0,12);
  const ranked=(await Promise.all(baseRanked.map(async x=>({card:x.card,score:Math.min(1,x.score*.72+(await visualSimilarity(uri,x.card.image))*.28)})))).sort((a,b)=>b.score-a.score);
  const top=ranked[0];
  const second=ranked[1]?.score||0;
  const confidence=top?.score||0;
  const margin=Math.max(0,confidence-second);
  const status=confidence>=0.72&&margin>=0.10?'matched':confidence>=0.42?'possible':'unknown';
  return {card:status==='matched'?(top?.card||null):null,confidence,text,number,language:detectLanguage(text),candidates:ranked.slice(0,8).map(x=>x.card),status,margin};
}

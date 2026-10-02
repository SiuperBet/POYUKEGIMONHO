import TextRecognition from '@react-native-ml-kit/text-recognition';
import {CatalogCard,Game,searchCards} from './catalog';

export type RecognitionResult={
  card:CatalogCard|null;
  confidence:number;
  text:string;
  number?:string;
  language?:string;
  candidates:CatalogCard[];
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

export async function recognizeCardImage(uri:string,game:Game='pokemon'):Promise<RecognitionResult>{
  const ocr=await TextRecognition.recognize(uri);
  const text=ocr.text||'';
  const number=extractNumber(text);
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=3&&x.length<=60);
  const queries=[...new Set(lines.filter(x=>!/^\d+[\s/]/.test(x)).slice(0,4))];
  const batches=await Promise.all(queries.map(q=>searchCards(game,q).catch(()=>[])));
  const candidates=[...new Map(batches.flat().map(c=>[c.id,c])).values()];
  const ranked=candidates.map(card=>({card,score:scoreCandidate(card,text,number)})).sort((a,b)=>b.score-a.score);
  const top=ranked[0];
  return {card:top&&top.score>=0.35?top.card:null,confidence:top?.score||0,text,number,language:detectLanguage(text),candidates:ranked.slice(0,8).map(x=>x.card)};
}

import TextRecognition,{TextRecognitionScript} from '@react-native-ml-kit/text-recognition';
import {Image} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {CatalogCard,Game,PokemonLanguage,searchCards,getPokemonCardsForPokemon} from './catalog';

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

const normalize=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9/ -]/g,' ').replace(/\s+/g,' ').trim();
const compact=(value:string)=>normalize(value).replace(/[^a-z0-9]/g,'');

const LANGUAGE_LABEL:Record<string,string>={
  en:'Inglese',it:'Italiano',fr:'Francese',es:'Spagnolo',de:'Tedesco',pt:'Portoghese',
  'pt-br':'Portoghese BR',ja:'Giapponese',ko:'Coreano','zh-cn':'Cinese semplificato','zh-tw':'Cinese tradizionale'
};

function extractNumbers(text:string){
  const matches=[...(text.matchAll(/\b([A-Za-z]*\d{1,4})\s*\/\s*(\d{1,4})\b/g))].map(m=>({
    full:String(m[0]).replace(/\s+/g,''),
    local:String(m[1]).replace(/^0+/,'')||'0',
    total:String(m[2])
  }));
  const localOnly=[...(text.matchAll(/\b(?:#\s*)?(\d{1,4})\b/g))].map(m=>String(m[1]).replace(/^0+/,'')||'0');
  return {best:matches[0]?.full,locals:[...new Set([...matches.map(x=>x.local),...localOnly])].slice(0,12)};
}

function detectLanguageCode(text:string):PokemonLanguage|undefined{
  if(/[\u3040-\u30ff]/.test(text))return 'ja';
  if(/[\uac00-\ud7af]/.test(text))return 'ko';
  if(/[\u4e00-\u9fff]/.test(text))return 'zh-cn';
  const t=normalize(text);
  if(/\b(dresseur|evolutions|objet|energie)\b/.test(t))return 'fr';
  if(/\b(entrenador|evoluciones|objeto|energia)\b/.test(t))return 'es';
  if(/\b(allenatore|evoluzioni|strumento|energia|abilita)\b/.test(t))return 'it';
  if(/\b(trainer|energy|evolutions|ability)\b/.test(t))return 'en';
  if(/\b(trainer|energie|entwicklungen|faehigkeit|fähigkeit)\b/.test(t))return 'de';
  return undefined;
}
function detectLanguage(text:string){
  const code=detectLanguageCode(text);
  return code?LANGUAGE_LABEL[code]:undefined;
}

const NOISE=/\b(?:hp|pv|ps|base|stage|stadio|abilita|abilità|ability|attack|attacco|weakness|debolezza|resistance|resistenza|retreat|ritirata|pokemon|pokémon)\b/gi;
function cleanQuery(line:string){
  const q=line.replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g,' ')
    .replace(/\b\d{1,3}\s*hp\b/gi,' ')
    .replace(/\b(?:\d{1,3}\s*)?damage\b/gi,' ')
    .replace(NOISE,' ')
    .replace(/[^A-Za-zÀ-ÿ\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af' -]/g,' ')
    .replace(/\s+/g,' ').trim();
  return q.length>=2&&q.length<=60?q:undefined;
}
function buildQueries(text:string){
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=2&&x.length<=120);
  const queries:string[]=[];
  for(const line of lines){
    const q=cleanQuery(line);
    if(q)queries.push(q);
    const words=q?.split(/\s+/)||[];
    if(words.length>5)queries.push(words.slice(0,5).join(' '));
    if(words.length>2)queries.push(words.slice(0,2).join(' '));
  }
  return [...new Set(queries)].slice(0,12);
}

function scoreCandidate(card:CatalogCard,ocr:string,locals:string[],detected?:PokemonLanguage,numberBest?:string){
  const source=normalize(ocr);
  const compactSource=compact(ocr);
  const name=normalize(card.name);
  const compactName=compact(card.name);
  const tokens=name.split(' ').filter(x=>x.length>1);
  const hits=tokens.filter(x=>source.includes(x)).length;
  let score=tokens.length?0.45*(hits/tokens.length):0;
  if(name&&source.includes(name))score+=0.32;
  if(compactName.length>=4&&compactSource.includes(compactName))score+=0.18;
  if(card.number){
    const rawNumber=String(card.number).replace(/\s/g,'');
    const n=rawNumber.split('/')[0].replace(/^[^0-9]*/,'').replace(/^0+/,'')||rawNumber;
    const exactLocal=locals.some(x=>{
      const lx=String(x).split('/')[0].replace(/^[^0-9]*/,'').replace(/^0+/,'')||String(x);
      return lx===n;
    });
    if(exactLocal)score+=0.46;
    else if(locals.some(x=>String(x).replace(/^0+/,'')===rawNumber.replace(/^0+/,'').split('/')[0]))score+=0.22;
    if(numberBest){
      const bestLocal=String(numberBest).split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||String(numberBest);
      const cardLocal=rawNumber.split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||rawNumber;
      if(bestLocal && cardLocal && bestLocal!==cardLocal)score-=0.34;
    }
  }
  if(detected&&card.language===detected)score+=0.12;
  if(detected&&card.language&&card.language!==detected)score-=0.10;
  if(card.variantLabel){
    const v=normalize(card.variantLabel);
    if(v&&source.includes(v))score+=0.08;
  }
  return Math.max(0,Math.min(1,score));
}

const POKE_NAME_CACHE='cardgrade:recognition:pokemon-names:v1';
type PokeName={id:number;name:string};

async function getPokemonNameIndex():Promise<PokeName[]>{
  try{
    const cached=await AsyncStorage.getItem(POKE_NAME_CACHE);
    if(cached){
      const parsed=JSON.parse(cached);
      if(Array.isArray(parsed)&&parsed.length>=900)return parsed;
    }
  }catch{}
  try{
    const response=await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0');
    const data=await response.json();
    const list=(data.results||[]).map((x:any,i:number)=>({id:i+1,name:String(x.name)})).filter((x:PokeName)=>x.name);
    if(list.length)void AsyncStorage.setItem(POKE_NAME_CACHE,JSON.stringify(list));
    return list;
  }catch{return []}
}

async function detectPokemonNames(text:string):Promise<string[]>{
  const index=await getPokemonNameIndex();
  if(!index.length)return [];
  const source=compact(text);
  const words=normalize(text).split(/\s+/).filter(Boolean);
  const scored=index.map(p=>{
    const n=compact(p.name);
    if(n.length<3)return {p,score:0};
    if(source.includes(n))return {p,score:1};
    const parts=normalize(p.name).split(/[- ]/).filter(Boolean);
    const hits=parts.filter(part=>part.length>2&&words.some(w=>w===part||w.includes(part)||part.includes(w))).length;
    return {p,score:parts.length?hits/parts.length:0};
  }).filter(x=>x.score>=0.75).sort((a,b)=>b.score-a.score).slice(0,3);
  return scored.map(x=>x.p.name);
}

async function ocrImage(uri:string,script:TextRecognitionScript){
  try{return (await TextRecognition.recognize(uri,script)).text||'';}catch{return ''}
}

async function makeOcrCrops(uri:string){
  try{
    const size=await new Promise<{width:number;height:number}|null>(resolve=>Image.getSize(uri,(width,height)=>resolve({width,height}),()=>resolve(null)));
    if(!size)return [];
    const {width,height}=size;
    const defs=[
      {originY:0,height:Math.round(height*.28)},
      {originY:Math.round(height*.18),height:Math.round(height*.42)},
      {originY:Math.round(height*.62),height:Math.round(height*.36)}
    ];
    const out:string[]=[];
    for(const d of defs){
      const result=await ImageManipulator.manipulateAsync(uri,[{crop:{originX:0,originY:d.originY,width,height:Math.min(d.height,height-d.originY)}}],{compress:1,format:ImageManipulator.SaveFormat.JPEG});
      out.push(result.uri);
    }
    return out;
  }catch{return []}
}

async function collectOcr(uri:string,game:Game){
  const first=await ocrImage(uri,TextRecognitionScript.LATIN);
  const chunks=[first];
  if(first.replace(/\s/g,'').length<18||!/[A-Za-zÀ-ÿ]{3,}/.test(first)||game==='pokemon'){
    const crops=await makeOcrCrops(uri);
    const cropResults=await Promise.all(crops.map(x=>ocrImage(x,TextRecognitionScript.LATIN)));
    chunks.push(...cropResults);
  }
  if(game==='pokemon'){
    const scriptResults=await Promise.all([
      ocrImage(uri,TextRecognitionScript.JAPANESE),
      ocrImage(uri,TextRecognitionScript.CHINESE),
      ocrImage(uri,TextRecognitionScript.KOREAN)
    ]);
    chunks.push(...scriptResults.filter(x=>x.trim().length>0));
  }
  return [...new Set(chunks.map(x=>x.trim()).filter(Boolean))].join('\n');
}

async function candidateSearch(game:Game,queries:string[],numberLocals:string[],detected?:PokemonLanguage,pokemonNames:string[]=[]){
  const languages=game==='pokemon'
    ? [...new Set<PokemonLanguage>([...(detected?[detected]:[]),'en','it','ja','zh-cn','zh-tw','fr','de','es','pt-br','ko'])]
    : [undefined];
  const requests:Array<Promise<CatalogCard[]>>=[];
  const limitedQueries=queries.slice(0,6); const limitedLanguages=game==='pokemon'?[...(detected?[detected]:[]),'it','en','ja']:[undefined];
  for(const q of limitedQueries)for(const lang of [...new Set(limitedLanguages)])requests.push(searchCards(game,q,lang as any).catch(()=>[]));
  if(game==='pokemon'){
    if(candidates.length<8)for(const name of pokemonNames.slice(0,1))requests.push(getPokemonCardsForPokemon(name).catch(()=>[]));
    for(const local of numberLocals.slice(0,4))for(const lang of languages)requests.push(searchCards(game,local,lang as any).catch(()=>[]));
  }
  const batches=await Promise.all(requests);
  const seen=new Set<string>();
  return batches.flat().filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true}).slice(0,500);
}

export async function recognizeCardImage(uri:string,game:Game='pokemon'):Promise<RecognitionResult>{
  const text=await collectOcr(uri,game);
  const numbers=extractNumbers(text);
  const detected=game==='pokemon'?detectLanguageCode(text):undefined;
  const queries=[...new Set([
    ...buildQueries(text),
    ...text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=3&&x.length<=80)
  ])].slice(0,24);
  const pokemonNames=game==='pokemon'?await detectPokemonNames(text):[];
  let candidates=await candidateSearch(game,queries,numbers.locals,detected,pokemonNames);
  if(candidates.length===0){
    const emergencyQueries=[...new Set([
      ...numbers.locals.slice(0,6),
      ...queries.filter(q=>/[A-Za-zÀ-ÿ]{3,}/.test(q)).slice(0,8)
    ])];
    const emergency=await Promise.all(emergencyQueries.map(q=>searchCards(game,q).catch(()=>[])));
    candidates=[...new Map(emergency.flat().map(card=>[card.id,card])).values()];
  }

  if(candidates.length===0&&game==='pokemon'){
    const probes=[...pokemonNames.slice(0,2),...numbers.locals.slice(0,2),...queries.slice(0,3)];
    const fallback=await Promise.all(probes.map(q=>searchCards(game,q,detected).catch(()=>[])));
    candidates=[...new Map(fallback.flat().map(c=>[c.id,c])).values()];
  }

  const ranked=candidates.map(card=>({card,score:scoreCandidate(card,text,numbers.locals,detected,numbers.best)})).sort((a,b)=>b.score-a.score);
  const top=ranked[0];
  const second=ranked[1]?.score||0;
  let confidence=top?.score||0;
  if(pokemonNames.length&&top&&pokemonNames.some(n=>compact(top.card.name).includes(compact(n))))confidence=Math.max(confidence,.58);
  // When the scan language is not reliably detectable, prefer the Italian printing
  // for presentation/matching without overriding an explicitly detected language.
  if(!detected&&top?.card.language==='it')confidence=Math.min(1,confidence+0.06);
  // A clear exact number must be respected: do not auto-match a different localId.
  if(numbers.best&&top?.card.number){
    const a=String(numbers.best).split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||String(numbers.best);
    const b=String(top.card.number).split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||String(top.card.number);
    if(a&&b&&a!==b)confidence=Math.max(0,confidence-.22);
  }
  const margin=Math.max(0,confidence-second);
  const status=confidence>=0.84&&margin>=0.14?'matched':confidence>=0.28&&ranked.length>0?'possible':'unknown';

  return {
    card:status==='matched'?(top?.card||null):null,
    confidence,text,number:numbers.best,language:detectLanguage(text),
    candidates:ranked.slice(0,12).map(x=>x.card),status,margin
  };
}

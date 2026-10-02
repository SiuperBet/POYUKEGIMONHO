import TextRecognition from '@react-native-ml-kit/text-recognition';
import {CatalogCard,Game,PokemonLanguage,POKEMON_LANGUAGES,searchCards} from './catalog';

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
  return {best:matches[0]?.full,locals:[...new Set([...matches.map(x=>x.local),...localOnly])].slice(0,8)};
}

function detectLanguageCode(text:string):PokemonLanguage|undefined{
  if(/[\u3040-\u30ff]/.test(text))return 'ja';
  if(/[\uac00-\ud7af]/.test(text))return 'ko';
  if(/[\u4e00-\u9fff]/.test(text))return 'zh-cn';
  const t=normalize(text);
  if(/\b(dresseur|evolutions|objet|energie)\b/.test(t))return 'fr';
  if(/\b(entrenador|evoluciones|objeto|energia)\b/.test(t))return 'es';
  if(/\b(allenatore|evoluzioni|strumento|energia)\b/.test(t))return 'it';
  if(/\b(trainer|energy|evolutions)\b/.test(t))return 'en';
  if(/\b(trainer|energie|entwicklungen)\b/.test(t))return 'de';
  return undefined;
}
function detectLanguage(text:string){
  const code=detectLanguageCode(text);
  return code?LANGUAGE_LABEL[code]:undefined;
}

const NOISE=/\b(?:hp|pv|ps|base|stage|stadio|abilita|ability|attack|attacco|weakness|debolezza|resistance|resistenza|retreat|ritirata|pokemon|pokémon)\b/gi;
function cleanQuery(line:string){
  const q=line.replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g,' ')
    .replace(/\b\d{1,3}\s*hp\b/gi,' ')
    .replace(/\b(?:\d{1,3}\s*)?damage\b/gi,' ')
    .replace(NOISE,' ')
    .replace(/[^A-Za-zÀ-ÿ\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af' -]/g,' ')
    .replace(/\s+/g,' ').trim();
  return q.length>=3&&q.length<=45?q:undefined;
}
function buildQueries(text:string){
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=2&&x.length<=100);
  const queries:string[]=[];
  for(const line of lines){
    const q=cleanQuery(line);
    if(q)queries.push(q);
    const words=q?.split(/\s+/)||[];
    if(words.length>5)queries.push(words.slice(0,5).join(' '));
  }
  return [...new Set(queries)].slice(0,8);
}

function scoreCandidate(card:CatalogCard,ocr:string,locals:string[],detected?:PokemonLanguage){
  const source=normalize(ocr);
  const name=normalize(card.name);
  const tokens=name.split(' ').filter(x=>x.length>1);
  const hits=tokens.filter(x=>source.includes(x)).length;
  let score=tokens.length?0.48*(hits/tokens.length):0;
  if(name&&source.includes(name))score+=0.30;
  if(card.number){
    const n=String(card.number).replace(/\s/g,'').replace(/^0+/,'');
    if(locals.includes(n))score+=0.38;
    else if(locals.some(x=>x&&n&&x.split('/')[0]===n.split('/')[0]))score+=0.18;
  }
  if(detected&&card.language===detected)score+=0.10;
  return Math.min(1,score);
}

async function candidateSearch(game:Game,queries:string[],numberLocals:string[],detected?:PokemonLanguage){
  const languages=game==='pokemon'
    ? [...new Set<PokemonLanguage>([...(detected?[detected]:[]),'en','it','ja','zh-cn','zh-tw','fr','de','es','pt-br','ko'])]
    : [undefined];
  const requests:Array<Promise<CatalogCard[]>>=[];
  for(const q of queries)for(const lang of languages)requests.push(searchCards(game,q,lang as any).catch(()=>[]));
  if(game==='pokemon')for(const local of numberLocals.slice(0,4))for(const lang of languages)requests.push(searchCards(game,local,lang as any).catch(()=>[]));
  const batches=await Promise.all(requests);
  const seen=new Set<string>();
  return batches.flat().filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true}).slice(0,180);
}

export async function recognizeCardImage(uri:string,game:Game='pokemon'):Promise<RecognitionResult>{
  let text='';
  try{text=(await TextRecognition.recognize(uri)).text||'';}catch{}
  const numbers=extractNumbers(text);
  const detected=game==='pokemon'?detectLanguageCode(text):undefined;
  const queries=buildQueries(text);
  let candidates=await candidateSearch(game,queries,numbers.locals,detected);

  if(candidates.length===0&&game==='pokemon'){
    const probes=[...numbers.locals.slice(0,2),...queries.slice(0,2)];
    candidates=(await Promise.all(probes.map(q=>searchCards(game,q,detected).catch(()=>[])))).flat();
    candidates=[...new Map(candidates.map(c=>[c.id,c])).values()];
  }

  const ranked=candidates.map(card=>({card,score:scoreCandidate(card,text,numbers.locals,detected)}))
    .sort((a,b)=>b.score-a.score).slice(0,20);
  const top=ranked[0];
  const second=ranked[1]?.score||0;
  const confidence=top?.score||0;
  const margin=Math.max(0,confidence-second);
  const status=confidence>=0.78&&margin>=0.12?'matched':confidence>=0.30?'possible':'unknown';

  return {
    card:status==='matched'?(top?.card||null):null,
    confidence,text,number:numbers.best,language:detectLanguage(text),
    candidates:ranked.slice(0,10).map(x=>x.card),status,margin
  };
}

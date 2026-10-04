import TextRecognition,{TextRecognitionScript} from '@react-native-ml-kit/text-recognition';
import {Image} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {CatalogCard,Game,PokemonLanguage,searchCards,searchLocalCatalogCards} from './catalog';

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

function normalizeCollectorCode(value:string){return String(value||'').replace(/[‐-‒–—]/g,'-').replace(/\s+/g,'').toUpperCase();}

function extractNumbers(text:string){
  const normalized=text.replace(/[‐‑‒–—]/g,'-');
  const codes=[...(normalized.matchAll(/\b[A-Za-z]{2,8}-[A-Za-z0-9]{2,12}\d{1,4}\b/g))].map(m=>normalizeCollectorCode(m[0]));
  const matches=[...(normalized.matchAll(/\b([A-Za-z]*\d{1,4})\s*\/\s*(\d{1,4})\b/g))].map(m=>({
    full:String(m[0]).replace(/\s+/g,''),
    local:String(m[1]).replace(/^0+/,'')||'0',
    total:String(m[2])
  }));
  const localOnly=[...(normalized.matchAll(/\b(?:#\s*)?(\d{1,4})\b/g))].map(m=>String(m[1]).replace(/^0+/,'')||'0');
  return {best:codes[0]||matches[0]?.full,locals:[...new Set([...codes,...matches.map(x=>x.local),...localOnly])].slice(0,16),codes};
}

function detectLanguageCode(text:string):PokemonLanguage|undefined{
  if(/[\u3040-\u30ff]/.test(text))return 'ja';
  if(/[\uac00-\ud7af]/.test(text))return 'ko';
  if(/[\u4e00-\u9fff]/.test(text))return 'zh-cn';
  const t=normalize(text);
  const signals:Partial<Record<PokemonLanguage,string[]>>={
    it:['allenatore','allenatori','evoluzioni','strumento','energia','abilita','attacco','attacchi','danno','danni','debolezza','resistenza','ritirata','panchina','banco','cura','cerca','scarta','pesca','metti','ritiro'],
    en:['trainer','trainers','evolutions','item','energy','ability','attack','damage','weakness','resistance','retreat','bench','heal','search','discard','draw','put'],
    fr:['dresseur','dresseurs','evolutions','objet','energie','capacite','attaque','degats','faiblesse','resistance','retraite','banc','soigne','cherche','defausse'],
    es:['entrenador','entrenadores','evoluciones','objeto','energia','habilidad','ataque','dano','debilidad','resistencia','retirada','banca','cura','busca','descarta'],
    de:['trainer','entwicklungen','item','energie','faehigkeit','fähigkeit','angriff','schaden','schwaeche','schwäche','resistenz','rueckzug','rückzug','bank'],
    'pt-br':['treinador','evolucoes','evoluções','item','energia','habilidade','ataque','dano','fraqueza','resistencia','recuo','banco','cura','procure','descarte']
  };
  const scores=new Map<PokemonLanguage,number>();
  for(const [lang,words] of Object.entries(signals) as [PokemonLanguage,string[]][]){
    const score=words.reduce((n,w)=>n+(new RegExp('\\b'+w+'\\b','i').test(t)?1:0),0);
    if(score>0)scores.set(lang,score);
  }
  const best=[...scores.entries()].sort((a,b)=>b[1]-a[1]);
  if(best.length&&best[0][1]>=1&&(best.length===1||best[0][1]>best[1][1]))return best[0][0];
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

function scoreCandidate(card:CatalogCard,ocr:string,locals:string[],detected?:PokemonLanguage,numberBest?:string,codes:string[]=[]){
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
    const rawNumber=String(card.number).replace(/\s/g,'').toUpperCase();
    const cardCode=normalizeCollectorCode(rawNumber);
    const ocrCodes=[...codes,...(ocr.toUpperCase().match(/\b[A-Z]{2,8}-[A-Z0-9]{2,12}\d{1,4}\b/g)||[]).map(normalizeCollectorCode)];
    const uniqueCodes=[...new Set(ocrCodes)];
    const hasCodeSignal=uniqueCodes.length>0;
    const exactCode=uniqueCodes.includes(cardCode);

    // Collector codes are printing-level identifiers. If OCR produces one,
    // an exact match is a dominant signal and a conflicting code is strongly
    // penalized instead of allowing the card name to win.
    if(exactCode)score+=0.78;
    else if(hasCodeSignal&&/^[A-Z0-9]{2,8}-[A-Z0-9]{2,16}$/i.test(cardCode))score-=0.58;

    const n=rawNumber.split('/')[0].replace(/^[^0-9]*/,'').replace(/^0+/,'')||rawNumber;
    const exactLocal=locals.some(x=>{
      const value=String(x).split('/')[0].replace(/^[^0-9]*/,'').replace(/^0+/,'')||String(x);
      return value===n;
    });
    if(exactLocal)score+=0.46;
    else if(locals.some(x=>String(x).replace(/^0+/,'')===rawNumber.replace(/^0+/,'').split('/')[0]))score+=0.22;

    if(numberBest){
      const best=String(numberBest);
      const bestLooksLikeCode=/^[A-Z]{2,8}-[A-Z0-9]{2,16}$/i.test(best);
      if(bestLooksLikeCode){
        if(normalizeCollectorCode(best)===cardCode)score+=0.16;
        else if(/^[A-Z0-9]{2,8}-[A-Z0-9]{2,16}$/i.test(cardCode))score-=0.34;
      }else{
        const bestLocal=best.split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||best;
        const cardLocal=rawNumber.split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||rawNumber;
        if(bestLocal&&cardLocal&&bestLocal!==cardLocal)score-=0.34;
      }
    }
  }

  // Language is part of the printing identity. When OCR gives a language signal,
  // matching that language must dominate a same-number result from another locale.
  if(detected&&card.language===detected)score+=0.24;
  if(detected&&card.language&&card.language!==detected)score-=0.22;
  if(!detected&&card.language==='it')score+=0.05;
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

async function collectFixedZoneOcr(uri:string,game:Game){
  try{
    const size=await new Promise<{width:number;height:number}|null>(resolve=>Image.getSize(uri,(width,height)=>resolve({width,height}),()=>resolve(null)));
    if(!size)return {text:'',nameText:'',numberText:''};
    const {width,height}=size;
    // The normalized card is always 63:88. Zones are therefore stable across
    // phone cameras, distance and perspective. We deliberately keep overlap
    // around the boundaries so small printing/layout differences are tolerated.
    const defs=game==='pokemon'
      ? [
          {key:'name',originX:Math.round(width*.04),originY:Math.round(height*.025),width:Math.round(width*.92),height:Math.round(height*.19)},
          {key:'number',originX:Math.round(width*.02),originY:Math.round(height*.78),width:Math.round(width*.96),height:Math.round(height*.20)},
          {key:'center',originX:Math.round(width*.06),originY:Math.round(height*.16),width:Math.round(width*.88),height:Math.round(height*.22)}
        ]
      : [
          {key:'name',originX:Math.round(width*.04),originY:Math.round(height*.015),width:Math.round(width*.92),height:Math.round(height*.17)},
          {key:'number',originX:Math.round(width*.03),originY:Math.round(height*.78),width:Math.round(width*.94),height:Math.round(height*.20)},
          {key:'center',originX:Math.round(width*.06),originY:Math.round(height*.12),width:Math.round(width*.88),height:Math.round(height*.22)}
        ];
    const results:Record<string,string>={};
    for(const d of defs){
      const crop=await ImageManipulator.manipulateAsync(uri,[{crop:{
        originX:d.originX,originY:d.originY,
        width:Math.min(d.width,width-d.originX),height:Math.min(d.height,height-d.originY)
      }}],{compress:1,format:ImageManipulator.SaveFormat.JPEG});
      const scripts=game==='pokemon'
        ? [TextRecognitionScript.LATIN,TextRecognitionScript.JAPANESE,TextRecognitionScript.CHINESE,TextRecognitionScript.KOREAN]
        : [TextRecognitionScript.LATIN];
      const texts=await Promise.all(scripts.map(script=>ocrImage(crop.uri,script)));
      results[d.key]=[...new Set(texts.map(x=>x.trim()).filter(Boolean))].join('\\n');
    }
    return {text:[results.name,results.number,results.center].filter(Boolean).join('\\n'),nameText:results.name||'',numberText:results.number||''};
  }catch{return {text:'',nameText:'',numberText:''}}
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

async function candidateSearch(game:Game,queries:string[],numberLocals:string[],detected?:PokemonLanguage){
  const nameProbes=[...new Set(queries.filter(q=>!/^\s*[A-Z]{2,8}-[A-Z0-9]{2,12}\d{1,4}\s*$/i.test(q)).slice(0,6))];
  const codeProbes=[...new Set(numberLocals.filter(x=>x.length>0).slice(0,6))];

  // Local cache is always checked first. If the card is not cached yet, fall
  // back to a targeted catalog lookup using the OCR signals. This means the
  // scanner is not limited to the few expansions warmed in the background.
  const localRequests=[
    ...nameProbes.map(name=>searchLocalCatalogCards(game,name,'',160).catch(()=>[])),
    ...codeProbes.map(code=>searchLocalCatalogCards(game,'',code,160).catch(()=>[]))
  ];
  const localBatches=await Promise.all(localRequests);
  const localCards=localBatches.flat();

  const languages:PokemonLanguage[]=game==='pokemon'
    ? (detected
        ? [detected]
        : ['it','en','ja','zh-tw','zh-cn','ko'])
    : [];
  const remoteRequests:Promise<CatalogCard[]>[]=[];
  if(game==='pokemon'){
    // Prefer the detected language. If script detection is inconclusive,
    // probe the main international + Asian print languages as a bounded
    // fallback. searchCards itself performs name/localId/ID matching.
    for(const language of languages){
      for(const name of nameProbes.slice(0,2))remoteRequests.push(searchCards('pokemon',name,language).catch(()=>[]));
      for(const code of codeProbes.slice(0,2))remoteRequests.push(searchCards('pokemon',code,language).catch(()=>[]));
    }
  }else{
    // YGOPRODeck can search by card name; the collector/set code is then used
    // by scoreCandidate to select the exact printing among the returned cards.
    for(const name of nameProbes.slice(0,3))remoteRequests.push(searchCards('yugioh',name).catch(()=>[]));
  }
  const remoteBatches=await Promise.all(remoteRequests);
  const seen=new Set<string>();
  return [...localCards,...remoteBatches.flat()].filter(card=>{
    if(seen.has(card.id))return false;
    seen.add(card.id);
    if(game!=='pokemon'||!card.language)return true;
    if(detected)return card.language===detected||card.language==='en'||card.language==='it';
    return true;
  }).slice(0,500);
}

export async function recognizeCardImage(uri:string,game:Game='pokemon'):Promise<RecognitionResult>{
  const fixed=await collectFixedZoneOcr(uri,game);
  const broad=await collectOcr(uri,game);
  const text=[fixed.text,broad].filter(Boolean).join('\\n');
  const numbers=extractNumbers([fixed.numberText,text].filter(Boolean).join('\\n'));
  const detected=game==='pokemon'?detectLanguageCode(text):undefined;
  const queries=[...new Set([
    ...buildQueries(text),
    ...text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=3&&x.length<=80)
  ])].slice(0,24);
  let candidates=await candidateSearch(game,queries,numbers.locals,detected);
  let ranked=candidates.map(card=>({card,score:scoreCandidate(card,text,numbers.locals,detected,numbers.best,numbers.codes)})).sort((a,b)=>b.score-a.score);

  // If OCR found a plausible exact collectible number, prefer candidates sharing
  // that localId. This is a strong disambiguator between near-identical printings.
  if(numbers.best&&ranked.length){
    const bestLocal=String(numbers.best).split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||String(numbers.best);
    const exact=ranked.filter(x=>{
      const local=String(x.card.number||'').split('/')[0].replace(/^[A-Za-z]*/,'').replace(/^0+/,'')||String(x.card.number||'');
      return local===bestLocal;
    });
    if(exact.length)ranked=[...exact,...ranked.filter(x=>!exact.includes(x))];
  }

  // If the detected language has viable candidates, rank inside that language first.
  // Other-language printings stay available as alternatives, but cannot silently win
  // just because they share the same card number.
  if(game==='pokemon'&&detected){
    const sameLanguage=ranked.filter(x=>x.card.language===detected);
    if(sameLanguage.length)ranked=[...sameLanguage,...ranked.filter(x=>x.card.language!==detected)];
  }

  let top=ranked[0];
  let second=ranked[1]?.score||0;
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
  let margin=Math.max(0,confidence-second);

  const status=confidence>=0.84&&margin>=0.14?'matched':confidence>=0.28&&ranked.length>0?'possible':'unknown';

  return {
    card:status==='matched'?(top?.card||null):null,
    confidence,text,number:numbers.best,language:detectLanguage(text),
    candidates:ranked.slice(0,12).map(x=>x.card),status,margin
  };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
// [build] Italian-first catalog + multilingual printing selection + fast visible-image cache


export type Game='pokemon'|'yugioh';
export type PokemonLanguage='en'|'fr'|'es'|'it'|'pt'|'pt-br'|'pt-pt'|'de'|'nl'|'pl'|'ru'|'ja'|'ko'|'zh-tw'|'id'|'th'|'zh-cn';
export const POKEMON_LANGUAGES:PokemonLanguage[]=['en','it','fr','es','de','pt-br','pt','pt-pt','nl','pl','ru','ja','ko','zh-tw','zh-cn','id','th'];
export const POKEMON_LANGUAGE_PRIORITY:Record<string,number>={it:0,en:1,fr:2,de:3,es:4,pt:5,'pt-br':5,ja:6,'zh-tw':7,'zh-cn':8,ko:9,nl:10,pl:11,ru:12,id:13,th:14};
export const POKEMON_LANGUAGE_LABEL:Record<PokemonLanguage,string>={en:'English',it:'Italiano',fr:'Français',es:'Español',de:'Deutsch',pt:'Português','pt-br':'Português BR','pt-pt':'Português PT',nl:'Nederlands',pl:'Polski',ru:'Русский',ja:'日本語',ko:'한국어','zh-tw':'繁體中文','zh-cn':'简体中文',id:'Bahasa Indonesia',th:'ไทย'};
export type CatalogCard={
  id:string; game:Game; name:string; setId?:string; setName?:string; number?:string;
  rarity?:string; image?:string; priceEUR?:number; priceUSD?:number; trend7EUR?:number; trend30EUR?:number; updatedAt?:string; releaseDate?:string;
  variantId?:string; variantLabel?:string; printingId?:string; language?:PokemonLanguage|string; sourceId?:string;
  artist?:string; types?:string[]; dexId?:number|string;
};
export type CatalogSet={
  id:string;game:Game;name:string;code?:string;cardCount?:number;releaseDate?:string;logo?:string;symbol?:string;
  seriesId?:string;seriesName?:string;seriesLogo?:string;language?:PokemonLanguage|string;sourceId?:string;subSetIds?:string[];
};

async function cache<T>(key:string,loader:()=>Promise<T>):Promise<T>{
  return AsyncStorage.getItem(key).then(async raw=>{
    if(raw){try{return JSON.parse(raw) as T}catch{}}
    const value=await loader();
    void AsyncStorage.setItem(key,JSON.stringify(value));
    return value;
  });
}

async function cacheNonEmpty<T>(key:string,loader:()=>Promise<T[]>):Promise<T[]>{
  const raw=await AsyncStorage.getItem(key);
  if(raw){try{const parsed=JSON.parse(raw) as T[];if(Array.isArray(parsed)&&parsed.length>0)return parsed}catch{}}
  const value=await loader();
  if(Array.isArray(value)&&value.length>0)void AsyncStorage.setItem(key,JSON.stringify(value));
  return value;
}

const legacyPokemonImage=(setId:string,localId:string)=>{
  if(!/^ecard/i.test(setId))return undefined;
  const n=String(localId).replace(/^H0*(\d+)$/i,(_,d)=>'H'+d).replace(/^0+(\d+)$/,'$1');
  return 'https://images.pokemontcg.io/'+encodeURIComponent(setId)+'/'+encodeURIComponent(n)+'.png';
};

async function getJson<T>(url:string):Promise<T>{
  const response=await fetch(url);
  if(!response.ok)throw new Error('HTTP '+response.status);
  return response.json() as Promise<T>;
}

const pokemonImage=(language:PokemonLanguage,setId:string,seriesId:string|undefined,localId:string,quality:'low'|'high'='low')=>
  'https://assets.tcgdex.net/'+encodeURIComponent(language)+'/'+encodeURIComponent(seriesId||setId)+'/'+encodeURIComponent(setId)+'/'+encodeURIComponent(localId)+'/'+quality+'.webp';
const pokemonCardId=(language:PokemonLanguage,rawId:string)=>language==='en'?rawId:language+'::'+rawId;

export async function mapWithConcurrency<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out:R[]=[];let cursor=0;
  const worker=async()=>{while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch{out[i]=undefined as R}}};
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},()=>worker()));
  return out;
}

export async function getSets(game:Game,preferredLanguage:PokemonLanguage='it'):Promise<CatalogSet[]>{
  if(game==='pokemon'){
    return cacheNonEmpty('catalog:pokemon:sets:v8',async()=>{
      const localeResults=await mapWithConcurrency(POKEMON_LANGUAGES,4,async(language)=>{
        try{
          const sets=await getJson<any[]>('https://api.tcgdex.net/v2/'+language+'/sets');
          return sets.map((set:any)=>({
            id:language+':'+String(set.id),sourceId:String(set.id),language,game:'pokemon' as const,
            name:String(set.name||set.id),cardCount:Number(set.cardCount?.total)||undefined,
            logo:typeof set.logo==='string'?set.logo+'.webp':undefined,symbol:typeof set.symbol==='string'?set.symbol+'.webp':undefined,
            seriesId:language==='en'?undefined:language,seriesName:language==='en'?'Pokémon · English':'Pokémon · '+POKEMON_LANGUAGE_LABEL[language]
          } as CatalogSet));
        }catch{return [] as CatalogSet[]}
      });
      // The catalog UI has a localized presentation language. Italian is the default,
      // while English is used only when an Italian set translation is unavailable.
      // Language-specific card printings remain distinct in the catalog and scanner.
      const all=localeResults.flat().filter(s=>s.cardCount!==0);
      const bySource=new Map<string,CatalogSet[]>();
      for(const set of all){
        const source=String(set.sourceId||set.id).replace(/^\\w+:/,'');
        const bucket=bySource.get(source)||[];
        if(!bucket.some(x=>x.language===set.language))bucket.push(set);
        bySource.set(source,bucket);
      }
      const selected=Array.from(bySource.values()).map(bucket=>
        bucket.find(x=>x.language===preferredLanguage)||
        bucket.find(x=>x.language==='en')||
        [...bucket].sort((a,b)=>(POKEMON_LANGUAGE_PRIORITY[String(a.language||'en')]??99)-(POKEMON_LANGUAGE_PRIORITY[String(b.language||'en')]??99))[0]
      ).filter(Boolean) as CatalogSet[];

      // "Classic Collection" is a 30-card subset of the 30th Celebration expansion,
      // not a standalone expansion. Keep one expansion entry and load the subset inside it.
      const parent=selected.find(s=>/30th\s+celebration/i.test(String(s.name))&&!/classic\s+collection/i.test(String(s.name)));
      const classic=selected.filter(s=>/30th\s+celebration/i.test(String(s.name))&&/classic\s+collection/i.test(String(s.name)));
      if(parent&&classic.length){
        const sameLanguage=classic.find(s=>String(s.language||'')===String(parent.language||''));
        if(sameLanguage){
          parent.subSetIds=[String(parent.sourceId||parent.id).replace(/^\\w+:/,''),String(sameLanguage.sourceId||sameLanguage.id).replace(/^\\w+:/,'')];
          parent.cardCount=(Number(parent.cardCount)||0)+(Number(sameLanguage.cardCount)||0);
        }
      }
      const hiddenClassicIds=new Set(classic.map(s=>s.id));
      return selected.filter(s=>!hiddenClassicIds.has(s.id)).sort((a,b)=>
        String(a.name).localeCompare(String(b.name),'it',{sensitivity:'base'})
      );
    });
  }
  return cacheNonEmpty('catalog:yugioh:sets:v4',async()=>{
    const data=await getJson<any[]>('https://db.ygoprodeck.com/api/v7/cardsets.php');
    return data.map(s=>({id:s.set_code||s.set_name,sourceId:s.set_code||s.set_name,game:'yugioh' as const,name:s.set_name,code:s.set_code,cardCount:Number(s.num_of_cards)||undefined,releaseDate:s.tcg_date,language:'en'}));
  });
}

export async function hydrateSetDates(game:Game,sets:CatalogSet[]):Promise<CatalogSet[]>{
  if(game!=='pokemon')return sets;
  const missing=sets.filter(s=>!s.releaseDate);
  if(!missing.length)return sets;
  const details=await mapWithConcurrency(missing,6,async(s)=>{
    try{
      const lang=String(s.language||'en');
      const id=String(s.sourceId||s.id).replace(/^\w+:/,'');
      const d=await getJson<any>('https://api.tcgdex.net/v2/'+lang+'/sets/'+encodeURIComponent(id));
      return {...s,releaseDate:typeof d.releaseDate==='string'?d.releaseDate:(d.releaseDate?.[lang]||d.releaseDate?.en),seriesId:d.serie?.id,seriesName:d.serie?.name,seriesLogo:d.serie?.logo};
    }catch{return s}
  });
  const byId=new Map(details.map(s=>[s.id,s]));
  const hydrated=sets.map(s=>byId.get(s.id)||s);
  void AsyncStorage.setItem('catalog:pokemon:sets:v8',JSON.stringify(hydrated));
  return hydrated;
}

function numberOf(v:any){return v===undefined||v===null?'':String(v)}
function priceFromPokemon(card:any){
  const p=card.pricing?.cardmarket;
  const values=[p?.trend,p?.avg30,p?.avg7,p?.avg1,p?.low];
  for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n}
  return undefined;
}
function priceFromYgo(card:any){
  const p=card.card_prices?.[0];
  const n=Number(p?.cardmarket_price);
  return Number.isFinite(n)&&n>0?n:undefined;
}

export async function getPokemonSetCards(setId:string,language:PokemonLanguage='it'):Promise<CatalogCard[]>{
  const key='catalog:pokemon:set:v5:'+language+':'+setId;
  return cacheNonEmpty(key,async()=>{
    let set:any={};
    for(let attempt=0;attempt<3;attempt++){
      try{
        set=await getJson<any>('https://api.tcgdex.net/v2/'+language+'/sets/'+encodeURIComponent(setId));
        if(Array.isArray(set.cards)&&set.cards.length>0)break;
      }catch{}
      if(attempt<2)await new Promise(r=>setTimeout(r,250*(attempt+1)));
    }
    let cards=Array.isArray(set.cards)?set.cards:[];
    if(cards.length===0){
      const fallback=await getJson<any[]>('https://api.tcgdex.net/v2/'+language+'/cards?set='+encodeURIComponent(setId)+'&pagination:page=1&pagination:itemsPerPage=250').catch(()=>[]);
      cards=Array.isArray(fallback)?fallback.filter((x:any)=>String(x.id||'').startsWith(setId+'-')):[];
    }
    const seriesId=String(set.serie?.id||'');
    const releaseDate=typeof set.releaseDate==='string'?set.releaseDate:(set.releaseDate?.[language]||set.releaseDate?.en);
    return cards.map((brief:any)=>{
      const localId=numberOf(brief.localId);
      const source=typeof brief.image==='string'&&brief.image.length>0?brief.image.replace(/\/+$/,''):'';
      const legacy=language==='en'?legacyPokemonImage(setId,localId):undefined;
      const image=legacy||(source?source+'/low.webp':pokemonImage(language,setId,seriesId,localId,'low'));
      const rawId=String(brief.id||setId+'-'+localId);
      return {id:pokemonCardId(language,rawId),sourceId:rawId,printingId:pokemonCardId(language,rawId),language,game:'pokemon' as const,name:brief.name||'Unknown',setId,setName:set.name,number:localId,image,releaseDate};
    }).filter((c:any)=>c.name!=='Unknown'||c.id).sort((x:any,y:any)=>String(x.number).localeCompare(String(y.number),undefined,{numeric:true,sensitivity:'base'}));
  });
}

export async function getPokemonMasterSetCards(setId:string,language:PokemonLanguage='it'):Promise<CatalogCard[]>{
  const key='catalog:pokemon:masterset:v1:'+language+':'+setId;
  return cacheNonEmpty(key,async()=>{
    const base=await getPokemonSetCards(setId,language);
    const detailed=await mapWithConcurrency(base,8,async(card)=>{
      const rawId=String(card.sourceId||card.id);
      return getJson<any>('https://api.tcgdex.net/v2/'+language+'/cards/'+encodeURIComponent(rawId)).catch(()=>null);
    });
    const out:CatalogCard[]=[];
    for(let i=0;i<base.length;i++){
      const card=base[i],detail=detailed[i];
      const variants=detail?.variants||{normal:true};
      const defs=[
        ['normal','Standard',variants.normal],
        ['reverse','Reverse Holo',variants.reverse],
        ['holo','Holo',variants.holo],
        ['firstEdition','1ª Edizione',variants.firstEdition],
      ] as const;
      for(const [variant,label,available] of defs){
        if(!available)continue;
        const variantId=variant;
        let price=card.priceEUR;
        const cm=detail?.pricing?.cardmarket||{};
        if(variant==='holo')price=Number(cm['avg-holo'])||Number(cm.avg)||price;
        else if(variant==='reverse')price=Number(detail?.pricing?.tcgplayer?.reverse?.marketPrice)||Number(cm.avg)||price;
        else price=Number(cm.avg)||price;
        out.push({
          ...card,
          id:card.id+'::'+variantId,
          printingId:card.id+'::'+variantId,
          variantId,
          variantLabel:label,
          priceEUR:Number.isFinite(Number(price))&&Number(price)>0?Number(price):undefined,
          priceUSD:variant==='normal'?Number(detail?.pricing?.tcgplayer?.normal?.marketPrice)||undefined:variant==='reverse'?Number(detail?.pricing?.tcgplayer?.reverse?.marketPrice)||undefined:variant==='holo'?Number(detail?.pricing?.tcgplayer?.holo?.marketPrice)||undefined:undefined,
        });
      }
    }
    return out;
  });
}

export async function getYugiohSetCards(setName:string):Promise<CatalogCard[]>{
  const key='catalog:yugioh:set:v3:'+setName;
  return cacheNonEmpty(key,async()=>{
    const out:CatalogCard[]=[];let offset=0;
    while(true){
      const data=await getJson<any>('https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(setName)+'&num=100&offset='+offset);
      const rows=Array.isArray(data)?data:data.data||[];
      for(const c of rows){
        const matches=(c.card_sets||[]).filter((s:any)=>s.set_name===setName);
        const entries=matches.length?matches:[c.card_sets?.[0]].filter(Boolean);
        for(const match of entries){
          const printingId=String(match.set_code||match.set_rarity||match.set_name);
          out.push({
            id:String(c.id)+'::'+printingId,printingId,variantId:printingId,variantLabel:String(match.set_rarity||printingId),
            game:'yugioh',name:c.name,setName,number:match.set_code,rarity:match.set_rarity,types:c.type?[c.type]:undefined,
            image:c.card_images?.[0]?.image_url_small||c.card_images?.[0]?.image_url,
            priceEUR:priceFromYgo(c),priceUSD:Number(match.set_price)||undefined
          });
        }
      }
      if(!data.meta?.next_page||rows.length===0)break;
      offset+=rows.length;if(rows.length<100)break;
    }
    const seen=new Set<string>();
    return out.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true})
      .sort((a,b)=>String(a.number).localeCompare(String(b.number),undefined,{numeric:true,sensitivity:'base'}));
  });
}

export async function getPokemonCardsForPokemon(pokemonName:string):Promise<CatalogCard[]>{
  const normalized=String(pokemonName||'').trim();
  if(!normalized)return [];
  const key='catalog:pokemon:pokedex-cards:v3:'+encodeURIComponent(normalized.toLowerCase());
  return cacheNonEmpty(key,async()=>{
    const languageNames=new Map<PokemonLanguage,string>([['en',normalized]]);
    try{
      const species=await getJson<any>('https://pokeapi.co/api/v2/pokemon-species/'+encodeURIComponent(normalized.toLowerCase()));
      const codeMap:Record<string,PokemonLanguage>={
        en:'en',fr:'fr',es:'es',de:'de',it:'it',nl:'nl',pl:'pl',ru:'ru',
        ja:'ja',ko:'ko','zh-Hans':'zh-cn','zh-Hant':'zh-tw',
        'pt-BR':'pt-br',pt:'pt','id':'id',th:'th'
      };
      for(const entry of (species.names||[])){
        const code=String(entry.language?.name||'');
        const value=String(entry.name||'').trim();
        const lang=codeMap[code];
        if(lang&&value)languageNames.set(lang,value);
      }
    }catch{}
    // The default mobile catalog is Italian-first. English is kept only as a fallback
    // for cards that do not have an Italian printing in the free catalog.
    const languages:Array<[PokemonLanguage,string]>=[
      ['it',languageNames.get('it')||normalized],
      ['en',normalized]
    ];
    const responses=await mapWithConcurrency(languages,4,async([language,name])=>{
      const all:any[]=[];
      for(let page=1;page<=10;page++){
        const rows=await getJson<any[]>(
          'https://api.tcgdex.net/v2/'+language+'/cards?name='+encodeURIComponent(name)+
          '&pagination:page='+page+'&pagination:itemsPerPage=250'
        ).catch(()=>[] as any[]);
        if(!rows.length)break;
        all.push(...rows);
        if(rows.length<250)break;
      }
      return {language,rows:all};
    });
    const out:CatalogCard[]=[];
    const seen=new Set<string>();
    const variantLabel=(card:any)=>{
      const v=card?.variants;
      if(!v||typeof v!=='object')return undefined;
      const labels=[['normal','Standard'],['holo','Holo'],['reverse','Reverse Holo'],['firstEdition','1st Edition'],['wPromo','Promo']] as const;
      const active=labels.filter(([key])=>Boolean(v[key])).map(([,label])=>label);
      return active.length?active.join(' · '):undefined;
    };
    for(const {language,rows} of responses){
      for(const card of rows){
        const rawId=String(card?.id||'');
        if(!rawId)continue;
        const id=pokemonCardId(language,rawId);
        if(seen.has(id))continue;
        seen.add(id);
        const image=typeof card.image==='string'&&card.image.length>0?card.image+'/high.webp':undefined;
        const parts=rawId.split('-');
        const setId=parts.length>1?parts.slice(0,-1).join('-'):undefined;
        out.push({
          id,sourceId:rawId,printingId:id,language,game:'pokemon',
          name:String(card.name||normalized),setId,setName:card.set?.name||undefined,
          number:numberOf(card.localId),rarity:card.rarity||undefined,
          artist:card.artist||undefined,image,
          variantId:variantLabel(card),variantLabel:variantLabel(card)
        });
      }
    }
    // Italian is the default physical printing for users in Italy. Some localized-name
    // searches can miss Italian cards, so recover them by the stable card ID from English results.
    const englishCards=out.filter(c=>String(c.language||'en')==='en');
    const italianBySource=new Map(out.filter(c=>String(c.language||'')==='it').map(c=>[String(c.sourceId||''),c]));
    const missingItalian=englishCards.filter(c=>{const raw=String(c.sourceId||'');return raw&&!italianBySource.has(raw)});
    if(missingItalian.length){
      const recovered=await mapWithConcurrency(missingItalian.slice(0,120),6,async(base)=>{
        const raw=String(base.sourceId||'');
        if(!raw)return null;
        const data=await getJson<any>('https://api.tcgdex.net/v2/it/cards/'+encodeURIComponent(raw)).catch(()=>null);
        if(!data)return null;
        const image=typeof data.image==='string'&&data.image.length>0?data.image+'/low.webp':base.image;
        return {
          ...base,
          id:pokemonCardId('it',raw),
          sourceId:raw,
          printingId:pokemonCardId('it',raw),
          language:'it' as PokemonLanguage,
          name:String(data.name||base.name),
          setId:data.set?.id||base.setId,
          setName:data.set?.name||base.setName,
          number:numberOf(data.localId)||base.number,
          rarity:data.rarity||base.rarity,
          image
        } as CatalogCard;
      });
      for(const card of recovered)if(card){italianBySource.set(String(card.sourceId||''),card);}
    }
    const preferred=englishCards.map(c=>italianBySource.get(String(c.sourceId||''))||c);
    const otherItalian=out.filter(c=>String(c.language||'')==='it'&&!preferred.some(x=>String(x.sourceId||'')===String(c.sourceId||'')));
    const preferredIds=new Set(preferred.map(c=>c.id));
    for(const c of otherItalian)if(!preferredIds.has(c.id))preferred.push(c);
    return preferred.sort((a,b)=>String(a.sourceId||a.id).localeCompare(String(b.sourceId||b.id),undefined,{numeric:true,sensitivity:'base'}));
  });
}

export async function hydrateCardDates(game:Game,cards:CatalogCard[]):Promise<CatalogCard[]>{
  if(!cards.length)return cards;
  if(game==='yugioh'){
    const sets=await getSets('yugioh').catch(()=>[]);
    const byName=new Map(sets.map(s=>[s.name,s.releaseDate]));
    return cards.map(c=>({...c,releaseDate:c.releaseDate||byName.get(c.setName||'')}));
  }
  const ids=[...new Set(cards.map(c=>c.setId).filter(Boolean) as string[])];
  const languageBySet=new Map(cards.filter(c=>c.setId).map(c=>[c.setId as string,String(c.language||'en')]));
  const details=await mapWithConcurrency(ids,6,async(id)=>{
    try{const lang=languageBySet.get(id)||'en';const d=await getJson<any>('https://api.tcgdex.net/v2/'+lang+'/sets/'+encodeURIComponent(id));return [id,typeof d.releaseDate==='string'?d.releaseDate:(d.releaseDate?.[lang]||d.releaseDate?.en)] as const}catch{return [id,undefined] as const}
  });
  const dates=new Map(details);
  return cards.map(c=>({...c,releaseDate:c.releaseDate||dates.get(c.setId||'')}));
}

const SEARCH_LANGUAGES:PokemonLanguage[]=['en','it','ja','zh-cn','zh-tw','fr','de','es','pt-br','ko'];

async function expandPokemonSearchAcrossLanguages(cards:CatalogCard[]):Promise<CatalogCard[]>{
  if(!cards.length)return cards;
  const canonical=cards.slice(0,24);
  const requests:{base:CatalogCard;language:PokemonLanguage;promise:Promise<any>}[]=[];
  for(const base of canonical){
    const rawId=String(base.sourceId||base.id).replace(/^(?:[a-z-]+)::/,'');
    for(const language of POKEMON_LANGUAGES){
      if(language===base.language)continue;
      requests.push({
        base,language,
        promise:getJson<any>('https://api.tcgdex.net/v2/'+language+'/cards/'+encodeURIComponent(rawId)).catch(()=>null)
      });
    }
  }
  const results=await mapWithConcurrency(requests,8,async(r)=>({r,data:await r.promise}));
  const out=[...cards];
  const seen=new Set(out.map(c=>c.id));
  for(const item of results){
    const c=item?.data;if(!c)continue;
    const lang=item.r.language,rawId=String(c.id||item.r.base.sourceId||'');
    if(!rawId)continue;
    const image=typeof c.image==='string'&&c.image.length>0?c.image+'/high.webp':undefined;
    const localized:CatalogCard={
      id:pokemonCardId(lang,rawId),
      sourceId:rawId,
      printingId:pokemonCardId(lang,rawId),
      language:lang,
      game:'pokemon',
      name:String(c.name||item.r.base.name),
      setId:c.set?.id||item.r.base.setId,
      setName:c.set?.name||item.r.base.setName,
      number:numberOf(c.localId)||item.r.base.number,
      rarity:c.rarity||item.r.base.rarity,
      image,
      priceEUR:priceFromPokemon(c),
      trend7EUR:Number(c.pricing?.cardmarket?.avg7)||undefined,
      trend30EUR:Number(c.pricing?.cardmarket?.avg30)||undefined,
      updatedAt:c.updated
    };
    if(!seen.has(localized.id)){seen.add(localized.id);out.push(localized);}
  }
  return out.slice(0,160);
}

export async function searchCards(game:Game,query:string,language?:PokemonLanguage):Promise<CatalogCard[]>{
  const q=query.trim();if(!q)return [];
  const tokens=[...new Set(q.split(/\s+/).map(x=>x.trim()).filter(x=>x.length>=2))];
  if(game==='pokemon'){
    const languages=language?[language]:SEARCH_LANGUAGES;
    const requests:{lang:PokemonLanguage;promise:Promise<any[]>}[]=[];
    for(const lang of languages){
      requests.push({lang,promise:getJson<any[]>('https://api.tcgdex.net/v2/'+lang+'/cards?name='+encodeURIComponent(q)).catch(()=>[] as any[])});
      const number=extractLocalNumber(q);
      if(number)requests.push({lang,promise:getJson<any[]>('https://api.tcgdex.net/v2/'+lang+'/cards?localId='+encodeURIComponent(number)).catch(()=>[] as any[])});
      requests.push({lang,promise:getJson<any[]>('https://api.tcgdex.net/v2/'+lang+'/cards?id='+encodeURIComponent(q)).catch(()=>[] as any[])});
    }
    const rawResults=await mapWithConcurrency(requests,8,x=>x.promise);
    const raw=requests.flatMap((x,i)=>rawResults[i].map(c=>({...c,__lang:x.lang})));
    const seen=new Set<string>();
    const merged=raw.filter(c=>{const rawId=String(c?.id||'');const id=String(c.__lang)+'::'+rawId;if(!rawId||seen.has(id))return false;seen.add(id);return true});
    const normalized=q.toLowerCase();
    const mapped=merged.map(c=>{
      const lang=c.__lang as PokemonLanguage,rawId=String(c.id),number=numberOf(c.localId);
      const hay=(String(c.name||'')+' '+number+' '+rawId).toLowerCase();
      const tokenHits=tokens.filter(t=>hay.includes(t.toLowerCase())).length;
      const image=typeof c.image==='string'&&c.image.length>0?c.image+'/high.webp':undefined;
      return {card:{id:pokemonCardId(lang,rawId),sourceId:rawId,printingId:pokemonCardId(lang,rawId),language:lang,game:'pokemon' as const,name:c.name,setId:c.set?.id,setName:c.set?.name,number,rarity:c.rarity,image,priceEUR:priceFromPokemon(c),trend7EUR:Number(c.pricing?.cardmarket?.avg7)||undefined,trend30EUR:Number(c.pricing?.cardmarket?.avg30)||undefined,updatedAt:c.updated},hits:tokenHits,exact:hay.includes(normalized)};
    });
    const result=mapped.sort((a,b)=>{const signalA=(b.exact===a.exact?(b.hits-a.hits):b.exact?1:-1);const signalB=(a.exact===b.exact?(a.hits-b.hits):a.exact?1:-1);if(signalA!==signalB)return signalA-signalB;return (POKEMON_LANGUAGE_PRIORITY[String(a.card.language||'en')]??99)-(POKEMON_LANGUAGE_PRIORITY[String(b.card.language||'en')]??99)}).slice(0,100).map(x=>x.card);
    if(!language&&result.length){
      // Una ricerca con tastiera latina deve comunque mostrare le stampe
      // giapponesi/cinesi/coreane ecc. della stessa carta: l'utente non deve
      // conoscere o digitare il nome localizzato.
      return expandPokemonSearchAcrossLanguages(result);
    }
    if(!language&&result.length===0){
      const fallbackLangs=POKEMON_LANGUAGES.filter(x=>!SEARCH_LANGUAGES.includes(x));
      const fallback=await Promise.all(fallbackLangs.map(lang=>searchCards('pokemon',q,lang).catch(()=>[])));
      const merged=[...new Map(fallback.flat().map(c=>[c.id,c])).values()];
      return expandPokemonSearchAcrossLanguages(merged.slice(0,100));
    }
    return result;
  }
  const requests=['https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='+encodeURIComponent(q)+'&num=100&offset=0','https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(q)+'&num=100&offset=0'];
  const cards=(await Promise.all(requests.map(u=>getJson<any>(u).catch(()=>({data:[]}))))).flatMap(x=>x.data||[]);
  const seen=new Set<string>();const out:CatalogCard[]=[];
  for(const c of cards)for(const ss of (c.card_sets||[])){
    const hay=(String(c.name||'')+' '+String(ss.set_code||'')+' '+String(ss.set_name||'')+' '+String(ss.set_rarity||'')).toLowerCase();
    if(!tokens.some(t=>hay.includes(t.toLowerCase())))continue;
    const printingId=String(ss.set_code||ss.set_rarity||ss.set_name),id=String(c.id)+'::'+printingId;
    if(seen.has(id))continue;seen.add(id);
    out.push({id,sourceId:String(c.id),printingId,variantId:printingId,variantLabel:String(ss.set_rarity||printingId),game:'yugioh',name:c.name,setName:ss.set_name,number:ss.set_code,rarity:ss.set_rarity,image:c.card_images?.[0]?.image_url_small||c.card_images?.[0]?.image_url,priceEUR:priceFromYgo(c),priceUSD:Number(ss.set_price)||undefined});
  }
  return out.slice(0,100);
}

function extractLocalNumber(q:string){
  const m=q.match(/(?:^|\s)([A-Za-z]*\d{1,4})(?:\s*\/\s*\d{1,4})?(?:$|\s)/);
  return m?.[1]||(/^[A-Za-z]*\d{1,4}(?:\/\d{1,4})?$/.test(q)?q.split('/')[0]:undefined);
}

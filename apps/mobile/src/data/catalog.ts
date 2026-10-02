import AsyncStorage from '@react-native-async-storage/async-storage';

export type Game='pokemon'|'yugioh';
export type CatalogCard={
  id:string; game:Game; name:string; setId?:string; setName?:string; number?:string;
  rarity?:string; image?:string; priceEUR?:number; priceUSD?:number; trend7EUR?:number; trend30EUR?:number; updatedAt?:string;
  variantId?:string; variantLabel?:string; printingId?:string;
};
export type CatalogSet={
  id:string;game:Game;name:string;code?:string;cardCount?:number;releaseDate?:string;logo?:string;symbol?:string;
  seriesId?:string;seriesName?:string;seriesLogo?:string;
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

const pokemonImage=(setId:string,localId:string,quality:'low'|'high'='low')=>
  'https://assets.tcgdex.net/en/'+encodeURIComponent(setId)+'/'+encodeURIComponent(localId)+'/'+quality+'.webp';

async function mapWithConcurrency<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out:R[]=[];let cursor=0;
  const worker=async()=>{while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch{out[i]=undefined as R}}};
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},()=>worker()));
  return out;
}

export async function getSets(game:Game):Promise<CatalogSet[]>{
  if(game==='pokemon'){
    return cacheNonEmpty('catalog:pokemon:sets:v5',async()=>{
      const [sets,series]=await Promise.all([
        getJson<any[]>('https://api.tcgdex.net/v2/en/sets'),
        getJson<any[]>('https://api.tcgdex.net/v2/en/series')
      ]);
      const seriesMap=new Map(series.map((s:any)=>[String(s.id),s]));
      const detailed=await mapWithConcurrency(sets,6,async(s:any)=>{
        const base={id:String(s.id),game:'pokemon' as const,name:s.name,cardCount:s.cardCount?.total,logo:s.logo,symbol:s.symbol};
        try{
          const d=await getJson<any>('https://api.tcgdex.net/v2/'+String(s.language||'en')+'/sets/'+encodeURIComponent(String(s.sourceId||s.id)));
          return {...base,releaseDate:d.releaseDate,seriesId:d.serie?.id,seriesName:d.serie?.name,seriesLogo:seriesMap.get(String(d.serie?.id))?.logo};
        }catch{
          return {...base};
        }
      });
      return detailed.filter(Boolean);
    });
  }
  return cacheNonEmpty('catalog:yugioh:sets:v4',async()=>{
    const data=await getJson<any[]>('https://db.ygoprodeck.com/api/v7/cardsets.php');
    return data.map(s=>({
      id:s.set_code||s.set_name,game:'yugioh' as const,name:s.set_name,code:s.set_code,
      cardCount:Number(s.num_of_cards)||undefined,releaseDate:s.tcg_date
    }));
  });
}

export async function hydrateSetDates(game:Game,sets:CatalogSet[]):Promise<CatalogSet[]>{
  if(game!=='pokemon')return sets;
  const missing=sets.filter(s=>!s.releaseDate);
  if(!missing.length)return sets;
  const details=await mapWithConcurrency(missing,6,async(s)=>{
    try{
      const d=await getJson<any>('https://api.tcgdex.net/v2/en/sets/'+encodeURIComponent(s.id));
      return {...s,releaseDate:d.releaseDate,seriesId:d.serie?.id,seriesName:d.serie?.name};
    }catch{return s}
  });
  const byId=new Map(details.map(s=>[s.id,s]));
  const hydrated=sets.map(s=>byId.get(s.id)||s);
  void AsyncStorage.setItem('catalog:pokemon:sets:v6',JSON.stringify(hydrated));
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

export async function getPokemonSetCards(setId:string):Promise<CatalogCard[]>{
  const key='catalog:pokemon:set:v4:'+setId;
  return cacheNonEmpty(key,async()=>{
    let set:any={};
    for(let attempt=0;attempt<3;attempt++){
      try{
        set=await getJson<any>('https://api.tcgdex.net/v2/en/sets/'+encodeURIComponent(setId));
        if(Array.isArray(set.cards)&&set.cards.length>0)break;
      }catch{}
      if(attempt<2)await new Promise(r=>setTimeout(r,250*(attempt+1)));
    }
    let cards=Array.isArray(set.cards)?set.cards:[];
    if(cards.length===0){
      const fallback=await getJson<any[]>(
        'https://api.tcgdex.net/v2/en/cards?set='+encodeURIComponent(setId)+'&pagination:page=1&pagination:itemsPerPage=250'
      ).catch(()=>[]);
      cards=Array.isArray(fallback)?fallback.filter((x:any)=>String(x.id||'').startsWith(setId+'-')):[];
    }
    return cards.map((brief:any)=>{
      const localId=numberOf(brief.localId);
      const source=typeof brief.image==='string'&&brief.image.length>0?brief.image.replace(/\/+$/,''):'';
      const legacy=legacyPokemonImage(setId,localId);
      const image=legacy||(source?source+'/low.webp':pokemonImage(setId,localId,'low'));
      return {
        id:String(brief.id||setId+'-'+localId),
        printingId:String(brief.id||setId+'-'+localId),
        game:'pokemon' as const,name:brief.name||'Unknown',setId,setName:set.name,
        number:localId,image
      };
    }).filter((c:any)=>c.name!=='Unknown'||c.id).sort((a:any,b:any)=>String(a.number).localeCompare(String(b.number),undefined,{numeric:true,sensitivity:'base'}));
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
            game:'yugioh',name:c.name,setName,number:match.set_code,rarity:match.set_rarity,
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

export async function searchCards(game:Game,query:string):Promise<CatalogCard[]>{
  const q=query.trim();
  if(!q)return [];
  const tokens=[...new Set(q.split(/\\s+/).map(x=>x.trim()).filter(x=>x.length>=2))];
  if(game==='pokemon'){
    const textTokens=tokens.filter(x=>!/^H?\\d+[A-Za-z]*$/i.test(x));
    const numberTokens=tokens.filter(x=>/^H?\\d+[A-Za-z]*$/i.test(x)||/\\d/.test(x));
    const requests:string[]=[];
    for(const token of textTokens.slice(0,3))requests.push('https://api.tcgdex.net/v2/en/cards?name='+encodeURIComponent('like:'+token));
    for(const token of numberTokens.slice(0,3))requests.push('https://api.tcgdex.net/v2/en/cards?localId='+encodeURIComponent('like:'+token));
    requests.push('https://api.tcgdex.net/v2/en/cards?id='+encodeURIComponent('like:'+q));
    const raw=(await Promise.all(requests.map(u=>getJson<any[]>(u).catch(()=>[] as any[])))).flat();
    const seen=new Set<string>();
    const merged=raw.filter(c=>{const id=String(c?.id||'');if(!id||seen.has(id))return false;seen.add(id);return true});
    const normalized=q.toLowerCase();
    const mapped=merged.map(c=>{
      const number=numberOf(c.localId);
      const hay=(String(c.name||'')+' '+number+' '+String(c.id||'')).toLowerCase();
      const tokenHits=tokens.filter(t=>hay.includes(t.toLowerCase())).length;
      return {card:{
        id:String(c.id),printingId:String(c.id),game:'pokemon' as const,name:c.name,setId:c.set?.id,setName:c.set?.name,number,
        rarity:c.rarity,image:c.image?c.image+'/high.webp':pokemonImage(String(c.set?.id||''),number,'high'),
        priceEUR:priceFromPokemon(c),trend7EUR:Number(c.pricing?.cardmarket?.avg7)||undefined,trend30EUR:Number(c.pricing?.cardmarket?.avg30)||undefined
      },hits:tokenHits,exact:hay.includes(normalized)};
    });
    return mapped.sort((a,b)=>b.exact===a.exact?(b.hits-a.hits):b.exact?1:-1).slice(0,80).map(x=>x.card);
  }
  const requests=[
    'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='+encodeURIComponent(q)+'&num=100&offset=0',
    'https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(q)+'&num=100&offset=0'
  ];
  const cards=(await Promise.all(requests.map(u=>getJson<any>(u).catch(()=>({data:[]}))))).flatMap(x=>x.data||[]);
  const seen=new Set<string>();const out:CatalogCard[]=[];
  for(const c of cards){
    for(const s of (c.card_sets||[])){
      const hay=(String(c.name||'')+' '+String(s.set_code||'')+' '+String(s.set_name||'')+' '+String(s.set_rarity||'')).toLowerCase();
      if(!tokens.some(t=>hay.includes(t.toLowerCase())))continue;
      const printingId=String(s.set_code||s.set_rarity||s.set_name);
      const id=String(c.id)+'::'+printingId;
      if(seen.has(id))continue;seen.add(id);
      out.push({id,printingId,variantId:printingId,variantLabel:String(s.set_rarity||printingId),game:'yugioh',name:c.name,setName:s.set_name,number:s.set_code,rarity:s.set_rarity,image:c.card_images?.[0]?.image_url_small||c.card_images?.[0]?.image_url,priceEUR:priceFromYgo(c),priceUSD:Number(s.set_price)||undefined});
    }
  }
  return out.slice(0,80);
}

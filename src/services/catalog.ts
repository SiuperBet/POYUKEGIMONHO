export type CatalogGame='pokemon'|'yugioh';

export interface CatalogPrice {
  source:string;
  currency:string;
  amount:number;
  updatedAt?:string;
  period?:string;
}

export interface CatalogCard {
  id:string;
  game:CatalogGame;
  name:string;
  number?:string;
  setId?:string;
  setName?:string;
  rarity?:string;
  year?:number;
  image?:string;
  language?:string;
  prices:CatalogPrice[];
  priceHistory?:CatalogPrice[];
  variants:string[];
  externalId:string;
}

const cache=new Map<string,any>();

async function getJson<T>(url:string):Promise<T>{
  const cached=cache.get(url);
  if(cached)return cached as T;
  const res=await fetch(url);
  if(!res.ok)throw new Error('Catalog request failed');
  const data=await res.json() as T;
  cache.set(url,data);
  return data;
}

function cleanText(text:string){
  return text.replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim();
}

function money(value:any){const n=Number(value);return Number.isFinite(n)&&n>0?n:0}

function pokemonPrices(p:any):CatalogPrice[]{
  const out:CatalogPrice[]=[];
  const cm=p?.cardmarket;
  const tcg=p?.tcgplayer;
  const add=(source:string,currency:string,value:any,period?:string,updated?:any)=>{
    const amount=money(value);if(amount)out.push({source,currency,amount,period,updatedAt:updated?String(updated):undefined});
  };
  add('Cardmarket','EUR',cm?.trend,'current',cm?.updated);
  add('Cardmarket','EUR',cm?.avg1,'1d',cm?.updated);
  add('Cardmarket','EUR',cm?.avg7,'7d',cm?.updated);
  add('Cardmarket','EUR',cm?.avg30,'30d',cm?.updated);
  add('Cardmarket','EUR',cm?.trend_holo??cm?.['trend-holo'],'holo-current',cm?.updated);
  add('Cardmarket','EUR',cm?.['avg7-holo'],'holo-7d',cm?.updated);
  add('Cardmarket','EUR',cm?.['avg30-holo'],'holo-30d',cm?.updated);
  add('TCGplayer','USD',tcg?.normal?.marketPrice,'normal-current',tcg?.updated);
  add('TCGplayer','USD',tcg?.reverse?.marketPrice,'reverse-current',tcg?.updated);
  add('TCGplayer','USD',tcg?.holofoil?.marketPrice,'holo-current',tcg?.updated);
  return out;
}

function pokemonVariants(v:any):string[]{
  if(!v)return [];
  return Object.entries(v).filter(([,value])=>value===true).map(([key])=>key);
}

function pokemonToCard(c:any):CatalogCard{
  const prices=pokemonPrices(c.pricing);
  return {
    id:String(c.id),game:'pokemon',name:String(c.name),number:c.localId==null?undefined:String(c.localId),
    setId:c.set?.id,setName:c.set?.name,rarity:c.rarity,image:c.image,
    year:c.set?.releaseDate?Number(String(c.set.releaseDate).slice(0,4)):undefined,
    prices:prices.filter(p=>!p.period||p.period==='current'||p.period==='normal-current'||p.period==='holo-current'),
    priceHistory:prices.filter(p=>p.period&&/d$/.test(p.period)),
    variants:pokemonVariants(c.variants),externalId:String(c.id)
  };
}

async function pokemonBriefs(query:string,field:'name'|'effect'='name'){
  const q=cleanText(query);if(!q)return [];
  const url=`https://api.tcgdex.net/v2/en/cards?${field}=${encodeURIComponent(q)}&pagination:itemsPerPage=20`;
  try{return await getJson<Array<any>>(url)}catch{return []}
}

export async function searchPokemon(query:string):Promise<CatalogCard[]>{
  const q=cleanText(query);if(!q)return [];
  const [nameRows,effectRows]=await Promise.all([pokemonBriefs(q,'name'),pokemonBriefs(q,'effect')]);
  const rows=[...new Map([...nameRows,...effectRows].map(r=>[r.id,r])).values()].slice(0,24);
  const detailed=await Promise.all(rows.map(r=>getJson<any>(`https://api.tcgdex.net/v2/en/cards/${r.id}`).catch(()=>null)));
  return detailed.filter(Boolean).map(pokemonToCard);
}

async function enrichPokemonRows(rows:any[],set:any):Promise<CatalogCard[]>{
  const out:CatalogCard[]=[];
  for(let i=0;i<rows.length;i+=8){
    const batch=rows.slice(i,i+8);
    const detailed=await Promise.all(batch.map(r=>getJson<any>(`https://api.tcgdex.net/v2/en/cards/${r.id}`).catch(()=>null)));
    for(const card of detailed.filter(Boolean))out.push(pokemonToCard(card));
  }
  return out.map(c=>({...c,setId:c.setId||String(set.id),setName:c.setName||String(set.name)}));
}

export async function getPokemonSetCards(setId:string):Promise<CatalogCard[]>{
  const set=await getJson<any>(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`);
  const rows=Array.isArray(set.cards)?set.cards:[]; 
  return enrichPokemonRows(rows,set);
}

function yugiohToCard(c:any,setNameHint?:string):CatalogCard{
  const set=c.card_sets?.find((s:any)=>s.set_name===setNameHint)||c.card_sets?.[0];
  const prices=c.card_prices?.[0]||{};
  const cm=money(prices.cardmarket_price),tcg=money(prices.tcgplayer_price);
  const image=c.card_images?.[0]?.image_url||c.card_images?.[0]?.image_url_small;
  return {
    id:String(c.id),game:'yugioh',name:String(c.name),number:set?.set_code?.split('-').slice(-1)[0],
    setId:set?.set_code,setName:set?.set_name,rarity:set?.set_rarity,image,
    prices:[
      ...(cm?[{source:'Cardmarket',currency:'EUR',amount:cm}]:[]),
      ...(tcg?[{source:'TCGplayer',currency:'USD',amount:tcg}]:[])
    ],
    variants:c.card_sets?.map((s:any)=>s.set_rarity).filter(Boolean).slice(0,12)||[],
    externalId:String(c.id)
  };
}

export async function searchYugioh(query:string):Promise<CatalogCard[]>{
  const q=cleanText(query);if(!q)return [];
  const data=await getJson<{data:Array<any>}>(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=40&offset=0`);
  return (data.data||[]).map(c=>yugiohToCard(c));
}

export async function getYugiohSetCards(setName:string):Promise<CatalogCard[]>{
  const all:any[]=[];
  let offset=0;
  while(true){
    const data=await getJson<{data:Array<any>;meta?:{total_rows?:number;next_page?:string}}>(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(setName)}&num=100&offset=${offset}`);
    const rows=data.data||[];all.push(...rows);
    if(!rows.length||!data.meta?.next_page||all.length>=(data.meta.total_rows||all.length))break;
    offset+=rows.length;
  }
  return all.map(c=>yugiohToCard(c,setName));
}

export function getCardPrice(card:CatalogCard,currency='EUR'){
  const p=card.prices.find(x=>x.currency===currency);
  return p?.amount||0;
}

function similarity(a:string,b:string){
 const x=a.toLowerCase().replace(/[^a-z0-9àèéìòù]/g,''),y=b.toLowerCase().replace(/[^a-z0-9àèéìòù]/g,'');
 if(!x||!y)return 0;
 const prev=Array.from({length:y.length+1},(_,i)=>i);
 for(let i=1;i<=x.length;i++){const row=[i];for(let j=1;j<=y.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));for(let j=0;j<row.length;j++)prev[j]=row[j]}
 return 1-prev[y.length]/Math.max(x.length,y.length);
}

export async function recognize(game:CatalogGame,text:string,numberHint?:string):Promise<CatalogCard[]>{
 const cleaned=cleanText(text);
 const lines=[...new Set(cleaned.split(/\n+/).map(x=>x.trim()).filter(x=>x.length>=3))];
 const tokens=[...new Set(cleaned.split(/\s+/).filter(w=>w.length>=3))].slice(0,12);
 if(!tokens.length)return [];
 const queries=[...new Set([...lines.slice(0,4),...tokens])].slice(0,10);
 const batches=await Promise.all(queries.map(q=>game==='pokemon'?searchPokemon(q):searchYugioh(q)));
 const unique=[...new Map(batches.flat().map(card=>[card.externalId,card])).values()];
 const scored=unique.map(card=>{
  const name=card.name.toLowerCase();
  const tokenScore=tokens.reduce((n,t)=>n+(name.includes(t.toLowerCase())?6:similarity(t,name)>.72?2:0),0);
  const lineScore=lines.reduce((n,line)=>n+(similarity(line,name)>.62?8:0),0);
  const numberScore=numberHint&&card.number&&card.number.replace(/\s/g,'').toLowerCase()===numberHint.replace(/\s/g,'').toLowerCase()?40:0;
  return {card,score:tokenScore+lineScore+numberScore};
 });
 return scored.sort((a,b)=>b.score-a.score).map(x=>x.card).slice(0,16);
}

export async function getPokemonSets(){
  return getJson<Array<any>>('https://api.tcgdex.net/v2/en/sets');
}

export async function getYugiohSets(){
  return getJson<Array<any>>('https://db.ygoprodeck.com/api/v7/cardsets.php');
}

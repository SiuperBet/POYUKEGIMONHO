export type CatalogGame='pokemon'|'yugioh';

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
  prices:Array<{source:string;currency:string;amount:number;updatedAt?:string}>;
  variants:string[];
  externalId:string;
}

const cache=new Map<string,CatalogCard[]>();

async function getJson<T>(url:string):Promise<T>{
  const cached=cache.get(url);
  if(cached)return cached as T;
  const res=await fetch(url);
  if(!res.ok)throw new Error('Catalog request failed');
  const data=await res.json() as T;
  return data;
}

function cleanText(text:string){
  return text.replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim();
}

export async function searchPokemon(query:string):Promise<CatalogCard[]>{
  const q=cleanText(query);
  if(!q)return [];
  const url=`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(q)}&pagination:itemsPerPage=12`;
  const rows=await getJson<Array<{id:string;name:string;localId:string;image?:string}>>(url);
  const detailed=await Promise.all(rows.slice(0,8).map(r=>getJson<any>(`https://api.tcgdex.net/v2/en/cards/${r.id}`).catch(()=>null)));
  return detailed.filter(Boolean).map((c:any)=>({
    id:c.id,game:'pokemon',name:c.name,number:c.localId,setId:c.set?.id,setName:c.set?.name,rarity:c.rarity,image:c.image,
    year:c.set?.releaseDate?Number(c.set.releaseDate.slice(0,4)):undefined,
    prices: pokemonPrices(c.pricing),variants: pokemonVariants(c.variants),externalId:c.id
  }));
}

function pokemonVariants(v:any):string[]{
  if(!v)return [];
  return Object.entries(v).filter(([,value])=>value===true).map(([key])=>key);
}
function pokemonPrices(p:any):CatalogCard['prices']{
  const out:CatalogCard['prices']=[];
  if(p?.cardmarket?.trend)out.push({source:'Cardmarket',currency:'EUR',amount:p.cardmarket.trend,updatedAt:p.cardmarket.updated?new Date(p.cardmarket.updated).toISOString():undefined});
  if(p?.tcgplayer?.normal?.marketPrice)out.push({source:'TCGplayer',currency:'USD',amount:p.tcgplayer.normal.marketPrice,updatedAt:p.tcgplayer.updated?new Date(p.tcgplayer.updated).toISOString():undefined});
  return out;
}

export async function searchYugioh(query:string):Promise<CatalogCard[]>{
  const q=cleanText(query);
  if(!q)return [];
  const url=`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=12`;
  const data=await getJson<{data:Array<any>}>(url);
  return (data.data||[]).slice(0,12).map(c=>{
    const set=c.card_sets?.[0];
    const prices=c.card_prices?.[0]||{};
    return {
      id:String(c.id),game:'yugioh',name:c.name,number:set?.set_code?.split('-').slice(-1)[0],
      setId:set?.set_code?.split('-')[0],setName:set?.set_name,rarity:set?.set_rarity,
      image:c.card_images?.[0]?.image_url,prices:[
        prices.cardmarket_price?{source:'Cardmarket',currency:'EUR',amount:Number(prices.cardmarket_price)}:null,
        prices.tcgplayer_price?{source:'TCGplayer',currency:'USD',amount:Number(prices.tcgplayer_price)}:null
      ].filter(Boolean) as CatalogCard['prices'],
      variants:c.card_sets?.map((s:any)=>s.set_rarity).filter(Boolean).slice(0,8)||[],externalId:String(c.id)
    };
  });
}

function similarity(a:string,b:string){
 const x=a.toLowerCase().replace(/[^a-z0-9]/g,''),y=b.toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!x||!y)return 0;
 const prev=Array.from({length:y.length+1},(_,i)=>i);
 for(let i=1;i<=x.length;i++){const row=[i];for(let j=1;j<=y.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));for(let j=0;j<row.length;j++)prev[j]=row[j]}
 return 1-prev[y.length]/Math.max(x.length,y.length);
}

export async function recognize(game:CatalogGame,text:string,numberHint?:string):Promise<CatalogCard[]>{
 const cleaned=cleanText(text);
 const lines=[...new Set(cleaned.split(/\n+/).map(x=>x.trim()).filter(x=>x.length>=3))];
 const tokens=[...new Set(cleaned.split(/\s+/).filter(w=>w.length>=3))].slice(0,14);
 if(!tokens.length)return [];
 const queries=[...new Set([...lines.slice(0,3),...tokens])].slice(0,12);
 const batches=await Promise.all(queries.map(q=>game==='pokemon'?searchPokemon(q):searchYugioh(q)));
 const unique=[...new Map(batches.flat().map(card=>[card.externalId,card])).values()];
 const scored=unique.map(card=>{
  const name=card.name.toLowerCase();
  const tokenScore=tokens.reduce((n,t)=>n+(name.includes(t.toLowerCase())?4:similarity(t,name)>.72?2:0),0);
  const lineScore=lines.reduce((n,line)=>n+(similarity(line,name)>.62?6:0),0);
  const numberScore=numberHint&&card.number&&card.number.replace(/\s/g,'').toLowerCase()===numberHint.replace(/\s/g,'').toLowerCase()?30:0;
  return {card,score:tokenScore+lineScore+numberScore};
 });
 return scored.sort((a,b)=>b.score-a.score).map(x=>x.card).slice(0,12);
}

export async function getPokemonSets(){
  return getJson<Array<any>>('https://api.tcgdex.net/v2/en/sets');
}
export async function getYugiohSets(){
  return getJson<Array<any>>('https://db.ygoprodeck.com/api/v7/cardsets.php');
}

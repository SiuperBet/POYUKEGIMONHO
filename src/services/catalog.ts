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

export async function recognize(game:CatalogGame,text:string,numberHint?:string):Promise<CatalogCard[]>{
  const tokens=[...new Set(cleanText(text).split(/\s+/).filter(w=>w.length>=3).slice(0,8))];
  if(!tokens.length)return [];
  const batches=await Promise.all(tokens.map(token=>game==='pokemon'?searchPokemon(token):searchYugioh(token)));
  const flat=batches.flat();
  const unique=[...new Map(flat.map(card=>[card.externalId,card])).values()];
  const scored=unique.map(card=>{
    const name=card.name.toLowerCase();
    const tokenScore=tokens.reduce((n,t)=>n+(name.includes(t.toLowerCase())?3:0),0);
    const numberScore=numberHint&&card.number&&card.number.replace(/\s/g,'')===numberHint.replace(/\s/g,'')?20:0;
    return {card,score:tokenScore+numberScore};
  });
  return scored.sort((a,b)=>b.score-a.score).map(x=>x.card).slice(0,12);
}

export async function getPokemonSets(){
  return getJson<Array<any>>('https://api.tcgdex.net/v2/en/sets');
}
export async function getYugiohSets(){
  return getJson<Array<any>>('https://db.ygoprodeck.com/api/v7/cardsets.php');
}

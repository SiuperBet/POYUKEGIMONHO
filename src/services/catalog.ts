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

function pokemonPrices(p:any):CatalogCard['prices']{
  const out:CatalogCard['prices']=[];
  const cm=p?.cardmarket;
  const tcg=p?.tcgplayer;
  const cmValue=Number(cm?.trend??cm?.avg??cm?.average??0);
  const tcgValue=Number(tcg?.normal?.marketPrice??tcg?.marketPrice??0);
  if(Number.isFinite(cmValue)&&cmValue>0)out.push({source:'Cardmarket',currency:'EUR',amount:cmValue,updatedAt:cm?.updated?String(cm.updated):undefined});
  if(Number.isFinite(tcgValue)&&tcgValue>0)out.push({source:'TCGplayer',currency:'USD',amount:tcgValue,updatedAt:tcg?.updated?String(tcg.updated):undefined});
  return out;
}

function pokemonVariants(v:any):string[]{
  if(!v)return [];
  return Object.entries(v).filter(([,value])=>value===true).map(([key])=>key);
}

function pokemonToCard(c:any):CatalogCard{
  return {
    id:String(c.id),game:'pokemon',name:String(c.name),number:c.localId==null?undefined:String(c.localId),
    setId:c.set?.id,setName:c.set?.name,rarity:c.rarity,image:c.image,
    year:c.set?.releaseDate?Number(String(c.set.releaseDate).slice(0,4)):undefined,
    prices:pokemonPrices(c.pricing),variants:pokemonVariants(c.variants),externalId:String(c.id)
  };
}

async function pokemonBriefs(query:string,field:'name'|'effect'='name'){
  const q=cleanText(query);
  if(!q)return [];
  const url=`https://api.tcgdex.net/v2/en/cards?${field}=${encodeURIComponent(q)}&pagination:itemsPerPage=20`;
  try{return await getJson<Array<any>>(url)}catch{return []}
}

export async function searchPokemon(query:string):Promise<CatalogCard[]>{
  const q=cleanText(query);
  if(!q)return [];
  const [nameRows,effectRows]=await Promise.all([pokemonBriefs(q,'name'),pokemonBriefs(q,'effect')]);
  const rows=[...new Map([...nameRows,...effectRows].map(r=>[r.id,r])).values()].slice(0,16);
  const detailed=await Promise.all(rows.map(r=>getJson<any>(`https://api.tcgdex.net/v2/en/cards/${r.id}`).catch(()=>null)));
  return detailed.filter(Boolean).map(pokemonToCard);
}

export async function getPokemonSetCards(setId:string):Promise<CatalogCard[]>{
  const set=await getJson<any>(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`);
  const rows=Array.isArray(set.cards)?set.cards.slice(0,180):[];
  const detailed=await Promise.all(rows.map((r:any)=>getJson<any>(`https://api.tcgdex.net/v2/en/cards/${r.id}`).catch(()=>null)));
  return detailed.filter(Boolean).map(pokemonToCard);
}

export async function searchYugioh(query:string):Promise<CatalogCard[]>{
  const q=cleanText(query);
  if(!q)return [];
  const url=`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=20`;
  const data=await getJson<{data:Array<any>}>(url);
  return (data.data||[]).slice(0,20).map(c=>{
    const set=c.card_sets?.[0];
    const prices=c.card_prices?.[0]||{};
    const cm=Number(prices.cardmarket_price||0),tcg=Number(prices.tcgplayer_price||0);
    return {
      id:String(c.id),game:'yugioh',name:c.name,number:set?.set_code?.split('-').slice(-1)[0],
      setId:set?.set_code?.split('-')[0],setName:set?.set_name,rarity:set?.set_rarity,
      image:c.card_images?.[0]?.image_url,prices:[
        ...(cm>0?[{source:'Cardmarket',currency:'EUR',amount:cm}]:[]),
        ...(tcg>0?[{source:'TCGplayer',currency:'USD',amount:tcg}]:[])
      ],variants:c.card_sets?.map((s:any)=>s.set_rarity).filter(Boolean).slice(0,8)||[],externalId:String(c.id)
    };
  });
}

export async function getYugiohSetCards(setName:string):Promise<CatalogCard[]>{
  const data=await getJson<{data:Array<any>}>(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(setName)}&num=120&offset=0`);
  return (data.data||[]).map(c=>{
    const set=c.card_sets?.find((s:any)=>s.set_name===setName)||c.card_sets?.[0];
    const prices=c.card_prices?.[0]||{};
    const cm=Number(prices.cardmarket_price||0),tcg=Number(prices.tcgplayer_price||0);
    return {
      id:String(c.id),game:'yugioh',name:c.name,number:set?.set_code?.split('-').slice(-1)[0],
      setName:set?.set_name,setId:set?.set_code?.split('-')[0],rarity:set?.set_rarity,
      image:c.card_images?.[0]?.image_url,prices:[
        ...(cm>0?[{source:'Cardmarket',currency:'EUR',amount:cm}]:[]),
        ...(tcg>0?[{source:'TCGplayer',currency:'USD',amount:tcg}]:[])
      ],variants:c.card_sets?.map((s:any)=>s.set_rarity).filter(Boolean).slice(0,8)||[],externalId:String(c.id)
    };
  });
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
 const tokens=[...new Set(cleaned.split(/\s+/).filter(w=>w.length>=3))].slice(0,10);
 if(!tokens.length)return [];
 const queries=[...new Set([...lines.slice(0,3),...tokens])].slice(0,8);
 const batches=await Promise.all(queries.map(q=>game==='pokemon'?searchPokemon(q):searchYugioh(q)));
 const unique=[...new Map(batches.flat().map(card=>[card.externalId,card])).values()];
 const scored=unique.map(card=>{
  const name=card.name.toLowerCase();
  const tokenScore=tokens.reduce((n,t)=>n+(name.includes(t.toLowerCase())?6:similarity(t,name)>.72?2:0),0);
  const lineScore=lines.reduce((n,line)=>n+(similarity(line,name)>.62?8:0),0);
  const numberScore=numberHint&&card.number&&card.number.replace(/\s/g,'').toLowerCase()===numberHint.replace(/\s/g,'').toLowerCase()?40:0;
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

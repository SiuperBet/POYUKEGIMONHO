import AsyncStorage from '@react-native-async-storage/async-storage';

export type Game='pokemon'|'yugioh';
export type CatalogCard={
  id:string; game:Game; name:string; setId?:string; setName?:string; number?:string;
  rarity?:string; image?:string; priceEUR?:number; priceUSD?:number; updatedAt?:string;
};
export type CatalogSet={id:string;game:Game;name:string;code?:string;cardCount?:number;releaseDate?:string;logo?:string};

async function cache<T>(key:string,loader:()=>Promise<T>):Promise<T>{
  return AsyncStorage.getItem(key).then(async raw=>{
    if(raw){try{return JSON.parse(raw) as T}catch{}}
    const value=await loader();
    void AsyncStorage.setItem(key,JSON.stringify(value));
    return value;
  });
}

async function getJson<T>(url:string):Promise<T>{
  const response=await fetch(url);
  if(!response.ok)throw new Error('HTTP '+response.status);
  return response.json() as Promise<T>;
}

export async function getSets(game:Game):Promise<CatalogSet[]>{
  if(game==='pokemon'){
    return cache('catalog:pokemon:sets',async()=>{
      const data=await getJson<any[]>('https://api.tcgdex.net/v2/en/sets');
      return data.map(s=>({id:s.id,game:'pokemon',name:s.name,cardCount:s.cardCount?.total,logo:s.logo}));
    });
  }
  return cache('catalog:yugioh:sets',async()=>{
    const data=await getJson<any[]>('https://db.ygoprodeck.com/api/v7/cardsets.php');
    return data.map(s=>({id:s.set_code||s.set_name,game:'yugioh',name:s.set_name,code:s.set_code,cardCount:Number(s.num_of_cards)||undefined,releaseDate:s.tcg_date}));
  });
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
  const key='catalog:pokemon:set:'+setId;
  return cache(key,async()=>{
    const set=await getJson<any>('https://api.tcgdex.net/v2/en/sets/'+encodeURIComponent(setId));
    const cards=Array.isArray(set.cards)?set.cards:[];
    const full=await Promise.all(cards.map(async (brief:any)=>{
      try{
        const c=await getJson<any>('https://api.tcgdex.net/v2/en/cards/'+encodeURIComponent(setId)+'-'+encodeURIComponent(brief.localId));
        return {id:c.id||setId+'-'+brief.localId,game:'pokemon' as const,name:c.name||brief.name||'Unknown',setId,setName:set.name,number:numberOf(c.localId||brief.localId),rarity:c.rarity,image:c.image?c.image+'/high.webp':undefined,priceEUR:priceFromPokemon(c)};
      }catch{
        return {id:setId+'-'+brief.localId,game:'pokemon' as const,name:brief.name||'Unknown',setId,setName:set.name,number:numberOf(brief.localId),image:brief.image?brief.image+'/high.webp':undefined};
      }
    }));
    return full;
  });
}

export async function getYugiohSetCards(setName:string):Promise<CatalogCard[]>{
  const key='catalog:yugioh:set:'+setName;
  return cache(key,async()=>{
    const out:CatalogCard[]=[];
    let offset=0;
    while(true){
      const data=await getJson<any>('https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(setName)+'&num=100&offset='+offset);
      const rows=Array.isArray(data)?data:data.data||[];
      for(const c of rows){
        const match=(c.card_sets||[]).find((s:any)=>s.set_name===setName)||c.card_sets?.[0];
        out.push({id:String(c.id),game:'yugioh',name:c.name,setName,number:match?.set_code,rarity:match?.set_rarity,image:c.card_images?.[0]?.image_url_small||c.card_images?.[0]?.image_url,priceEUR:priceFromYgo(c),priceUSD:Number(c.card_prices?.[0]?.tcgplayer_price)||undefined});
      }
      if(!data.meta?.next_page||rows.length===0)break;
      offset+=rows.length;
      if(rows.length<100)break;
    }
    return out;
  });
}

export async function searchCards(game:Game,query:string):Promise<CatalogCard[]>{
  const q=query.trim();
  if(!q)return [];
  if(game==='pokemon'){
    const data=await getJson<any[]>('https://api.tcgdex.net/v2/en/cards?name='+encodeURIComponent(q));
    return data.slice(0,40).map(c=>({id:c.id,game:'pokemon',name:c.name,setId:c.set?.id,setName:c.set?.name,number:numberOf(c.localId),rarity:c.rarity,image:c.image?c.image+'/high.webp':undefined,...pricingFromPokemon(c)}));
  }
  const data=await getJson<any>('https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='+encodeURIComponent(q)+'&num=40&offset=0');
  return (data.data||[]).map((c:any)=>({id:String(c.id),game:'yugioh',name:c.name,number:c.card_sets?.[0]?.set_code,rarity:c.card_sets?.[0]?.set_rarity,image:c.card_images?.[0]?.image_url_small,priceEUR:priceFromYgo(c),priceUSD:Number(c.card_prices?.[0]?.tcgplayer_price)||undefined}));
}

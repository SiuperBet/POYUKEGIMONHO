import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CatalogCard} from './catalog';

export type Condition='Mint'|'NM'|'Excellent'|'Good'|'Played'|'Poor'|'Damaged';
export const CONDITION_FACTORS:Record<Condition,number>={Mint:1,NM:0.95,Excellent:0.65,Good:0.41,Played:0.22,Poor:0.17,Damaged:0.10};
export const CONDITIONS:Condition[]=['Mint','NM','Excellent','Good','Played','Poor','Damaged'];
export type CollectionItem=CatalogCard & {quantity:number;condition:Condition;addedAt:string;backImage?:string;};
export function estimateCardValueEUR(priceEUR:number|undefined,condition:Condition='NM'){return Number.isFinite(priceEUR)&&Number(priceEUR)>0?Number(priceEUR)*CONDITION_FACTORS[condition]:0;}
export type GradedItem={id:string;image?:string;backImage?:string;grade:string;score:number;confidence:number;addedAt:string;notes:string[];condition?:Condition;card?:CatalogCard;};

const COLLECTION='poyukegimonho:mobile:collection:v1';
const GRADED='poyukegimonho:mobile:graded:v1';

async function read<T>(key:string,fallback:T):Promise<T>{const raw=await AsyncStorage.getItem(key);if(!raw)return fallback;try{return JSON.parse(raw) as T}catch{return fallback}}
export const loadCollection=()=>read<CollectionItem[]>(COLLECTION,[]);
export const loadGraded=()=>read<GradedItem[]>(GRADED,[]);
export async function saveCollection(items:CollectionItem[]){await AsyncStorage.setItem(COLLECTION,JSON.stringify(items))}
export async function saveGraded(items:GradedItem[]){await AsyncStorage.setItem(GRADED,JSON.stringify(items))}
export async function addToCollection(card:CatalogCard,condition:Condition='NM',quantity=1,scanImage?:string,backImage?:string){
  const items=await loadCollection();
  const index=items.findIndex(x=>x.id===card.id&&x.condition===condition);
  if(index>=0)items[index]={...items[index],quantity:items[index].quantity+quantity,image:scanImage||items[index].image,backImage:backImage||items[index].backImage};
  else items.unshift({...card,quantity,condition,addedAt:new Date().toISOString(),image:scanImage||card.image,backImage});
  await saveCollection(items); return items;
}
export async function addGraded(item:GradedItem){const items=await loadGraded();items.unshift(item);await saveGraded(items);return items}

export async function updateGraded(id:string,patch:Partial<GradedItem>){const items=await loadGraded();const next=items.map(x=>x.id===id?{...x,...patch}:x);await saveGraded(next);return next}
export async function deleteGraded(id:string){const items=await loadGraded();const next=items.filter(x=>x.id!==id);await saveGraded(next);return next}

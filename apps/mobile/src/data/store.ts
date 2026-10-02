import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CatalogCard} from './catalog';

export type CollectionItem=CatalogCard & {quantity:number;condition:string;addedAt:string;};
export type GradedItem={id:string;image?:string;grade:string;score:number;confidence:number;addedAt:string;notes:string[];card?:CatalogCard;};

const COLLECTION='poyukegimonho:mobile:collection:v1';
const GRADED='poyukegimonho:mobile:graded:v1';

async function read<T>(key:string,fallback:T):Promise<T>{const raw=await AsyncStorage.getItem(key);if(!raw)return fallback;try{return JSON.parse(raw) as T}catch{return fallback}}
export const loadCollection=()=>read<CollectionItem[]>(COLLECTION,[]);
export const loadGraded=()=>read<GradedItem[]>(GRADED,[]);
export async function saveCollection(items:CollectionItem[]){await AsyncStorage.setItem(COLLECTION,JSON.stringify(items))}
export async function saveGraded(items:GradedItem[]){await AsyncStorage.setItem(GRADED,JSON.stringify(items))}
export async function addToCollection(card:CatalogCard,condition='NM',quantity=1){
  const items=await loadCollection();
  const index=items.findIndex(x=>x.id===card.id&&x.condition===condition);
  if(index>=0)items[index]={...items[index],quantity:items[index].quantity+quantity};
  else items.unshift({...card,quantity,condition,addedAt:new Date().toISOString()});
  await saveCollection(items); return items;
}
export async function addGraded(item:GradedItem){const items=await loadGraded();items.unshift(item);await saveGraded(items);return items}

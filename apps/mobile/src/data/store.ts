import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CatalogCard} from './catalog';

export type Condition='Mint'|'NM'|'Excellent'|'Good'|'Played'|'Poor'|'Damaged'|'Da verificare';
export const CONDITION_FACTORS:Record<Condition,number>={Mint:1,NM:0.95,Excellent:0.65,Good:0.41,Played:0.22,Poor:0.17,Damaged:0.10,'Da verificare':0};
export const CONDITIONS:Condition[]=['Mint','NM','Excellent','Good','Played','Poor','Damaged'];
export type DefectType='riga'|'graffio'|'piega'|'puntino_bianco'|'whitening'|'angolo_rovinato'|'bordo_scheggiato'|'dent'|'sporco'|'print_line'|'difetto_stampa'|'holo_graffio'|'imperfezione'|'altro';
export type DefectRecord={id:string;type:DefectType;side:'front'|'back';severity:'low'|'medium'|'high';confidence:number;note?:string;region?:{x:number;y:number;width:number;height:number};score?:number;source?:'automatic'|'manual'|'reviewed'};
export type InspectionPhoto={id:string;uri:string;purpose:'front'|'back'|'corner_tl'|'corner_tr'|'corner_bl'|'corner_br'|'edge_top'|'edge_right'|'edge_bottom'|'edge_left'|'surface_close'|'surface_angle';label:string;createdAt:string};
export type ProfessionalAnalysis={mode:'professional';completed:boolean;photos:InspectionPhoto[];centering?:{front:{left:number;right:number;top:number;bottom:number};back?:{left:number;right:number;top:number;bottom:number}};subgrades?:{centering:number;corners:number;edges:number;surface:number};overall?:number;confidence:number;alterationCheck?:'clear'|'review'|'suspected';notes:string[]};
export type VisualAnalysisSnapshot={condition:Condition;score:number;confidence:number;frontQuality:number;backQuality?:number;defects:DefectRecord[];hasBack:boolean;engine:string;notes:string[];professional?:ProfessionalAnalysis};
export type CollectionItem=CatalogCard & {quantity:number;condition:Condition;addedAt:string;backImage?:string;visualAnalysis?:VisualAnalysisSnapshot;professionalAnalysis?:ProfessionalAnalysis;};
export function estimateCardValueEUR(priceEUR:number|undefined,condition:Condition='NM'){return Number.isFinite(priceEUR)&&Number(priceEUR)>0?Number(priceEUR)*CONDITION_FACTORS[condition]:0;}
export type GradedItem={id:string;image?:string;backImage?:string;grade:string;score:number;confidence:number;addedAt:string;notes:string[];condition?:Condition;card?:CatalogCard;visualAnalysis?:VisualAnalysisSnapshot;professionalAnalysis?:ProfessionalAnalysis;};

const COLLECTION='poyukegimonho:mobile:collection:v1';
const GRADED='poyukegimonho:mobile:graded:v1';

async function read<T>(key:string,fallback:T):Promise<T>{const raw=await AsyncStorage.getItem(key);if(!raw)return fallback;try{return JSON.parse(raw) as T}catch{return fallback}}
export async function loadCollection(){
  const current=await read<CollectionItem[]>(COLLECTION,[]);
  if(current.length)return current;
  const legacy=await read<CollectionItem[]>(LEGACY_COLLECTION,[]);
  if(legacy.length)await AsyncStorage.setItem(COLLECTION,JSON.stringify(legacy));
  return legacy;
}
export const loadGraded=()=>read<GradedItem[]>(GRADED,[]);
export async function saveCollection(items:CollectionItem[]){await AsyncStorage.setItem(COLLECTION,JSON.stringify(items))}
export async function saveGraded(items:GradedItem[]){await AsyncStorage.setItem(GRADED,JSON.stringify(items))}
export async function addToCollection(card:CatalogCard,condition:Condition='Da verificare',quantity=1,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysisSnapshot,professionalAnalysis?:ProfessionalAnalysis){
  const items=await loadCollection();
  const index=items.findIndex(x=>x.id===card.id&&x.condition===condition);
  if(index>=0)items[index]={...items[index],quantity:items[index].quantity+quantity,image:scanImage||items[index].image,backImage:backImage||items[index].backImage,visualAnalysis:visualAnalysis||items[index].visualAnalysis,professionalAnalysis:professionalAnalysis||items[index].professionalAnalysis};
  else items.unshift({...card,quantity,condition,addedAt:new Date().toISOString(),image:scanImage||card.image,backImage,visualAnalysis,professionalAnalysis});
  await saveCollection(items); return items;
}
export async function addGraded(item:GradedItem){const items=await loadGraded();items.unshift(item);await saveGraded(items);return items}

export async function updateGraded(id:string,patch:Partial<GradedItem>){const items=await loadGraded();const next=items.map(x=>x.id===id?{...x,...patch}:x);await saveGraded(next);return next}
export async function deleteGraded(id:string){const items=await loadGraded();const next=items.filter(x=>x.id!==id);await saveGraded(next);return next}

export async function updateCollection(id:string,condition:Condition,patch:Partial<CollectionItem>={}){const items=await loadCollection();const next=items.map(x=>x.id===id&&x.condition===condition?{...x,...patch}:x);await saveCollection(next);return next}

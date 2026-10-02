import type { InspectionPhoto } from './store';

export type InspectionStep={
  purpose:InspectionPhoto['purpose'];
  title:string;
  instruction:string;
  optional?:boolean;
};

export const PROFESSIONAL_INSPECTION_STEPS:InspectionStep[]=[
  {purpose:'front',title:'Fronte',instruction:'Inquadra tutta la carta, parallela al telefono, senza tagliare i bordi.'},
  {purpose:'back',title:'Retro',instruction:'Gira la carta e acquisisci tutto il retro con la stessa cura.'},
  {purpose:'surface_close',title:'Superficie ravvicinata',instruction:'Avvicinati per mostrare micro-graffi, righe, macchie e difetti di stampa.'},
  {purpose:'surface_angle',title:'Superficie inclinata',instruction:'Inclina leggermente il telefono per far emergere riflessi, graffi, pieghe e dent.'},
  {purpose:'corner_tl',title:'Angolo alto sinistro',instruction:'Avvicinati all'angolo e mantieni il dettaglio perfettamente a fuoco.'},
  {purpose:'corner_tr',title:'Angolo alto destro',instruction:'Avvicinati all'angolo e mantieni il dettaglio perfettamente a fuoco.'},
  {purpose:'corner_bl',title:'Angolo basso sinistro',instruction:'Avvicinati all'angolo e mantieni il dettaglio perfettamente a fuoco.'},
  {purpose:'corner_br',title:'Angolo basso destro',instruction:'Avvicinati all'angolo e mantieni il dettaglio perfettamente a fuoco.'},
  {purpose:'edge_top',title:'Bordo superiore',instruction:'Segui il bordo con una foto ravvicinata e ben illuminata.'},
  {purpose:'edge_right',title:'Bordo destro',instruction:'Segui il bordo con una foto ravvicinata e ben illuminata.'},
  {purpose:'edge_bottom',title:'Bordo inferiore',instruction:'Segui il bordo con una foto ravvicinata e ben illuminata.'},
  {purpose:'edge_left',title:'Bordo sinistro',instruction:'Segui il bordo con una foto ravvicinata e ben illuminata.'},
];

export function getInspectionRetryMessage(purpose:InspectionPhoto['purpose'],quality:number){
  if(quality>=75)return undefined;
  if(quality<45)return 'Foto insufficiente: riprova più vicino, con più luce e mettendo a fuoco il dettaglio.';
  if(purpose.startsWith('corner_'))return 'Angolo poco leggibile: avvicinati e mantieni il telefono fermo.';
  if(purpose.startsWith('edge_'))return 'Bordo poco leggibile: avvicinati e inclina leggermente la luce.';
  if(purpose==='surface_angle')return 'Serve più dettaglio: cambia leggermente l’angolazione per far emergere la superficie.';
  return 'Serve una foto più nitida: avvicinati leggermente e mantieni la carta ferma.';
}

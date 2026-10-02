import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {clamp,isConvexQuad,polygonArea,updateQuadStability,type Point,type QuadStability} from './scanner/geometry';
import {estimateImageQuality,evaluateQuality,type QualityResult} from './scanner/quality';
import {recognizeCardText} from './services/ocr';
import {recognize,getPokemonSets,getYugiohSets,getPokemonSetCards,getYugiohSetCards,getCardPrice,type CatalogCard} from './services/catalog';
import {gradeImage,type GradeResult} from './services/grading';
import {detectCardQuad,perspectiveWarp} from './scanner/vision';
import {rankVisualMatches} from './services/visualMatch';
import {enableDeviceLevel,getDeviceLevel,type DeviceLevel} from './scanner/deviceLevel';

type Game='pokemon'|'yugioh';
type SortMode='nameAsc'|'nameDesc'|'priceAsc'|'priceDesc'|'numberAsc'|'numberDesc';
type SavedCard=CatalogCard & {quantity:number;grade:GradeResult;addedAt:string;scanImage?:string;ownedVariant?:string;ownedLanguage?:string;conditionNotes?:string[]};
type SavedGradeScan={id:string;grade:GradeResult;image?:string;addedAt:string};
type Condition=GradeResult['grade'];
const conditionOptions:Condition[]=['Mint','NM','Excellent','Good','Played','Poor','Damaged'];
const languageOptions=['Italiano','Inglese','Giapponese','Francese','Tedesco','Spagnolo','Portoghese','Cinese','Coreano','Altro'];
const defectOptions=['Graffi','Piegature','Ammaccature','Whitening / bordi','Angoli usurati','Superficie usurata'];
const conditionFactor:Record<Condition,number>={Mint:1,NM:1,Excellent:.65,Good:.41,Played:.22,Poor:.17,Damaged:.1};
const conditionScore:Record<Condition,number>={Mint:99,NM:95,Excellent:88,Good:76,Played:58,Poor:35,Damaged:15};
function manualGrade(condition:Condition,defects:string[]=[]):GradeResult{const penalty=defects.length*3;const score=Math.max(0,conditionScore[condition]-penalty);return {grade:condition,score,confidence:1,defects,findings:defects.map(label=>({type:'surface',severity:defects.length>=3?'high':'medium',confidence:1,label,description:'Difetto indicato manualmente dall’utente.'})),centering:score,subgrades:{centering:score,corners:score,edges:score,surface:score},assessmentSource:'manual'}}
function conditionPrice(card:CatalogCard,condition:Condition,variant?:string){const wanted=(variant||'').toLowerCase();const period=wanted.includes('reverse')?'reverse-current':wanted.includes('holo')?'holo-current':'current';const base=card.prices.find(p=>p.currency==='EUR'&&p.period===period)?.amount||getCardPrice(card,'EUR');return base?base*conditionFactor[condition]:0}
function priceOf(card:CatalogCard){return getCardPrice(card,'EUR')||getCardPrice(card,'USD')||0}
function savedPrice(card:SavedCard){return conditionPrice(card,card.grade.grade,card.ownedVariant)}
function sortCards<T extends CatalogCard>(items:T[],mode:SortMode){return [...items].sort((a,b)=>{if(mode.startsWith('name'))return a.name.localeCompare(b.name,'it',{numeric:true})*(mode==='nameAsc'?1:-1);if(mode.startsWith('number'))return String(a.number||'').localeCompare(String(b.number||''),'it',{numeric:true})*(mode==='numberAsc'?1:-1);return (priceOf(a)-priceOf(b))*(mode==='priceAsc'?1:-1)})}
function sortSets<T extends Record<string,any>>(items:T[],mode:SortMode){return [...items].sort((a,b)=>{const an=String(a.name||a.set_name||''),bn=String(b.name||b.set_name||'');if(mode.startsWith('name'))return an.localeCompare(bn,'it',{numeric:true})*(mode==='nameAsc'?1:-1);const ac=Number(a.cardCount?.official||a.num_of_cards||0),bc=Number(b.cardCount?.official||b.num_of_cards||0);return (ac-bc)*(mode==='numberAsc'||mode==='priceAsc'?1:-1)})}
const nav=[['home','⌂','Home'],['scan','◉','Scan'],['collection','◇','Collection'],['sets','▦','Sets'],['market','↗','Market']] as const;
const initialCorners:Point[]=[{x:18,y:10},{x:82,y:10},{x:82,y:90},{x:18,y:90}];
const savedKey='poyukegimonho.collection.v2';
const gradingKey='poyukegimonho.grading.v1';

function loadCollection():SavedCard[]{try{return JSON.parse(localStorage.getItem(savedKey)||'[]') as SavedCard[]}catch{return []}}
function imageUrl(value?:string,quality:'low'|'high'='low'){if(!value)return '';let url=value.startsWith('//')?'https:'+value:value;if(url.includes('assets.tcgdex.net/')){if(/\/logo$|\/symbol$/i.test(url))return url+'.webp';if(/\/(high|low)\.(png|webp|jpg)$/i.test(url))return url;return url+'/'+quality+'.webp'}return url}
function saveCollection(items:SavedCard[]){localStorage.setItem(savedKey,JSON.stringify(items))}
function loadGradingScans():SavedGradeScan[]{try{return JSON.parse(localStorage.getItem(gradingKey)||'[]') as SavedGradeScan[]}catch{return []}}
function saveGradingScans(items:SavedGradeScan[]){localStorage.setItem(gradingKey,JSON.stringify(items))}
function extractNumberHint(text:string){return text.match(/\b\d{1,3}\s*\/\s*\d{1,3}\b/)?.[0]?.replace(/\s/g,'')||text.match(/\b[A-Z]{2,6}\d?-[A-Z0-9]{1,5}\b/i)?.[0]||undefined}
function blobToDataUrl(blob:Blob){return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}

export default function App(){
 const [page,setPage]=useState<(typeof nav)[number][0]>('home');
 const [game,setGame]=useState<Game>('pokemon');
 const [cameraOn,setCameraOn]=useState(false),[auto,setAuto]=useState(true),[cameraConsentOpen,setCameraConsentOpen]=useState(false),[deviceLevel,setDeviceLevel]=useState<DeviceLevel>(getDeviceLevel());
 const [preview,setPreview]=useState<string|null>(null),[previewData,setPreviewData]=useState<string|null>(null),[corners,setCorners]=useState<Point[]>(initialCorners);
 const [stability,setStability]=useState<QuadStability>({good:0,bad:0,state:'searching'});
 const [quality,setQuality]=useState<QualityResult|null>(null),[collection,setCollection]=useState<SavedCard[]>(loadCollection),[gradingScans,setGradingScans]=useState<SavedGradeScan[]>(loadGradingScans);
 const [sets,setSets]=useState<any[]>([]),[setSearch,setSetSearch]=useState(''),[setSort,setSetSort]=useState<SortMode>('nameAsc'),[selectedSet,setSelectedSet]=useState<any|null>(null),[setCards,setSetCards]=useState<CatalogCard[]>([]),[setCardSearch,setSetCardSearch]=useState(''),[setCardSort,setSetCardSort]=useState<SortMode>('numberAsc'),[loadingSet,setLoadingSet]=useState(false);
 const [collectionSearch,setCollectionSearch]=useState(''),[collectionSort,setCollectionSort]=useState<SortMode>('nameAsc');
 const [recognitionSearch,setRecognitionSearch]=useState(''),[recognitionSort,setRecognitionSort]=useState<SortMode>('nameAsc');
 const [marketSearch,setMarketSearch]=useState(''),[marketSort,setMarketSort]=useState<SortMode>('priceDesc');
 const [recognition,setRecognition]=useState<CatalogCard[]>([]),[ocrText,setOcrText]=useState('');
 const [ocrConfidence,setOcrConfidence]=useState(0),[processing,setProcessing]=useState(false);
 const [grade,setGrade]=useState<GradeResult|null>(null),[selected,setSelected]=useState<CatalogCard|null>(null);
 const [catalogSelected,setCatalogSelected]=useState<CatalogCard|null>(null),[manualCondition,setManualCondition]=useState<Condition>('NM'),[manualQuantity,setManualQuantity]=useState(1),[manualVariant,setManualVariant]=useState('Normal'),[manualLanguage,setManualLanguage]=useState('Italiano'),[manualDefects,setManualDefects]=useState<string[]>([]);
 const [editingCollectionId,setEditingCollectionId]=useState<string|null>(null),[editCondition,setEditCondition]=useState<Condition>('NM'),[editQuantity,setEditQuantity]=useState(1),[editVariant,setEditVariant]=useState('Normal'),[editLanguage,setEditLanguage]=useState('Italiano'),[editDefects,setEditDefects]=useState<string[]>([]);
 const [manualQuery,setManualQuery]=useState(''),[error,setError]=useState('');
 const videoRef=useRef<HTMLVideoElement>(null),stageRef=useRef<HTMLDivElement>(null),streamRef=useRef<MediaStream|null>(null),dragging=useRef<number|null>(null),galleryInputRef=useRef<HTMLInputElement>(null);
 const autoTimer=useRef<number|null>(null),autoStable=useRef(0),capturedRef=useRef(false),detectedCornersRef=useRef<Point[]|null>(null),detectionMisses=useRef(0);

 useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(autoTimer.current)clearInterval(autoTimer.current)},[]);

 useEffect(()=>{
   const video=videoRef.current,stream=streamRef.current;
   if(!cameraOn||!video||!stream)return;
   video.srcObject=stream;
   video.muted=true;
   video.playsInline=true;
   const play=async()=>{try{await video.play()}catch{}};
   if(video.readyState>=2)void play();else video.onloadedmetadata=()=>void play();
   return()=>{video.onloadedmetadata=null};
 },[cameraOn]);
 useEffect(()=>{saveCollection(collection)},[collection]);
useEffect(()=>{saveGradingScans(gradingScans)},[gradingScans]);
 useEffect(()=>{if(!catalogSelected)return;requestAnimationFrame(()=>document.querySelector('.catalog-detail')?.scrollIntoView({behavior:'smooth',block:'center'}));},[catalogSelected]);
 useEffect(()=>{setStability(s=>updateQuadStability(s,isConvexQuad(corners)&&polygonArea(corners)>1100))},[corners]);

 async function startCamera(){
  setError('');
  void enableDeviceLevel().then(setDeviceLevel);
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('media');
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:60}},audio:false});
   const track=stream.getVideoTracks()[0];
   const caps=track.getCapabilities?.();
   if(caps?.width&&caps?.height){
    const maxWidth=typeof caps.width.max==='number'?caps.width.max:3840,maxHeight=typeof caps.height.max==='number'?caps.height.max:2160;
    try{await track.applyConstraints({width:{ideal:Math.min(3840,maxWidth),max:maxWidth},height:{ideal:Math.min(2160,maxHeight),max:maxHeight},frameRate:{ideal:30,max:typeof caps.frameRate?.max==='number'?caps.frameRate.max:60}})}catch{}
   }
   streamRef.current=stream;
   capturedRef.current=false;autoStable.current=0;detectionMisses.current=0;
   setCameraOn(true);
   setCameraConsentOpen(false);
  }catch{setCameraOn(false);setError('Fotocamera non disponibile: controlla i permessi oppure usa Galleria.')}
 }
 function stopCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOn(false)}
 function resetScan(){
  stopCamera();setPreview(old=>{if(old)URL.revokeObjectURL(old);return null});setPreviewData(null);setCorners(initialCorners);detectedCornersRef.current=null;setRecognition([]);setSelected(null);setGrade(null);setOcrText('');setOcrConfidence(0);setQuality(null);setError('');setStability({good:0,bad:0,state:'searching'});capturedRef.current=false;autoStable.current=0;detectionMisses.current=0;
 }
 function openScan(){resetScan();setPage('scan');setCameraConsentOpen(true)}

 function sourceCanvas(){
  const v=videoRef.current,stage=stageRef.current;
  if(!v||!stage||v.readyState<2||!v.videoWidth||!v.videoHeight)return null;
  const rect=stage.getBoundingClientRect(),cw=Math.max(320,Math.round(rect.width*2)),ch=Math.max(480,Math.round(rect.height*2));
  const c=document.createElement('canvas');c.width=cw;c.height=ch;
  const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
  const scale=Math.max(cw/v.videoWidth,ch/v.videoHeight),dw=v.videoWidth*scale,dh=v.videoHeight*scale;
  ctx.drawImage(v,(cw-dw)/2,(ch-dh)/2,dw,dh);
  return c;
 }

 async function processCanvas(canvas:HTMLCanvasElement,usedCorners:Point[]){
  if(processing)return;
  capturedRef.current=true;setProcessing(true);setError('');
  try{
   const image=canvas.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,canvas.width,canvas.height);
   const crop=perspectiveWarp(canvas,usedCorners);
   if(image){
    const m=estimateImageQuality(image,canvas.width,canvas.height);
    const xs=usedCorners.map(p=>p.x),ys=usedCorners.map(p=>p.y);
    const aspect=(Math.max(...xs)-Math.min(...xs))/Math.max(1,Math.max(...ys)-Math.min(...ys));
    setQuality(evaluateQuality({areaRatio:polygonArea(usedCorners)/10000,aspectRatio:aspect,brightness:m.brightness,contrast:m.contrast,edgeConfidence:m.edgeConfidence}));
   }
   const cropData=crop.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,crop.width,crop.height);
   if(cropData)setGrade(gradeImage(cropData,polygonArea(usedCorners),usedCorners));
   const blob=await new Promise<Blob|null>(r=>crop.toBlob(r,'image/jpeg',.94));
   if(!blob)throw new Error('crop');
   const url=URL.createObjectURL(blob);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});setPreviewData(await blobToDataUrl(blob));
   const ocr=await recognizeCardText(blob);
   setOcrText(ocr.text);setOcrConfidence(ocr.confidence);
   const results=await recognize(game,ocr.text,extractNumberHint(ocr.text));
   const ranked=await rankVisualMatches(blob,results);
   setRecognition(ranked);setSelected(ranked[0]||null);
   if(!ranked.length&&ocr.text.trim())setError('Testo letto, ma nessuna corrispondenza certa nel catalogo. Puoi cercare il nome manualmente.');
  }catch{setError('Elaborazione non riuscita. La scansione è comunque disponibile per il salvataggio manuale.')}
  finally{stopCamera();setProcessing(false)}
 }

 function capture(){const c=sourceCanvas();if(!c||processing)return;const usable=corners.map(p=>({...p}));if(auto&&stability.state==='ready'&&detectedCornersRef.current?.length===4){setCorners(detectedCornersRef.current);void processCanvas(c,detectedCornersRef.current)}else{void processCanvas(c,usable)}}
 function importImage(file:File){
  setError('');capturedRef.current=true;setCameraConsentOpen(false);stopCamera();
  const url=URL.createObjectURL(file);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});
  const img=new Image();
  img.onload=()=>{
   const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d')?.drawImage(img,0,0);
   const frame=c.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,c.width,c.height);
   const detected=frame?detectCardQuad(frame):null;
   const used=detected?.confidence&&detected.confidence>.62?detected.points:initialCorners;
   setCorners(used);setStability({good:4,bad:0,state:'ready'});void processCanvas(c,used);
  };
  img.onerror=()=>setError('Immagine non leggibile');
  img.src=url;
 }

 function snapCorner(index:number,x:number,y:number){
  const c=sourceCanvas();if(!c)return {x,y};
  const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)return {x,y};
  const data=ctx.getImageData(0,0,c.width,c.height).data,px=x/100*c.width,py=y/100*c.height;
  const lum=(xx:number,yy:number)=>{xx=Math.max(1,Math.min(c.width-2,Math.round(xx)));yy=Math.max(1,Math.min(c.height-2,Math.round(yy)));const i=(yy*c.width+xx)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
  const edgeX=(xx:number,yy:number)=>Math.abs(lum(xx-2,yy)-lum(xx+2,yy)),edgeY=(xx:number,yy:number)=>Math.abs(lum(xx,yy-2)-lum(xx,yy+2));
  const radius=26,step=3;
  let best={x:px,y:py,score:0};
  for(let dy=-radius;dy<=radius;dy+=step)for(let dx=-radius;dx<=radius;dx+=step){
   const xx=px+dx,yy=py+dy;let score=edgeX(xx,yy)+edgeY(xx,yy);
   for(let k=-55;k<=55;k+=5){score+=index<2?edgeX(xx,yy+k)*.7:edgeX(xx,yy+k)*.7;score+=index===0||index===3?edgeY(xx+k,yy)*.7:edgeY(xx+k,yy)*.7}
   if(score>best.score)best={x:xx,y:yy,score};
  }
  const threshold=Math.max(95,(c.width+c.height)*.055);
  return best.score>threshold?{x:best.x/c.width*100,y:best.y/c.height*100}:{x,y};
 }

 function snapSide(side:'top'|'right'|'bottom'|'left',fallback:Point[]){
 const c=sourceCanvas();if(!c)return fallback;
 const frame=c.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,c.width,c.height);if(!frame)return fallback;
 const detected=detectCardQuad(frame);if(!detected||detected.confidence<.76)return fallback;
 const p=detected.points;
 const cx=p.reduce((s,q)=>s+q.x,0)/4,cy=p.reduce((s,q)=>s+q.y,0)/4;
 const fx=fallback.reduce((s,q)=>s+q.x,0)/4,fy=fallback.reduce((s,q)=>s+q.y,0)/4;
 if(Math.hypot(cx-fx,cy-fy)>14)return fallback;
 return fallback.map((point,i)=>side==='top'&&i<2?p[i]:side==='right'&&(i===1||i===2)?p[i]:side==='bottom'&&i>1?p[i]:side==='left'&&(i===0||i===3)?p[i]:point);
}
function moveSide(side:'top'|'right'|'bottom'|'left',e:ReactPointerEvent<HTMLButtonElement>){
 const r=e.currentTarget.parentElement?.getBoundingClientRect();if(!r)return;
 const value=side==='top'||side==='bottom'?(e.clientY-r.top)/r.height*100:(e.clientX-r.left)/r.width*100;
 setCorners(old=>{const next=old.map(p=>({...p}));if(side==='top'||side==='bottom'){const ids=side==='top'?[0,1]:[2,3],avg=ids.reduce((n,i)=>n+old[i].y,0)/2,dy=clamp(value,3,97)-avg;ids.forEach(i=>next[i].y=clamp(old[i].y+dy,2,98));}else{const ids=side==='right'?[1,2]:[0,3],avg=ids.reduce((n,i)=>n+old[i].x,0)/2,dx=clamp(value,3,97)-avg;ids.forEach(i=>next[i].x=clamp(old[i].x+dx,2,98));}return next});
}
function alignSide(side:'top'|'right'|'bottom'|'left'){void side;}
function saveGrading(){if(!grade)return;setGradingScans(old=>[{id:crypto.randomUUID(),grade,image:previewData||undefined,addedAt:new Date().toISOString()},...old]);setError('');}
function moveCorner(index:number,e:ReactPointerEvent<HTMLButtonElement>){
  const r=e.currentTarget.parentElement?.getBoundingClientRect();if(!r)return;
  const rawX=clamp((e.clientX-r.left)/r.width*100,2,98),rawY=clamp((e.clientY-r.top)/r.height*100,2,98);
  setCorners(old=>old.map((p,i)=>i===index?{x:rawX,y:rawY}:p));
 }

 useEffect(()=>{
  if(!cameraOn||!auto)return;
  autoTimer.current=window.setInterval(()=>{
   if(capturedRef.current)return;
   const c=sourceCanvas();if(!c)return;
   const frame=c.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,c.width,c.height);if(!frame)return;
   const detected=detectCardQuad(frame);
   const previous=detectedCornersRef.current;
   let usable=detected&&detected.confidence>.76?detected:null;
   if(usable){
    const pts=usable.points;
    const cx=pts.reduce((s,p)=>s+p.x,0)/4,cy=pts.reduce((s,p)=>s+p.y,0)/4;
    const width=Math.max(pts[1].x-pts[0].x,pts[2].x-pts[3].x);
    const height=Math.max(pts[3].y-pts[0].y,pts[2].y-pts[1].y);
    const area=polygonArea(pts)/10000;
    const centered=Math.hypot(cx-50,cy-50)<=16;
    const usableSize=width>=28&&width<=82&&height>=42&&height<=94&&area>=.10&&area<=.76;
    if(!centered||!usableSize)usable=null;
   }
   if(usable&&previous){
    const prevCx=previous.reduce((s,p)=>s+p.x,0)/4,prevCy=previous.reduce((s,p)=>s+p.y,0)/4;
    const nextCx=usable.points.reduce((s,p)=>s+p.x,0)/4,nextCy=usable.points.reduce((s,p)=>s+p.y,0)/4;
    const displacement=Math.hypot(nextCx-prevCx,nextCy-prevCy);
    const prevH=Math.max(previous[2].y-previous[0].y,previous[3].y-previous[1].y);
    const nextH=Math.max(usable.points[2].y-usable.points[0].y,usable.points[3].y-usable.points[1].y);
    const scaleChange=Math.max(nextH,1)/Math.max(prevH,1);
    if(displacement>11||scaleChange>1.35||scaleChange<.74)usable=null;
   }
   if(usable){
    detectionMisses.current=0;
    const smoothed=previous&&previous.length===4
      ?usable.points.map((p,i)=>({x:previous[i].x*.35+p.x*.65,y:previous[i].y*.35+p.y*.65}))
      :usable.points;
    detectedCornersRef.current=smoothed;
    setCorners(smoothed);setStability(s=>updateQuadStability(s,true));
    const level=getDeviceLevel();setDeviceLevel(level);
    const motionStable=previous?Math.max(...smoothed.map((p,i)=>Math.hypot(p.x-(previous[i]?.x??p.x),p.y-(previous[i]?.y??p.y))))<4:true;
    autoStable.current=level.available&&level.tilt>8?0:(motionStable?autoStable.current+1:0);
    if(auto&&usable.confidence>.82&&autoStable.current>=8&&(!level.available||level.tilt<=8)){autoStable.current=0;void processCanvas(c,smoothed)}
   }else{
    detectionMisses.current++;
    autoStable.current=0;
    if(detectionMisses.current>=3){detectedCornersRef.current=null;setStability(s=>updateQuadStability(s,false));}
   }
  },500);
  return()=>{if(autoTimer.current)clearInterval(autoTimer.current)}
 },[cameraOn,auto]);

 async function manualSearch(){
  if(!manualQuery.trim())return;
  setProcessing(true);setError('');
  try{const r=await recognize(game,manualQuery);setRecognition(r);setSelected(r[0]||null);setOcrText(manualQuery);setOcrConfidence(1);if(!r.length)setError('Nessuna carta trovata con questo nome.')}catch{setError('Catalogo non raggiungibile')}finally{setProcessing(false)}
 }

 function addSelected(){
  if(!grade)return;
  const card=selected||{id:'scan-'+Date.now(),game,name:'Carta da identificare',number:undefined,setId:undefined,setName:'Da verificare',rarity:undefined,year:undefined,image:undefined,prices:[],variants:[],externalId:'local-scan'} satisfies CatalogCard;
  setCollection(old=>[...old,{...card,quantity:1,grade,addedAt:new Date().toISOString(),scanImage:previewData||undefined}]);
  setPage('collection');setError('');
 }
 function addCatalogCard(card:CatalogCard,condition:Condition,quantity:number){const qty=Math.max(1,Math.min(999,Math.round(quantity)));setCollection(old=>{const existing=old.find(x=>x.id===card.id&&x.grade.grade===condition&&x.ownedVariant===manualVariant&&x.ownedLanguage===manualLanguage);if(existing)return old.map(x=>x===existing?{...x,quantity:x.quantity+qty}:x);return [{...card,quantity:qty,grade:manualGrade(condition,manualDefects),ownedVariant:manualVariant,ownedLanguage:manualLanguage,conditionNotes:manualDefects,addedAt:new Date().toISOString()},...old]});setCatalogSelected(null);setManualQuantity(1);setManualCondition('NM');setManualVariant('Normal');setManualLanguage('Italiano');setManualDefects([]);setPage('collection');setError('');}
 function startEditCollection(card:SavedCard){setEditingCollectionId(card.addedAt);setEditCondition(card.grade.grade);setEditQuantity(card.quantity);setEditVariant(card.ownedVariant||'Normal');setEditLanguage(card.ownedLanguage||'Italiano');setEditDefects(card.conditionNotes||[]);}
 function saveEditCollection(card:SavedCard){const quantity=Math.max(1,Math.min(999,Math.round(editQuantity)));setCollection(old=>old.map(x=>x.addedAt===card.addedAt?{...x,quantity,grade:manualGrade(editCondition,editDefects),ownedVariant:editVariant,ownedLanguage:editLanguage,conditionNotes:editDefects}:x));setEditingCollectionId(null);}

 async function loadSets(){
  try{setError('');setSelectedSet(null);setSetCards([]);setSets(game==='pokemon'?await getPokemonSets():await getYugiohSets())}catch{setError('Impossibile caricare le espansioni')}
 }
 async function openSet(set:any){
  setSelectedSet(set);setSetCards([]);setLoadingSet(true);setError('');
  try{setSetCards(game==='pokemon'?await getPokemonSetCards(String(set.id)):await getYugiohSetCards(String(set.set_name)))}catch{setError('Impossibile caricare le carte dell’espansione')}finally{setLoadingSet(false)}
 }
 useEffect(()=>{if(page==='sets'&&!selectedSet)void loadSets()},[page,game,selectedSet]);

 const filteredSets=sortSets(sets.filter(s=>String(s.name||s.set_name).toLowerCase().includes(setSearch.toLowerCase())),setSort);
 const filteredCollection=sortCards(collection.filter(c=>[c.name,c.number,c.setName].some(v=>String(v||'').toLowerCase().includes(collectionSearch.toLowerCase()))),collectionSort);
 const filteredRecognition=sortCards(recognition.filter(c=>[c.name,c.number,c.setName].some(v=>String(v||'').toLowerCase().includes(recognitionSearch.toLowerCase()))),recognitionSort);
 const filteredSetCards=sortCards(setCards.filter(c=>[c.name,c.number,c.rarity].some(v=>String(v||'').toLowerCase().includes(setCardSearch.toLowerCase()))),setCardSort);
 const marketCards=sortCards(collection.filter(c=>c.prices.length&&[c.name,c.number,c.setName].some(v=>String(v||'').toLowerCase().includes(marketSearch.toLowerCase()))),marketSort);
 const totalValue=collection.reduce((n,c)=>n+savedPrice(c)*c.quantity,0);
 const stableLabel=stability.state==='ready'?'Carta centrata — stabile':stability.state==='stabilizing'?'Stabilizzazione…':'Inquadra la carta';

 return <div className="app"><header><div className="brand"><b>P</b><span>POYUKEGIMONHO</span></div><span className="status">● {cameraOn?'camera active':navigator.onLine?'online':'offline'}</span></header><main>
 {page==='home'&&<section className="hero"><p className="eyebrow">COLLECTOR INTELLIGENCE</p><h1>Scan. Understand. Collect.</h1><p>Scanner reale con auto-capture, OCR locale, riconoscimento catalogo, condizione, collezione, espansioni e prezzi.</p><div className="actions"><button className="primary" onClick={openScan}>Apri scanner</button><button onClick={()=>setPage('collection')}>Collezione ({collection.length})</button></div><div className="game"><span>Gioco</span><button className={game==='pokemon'?'selected':''} onClick={()=>setGame('pokemon')}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>setGame('yugioh')}>Yu-Gi-Oh!</button></div><div className="home-metrics"><div><b>{collection.reduce((n,c)=>n+c.quantity,0)}</b><span>carte</span></div><div><b>{collection.length}</b><span>record</span></div><div><b>{totalValue?totalValue.toFixed(2)+' €':'—'}</b><span>valore noto EUR</span></div></div></section>}

 {page==='scan'&&<section><div className="scan-head"><div><p className="eyebrow">SCAN • RECOGNITION • GRADING</p><h2>Inquadra una carta</h2></div><button onClick={()=>{stopCamera();setPage('home')}}>Chiudi</button></div><div className="scanner" ref={stageRef}>
 {cameraOn&&<video ref={videoRef} className="video live" playsInline muted/>}{cameraConsentOpen&&!cameraOn&&!preview&&<div className="camera-consent-backdrop" role="dialog" aria-modal="true"><div className="camera-consent"><div className="consent-icon">◉</div><p className="eyebrow">FOTOCAMERA</p><h3>Consenti l'accesso alla fotocamera</h3><p>La fotocamera resta aperta finché non acquisisci o chiudi lo scanner. L'acquisizione automatica è separata da questo permesso.</p><div className="consent-actions"><button className="btn" onClick={()=>{setCameraConsentOpen(false);galleryInputRef.current?.click()}}>Scegli dalla galleria</button><button className="primary" onClick={()=>void startCamera()}>Consenti e apri fotocamera</button></div></div></div>}{!cameraOn&&!preview&&<div className="camera-off"><strong>Scanner pronto</strong><span>Attiva la camera o importa una foto.</span><button className="primary" onClick={()=>void startCamera()}>Attiva camera</button></div>}{preview&&<img className="photo-preview" src={preview} alt="Carta acquisita"/>}
 <svg className="quad-overlay" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={corners.map(p=>p.x+','+p.y).join(' ')}/></svg>
 {corners.map((p,i)=><button key={i} className="corner" style={{left:p.x+'%',top:p.y+'%'}} onPointerDown={e=>{dragging.current=i;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(dragging.current===i)moveCorner(i,e)}} onPointerUp={()=>{dragging.current=null}} onPointerCancel={()=>{dragging.current=null}} aria-label={'Sposta angolo '+(i+1)}/>)}
 
 <div className="scan-top"><span className={'pill '+(stability.state==='ready'?'good':'')}>● {stableLabel}</span><span className={'pill '+(deviceLevel.available&&deviceLevel.tilt<=6?'good':'')}>◉ {deviceLevel.available?(deviceLevel.tilt<=6?'Bolla OK':`Inclina ${deviceLevel.tilt.toFixed(0)}°`):'Bolla non disponibile'}</span><span className="pill">{quality?.ok?'Qualità OK':'Qualità in analisi'} · Auto {auto?'ON':'OFF'}</span></div><div className="level-bubble"><span className="level-dot" style={{transform:`translate(${Math.max(-34,Math.min(34,(deviceLevel.gamma||0)*1.2))}px,${Math.max(-34,Math.min(34,(deviceLevel.beta||0)*1.2))}px)`}}/></div><div className="scan-bottom"><button className="shutter" onClick={capture} aria-label="Scatta" disabled={processing}/></div></div>
 <div className="scanner-footer"><button className="btn" onClick={()=>galleryInputRef.current?.click()}>Galleria</button><input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];e.currentTarget.value='';if(f)importImage(f)}} style={{display:'none'}}/><button className="btn" onClick={()=>setAuto(v=>!v)}>Auto Capture: {auto?'ON':'OFF'}</button><button className="btn" onClick={resetScan}>Nuova scansione</button></div>
 <div className="review"><div className="review-head"><div><p className="eyebrow">RISULTATO</p><h3>{processing?'Analisi in corso…':selected?.name||'Nessuna carta riconosciuta'}</h3></div>{grade&&<span className="grade">{grade.grade} · {grade.score}/100</span>}</div>
 {ocrText&&<p className="ocr">OCR: <b>{ocrText.slice(0,220)}</b> · confidenza {(ocrConfidence*100).toFixed(0)}%</p>}{grade&&<><div className="chips"><span>Condizione: {grade.grade}</span><span>Score: {grade.score}/100</span><span>{grade.assessmentSource==='manual'?'Inserimento manuale':'Confidenza: '+(grade.confidence*100).toFixed(0)+'%'}</span><span>Centratura: {grade.centering}/100</span></div><div className="subgrades"><b>Cent. {grade.subgrades.centering}</b><b>Angoli {grade.subgrades.corners}</b><b>Bordi {grade.subgrades.edges}</b><b>Superficie {grade.subgrades.surface}</b></div>{grade.findings.length>0&&<div className="grading-report"><strong>Controllo difetti</strong>{grade.findings.map((f,i)=><div className="grading-finding" key={i}><span className={'finding-dot '+f.severity}/><div><b>{f.label}</b><small>{f.description} · {(f.confidence*100).toFixed(0)}%</small></div></div>)}</div>}</>}
 <div className="manual-search"><input value={manualQuery} onChange={e=>setManualQuery(e.target.value)} placeholder="Nome, numero, set…"/><button onClick={()=>void manualSearch()} disabled={processing}>Cerca catalogo</button></div>
 {recognition.length>0&&<><div className="toolbar"><input className="search" value={recognitionSearch} onChange={e=>setRecognitionSearch(e.target.value)} placeholder="Filtra risultati per caratteri/numeri…"/><select value={recognitionSort} onChange={e=>setRecognitionSort(e.target.value as SortMode)}><option value="nameAsc">Nome ↑</option><option value="nameDesc">Nome ↓</option><option value="priceAsc">Prezzo ↑</option><option value="priceDesc">Prezzo ↓</option><option value="numberAsc">Numero ↑</option><option value="numberDesc">Numero ↓</option></select></div><div className="results">{filteredRecognition.slice(0,16).map(card=><button key={card.id} className={'result '+(selected?.id===card.id?'selected-result':'')} onClick={()=>setSelected(card)}>{card.image&&<img src={imageUrl(card.image)} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}<span><b>{card.name}</b><small>{card.setName||'Set non disponibile'} {card.number?'• #'+card.number:''}</small><small>{card.rarity||'Rarità n/d'}</small></span></button>)}</div></>}
 <div className="card-detail"><div><b>{selected?.name||'Scansione non identificata'}</b><span>{selected?.setName||'Puoi salvarla e identificarla dopo'} {selected?.number?'• '+selected.number:''}</span><span>{selected?.rarity||'Condizione già analizzata'}</span></div><div className="prices">{selected?.prices.length?selected.prices.map(p=><span key={p.source}>{p.source}: {p.amount.toFixed(2)} {p.currency}</span>):<span>Prezzo non disponibile</span>}</div><div className="save-actions"><button onClick={saveGrading} disabled={!grade||processing}>Salva grading</button><button className="primary" onClick={addSelected} disabled={!grade||processing}>Salva carta</button></div></div></div>{error&&<div className="error">{error}</div>}</section>}

 {page==='collection'&&<section><div className="section-head"><div><p className="eyebrow">COLLECTION</p><h2>Le mie carte</h2></div><button className="primary" onClick={openScan}>+ Scansiona</button></div><div className="toolbar"><input className="search" value={collectionSearch} onChange={e=>setCollectionSearch(e.target.value)} placeholder="Cerca per nome, numero, espansione…"/><select value={collectionSort} onChange={e=>setCollectionSort(e.target.value as SortMode)}><option value="nameAsc">Nome ↑</option><option value="nameDesc">Nome ↓</option><option value="priceAsc">Prezzo ↑</option><option value="priceDesc">Prezzo ↓</option><option value="numberAsc">Numero ↑</option><option value="numberDesc">Numero ↓</option></select></div><div className="summary"><b>{collection.reduce((n,c)=>n+c.quantity,0)}</b> carte · <b>{collection.length}</b> record · valore noto EUR <b>{totalValue?totalValue.toFixed(2)+' €':'—'}</b></div>{collection.length===0?<div className="empty"><strong>Collezione vuota</strong><span>Scansiona una carta e salvala qui. Anche le scansioni non riconosciute possono essere salvate.</span></div>:<div className="collection-grid">{filteredCollection.map((c)=><article className="collection-card" key={c.id+'-'+c.addedAt}>{(c.scanImage||c.image)?<img src={imageUrl(c.scanImage||c.image)} alt="" loading="lazy" onError={e=>{const img=e.currentTarget;if(c.scanImage&&img.src!==imageUrl(c.scanImage)){img.src=imageUrl(c.scanImage)}else{img.style.display='none';img.parentElement?.classList.add('image-missing')}}}/>:<div className="image-missing"><span>IMG</span></div>}<div><h3>{c.name}</h3><p>{c.setName||'Set n/d'} {c.number?'• #'+c.number:''}</p><div className="card-meta-line"><span>{c.ownedLanguage||'Lingua n/d'}</span><span>{c.ownedVariant||'Normal'}</span></div><div className="chips"><span>{c.grade.grade}</span><span>Q.tà {c.quantity}</span>{savedPrice(c)>0&&<span>{savedPrice(c).toFixed(2)} EUR/copia</span>}</div>{editingCollectionId===c.addedAt?<div className="collection-editor"><label>Condizione<select value={editCondition} onChange={e=>setEditCondition(e.target.value as Condition)}>{conditionOptions.map(g=><option key={g} value={g}>{g}</option>)}</select></label><label>Quantità<input type="number" min="1" max="999" value={editQuantity} onChange={e=>setEditQuantity(Math.max(1,Math.min(999,Number(e.target.value)||1)))}/></label><label>Lingua<select value={editLanguage} onChange={e=>setEditLanguage(e.target.value)}>{languageOptions.map(l=><option key={l}>{l}</option>)}</select></label><label>Variante<select value={editVariant} onChange={e=>setEditVariant(e.target.value)}><option>Normal</option>{c.variants.map(v=><option key={v}>{v}</option>)}<option>Holo</option><option>Reverse Holo</option></select></label><div className="defect-picker"><span>Difetti</span><div>{defectOptions.map(d=><label key={d}><input type="checkbox" checked={editDefects.includes(d)} onChange={e=>setEditDefects(v=>e.target.checked?[...v,d]:v.filter(x=>x!==d))}/>{d}</label>)}</div></div><div className="editor-actions"><button className="primary" onClick={()=>saveEditCollection(c)}>Salva</button><button onClick={()=>setEditingCollectionId(null)}>Annulla</button></div></div>:<div className="editor-actions"><button onClick={()=>startEditCollection(c)}>Modifica condizione/quantità</button><button onClick={()=>setCollection(old=>old.filter(x=>x.addedAt!==c.addedAt))}>Rimuovi</button></div>}</div></article>)}</div>}<div className="grading-history"><div className="section-head"><div><p className="eyebrow">GRADING HISTORY</p><h3>Scansioni grading salvate</h3></div></div>{gradingScans.length===0?<div className="empty"><span>Nessuna scansione grading salvata.</span></div>:<div className="grading-history-grid">{gradingScans.map(s=><article className="grading-history-card" key={s.id}>{s.image?<img src={imageUrl(s.image)} alt="Scansione grading" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>:<div className="image-missing"><span>SCAN</span></div>}<div><b>{s.grade.grade} · {s.grade.score}/100</b><span>Confidence {(s.grade.confidence*100).toFixed(0)}%</span><small>{new Date(s.addedAt).toLocaleString('it-IT')}</small></div></article>)}</div>}</div></section>}

 {page==='sets'&&<section><div className="section-head"><div><p className="eyebrow">CATALOG</p><h2>{selectedSet?selectedSet.name||selectedSet.set_name:'Espansioni'}</h2></div>{selectedSet?<button onClick={()=>{setSelectedSet(null);setSetCards([]);setSetCardSearch('')}}>← Espansioni</button>:<button onClick={()=>void loadSets()}>Aggiorna</button>}</div>{!selectedSet?<> <div className="toolbar"><input className="search" value={setSearch} onChange={e=>setSetSearch(e.target.value)} placeholder="Cerca espansione per nome/codice…"/><select value={setSort} onChange={e=>setSetSort(e.target.value as SortMode)}><option value="nameAsc">Nome ↑</option><option value="nameDesc">Nome ↓</option><option value="numberAsc">Carte ↑</option><option value="numberDesc">Carte ↓</option></select><button className={game==='pokemon'?'selected':''} onClick={()=>{setGame('pokemon');setSets([]);setSelectedSet(null)}}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>{setGame('yugioh');setSets([]);setSelectedSet(null)}}>Yu-Gi-Oh!</button></div>{filteredSets.length===0?<div className="empty"><strong>Caricamento catalogo…</strong><span>{error||'Attendi i dati del provider.'}</span></div>:<div className="set-grid">{filteredSets.map((s,i)=><button className="set-card" key={s.id||s.set_code||i} onClick={()=>void openSet(s)}>{(s.logo||s.image)&&<img src={imageUrl(s.logo||s.image)} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}<div><b>{s.name||s.set_name}</b><span>{s.cardCount?.official||s.num_of_cards||'?'} carte</span><small>{s.releaseDate||s.tcg_date||''}</small><small>{(()=>{const total=Number(s.cardCount?.official||s.num_of_cards||0);const owned=collection.filter(c=>c.setId===String(s.id||s.set_code)).reduce((n,c)=>n+c.quantity,0);return owned?owned+' possedute · '+Math.min(100,total?Math.round(owned/total*100):0)+'% completato':'Nessuna posseduta'})()}</small></div></button>)}</div>}</> : <> {loadingSet?<div className="empty"><strong>Caricamento carte…</strong><span>Sto caricando catalogo, immagini e prezzi dell’espansione.</span></div>:setCards.length===0?<div className="empty"><strong>Nessuna carta disponibile</strong><span>{error||'Il provider non ha restituito le carte.'}</span></div>:<><div className="toolbar"><input className="search" value={setCardSearch} onChange={e=>setSetCardSearch(e.target.value)} placeholder="Cerca carta per nome, numero o rarità…"/><select value={setCardSort} onChange={e=>setSetCardSort(e.target.value as SortMode)}><option value="nameAsc">Nome ↑</option><option value="nameDesc">Nome ↓</option><option value="priceAsc">Prezzo ↑</option><option value="priceDesc">Prezzo ↓</option><option value="numberAsc">Numero ↑</option><option value="numberDesc">Numero ↓</option></select></div><div className="card-grid">{filteredSetCards.map(card=><button className="catalog-card" key={card.id} onClick={()=>{setCatalogSelected(card);setManualCondition('NM');setManualQuantity(1);setManualVariant('Normal');setManualLanguage('Italiano');setManualDefects([])}} onPointerUp={()=>{setCatalogSelected(card);setManualCondition('NM');setManualQuantity(1);setManualVariant('Normal');setManualLanguage('Italiano');setManualDefects([])}}>{card.image&&<img src={imageUrl(card.image)} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}<b>{card.name}</b><span>#{card.number||'—'} · {card.rarity||'Rarità n/d'}</span><small>{priceOf(card)?priceOf(card).toFixed(2)+' '+(getCardPrice(card,'EUR')?'EUR':'USD'):'Prezzo n/d'}</small></button>)}</div>{catalogSelected&&<div className="catalog-detail"><div className="catalog-detail-media">{catalogSelected.image&&<img src={imageUrl(catalogSelected.image,'high')} alt={catalogSelected.name} loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}</div><div className="catalog-detail-info"><div className="section-head"><div><p className="eyebrow">INSERIMENTO MANUALE</p><h3>{catalogSelected.name}</h3><p>{catalogSelected.setName||'Set n/d'} {catalogSelected.number?'• #'+catalogSelected.number:''} {catalogSelected.rarity?'• '+catalogSelected.rarity:''}</p></div><button onClick={()=>setCatalogSelected(null)}>Chiudi</button></div><div className="manual-collection-grid"><label>Condizione<select value={manualCondition} onChange={e=>setManualCondition(e.target.value as Condition)}>{conditionOptions.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Quantità<input type="number" min="1" max="999" value={manualQuantity} onChange={e=>setManualQuantity(Math.max(1,Math.min(999,Number(e.target.value)||1)))}/></label><label>Lingua<select value={manualLanguage} onChange={e=>setManualLanguage(e.target.value)}>{languageOptions.map(l=><option key={l}>{l}</option>)}</select></label><label>Variante<select value={manualVariant} onChange={e=>setManualVariant(e.target.value)}><option>Normal</option>{catalogSelected.variants.map(v=><option key={v}>{v}</option>)}<option>Holo</option><option>Reverse Holo</option></select></label><div className="manual-value"><span>Stima valore per copia</span><b>{conditionPrice(catalogSelected,manualCondition,manualVariant)?conditionPrice(catalogSelected,manualCondition,manualVariant).toFixed(2)+' EUR':'Prezzo EUR non disponibile'}</b><small>Stima basata su variante, condizione e prezzo disponibile; non è una quotazione garantita.</small></div></div><div className="defect-picker"><span>Difetti osservati (opzionale)</span><div>{defectOptions.map(d=><label key={d}><input type="checkbox" checked={manualDefects.includes(d)} onChange={e=>setManualDefects(v=>e.target.checked?[...v,d]:v.filter(x=>x!==d))}/>{d}</label>)}</div></div><button className="primary" onClick={()=>addCatalogCard(catalogSelected,manualCondition,manualQuantity)}>Aggiungi alla collezione</button></div></div>}</>}</>}</section>}

 {page==='market'&&<section><p className="eyebrow">MARKET</p><h2>Prezzi & storico</h2><div className="market-grid"><div className="module"><b>Cardmarket</b><span>EUR corrente + medie 1/7/30 giorni per Pokémon quando disponibili.</span></div><div className="module"><b>TCGplayer</b><span>USD market price e varianti quando disponibili.</span></div><div className="module"><b>CardTrader</b><span>Predisposto come provider server-side: le API richiedono autenticazione e non mettiamo token nel browser.</span></div></div><div className="toolbar"><input className="search" value={marketSearch} onChange={e=>setMarketSearch(e.target.value)} placeholder="Cerca carta per nome, numero o espansione…"/><select value={marketSort} onChange={e=>setMarketSort(e.target.value as SortMode)}><option value="nameAsc">Nome ↑</option><option value="nameDesc">Nome ↓</option><option value="priceAsc">Prezzo ↑</option><option value="priceDesc">Prezzo ↓</option><option value="numberAsc">Numero ↑</option><option value="numberDesc">Numero ↓</option></select></div>{marketCards.length===0?<div className="empty">Nessun prezzo disponibile nella collezione filtrata.</div>:<div className="collection-grid">{marketCards.map(c=><article className="collection-card" key={c.addedAt}><div>{c.image&&<img src={imageUrl(c.image)} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}</div><div><h3>{c.name}</h3><p>{c.setName||'Set n/d'} {c.number?'• #'+c.number:''}</p><div className="prices">{c.prices.map(p=><span key={p.source+p.period}>{p.source}: {p.amount.toFixed(2)} {p.currency}</span>)}</div>{c.priceHistory&&c.priceHistory.length>0&&<div className="chips">{c.priceHistory.map(p=><span key={p.source+p.period}>{p.source} {p.period}: {p.amount.toFixed(2)} {p.currency}</span>)}</div>}</div></article>)}</div>}</section>}
 </main><nav>{nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{if(id==='scan')openScan();else{stopCamera();setPage(id)}}}><b>{icon}</b>{label}</button>)}</nav></div>
}

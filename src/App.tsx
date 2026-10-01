import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {clamp,isConvexQuad,polygonArea,updateQuadStability,type Point,type QuadStability} from './scanner/geometry';
import {estimateImageQuality,evaluateQuality,type QualityResult} from './scanner/quality';
import {recognizeCardText} from './services/ocr';
import {recognize,getPokemonSets,getYugiohSets,getPokemonSetCards,getYugiohSetCards,type CatalogCard} from './services/catalog';
import {gradeImage,type GradeResult} from './services/grading';
import {detectCardQuad,perspectiveWarp} from './scanner/vision';
import {rankVisualMatches} from './services/visualMatch';

type Game='pokemon'|'yugioh';
type SavedCard=CatalogCard & {quantity:number;grade:GradeResult;addedAt:string;scanImage?:string};
const nav=[['home','⌂','Home'],['scan','◉','Scan'],['collection','◇','Collection'],['sets','▦','Sets'],['market','↗','Market']] as const;
const initialCorners:Point[]=[{x:18,y:10},{x:82,y:10},{x:82,y:90},{x:18,y:90}];
const savedKey='poyukegimonho.collection.v2';

function loadCollection():SavedCard[]{try{return JSON.parse(localStorage.getItem(savedKey)||'[]') as SavedCard[]}catch{return []}}
function saveCollection(items:SavedCard[]){localStorage.setItem(savedKey,JSON.stringify(items))}
function extractNumberHint(text:string){return text.match(/\b\d{1,3}\s*\/\s*\d{1,3}\b/)?.[0]?.replace(/\s/g,'')||text.match(/\b[A-Z]{2,6}\d?-[A-Z0-9]{1,5}\b/i)?.[0]||undefined}
function blobToDataUrl(blob:Blob){return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}

export default function App(){
 const [page,setPage]=useState<(typeof nav)[number][0]>('home');
 const [game,setGame]=useState<Game>('pokemon');
 const [cameraOn,setCameraOn]=useState(false),[auto,setAuto]=useState(true);
 const [preview,setPreview]=useState<string|null>(null),[previewData,setPreviewData]=useState<string|null>(null),[corners,setCorners]=useState<Point[]>(initialCorners);
 const [stability,setStability]=useState<QuadStability>({good:0,bad:0,state:'searching'});
 const [quality,setQuality]=useState<QualityResult|null>(null),[collection,setCollection]=useState<SavedCard[]>(loadCollection);
 const [sets,setSets]=useState<any[]>([]),[setSearch,setSetSearch]=useState(''),[selectedSet,setSelectedSet]=useState<any|null>(null),[setCards,setSetCards]=useState<CatalogCard[]>([]),[loadingSet,setLoadingSet]=useState(false);
 const [recognition,setRecognition]=useState<CatalogCard[]>([]),[ocrText,setOcrText]=useState('');
 const [ocrConfidence,setOcrConfidence]=useState(0),[processing,setProcessing]=useState(false);
 const [grade,setGrade]=useState<GradeResult|null>(null),[selected,setSelected]=useState<CatalogCard|null>(null);
 const [manualQuery,setManualQuery]=useState(''),[error,setError]=useState('');
 const videoRef=useRef<HTMLVideoElement>(null),stageRef=useRef<HTMLDivElement>(null),streamRef=useRef<MediaStream|null>(null),dragging=useRef<number|null>(null);
 const autoTimer=useRef<number|null>(null),autoStable=useRef(0),capturedRef=useRef(false);

 useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(preview)URL.revokeObjectURL(preview);if(autoTimer.current)clearInterval(autoTimer.current)},[preview]);
 useEffect(()=>{saveCollection(collection)},[collection]);
 useEffect(()=>{setStability(s=>updateQuadStability(s,isConvexQuad(corners)&&polygonArea(corners)>1100))},[corners]);

 async function startCamera(){
  setError('');
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('media');
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:3840,max:3840},height:{ideal:2160,max:2160},frameRate:{ideal:30,max:60}},audio:false});
   const track=stream.getVideoTracks()[0];
   const caps=track.getCapabilities?.();
   if(caps?.width&&caps?.height){
    const maxWidth=typeof caps.width.max==='number'?caps.width.max:3840,maxHeight=typeof caps.height.max==='number'?caps.height.max:2160;
    try{await track.applyConstraints({width:{ideal:Math.min(3840,maxWidth),max:maxWidth},height:{ideal:Math.min(2160,maxHeight),max:maxHeight},frameRate:{ideal:30,max:typeof caps.frameRate?.max==='number'?caps.frameRate.max:60}})}catch{}
   }
   streamRef.current=stream;
   if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play()}
   capturedRef.current=false;autoStable.current=0;setCameraOn(true);
  }catch{setCameraOn(false);setError('Fotocamera non disponibile: controlla i permessi oppure usa Galleria.')}
 }
 function stopCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOn(false)}
 function resetScan(){
  stopCamera();setPreview(old=>{if(old)URL.revokeObjectURL(old);return null});setPreviewData(null);setCorners(initialCorners);setRecognition([]);setSelected(null);setGrade(null);setOcrText('');setOcrConfidence(0);setQuality(null);setError('');setStability({good:0,bad:0,state:'searching'});capturedRef.current=false;autoStable.current=0;
 }
 function openScan(){resetScan();setPage('scan');void startCamera()}

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
   if(image){
    const m=estimateImageQuality(image,canvas.width,canvas.height);
    const xs=usedCorners.map(p=>p.x),ys=usedCorners.map(p=>p.y);
    const aspect=(Math.max(...xs)-Math.min(...xs))/Math.max(1,Math.max(...ys)-Math.min(...ys));
    setQuality(evaluateQuality({areaRatio:polygonArea(usedCorners)/10000,aspectRatio:aspect,brightness:m.brightness,contrast:m.contrast,edgeConfidence:m.edgeConfidence}));
    setGrade(gradeImage(image,polygonArea(usedCorners)));
   }
   const crop=perspectiveWarp(canvas,usedCorners);
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

 function capture(){const c=sourceCanvas();if(c)void processCanvas(c,corners)}
 function importImage(file:File){
  setError('');capturedRef.current=true;stopCamera();
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

 function moveCorner(index:number,e:ReactPointerEvent<HTMLButtonElement>){
  const r=e.currentTarget.parentElement?.getBoundingClientRect();if(!r)return;
  const rawX=clamp((e.clientX-r.left)/r.width*100,2,98),rawY=clamp((e.clientY-r.top)/r.height*100,2,98);
  setCorners(old=>old.map((p,i)=>i===index?snapCorner(index,rawX,rawY):p));
 }

 useEffect(()=>{
  if(!cameraOn||!auto)return;
  autoTimer.current=window.setInterval(()=>{
   if(capturedRef.current)return;
   const c=sourceCanvas();if(!c)return;
   const frame=c.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,c.width,c.height);if(!frame)return;
   const detected=detectCardQuad(frame);
   if(detected&&detected.confidence>.62){
    setCorners(detected.points);setStability(s=>updateQuadStability(s,true));autoStable.current+=1;
    if(detected.confidence>.70&&autoStable.current>=4){autoStable.current=0;void processCanvas(c,detected.points)}
   }else{autoStable.current=0;setStability(s=>updateQuadStability(s,false))}
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

 async function loadSets(){
  try{setError('');setSelectedSet(null);setSetCards([]);setSets(game==='pokemon'?await getPokemonSets():await getYugiohSets())}catch{setError('Impossibile caricare le espansioni')}
 }
 async function openSet(set:any){
  setSelectedSet(set);setSetCards([]);setLoadingSet(true);setError('');
  try{setSetCards(game==='pokemon'?await getPokemonSetCards(String(set.id)):await getYugiohSetCards(String(set.set_name)))}catch{setError('Impossibile caricare le carte dell’espansione')}finally{setLoadingSet(false)}
 }
 useEffect(()=>{if(page==='sets'&&!selectedSet)void loadSets()},[page,game,selectedSet]);

 const filteredSets=sets.filter(s=>String(s.name||s.set_name).toLowerCase().includes(setSearch.toLowerCase()));
 const totalValue=collection.reduce((n,c)=>n+(c.prices.find(p=>p.currency==='EUR')?.amount||0)*c.quantity,0);
 const stableLabel=stability.state==='ready'?'Carta centrata — stabile':stability.state==='stabilizing'?'Stabilizzazione…':'Inquadra la carta';

 return <div className="app"><header><div className="brand"><b>P</b><span>POYUKEGIMONHO</span></div><span className="status">● {cameraOn?'camera active':navigator.onLine?'online':'offline'}</span></header><main>
 {page==='home'&&<section className="hero"><p className="eyebrow">COLLECTOR INTELLIGENCE</p><h1>Scan. Understand. Collect.</h1><p>Scanner reale con auto-capture, OCR locale, riconoscimento catalogo, condizione, collezione, espansioni e prezzi.</p><div className="actions"><button className="primary" onClick={openScan}>Apri scanner</button><button onClick={()=>setPage('collection')}>Collezione ({collection.length})</button></div><div className="game"><span>Gioco</span><button className={game==='pokemon'?'selected':''} onClick={()=>setGame('pokemon')}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>setGame('yugioh')}>Yu-Gi-Oh!</button></div><div className="home-metrics"><div><b>{collection.reduce((n,c)=>n+c.quantity,0)}</b><span>carte</span></div><div><b>{collection.length}</b><span>record</span></div><div><b>{totalValue?totalValue.toFixed(2)+' €':'—'}</b><span>valore noto EUR</span></div></div></section>}

 {page==='scan'&&<section><div className="scan-head"><div><p className="eyebrow">SCAN • RECOGNITION • GRADING</p><h2>Inquadra una carta</h2></div><button onClick={()=>{stopCamera();setPage('home')}}>Chiudi</button></div><div className="scanner" ref={stageRef}>
 {cameraOn&&<video ref={videoRef} className="video live" playsInline muted/>}{!cameraOn&&!preview&&<div className="camera-off"><strong>Scanner pronto</strong><span>Attiva la camera o importa una foto.</span><button className="primary" onClick={()=>void startCamera()}>Attiva camera</button></div>}{preview&&<img className="photo-preview" src={preview} alt="Carta acquisita"/>}
 <svg className="quad-overlay" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={corners.map(p=>p.x+','+p.y).join(' ')}/></svg>
 {corners.map((p,i)=><button key={i} className="corner" style={{left:p.x+'%',top:p.y+'%'}} onPointerDown={e=>{dragging.current=i;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(dragging.current===i)moveCorner(i,e)}} onPointerUp={()=>{dragging.current=null}} onPointerCancel={()=>{dragging.current=null}} aria-label={'Sposta angolo '+(i+1)}/>)}
 <div className="scan-top"><span className={'pill '+(stability.state==='ready'?'good':'')}>● {stableLabel}</span><span className="pill">{quality?.ok?'Qualità OK':'Qualità in analisi'} · Auto {auto?'ON':'OFF'}</span></div><div className="scan-bottom"><button className="shutter" onClick={capture} aria-label="Scatta" disabled={processing}/></div></div>
 <div className="scanner-footer"><label className="btn">Galleria<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)importImage(f)}}/></label><button className="btn" onClick={()=>setAuto(v=>!v)}>Auto Capture: {auto?'ON':'OFF'}</button><button className="btn" onClick={resetScan}>Nuova scansione</button></div>
 <div className="review"><div className="review-head"><div><p className="eyebrow">RISULTATO</p><h3>{processing?'Analisi in corso…':selected?.name||'Nessuna carta riconosciuta'}</h3></div>{grade&&<span className="grade">{grade.grade} · {grade.score}/100</span>}</div>
 {ocrText&&<p className="ocr">OCR: <b>{ocrText.slice(0,220)}</b> · confidenza {(ocrConfidence*100).toFixed(0)}%</p>}{grade&&<div className="chips"><span>Condizione: {grade.grade}</span><span>Confidenza: {(grade.confidence*100).toFixed(0)}%</span>{grade.defects.map(d=><span key={d}>{d}</span>)}</div>}
 <div className="manual-search"><input value={manualQuery} onChange={e=>setManualQuery(e.target.value)} placeholder="Nome carta…"/><button onClick={()=>void manualSearch()} disabled={processing}>Cerca catalogo</button></div>
 {recognition.length>0&&<div className="results">{recognition.slice(0,8).map(card=><button key={card.id} className={'result '+(selected?.id===card.id?'selected-result':'')} onClick={()=>setSelected(card)}>{card.image&&<img src={card.image} alt=""/>}<span><b>{card.name}</b><small>{card.setName||'Set non disponibile'} {card.number?'• #'+card.number:''}</small><small>{card.rarity||'Rarità n/d'}</small></span></button>)}</div>}
 <div className="card-detail"><div><b>{selected?.name||'Scansione non identificata'}</b><span>{selected?.setName||'Puoi salvarla e identificarla dopo'} {selected?.number?'• '+selected.number:''}</span><span>{selected?.rarity||'Condizione già analizzata'}</span></div><div className="prices">{selected?.prices.length?selected.prices.map(p=><span key={p.source}>{p.source}: {p.amount.toFixed(2)} {p.currency}</span>):<span>Prezzo non disponibile</span>}</div><button className="primary" onClick={addSelected} disabled={!grade||processing}>Salva scansione</button></div></div>{error&&<div className="error">{error}</div>}</section>}

 {page==='collection'&&<section><div className="section-head"><div><p className="eyebrow">COLLECTION</p><h2>Le mie carte</h2></div><button className="primary" onClick={openScan}>+ Scansiona</button></div><div className="summary"><b>{collection.reduce((n,c)=>n+c.quantity,0)}</b> carte · <b>{collection.length}</b> record · valore noto EUR <b>{totalValue?totalValue.toFixed(2)+' €':'—'}</b></div>{collection.length===0?<div className="empty"><strong>Collezione vuota</strong><span>Scansiona una carta e salvala qui. Anche le scansioni non riconosciute possono essere salvate.</span></div>:<div className="collection-grid">{collection.map((c,i)=><article className="collection-card" key={c.id+'-'+i}>{(c.scanImage||c.image)&&<img src={c.scanImage||c.image} alt=""/>}<div><h3>{c.name}</h3><p>{c.setName||'Set n/d'} {c.number?'• #'+c.number:''}</p><div className="chips"><span>{c.grade.grade}</span><span>Q.tà {c.quantity}</span>{c.prices.find(p=>p.currency==='EUR')&&<span>{c.prices.find(p=>p.currency==='EUR')!.amount.toFixed(2)} EUR</span>}</div><button onClick={()=>setCollection(old=>old.filter((_,j)=>j!==i))}>Rimuovi</button></div></article>)}</div>}</section>}

 {page==='sets'&&<section><div className="section-head"><div><p className="eyebrow">CATALOG</p><h2>{selectedSet?selectedSet.name||selectedSet.set_name:'Espansioni'}</h2></div>{selectedSet?<button onClick={()=>{setSelectedSet(null);setSetCards([])}}>← Espansioni</button>:<button onClick={()=>void loadSets()}>Aggiorna</button>}</div>{!selectedSet?<><div className="toolbar"><input className="search" value={setSearch} onChange={e=>setSetSearch(e.target.value)} placeholder="Cerca espansione…"/><button className={game==='pokemon'?'selected':''} onClick={()=>{setGame('pokemon');setSets([]);setSelectedSet(null)}}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>{setGame('yugioh');setSets([]);setSelectedSet(null)}}>Yu-Gi-Oh!</button></div>{filteredSets.length===0?<div className="empty"><strong>Caricamento catalogo…</strong><span>{error||'Attendi i dati del provider.'}</span></div>:<div className="set-grid">{filteredSets.slice(0,120).map((s,i)=><button className="set-card" key={s.id||s.set_code||i} onClick={()=>void openSet(s)}>{(s.logo||s.image)&&<img src={s.logo||s.image} alt=""/>}<div><b>{s.name||s.set_name}</b><span>{s.cardCount?.official||s.num_of_cards||'?'} carte</span><small>{s.releaseDate||s.tcg_date||''}</small></div></button>)}</div>}</>:<>{loadingSet?<div className="empty"><strong>Caricamento carte…</strong><span>Sto aprendo tutte le carte dell’espansione.</span></div>:setCards.length===0?<div className="empty"><strong>Nessuna carta disponibile</strong><span>{error||'Il provider non ha restituito le carte.'}</span></div>:<div className="card-grid">{setCards.map(card=><button className="catalog-card" key={card.id} onClick={()=>{setSelected(card);setPage('scan')}}>{card.image&&<img src={card.image} alt=""/>}<b>{card.name}</b><span>#{card.number||'—'} · {card.rarity||'Rarità n/d'}</span></button>)}</div>}</>}</section>}

 {page==='market'&&<section><p className="eyebrow">MARKET</p><h2>Prezzi & storico</h2><div className="market-grid"><div className="module"><b>Cardmarket</b><span>Prezzi EUR quando il provider li restituisce.</span></div><div className="module"><b>TCGplayer</b><span>Prezzi USD quando il provider li restituisce.</span></div><div className="module"><b>Nessun prezzo inventato</b><span>Se non esiste una quotazione, mostriamo “non disponibile”.</span></div></div><div className="empty">I prezzi vengono caricati nel risultato della carta riconosciuta o nel dettaglio di una carta del catalogo.</div></section>}
 </main><nav>{nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{if(id==='scan')openScan();else{stopCamera();setPage(id)}}}><b>{icon}</b>{label}</button>)}</nav></div>
}

import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {clamp,isConvexQuad,polygonArea,updateQuadStability,type Point,type QuadStability} from './scanner/geometry';
import {estimateImageQuality,evaluateQuality,type QualityResult} from './scanner/quality';
import {recognizeText} from './services/ocr';
import {recognize,getPokemonSets,getYugiohSets,type CatalogCard} from './services/catalog';
import {gradeImage,type GradeResult} from './services/grading';
import {detectCardQuad,perspectiveWarp} from './scanner/vision';
import {rankVisualMatches} from './services/visualMatch';

type Game='pokemon'|'yugioh';
type SavedCard=CatalogCard & {quantity:number;grade:GradeResult;addedAt:string};
const nav=[['home','⌂','Home'],['scan','◉','Scan'],['collection','◇','Collection'],['sets','▦','Sets'],['market','↗','Market']] as const;
const initialCorners:Point[]=[{x:18,y:10},{x:82,y:10},{x:82,y:90},{x:18,y:90}];
const savedKey='poyukegimonho.collection.v2';

function loadCollection():SavedCard[]{try{return JSON.parse(localStorage.getItem(savedKey)||'[]') as SavedCard[]}catch{return []}}
function saveCollection(items:SavedCard[]){localStorage.setItem(savedKey,JSON.stringify(items))}
function extractNumberHint(text:string){return text.match(/\b\d{1,3}\s*\/\s*\d{1,3}\b/)?.[0]?.replace(/\s/g,'')||text.match(/\b[A-Z]{2,6}\d?-[A-Z0-9]{1,5}\b/i)?.[0]||undefined}
function perspectiveCrop(source:HTMLCanvasElement,points:Point[]){
 const w=source.width,h=source.height,p=points.map(x=>({x:x.x/100*w,y:x.y/100*h}));
 const width=Math.max(Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),Math.hypot(p[2].x-p[3].x,p[2].y-p[3].y));
 const height=Math.max(Math.hypot(p[3].x-p[0].x,p[3].y-p[0].y),Math.hypot(p[2].x-p[1].x,p[2].y-p[1].y));
 const out=document.createElement('canvas');out.width=Math.max(320,Math.round(width));out.height=Math.max(448,Math.round(height));
 const ctx=out.getContext('2d');if(!ctx)return source;
 const minX=Math.min(...p.map(v=>v.x)),minY=Math.min(...p.map(v=>v.y));
 ctx.drawImage(source,minX,minY,width,height,0,0,out.width,out.height);return out;
}

export default function App(){
 const [page,setPage]=useState<(typeof nav)[number][0]>('home');
 const [game,setGame]=useState<Game>('pokemon');
 const [cameraOn,setCameraOn]=useState(false),[auto,setAuto]=useState(true);
 const [preview,setPreview]=useState<string|null>(null),[corners,setCorners]=useState<Point[]>(initialCorners);
 const [stability,setStability]=useState<QuadStability>({good:0,bad:0,state:'searching'});
 const [quality,setQuality]=useState<QualityResult|null>(null),[collection,setCollection]=useState<SavedCard[]>(loadCollection);
 const [sets,setSets]=useState<any[]>([]),[setSearch,setSetSearch]=useState('');
 const [recognition,setRecognition]=useState<CatalogCard[]>([]),[ocrText,setOcrText]=useState('');
 const [ocrConfidence,setOcrConfidence]=useState(0),[processing,setProcessing]=useState(false);
 const [grade,setGrade]=useState<GradeResult|null>(null),[selected,setSelected]=useState<CatalogCard|null>(null);
 const [manualQuery,setManualQuery]=useState(''),[error,setError]=useState('');
 const videoRef=useRef<HTMLVideoElement>(null),streamRef=useRef<MediaStream|null>(null),dragging=useRef<number|null>(null);
 const autoTimer=useRef<number|null>(null),capturedRef=useRef(false);

 useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(preview)URL.revokeObjectURL(preview);if(autoTimer.current)clearInterval(autoTimer.current)},[preview]);
 useEffect(()=>{saveCollection(collection)},[collection]);
 useEffect(()=>{setStability(s=>updateQuadStability(s,isConvexQuad(corners)&&polygonArea(corners)>1100))},[corners]);

 async function startCamera(){
  setError('');
  try{streamRef.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
   if(videoRef.current){videoRef.current.srcObject=streamRef.current;await videoRef.current.play()}setCameraOn(true);capturedRef.current=false;
  }catch{setCameraOn(false);setError('Fotocamera non disponibile: controlla i permessi o usa Galleria.')}
 }
 function stopCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOn(false)}
 function openScan(){setPage('scan');setError('');setRecognition([]);setGrade(null);setOcrText('');setQuality(null);setStability({good:0,bad:0,state:'searching'});void startCamera()}
 function sourceCanvas(){
  const v=videoRef.current;if(!v||v.readyState<2)return null;
  const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d')?.drawImage(v,0,0);return c;
 }
 async function processCanvas(canvas:HTMLCanvasElement){
  if(capturedRef.current&&cameraOn)return;capturedRef.current=true;setProcessing(true);setError('');
  const image=canvas.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,canvas.width,canvas.height);
  if(image){const m=estimateImageQuality(image,canvas.width,canvas.height);const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
   const aspect=(Math.max(...xs)-Math.min(...xs))/Math.max(1,Math.max(...ys)-Math.min(...ys));
   setQuality(evaluateQuality({areaRatio:polygonArea(corners)/10000,aspectRatio:aspect,brightness:m.brightness,contrast:m.contrast,edgeConfidence:m.edgeConfidence}));
   setGrade(gradeImage(image,polygonArea(corners)));
  }
  const crop=perspectiveWarp(canvas,corners);const blob=await new Promise<Blob|null>(r=>crop.toBlob(r,'image/jpeg',.92));
  if(blob){const url=URL.createObjectURL(blob);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});
   try{const ocr=await recognizeText(blob);setOcrText(ocr.text);setOcrConfidence(ocr.confidence);const results=await recognize(game,ocr.text,extractNumberHint(ocr.text));const ranked=await rankVisualMatches(blob,results);setRecognition(ranked);if(ranked.length)setSelected(ranked[0])}
   catch{setError('OCR/catalogo non raggiungibile. Puoi cercare manualmente il nome della carta.')}
  }
  stopCamera();setProcessing(false);
 }
 function capture(){const c=sourceCanvas();if(c)void processCanvas(c)}
 function importImage(file:File){
  capturedRef.current=true;stopCamera();const url=URL.createObjectURL(file);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});
  const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d')?.drawImage(img,0,0);void processCanvas(c)};img.src=url;
 }
 function moveCorner(index:number,e:ReactPointerEvent<HTMLButtonElement>){
  const r=e.currentTarget.parentElement?.getBoundingClientRect();if(!r)return;
  const x=clamp((e.clientX-r.left)/r.width*100,3,97),y=clamp((e.clientY-r.top)/r.height*100,3,97);
  setCorners(old=>old.map((p,i)=>i===index?{x,y}:p));
 }
 useEffect(()=>{if(!cameraOn||!auto)return;autoTimer.current=window.setInterval(()=>{if(capturedRef.current)return;const c=sourceCanvas();if(!c)return;const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)return;const frame=ctx.getImageData(0,0,c.width,c.height);const m=estimateImageQuality(frame,c.width,c.height);const detected=detectCardQuad(frame);if(detected&&detected.confidence>.62){setCorners(detected.points);setStability(s=>updateQuadStability(s,true));if(detected.confidence>.76&&stability.state==='ready')capture()}else{const valid=isConvexQuad(corners)&&polygonArea(corners)>1100&&m.contrast>14&&m.edgeConfidence>.08;setStability(s=>updateQuadStability(s,valid))}},700);return()=>{if(autoTimer.current)clearInterval(autoTimer.current)}},[cameraOn,auto,stability.state,corners]);
 async function manualSearch(){if(!manualQuery.trim())return;setProcessing(true);try{const r=await recognize(game,manualQuery);setRecognition(r);setSelected(r[0]||null);setOcrText(manualQuery)}catch{setError('Catalogo non raggiungibile')}setProcessing(false)}
 function addSelected(){if(!selected||!grade)return;setCollection(old=>[...old,{...selected,quantity:1,grade,addedAt:new Date().toISOString()}]);setPage('collection')}
 async function loadSets(){try{setError('');setSets(game==='pokemon'?await getPokemonSets():await getYugiohSets())}catch{setError('Impossibile caricare le espansioni')}}
 useEffect(()=>{if(page==='sets'&&!sets.length)void loadSets()},[page,game]);
 const filteredSets=sets.filter(s=>String(s.name||s.set_name).toLowerCase().includes(setSearch.toLowerCase()));
 const totalValue=collection.reduce((n,c)=>n+(c.prices[0]?.amount||0)*c.quantity,0);
 const stableLabel=stability.state==='ready'?'Carta centrata — stabile':stability.state==='stabilizing'?'Stabilizzazione…':'Inquadra la carta';

 return <div className="app"><header><div className="brand"><b>P</b><span>POYUKEGIMONHO</span></div><span className="status">● {cameraOn?'camera active':navigator.onLine?'online':'offline'}</span></header><main>
 {page==='home'&&<section className="hero"><p className="eyebrow">COLLECTOR INTELLIGENCE</p><h1>Scan. Understand. Collect.</h1><p>Scanner reale con auto-capture, OCR locale, riconoscimento catalogo, condizione, collezione, espansioni e prezzi.</p><div className="actions"><button className="primary" onClick={openScan}>Apri scanner</button><button onClick={()=>setPage('collection')}>Collezione ({collection.length})</button></div><div className="game"><span>Gioco</span><button className={game==='pokemon'?'selected':''} onClick={()=>setGame('pokemon')}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>setGame('yugioh')}>Yu-Gi-Oh!</button></div><div className="home-metrics"><div><b>{collection.reduce((n,c)=>n+c.quantity,0)}</b><span>carte</span></div><div><b>{collection.length}</b><span>record</span></div><div><b>{totalValue?totalValue.toFixed(2)+' €':'—'}</b><span>valore noto</span></div></div></section>}
 {page==='scan'&&<section><div className="scan-head"><div><p className="eyebrow">SCAN • RECOGNITION • GRADING</p><h2>Inquadra una carta</h2></div><button onClick={()=>{stopCamera();setPage('home')}}>Chiudi</button></div><div className="scanner">
 {cameraOn&&<video ref={videoRef} className="video live" playsInline muted/>}{!cameraOn&&!preview&&<div className="camera-off"><strong>Scanner pronto</strong><span>Attiva la camera o importa una foto.</span><button className="primary" onClick={()=>void startCamera()}>Attiva camera</button></div>}{preview&&<img className="photo-preview" src={preview} alt="Carta acquisita"/>}
 <svg className="quad-overlay" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={corners.map(p=>p.x+','+p.y).join(' ')}/></svg>
 {corners.map((p,i)=><button key={i} className="corner" style={{left:p.x+'%',top:p.y+'%'}} onPointerDown={e=>{dragging.current=i;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(dragging.current===i)moveCorner(i,e)}} onPointerUp={()=>{dragging.current=null}} aria-label={'Sposta angolo '+(i+1)}/>)}
 <div className="scan-top"><span className={'pill '+(stability.state==='ready'?'good':'')}>● {stableLabel}</span><span className="pill">{quality?.ok?'Qualità OK':'Qualità in analisi'} · Auto {auto?'ON':'OFF'}</span></div><div className="scan-bottom"><button className="shutter" onClick={capture} aria-label="Scatta" disabled={processing}/></div></div>
 <div className="scanner-footer"><label className="btn">Galleria<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)importImage(f)}}/></label><button className="btn" onClick={()=>setAuto(v=>!v)}>Auto Capture: {auto?'ON':'OFF'}</button><button className="btn" onClick={()=>{setCorners(initialCorners);setPreview(null);setRecognition([]);setGrade(null);setOcrText('');setQuality(null);capturedRef.current=false;setStability({good:0,bad:0,state:'searching'});if(!cameraOn)void startCamera()}}>Nuova scansione</button></div>
 <div className="review"><div className="review-head"><div><p className="eyebrow">RISULTATO</p><h3>{processing?'Analisi in corso…':selected?.name||'Nessuna carta riconosciuta'}</h3></div>{grade&&<span className="grade">{grade.grade} · {grade.score}/100</span>}</div>
 {ocrText&&<p className="ocr">OCR: <b>{ocrText.slice(0,180)}</b> · confidenza {(ocrConfidence*100).toFixed(0)}%</p>}{grade&&<div className="chips"><span>Condizione: {grade.grade}</span><span>Confidenza: {(grade.confidence*100).toFixed(0)}%</span>{grade.defects.map(d=><span key={d}>{d}</span>)}</div>}
 <div className="manual-search"><input value={manualQuery} onChange={e=>setManualQuery(e.target.value)} placeholder="Se OCR non basta: nome carta…"/><button onClick={()=>void manualSearch()} disabled={processing}>Cerca catalogo</button></div>
 {recognition.length>0&&<div className="results">{recognition.slice(0,6).map(card=><button key={card.id} className={'result '+(selected?.id===card.id?'selected-result':'')} onClick={()=>setSelected(card)}>{card.image&&<img src={card.image} alt=""/>}<span><b>{card.name}</b><small>{card.setName||'Set non disponibile'} {card.number?'• #'+card.number:''}</small><small>{card.rarity||'Rarità n/d'}</small></span></button>)}</div>}
 {selected&&<div className="card-detail"><div><b>{selected.name}</b><span>{selected.setName||'Set n/d'} {selected.number?'• '+selected.number:''}</span><span>{selected.rarity||'Rarità n/d'} {selected.year?'• '+selected.year:''}</span></div><div className="prices">{selected.prices.length?selected.prices.map(p=><span key={p.source}>{p.source}: {p.amount.toFixed(2)} {p.currency}</span>):<span>Prezzo non disponibile</span>}</div><button className="primary" onClick={addSelected} disabled={!grade}>Salva in collezione</button></div>}</div>{error&&<div className="error">{error}</div>}</section>}
 {page==='collection'&&<section><div className="section-head"><div><p className="eyebrow">COLLECTION</p><h2>Le mie carte</h2></div><button className="primary" onClick={openScan}>+ Scansiona</button></div><div className="summary"><b>{collection.reduce((n,c)=>n+c.quantity,0)}</b> carte · <b>{collection.length}</b> record · valore noto <b>{totalValue?totalValue.toFixed(2)+' €':'—'}</b></div>{collection.length===0?<div className="empty"><strong>Collezione vuota</strong><span>Scansiona una carta e salvala qui. I dati restano nel browser.</span></div>:<div className="collection-grid">{collection.map((c,i)=><article className="collection-card" key={c.id+'-'+i}>{c.image&&<img src={c.image} alt=""/>}<div><h3>{c.name}</h3><p>{c.setName||'Set n/d'} {c.number?'• #'+c.number:''}</p><div className="chips"><span>{c.grade.grade}</span><span>Q.tà {c.quantity}</span>{c.prices[0]&&<span>{c.prices[0].amount.toFixed(2)} {c.prices[0].currency}</span>}</div><button onClick={()=>setCollection(old=>old.filter((_,j)=>j!==i))}>Rimuovi</button></div></article>)}</div>}</section>}
 {page==='sets'&&<section><div className="section-head"><div><p className="eyebrow">CATALOG</p><h2>Espansioni</h2></div><button onClick={()=>void loadSets()}>Aggiorna</button></div><div className="toolbar"><input className="search" value={setSearch} onChange={e=>setSetSearch(e.target.value)} placeholder="Cerca espansione…"/><button className={game==='pokemon'?'selected':''} onClick={()=>{setGame('pokemon');setSets([])}}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>{setGame('yugioh');setSets([])}}>Yu-Gi-Oh!</button></div>{filteredSets.length===0?<div className="empty"><strong>Caricamento catalogo…</strong><span>{error||'Attendi i dati del provider.'}</span></div>:<div className="set-grid">{filteredSets.slice(0,80).map((s,i)=><article className="set-card" key={s.id||s.set_code||i}>{(s.logo||s.image)&&<img src={s.logo||s.image} alt=""/>}<div><b>{s.name||s.set_name}</b><span>{s.cardCount?.official||s.num_of_cards||'?'} carte</span><small>{s.releaseDate||s.tcg_date||''}</small></div></article>)}</div>}</section>}
 {page==='market'&&<section><p className="eyebrow">MARKET</p><h2>Prezzi & storico</h2><div className="market-grid"><div className="module"><b>Cardmarket</b><span>Prezzi EUR quando il provider li restituisce.</span></div><div className="module"><b>TCGplayer</b><span>Prezzi USD quando il provider li restituisce.</span></div><div className="module"><b>Nessun prezzo inventato</b><span>Se non esiste una quotazione, mostriamo “non disponibile”.</span></div></div><div className="empty">I prezzi vengono caricati nel risultato della carta riconosciuta.</div></section>}
 </main><nav>{nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{if(id==='scan')openScan();else{stopCamera();setPage(id)}}}><b>{icon}</b>{label}</button>)}</nav></div>
}
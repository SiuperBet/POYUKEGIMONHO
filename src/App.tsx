import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import type {Game} from './domain/model';
import {clamp,isConvexQuad,polygonArea,updateQuadStability,type Point,type QuadStability} from './scanner/geometry';
import {estimateImageQuality,evaluateQuality,type QualityResult} from './scanner/quality';

const nav=[['home','⌂','Home'],['scan','◉','Scan'],['collection','◇','Collection'],['sets','▦','Sets'],['market','↗','Market']] as const;
const initialCorners:Point[]=[{x:20,y:10},{x:80,y:10},{x:80,y:90},{x:20,y:90}];

export default function App(){
 const [page,setPage]=useState<(typeof nav)[number][0]>('home');
 const [game,setGame]=useState<Game>('pokemon');
 const [cameraOn,setCameraOn]=useState(false);
 const [auto,setAuto]=useState(true);
 const [preview,setPreview]=useState<string|null>(null);
 const [corners,setCorners]=useState<Point[]>(initialCorners);
 const [stability,setStability]=useState<QuadStability>({good:0,bad:0,state:'searching'});
 const [quality,setQuality]=useState<QualityResult|null>(null);
 const videoRef=useRef<HTMLVideoElement>(null);
 const streamRef=useRef<MediaStream|null>(null);
 const dragging=useRef<number|null>(null);

 useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(preview)URL.revokeObjectURL(preview)},[preview]);

 const geometryValid=isConvexQuad(corners)&&polygonArea(corners)>=18*100;
 useEffect(()=>{setStability(s=>updateQuadStability(s,geometryValid))},[corners,geometryValid]);

 async function analyzeCanvas(canvas:HTMLCanvasElement){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return;
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  const metrics=estimateImageQuality(image,canvas.width,canvas.height);
  const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
  const aspect=(Math.max(...xs)-Math.min(...xs))/Math.max(1,Math.max(...ys)-Math.min(...ys));
  setQuality(evaluateQuality({areaRatio:polygonArea(corners)/10000,aspectRatio:aspect,brightness:metrics.brightness,contrast:metrics.contrast,edgeConfidence:metrics.edgeConfidence}));
 }

 async function startCamera(){try{streamRef.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});if(videoRef.current){videoRef.current.srcObject=streamRef.current;await videoRef.current.play()}setCameraOn(true)}catch{setCameraOn(false)}}
 function stopCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOn(false)}
 function openScan(){setPage('scan');setQuality(null);setStability({good:0,bad:0,state:'searching'});void startCamera()}
 function capture(){const video=videoRef.current;if(!video||video.readyState<2)return;const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d')?.drawImage(video,0,0);void analyzeCanvas(canvas);canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});stopCamera()},'image/jpeg',.9)}
 function importImage(file:File){const url=URL.createObjectURL(file);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d')?.drawImage(image,0,0);void analyzeCanvas(canvas)};image.src=url;stopCamera()}
 function moveCorner(index:number,event:ReactPointerEvent<HTMLButtonElement>){const rect=event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();if(!rect)return;const x=clamp(((event.clientX-rect.left)/rect.width)*100,4,96);const y=clamp(((event.clientY-rect.top)/rect.height)*100,4,96);setCorners(old=>old.map((p,i)=>i===index?{x,y}:p))}
 const stabilityLabel=stability.state==='ready'?'Carta centrata — stabile':stability.state==='stabilizing'?'Stabilizzazione…':'Inquadra la carta';
 const qualityLabel=quality?.ok?'Qualità OK':quality?'Controlla qualità':'Qualità in attesa';

 return <div className="app"><header><div className="brand"><b>C</b><span>CARDGRADE</span></div><span className="status">● {cameraOn?'camera active':'local-first'}</span></header><main>
 {page==='home'&&<section className="hero"><p className="eyebrow">COLLECTOR INTELLIGENCE</p><h1>Scan. Understand. Collect.</h1><p>Camera reale, crop manuale e pipeline pronta per detection, recognition e grading.</p><div className="actions"><button className="primary" onClick={openScan}>Apri scanner</button><button onClick={()=>setPage('collection')}>Collezione</button></div><div className="game"><span>Gioco</span><button className={game==='pokemon'?'selected':''} onClick={()=>setGame('pokemon')}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>setGame('yugioh')}>Yu-Gi-Oh!</button></div></section>}
 {page==='scan'&&<section><div className="scan-head"><div><p className="eyebrow">SCANNER • PHASE 2</p><h2>Inquadra una carta</h2></div><button onClick={()=>{stopCamera();setPage('home')}}>Chiudi</button></div><div className="scanner"><video ref={videoRef} className={cameraOn?'video live':'video'} playsInline muted aria-label="Anteprima fotocamera"/>{!cameraOn&&!preview&&<div className="camera-off"><strong>Camera non attiva</strong><span>Avvia la fotocamera oppure importa una foto.</span><button className="primary" onClick={()=>void startCamera()}>Attiva camera</button></div>}{preview&&<img className="photo-preview" src={preview} alt="Foto della carta"/>}<svg className="quad-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={corners.map(p=>`${p.x},${p.y}`).join(' ')}/></svg>{corners.map((p,i)=><button key={i} className="corner" style={{left:`${p.x}%`,top:`${p.y}%`}} onPointerDown={e=>{dragging.current=i;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(dragging.current===i)moveCorner(i,e)}} onPointerUp={()=>{dragging.current=null}} aria-label={`Sposta angolo ${i+1}`}/>) }<div className="scan-top"><span className={`pill ${stability.state==='ready'?'good':''}`}>● {stabilityLabel}</span><span className="pill">{qualityLabel} · Auto {auto?'ON':'OFF'}</span></div><div className="scan-bottom"><button className="shutter" onClick={capture} aria-label="Scatta"></button></div></div><div className="scanner-footer"><label className="btn">Galleria<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)importImage(f)}}/></label><button className="btn" onClick={()=>setAuto(v=>!v)}>Auto Capture: {auto?'ON':'OFF'}</button><button className="btn" onClick={()=>{setCorners(initialCorners);setQuality(null);setStability({good:0,bad:0,state:'searching'})}}>Reset crop</button></div><p className="hint">I quattro punti ora seguono davvero il crop. La stabilizzazione usa isteresi: servono più frame validi per dichiarare la carta pronta.</p></section>}
 {page==='collection'&&<section><p className="eyebrow">COLLECTION</p><h2>Le mie carte</h2><div className="empty"><strong>Collezione vuota</strong><span>Nessun dato inventato. Salveremo printing, variante, condizione e quantità.</span></div></section>}
 {page==='sets'&&<section><p className="eyebrow">CATALOG</p><h2>Espansioni</h2><div className="empty"><strong>Catalogo non connesso</strong><span>Set e relazioni internazionali saranno forniti da un CatalogProvider.</span></div></section>}
 {page==='market'&&<section><p className="eyebrow">MARKET</p><h2>Prezzi & storico</h2><div className="empty"><strong>PriceProvider</strong><span>Solo fonti legittime, timestamp, valuta, condizione, variante e confidence.</span></div></section>}
 </main><nav>{nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{if(id==='scan')openScan();else{stopCamera();setPage(id)}}}><b>{icon}</b>{label}</button>)}</nav></div>
}
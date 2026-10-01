import {useEffect,useRef,useState} from 'react';
import type {Game} from './domain/model';
import {clamp,type Point} from './scanner/geometry';

const nav=[['home','⌂','Home'],['scan','◉','Scan'],['collection','◇','Collection'],['sets','▦','Sets'],['market','↗','Market']] as const;
const initialCorners:Point[]=[{x:20,y:10},{x:80,y:10},{x:80,y:90},{x:20,y:90}];

export default function App(){
 const [page,setPage]=useState<(typeof nav)[number][0]>('home');
 const [game,setGame]=useState<Game>('pokemon');
 const [cameraOn,setCameraOn]=useState(false);
 const [auto,setAuto]=useState(true);
 const [preview,setPreview]=useState<string|null>(null);
 const [corners,setCorners]=useState<Point[]>(initialCorners);
 const videoRef=useRef<HTMLVideoElement>(null);
 const streamRef=useRef<MediaStream|null>(null);
 const dragging=useRef<number|null>(null);

 useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(preview)URL.revokeObjectURL(preview)},[preview]);

 async function startCamera(){try{streamRef.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});if(videoRef.current){videoRef.current.srcObject=streamRef.current;await videoRef.current.play()}setCameraOn(true)}catch{setCameraOn(false)}}
 function stopCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCameraOn(false)}
 function openScan(){setPage('scan');void startCamera()}
 function capture(){const video=videoRef.current;if(!video||video.readyState<2)return;const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d')?.drawImage(video,0,0);canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});stopCamera()},'image/jpeg',.9)}
 function importImage(file:File){const url=URL.createObjectURL(file);setPreview(old=>{if(old)URL.revokeObjectURL(old);return url});stopCamera()}
 function moveCorner(index:number,event:React.PointerEvent<HTMLButtonElement>){const parent=event.currentTarget.parentElement;const rect=parent?.parentElement?.getBoundingClientRect();if(!rect)return;const x=clamp(((event.clientX-rect.left)/rect.width)*100,4,96);const y=clamp(((event.clientY-rect.top)/rect.height)*100,4,96);setCorners(old=>old.map((p,i)=>i===index?{x,y}:p))}
 return <div className="app"><header><div className="brand"><b>C</b><span>CARDGRADE</span></div><span className="status">● {cameraOn?'camera active':'local-first'}</span></header><main>
 {page==='home'&&<section className="hero"><p className="eyebrow">COLLECTOR INTELLIGENCE</p><h1>Scan. Understand. Collect.</h1><p>Camera reale, crop manuale e pipeline pronta per detection, recognition e grading.</p><div className="actions"><button className="primary" onClick={openScan}>Apri scanner</button><button onClick={()=>setPage('collection')}>Collezione</button></div><div className="game"><span>Gioco</span><button className={game==='pokemon'?'selected':''} onClick={()=>setGame('pokemon')}>Pokémon</button><button className={game==='yugioh'?'selected':''} onClick={()=>setGame('yugioh')}>Yu-Gi-Oh!</button></div></section>}
 {page==='scan'&&<section><div className="scan-head"><div><p className="eyebrow">SCANNER • PHASE 2</p><h2>Inquadra una carta</h2></div><button onClick={()=>{stopCamera();setPage('home')}}>Chiudi</button></div><div className="scanner"><video ref={videoRef} className={cameraOn?'video live':'video'} playsInline muted aria-label="Anteprima fotocamera"/>{!cameraOn&&!preview&&<div className="camera-off"><strong>Camera non attiva</strong><span>Avvia la fotocamera oppure importa una foto.</span><button className="primary" onClick={()=>void startCamera()}>Attiva camera</button></div>}{preview&&<img className="photo-preview" src={preview} alt="Foto della carta"/>}<div className="quad" style={{left:'20%',top:'10%',width:'60%',height:'80%'}}>{corners.map((p,i)=><button key={i} className="corner" style={{left:i===0||i===3?'0':'100%',top:i<2?'0':'100%'}} onPointerDown={e=>{dragging.current=i;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(dragging.current===i)moveCorner(i,e)}} onPointerUp={()=>{dragging.current=null}} aria-label={`Sposta angolo ${i+1}`}/>)}</div><div className="scan-top"><span className="pill good">● Carta centrata</span><span className="pill">Auto {auto?'ON':'OFF'}</span></div><div className="scan-bottom"><button className="shutter" onClick={capture} aria-label="Scatta"></button></div></div><div className="scanner-footer"><label className="btn">Galleria<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)importImage(f)}}/></label><button className="btn" onClick={()=>setAuto(v=>!v)}>Auto Capture: {auto?'ON':'OFF'}</button><button className="btn" onClick={()=>setCorners(initialCorners)}>Reset crop</button></div><p className="hint">Il frame camera e il crop manuale sono ora nativi. La detection automatica a 4 angoli e la prospettiva verranno innestate come adapter CV senza cambiare la UI.</p></section>}
 {page==='collection'&&<section><p className="eyebrow">COLLECTION</p><h2>Le mie carte</h2><div className="empty"><strong>Collezione vuota</strong><span>Nessun dato inventato. Salveremo printing, variante, condizione e quantità.</span></div></section>}
 {page==='sets'&&<section><p className="eyebrow">CATALOG</p><h2>Espansioni</h2><div className="empty"><strong>Catalogo non connesso</strong><span>Set e relazioni internazionali saranno forniti da un CatalogProvider.</span></div></section>}
 {page==='market'&&<section><p className="eyebrow">MARKET</p><h2>Prezzi & storico</h2><div className="empty"><strong>PriceProvider</strong><span>Solo fonti legittime, timestamp, valuta, condizione, variante e confidence.</span></div></section>}
 </main><nav>{nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{if(id==='scan')openScan();else{stopCamera();setPage(id)}}}><b>{icon}</b>{label}</button>)}</nav></div>
}
import React,{useMemo,useRef,useState} from 'react';
import {Image,PanResponder,Platform,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {CameraView,useCameraPermissions,type CameraType} from 'expo-camera';
import {normalizeCardImage} from './cardNormalization';
import type {Point} from './cardGeometry';
import type {CatalogCard,Game} from '../data/catalog';
import {recognizeCardImage,type RecognitionResult} from '../data/recognition';
import type {ProfessionalAnalysis,GradedItem,Condition} from '../data/store';
import type {VisualAnalysis} from '../data/visualGrading';

type Props={
 resumeGraded?:GradedItem;game?:Game;onExit?:()=>void;
 onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;
 onCardSelected?:(gradedId:string,card:CatalogCard)=>Promise<void>|void;
 onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;
 onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis,professionalAnalysis?:ProfessionalAnalysis)=>Promise<void>|void;
 onProfessionalAnalysis?:(gradedId:string,analysis:ProfessionalAnalysis)=>Promise<void>|void;
 onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;
 onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void;
};

type NativeScanner={launchAsync:()=>Promise<{uri:string}|null>};
type Quad={topLeft:Point;topRight:Point;bottomRight:Point;bottomLeft:Point};
const INITIAL:Quad={topLeft:{x:.02,y:.02},topRight:{x:.98,y:.02},bottomRight:{x:.98,y:.98},bottomLeft:{x:.02,y:.98}};

function getNativeScanner():NativeScanner|null{
 if(Platform.OS!=='android')return null;
 try{return require('@cardgrade/document-scanner').default as NativeScanner}catch{return null}
}
function line(a:Point,b:Point,w:number,h:number){const x1=a.x*w,y1=a.y*h,x2=b.x*w,y2=b.y*h,len=Math.hypot(x2-x1,y2-y1);return{left:(x1+x2-len)/2,top:(y1+y2-2)/2,width:len,transform:[{rotate:Math.atan2(y2-y1,x2-x1)*180/Math.PI+'deg'}]};}

export function ScannerScreen({onExit,onCaptured,game='pokemon'}:Props){
 const nativeScanner=useRef<NativeScanner|null>(null);
 const[permission,requestPermission]=useCameraPermissions();
 const[processing,setProcessing]=useState(false);
 const[recognition,setRecognition]=useState<RecognitionResult|null>(null);
 const[pendingUri,setPendingUri]=useState<string|null>(null);
 const[error,setError]=useState('');
 const[ready,setReady]=useState(false);
 const[camera,setCamera]=useState<CameraView|null>(null);
 const[review,setReview]=useState(false);
 const[quad,setQuad]=useState<Quad>(INITIAL);
 const[autoOn]=useState(true);

 const startReview=(uri:string)=>{setPendingUri(uri);setQuad(INITIAL);setRecognition(null);setError('');setReview(true)};

 const confirmReview=async()=>{
  if(!pendingUri||processing)return;
  setProcessing(true);setError('');
  try{
   const normalized=await normalizeCardImage(pendingUri,quad);
   if(!normalized.quality.readable){
    const q=normalized.quality;
    setError(q.blurRisk?'Foto sfocata — ripeti la scansione':q.darkRisk?'Immagine troppo scura':q.reflectionRisk?'Troppi riflessi':'Qualità insufficiente');
    return;
   }
   const result=await recognizeCardImage(normalized.uri,game);
   setRecognition(result);
   setReview(false);
   if(result.status==='matched'&&result.card)await onCaptured?.(pendingUri,result.card);
  }catch{setError('Impossibile elaborare la carta. Riprova.')}
  finally{setProcessing(false)}
 };

 const launchDocumentScanner=async()=>{
  if(processing)return;
  setProcessing(true);setError('');
  try{
   nativeScanner.current=nativeScanner.current||getNativeScanner();
   if(!nativeScanner.current)throw new Error('native scanner unavailable');
   const result=await nativeScanner.current.launchAsync();
   if(result?.uri)startReview(result.uri);
  }catch{setError('Impossibile avviare lo scanner. Riprova.')}
  finally{setProcessing(false)}
 };

 const manualCameraCapture=async()=>{
  if(!camera||processing)return;
  setProcessing(true);
  try{const photo=await camera.takePictureAsync({quality:1,skipProcessing:false});if(photo?.uri)startReview(photo.uri)}
  catch{setError('Acquisizione non riuscita. Riprova.')}
  finally{setProcessing(false)}
 };

 if(review&&pendingUri)return <ReviewScreen uri={pendingUri} quad={quad} setQuad={setQuad} processing={processing} error={error} onBack={()=>{setReview(false);setError('')}} onConfirm={()=>void confirmReview()}/>;

 if(Platform.OS==='android')return <View style={styles.root}>
  <View style={styles.nativeHeader}><TouchableOpacity style={styles.iconButton} onPress={onExit}><Text style={styles.icon}>×</Text></TouchableOpacity><View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>SCANNER</Text></View><View style={styles.autoBadge}><Text style={styles.autoText}>AUTO ON</Text></View></View>
  <View style={styles.nativeCenter}>
   <View style={styles.cardGuide}><View style={styles.guideTL}/><View style={styles.guideTR}/><View style={styles.guideBR}/><View style={styles.guideBL}/></View>
   <Text style={styles.statusTitle}>{processing?'Elaborazione…':'Inquadra la carta'}</Text>
   <Text style={styles.statusCopy}>Il rilevamento automatico acquisisce la carta quando i bordi sono realmente leggibili.</Text>
   {error?<Text style={styles.error}>{error}</Text>:null}
   {recognition?<View style={styles.result}><Text style={styles.resultTitle}>{recognition.status==='matched'&&recognition.card?recognition.card.name:recognition.status==='possible'?'Possibile corrispondenza':'Carta non riconosciuta'}</Text>{recognition.status==='possible'&&pendingUri&&recognition.candidates.slice(0,3).map((card,i)=><TouchableOpacity key={card.id} style={styles.candidate} onPress={()=>{void (async()=>{setRecognition({...recognition,status:'matched',card,confidence:Math.max(.84,recognition.confidence),margin:Math.max(.14,recognition.margin)});await onCaptured?.(pendingUri,card)})();}}><Text style={styles.candidateText}>{i+1}. {card.name}{card.number?' · '+card.number:''}{card.language?' · '+card.language:''}</Text><Text style={styles.confirm}>SELEZIONA</Text></TouchableOpacity>)}</View>:null}
   <TouchableOpacity disabled={processing} style={[styles.scanButton,processing&&styles.disabled]} onPress={()=>void launchDocumentScanner()}><Text style={styles.scanButtonText}>{processing?'ELABORAZIONE…':'SCANSIONA CARTA'}</Text></TouchableOpacity>
   <Text style={styles.freeNote}>Scanner nativo Android · auto capture · correzione prospettica</Text>
  </View>
 </View>;

 if(!permission)return <View style={styles.center}><Text style={styles.statusCopy}>Preparazione fotocamera…</Text></View>;
 if(!permission.granted)return <View style={styles.center}><Text style={styles.title}>Fotocamera necessaria</Text><Text style={styles.statusCopy}>CARDGRADE usa la fotocamera per acquisire la carta.</Text><TouchableOpacity style={styles.scanButton} onPress={()=>void requestPermission()}><Text style={styles.scanButtonText}>CONSENTI FOTOCAMERA</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={onExit}><Text style={styles.secondaryText}>TORNA ALL'APP</Text></TouchableOpacity></View>;

 return <View style={styles.root}><CameraView ref={setCamera} style={StyleSheet.absoluteFill} facing={'back' as CameraType} mode="picture" animateShutter={false} onCameraReady={()=>setReady(true)}/><View style={styles.scrim}/><View style={styles.header}><TouchableOpacity style={styles.iconButton} onPress={onExit}><Text style={styles.icon}>×</Text></TouchableOpacity><View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>SCANNER</Text></View><View style={styles.autoBadge}><Text style={styles.autoText}>AUTO ON</Text></View></View><View style={styles.nativeCenter}><Text style={styles.statusTitle}>{processing?'Elaborazione…':ready?'Posiziona la carta':'Preparazione fotocamera…'}</Text><TouchableOpacity disabled={!ready||processing} style={[styles.scanButton,(!ready||processing)&&styles.disabled]} onPress={()=>void manualCameraCapture()}><Text style={styles.scanButtonText}>SCANSIONA CARTA</Text></TouchableOpacity></View></View>;
}

function ReviewScreen({uri,quad,setQuad,processing,error,onBack,onConfirm}:{uri:string;quad:Quad;setQuad:React.Dispatch<React.SetStateAction<Quad>>;processing:boolean;error:string;onBack:()=>void;onConfirm:()=>void}){
 const size=320,h=size*88/63;
 const keys=['topLeft','topRight','bottomRight','bottomLeft'] as const;
 const responders=useMemo(()=>{
  const create=(key:typeof keys[number])=>PanResponder.create({
   onStartShouldSetPanResponder:()=>true,
   onMoveShouldSetPanResponder:()=>true,
   onPanResponderMove:(_,g)=>setQuad(q=>({...q,[key]:{x:Math.max(.005,Math.min(.995,q[key].x+g.dx/size)),y:Math.max(.005,Math.min(.995,q[key].y+g.dy/h))}}))
  });
  return {topLeft:create('topLeft'),topRight:create('topRight'),bottomRight:create('bottomRight'),bottomLeft:create('bottomLeft')};
 },[size,h,setQuad]);
 return <View style={styles.root}>
  <View style={styles.reviewHeader}><TouchableOpacity style={styles.secondary} onPress={onBack}><Text style={styles.secondaryText}>INDIETRO</Text></TouchableOpacity><View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>REGOLA CARTA</Text></View><TouchableOpacity style={styles.confirmTop} onPress={onConfirm} disabled={processing}><Text style={styles.confirmTopText}>CONFERMA</Text></TouchableOpacity></View>
  <View style={[styles.reviewFrame,{width:size,height:h}]}>
   <Image source={{uri}} style={StyleSheet.absoluteFill} resizeMode="contain"/>
   <View pointerEvents="none" style={StyleSheet.absoluteFill}>{keys.map((k,i)=>{const a=quad[k],b=quad[keys[(i+1)%4]];return <View key={k} style={styles.reviewOverlay}><View style={line(a,b,size,h)}/></View>})}</View>
   {keys.map(k=>{const p=quad[k];return <View key={k} {...responders[k].panHandlers} style={[styles.handle,{left:p.x*size-15,top:p.y*h-15}]}><View style={styles.handleDot}/></View>})}
  </View>
  <Text style={styles.reviewTitle}>Controlla bordi e angoli</Text>
  <Text style={styles.reviewCopy}>Trascina i 4 punti per allineare perfettamente la carta. Poi premi CONFERMA.</Text>
  {error?<Text style={styles.error}>{error}</Text>:null}
  <TouchableOpacity style={[styles.scanButton,processing&&styles.disabled]} onPress={onConfirm} disabled={processing}><Text style={styles.scanButtonText}>{processing?'ANALISI…':'CONFERMA E ANALIZZA'}</Text></TouchableOpacity>
 </View>
}

const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#050608'},center:{flex:1,backgroundColor:'#050608',alignItems:'center',justifyContent:'center',padding:28},
 scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.12)'},header:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',zIndex:4},
 nativeHeader:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',zIndex:4},reviewHeader:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',zIndex:5},
 headerTitle:{alignItems:'center'},kicker:{color:'#dce3ea',fontSize:10,fontWeight:'900',letterSpacing:1.6},mode:{color:'#fff',fontSize:15,fontWeight:'900',letterSpacing:1},
 iconButton:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(0,0,0,.55)',alignItems:'center',justifyContent:'center'},icon:{color:'#fff',fontSize:25,fontWeight:'300'},
 iconSpacer:{width:42,height:42},autoBadge:{paddingHorizontal:12,paddingVertical:9,borderRadius:14,borderWidth:1,borderColor:'#b8ff5a',backgroundColor:'rgba(0,0,0,.55)'},autoText:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},
 nativeCenter:{flex:1,alignItems:'center',justifyContent:'center',paddingHorizontal:28},cardGuide:{width:'64%',aspectRatio:63/88,borderWidth:1,borderColor:'rgba(255,255,255,.38)',borderRadius:14,marginBottom:28},
 guideTL:{position:'absolute',left:-2,top:-2,width:30,height:30,borderLeftWidth:4,borderTopWidth:4,borderColor:'#fff',borderTopLeftRadius:12},guideTR:{position:'absolute',right:-2,top:-2,width:30,height:30,borderRightWidth:4,borderTopWidth:4,borderColor:'#fff',borderTopRightRadius:12},guideBR:{position:'absolute',right:-2,bottom:-2,width:30,height:30,borderRightWidth:4,borderBottomWidth:4,borderColor:'#fff',borderBottomRightRadius:12},guideBL:{position:'absolute',left:-2,bottom:-2,width:30,height:30,borderLeftWidth:4,borderBottomWidth:4,borderColor:'#fff',borderBottomLeftRadius:12},
 statusTitle:{color:'#fff',fontSize:19,fontWeight:'900',textAlign:'center'},statusCopy:{marginTop:8,color:'rgba(255,255,255,.76)',fontSize:13,lineHeight:19,textAlign:'center',maxWidth:350},error:{marginTop:12,color:'#ff8b8b',fontSize:13,fontWeight:'800',textAlign:'center'},
 result:{marginTop:14,padding:12,borderRadius:14,backgroundColor:'rgba(0,0,0,.62)',maxWidth:340},resultTitle:{color:'#fff',fontSize:15,fontWeight:'900',textAlign:'center'},candidate:{marginTop:6,padding:9,borderRadius:9,backgroundColor:'rgba(255,255,255,.08)'},candidateText:{color:'#fff',fontSize:11,textAlign:'center'},confirm:{marginTop:3,color:'#b8ff5a',fontSize:9,fontWeight:'900',textAlign:'center'},
 scanButton:{marginTop:22,minWidth:230,paddingHorizontal:24,paddingVertical:16,borderRadius:15,backgroundColor:'#b8ff5a',alignItems:'center'},scanButtonText:{color:'#10130c',fontWeight:'900',fontSize:14},disabled:{opacity:.45},freeNote:{marginTop:12,color:'rgba(255,255,255,.48)',fontSize:10,textAlign:'center'},
 secondary:{paddingHorizontal:14,paddingVertical:11,borderRadius:13,backgroundColor:'rgba(0,0,0,.55)'},secondaryText:{color:'#fff',fontWeight:'800',fontSize:11},title:{color:'#fff',fontSize:26,fontWeight:'900',textAlign:'center'},
 reviewFrame:{alignSelf:'center',marginTop:105,overflow:'visible',backgroundColor:'#101214',borderRadius:8},reviewOverlay:{...StyleSheet.absoluteFillObject},edgeReview:{position:'absolute',height:4,backgroundColor:'#b8ff5a',borderRadius:2},
 handle:{position:'absolute',width:30,height:30,borderRadius:15,backgroundColor:'rgba(0,0,0,.25)',alignItems:'center',justifyContent:'center'},handleDot:{width:18,height:18,borderRadius:9,backgroundColor:'#fff',borderWidth:2,borderColor:'#b8ff5a'},
 reviewTitle:{marginTop:34,color:'#fff',fontSize:20,fontWeight:'900',textAlign:'center'},reviewCopy:{marginTop:8,color:'rgba(255,255,255,.72)',fontSize:13,lineHeight:19,textAlign:'center',paddingHorizontal:30},confirmTop:{paddingHorizontal:13,paddingVertical:10,borderRadius:12,backgroundColor:'#b8ff5a'},confirmTopText:{fontSize:10,fontWeight:'900',color:'#10130c'}
});

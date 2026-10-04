import React,{useRef,useState} from 'react';
import {Platform,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {CameraView,useCameraPermissions,type CameraType} from 'expo-camera';
import type {CatalogCard,Game} from '../data/catalog';
import {recognizeCardImage,type RecognitionResult} from '../data/recognition';
import type {ProfessionalAnalysis,GradedItem,Condition} from '../data/store';
import type {VisualAnalysis} from '../data/visualGrading';

type Props={
  resumeGraded?:GradedItem;
  game?:Game;
  onExit?:()=>void;
  onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;
  onCardSelected?:(gradedId:string,card:CatalogCard)=>Promise<void>|void;
  onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;
  onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis,professionalAnalysis?:ProfessionalAnalysis)=>Promise<void>|void;
  onProfessionalAnalysis?:(gradedId:string,analysis:ProfessionalAnalysis)=>Promise<void>|void;
  onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;
  onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void;
};

type NativeScanner={launchAsync:()=>Promise<{uri:string}|null>};

function getNativeScanner():NativeScanner|null{
  if(Platform.OS!=='android')return null;
  try{return require('../../modules/cardgrade-document-scanner/src').default as NativeScanner}catch{return null}
}

export function ScannerScreen({onExit,onCaptured,game='pokemon'}:Props){
  const nativeScanner=useRef<NativeScanner|null>(null);
  const[permission,requestPermission]=useCameraPermissions();
  const[processing,setProcessing]=useState(false);
  const[recognition,setRecognition]=useState<RecognitionResult|null>(null);
  const[pendingUri,setPendingUri]=useState<string|null>(null);
  const[error,setError]=useState('');
  const[ready,setReady]=useState(false);
  const[camera,setCamera]=useState<CameraView|null>(null);

  const processScan=async(uri:string)=>{
    setProcessing(true);
    setError('');
    setRecognition(null);
    setPendingUri(uri);
    try{
      const result=await recognizeCardImage(uri,game);
      setRecognition(result);
      if(result.status==='matched'&&result.card)await onCaptured?.(uri,result.card);
    }catch{
      setError('Analisi della carta non riuscita. Riprova con una foto nitida.');
    }finally{setProcessing(false)}
  };

  const launchDocumentScanner=async()=>{
    if(processing)return;
    setProcessing(true);
    setError('');
    setRecognition(null);
    try{
      nativeScanner.current=nativeScanner.current||getNativeScanner();
      const scanner=nativeScanner.current;
      if(!scanner){
        setError('Scanner nativo non disponibile su questo dispositivo.');
        return;
      }
      const result=await scanner.launchAsync();
      if(result?.uri)await processScan(result.uri);
    }catch{
      setError('Impossibile avviare lo scanner. Riprova.');
    }finally{setProcessing(false)}
  };

  const manualCameraCapture=async()=>{
    if(!camera||processing)return;
    setProcessing(true);
    try{
      const photo=await camera.takePictureAsync({quality:1,skipProcessing:false});
      if(photo?.uri)await processScan(photo.uri);
    }catch{
      setError('Acquisizione non riuscita. Riprova.');
    }finally{setProcessing(false)}
  };

  if(Platform.OS==='android'){
    return <View style={styles.root}>
      <View style={styles.nativeHeader}>
        <TouchableOpacity style={styles.iconButton} onPress={onExit}><Text style={styles.icon}>×</Text></TouchableOpacity>
        <View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>SCANNER</Text></View>
        <View style={styles.iconSpacer}/>
      </View>
      <View style={styles.nativeCenter}>
        <View style={styles.cardGuide}><View style={styles.guideTL}/><View style={styles.guideTR}/><View style={styles.guideBR}/><View style={styles.guideBL}/></View>
        <Text style={styles.statusTitle}>{processing?'Elaborazione…':'Posiziona la carta nell’inquadratura'}</Text>
        <Text style={styles.statusCopy}>Lo scanner rileva automaticamente i 4 bordi, corregge la prospettiva e acquisisce la carta.</Text>
        {error?<Text style={styles.error}>{error}</Text>:null}
        {recognition?<View style={styles.result}>
          <Text style={styles.resultTitle}>{recognition.status==='matched'&&recognition.card?recognition.card.name:recognition.status==='possible'?'Possibile corrispondenza':'Carta non riconosciuta'}</Text>
          {recognition.status==='possible'&&pendingUri&&recognition.candidates.slice(0,3).map((card,i)=><TouchableOpacity key={card.id} style={styles.candidate} onPress={()=>void(async()=>{setRecognition({...recognition,status:'matched',card,confidence:Math.max(.84,recognition.confidence),margin:Math.max(.14,recognition.margin)});await onCaptured?.(pendingUri,card)})()}>
            <Text style={styles.candidateText}>{i+1}. {card.name}{card.number?' · '+card.number:''}{card.language?' · '+card.language:''}</Text>
            <Text style={styles.confirm}>SELEZIONA</Text>
          </TouchableOpacity>)}
        </View>:null}
        <TouchableOpacity disabled={processing} style={[styles.scanButton,processing&&styles.disabled]} onPress={()=>void launchDocumentScanner()}>
          <Text style={styles.scanButtonText}>{processing?'ELABORAZIONE…':'SCANSIONA CARTA'}</Text>
        </TouchableOpacity>
        <Text style={styles.freeNote}>Scanner nativo Android · acquisizione automatica · correzione prospettica</Text>
      </View>
    </View>;
  }

  if(!permission)return<View style={styles.center}><Text style={styles.statusCopy}>Preparazione fotocamera…</Text></View>;
  if(!permission.granted)return<View style={styles.center}><Text style={styles.title}>Fotocamera necessaria</Text><Text style={styles.statusCopy}>CARDGRADE usa la fotocamera per acquisire la carta.</Text><TouchableOpacity style={styles.scanButton} onPress={()=>void requestPermission()}><Text style={styles.scanButtonText}>CONSENTI FOTOCAMERA</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={onExit}><Text style={styles.secondaryText}>TORNA ALL'APP</Text></TouchableOpacity></View>;

  return <View style={styles.root}>
    <CameraView ref={setCamera} style={StyleSheet.absoluteFill} facing={'back' as CameraType} mode="picture" animateShutter={false} onCameraReady={()=>setReady(true)}/>
    <View style={styles.scrim}/>
    <View style={styles.header}><TouchableOpacity style={styles.iconButton} onPress={onExit}><Text style={styles.icon}>×</Text></TouchableOpacity><View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>SCANNER</Text></View><View style={styles.iconSpacer}/></View>
    <View style={styles.nativeCenter}><Text style={styles.statusTitle}>{processing?'Elaborazione…':ready?'Posiziona la carta e premi SCANSIONA':'Preparazione fotocamera…'}</Text><TouchableOpacity disabled={!ready||processing} style={[styles.scanButton,(!ready||processing)&&styles.disabled]} onPress={()=>void manualCameraCapture()}><Text style={styles.scanButtonText}>SCANSIONA CARTA</Text></TouchableOpacity></View>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#050608'},
  center:{flex:1,backgroundColor:'#050608',alignItems:'center',justifyContent:'center',padding:28},
  scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.12)'},
  header:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  nativeHeader:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',zIndex:3},
  headerTitle:{alignItems:'center'},
  kicker:{color:'#dce3ea',fontSize:10,fontWeight:'900',letterSpacing:1.6},
  mode:{color:'#fff',fontSize:15,fontWeight:'900',letterSpacing:1},
  iconButton:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(0,0,0,.55)',alignItems:'center',justifyContent:'center'},
  iconSpacer:{width:42,height:42},
  icon:{color:'#fff',fontSize:25,fontWeight:'300'},
  nativeCenter:{flex:1,alignItems:'center',justifyContent:'center',paddingHorizontal:28},
  cardGuide:{width:'64%',aspectRatio:63/88,borderWidth:1,borderColor:'rgba(255,255,255,.38)',borderRadius:14,marginBottom:28},
  guideTL:{position:'absolute',left:-2,top:-2,width:30,height:30,borderLeftWidth:4,borderTopWidth:4,borderColor:'#fff',borderTopLeftRadius:12},
  guideTR:{position:'absolute',right:-2,top:-2,width:30,height:30,borderRightWidth:4,borderTopWidth:4,borderColor:'#fff',borderTopRightRadius:12},
  guideBR:{position:'absolute',right:-2,bottom:-2,width:30,height:30,borderRightWidth:4,borderBottomWidth:4,borderColor:'#fff',borderBottomRightRadius:12},
  guideBL:{position:'absolute',left:-2,bottom:-2,width:30,height:30,borderLeftWidth:4,borderBottomWidth:4,borderColor:'#fff',borderBottomLeftRadius:12},
  statusTitle:{color:'#fff',fontSize:19,fontWeight:'900',textAlign:'center'},
  statusCopy:{marginTop:8,color:'rgba(255,255,255,.76)',fontSize:13,lineHeight:19,textAlign:'center',maxWidth:350},
  error:{marginTop:12,color:'#ff8b8b',fontSize:13,fontWeight:'800',textAlign:'center'},
  result:{marginTop:14,padding:12,borderRadius:14,backgroundColor:'rgba(0,0,0,.62)',maxWidth:340},
  resultTitle:{color:'#fff',fontSize:15,fontWeight:'900',textAlign:'center'},
  candidate:{marginTop:6,padding:9,borderRadius:9,backgroundColor:'rgba(255,255,255,.08)'},
  candidateText:{color:'#fff',fontSize:11,textAlign:'center'},
  confirm:{marginTop:3,color:'#b8ff5a',fontSize:9,fontWeight:'900',textAlign:'center'},
  scanButton:{marginTop:22,minWidth:230,paddingHorizontal:24,paddingVertical:16,borderRadius:15,backgroundColor:'#b8ff5a',alignItems:'center'},
  scanButtonText:{color:'#10130c',fontWeight:'900',fontSize:14},
  disabled:{opacity:.45},
  freeNote:{marginTop:12,color:'rgba(255,255,255,.48)',fontSize:10,textAlign:'center'},
  secondary:{marginTop:16,paddingHorizontal:18,paddingVertical:12,borderRadius:13,backgroundColor:'rgba(0,0,0,.55)'},
  secondaryText:{color:'#fff',fontWeight:'800',fontSize:12},
  title:{color:'#fff',fontSize:26,fontWeight:'900',textAlign:'center'}
});

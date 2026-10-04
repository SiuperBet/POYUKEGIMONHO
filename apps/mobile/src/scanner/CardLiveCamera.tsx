import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {Camera,useCameraDevice,useCameraPermission,usePhotoOutput} from 'react-native-vision-camera';

type Props={
  onCaptured:(uri:string)=>void|Promise<void>;
  onCancel:()=>void;
};

export function CardLiveCamera({onCaptured,onCancel}:Props){
  const device=useCameraDevice('back',{physicalDevices:['wide-angle']});
  const {hasPermission,requestPermission}=useCameraPermission();
  const photoOutput=usePhotoOutput({qualityPrioritization:'quality',quality:0.95});
  const [busy,setBusy]=useState(false);
  const [started,setStarted]=useState(false);
  const [cameraError,setCameraError]=useState<string|null>(null);
  const mounted=useRef(true);

  useEffect(()=>()=>{mounted.current=false},[]);
  useEffect(()=>{
    if(!hasPermission) void requestPermission();
  },[hasPermission,requestPermission]);

  const capture=async()=>{
    if(busy||!started)return;
    setBusy(true);
    setCameraError(null);
    try{
      const file=await photoOutput.capturePhotoToFile({flashMode:'off'}, {});
      const uri=file.filePath.startsWith('file://')?file.filePath:'file://'+file.filePath;
      await onCaptured(uri);
    }catch(error){
      if(mounted.current)setCameraError('Scatto non riuscito. Mantieni ferma la carta e riprova.');
    }finally{
      if(mounted.current)setBusy(false);
    }
  };

  if(!hasPermission){
    return <View style={styles.root}><View style={styles.center}><Text style={styles.title}>Accesso alla fotocamera</Text><Text style={styles.copy}>CARDGRADE usa la fotocamera solo durante la scansione della carta.</Text><TouchableOpacity style={styles.primary} onPress={()=>void requestPermission()}><Text style={styles.primaryText}>CONSENTI FOTOCAMERA</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>ANNULLA</Text></TouchableOpacity></View></View>;
  }

  if(!device){
    return <View style={styles.root}><View style={styles.center}><Text style={styles.title}>Fotocamera non disponibile</Text><Text style={styles.copy}>Non è stato rilevato un dispositivo camera posteriore.</Text><TouchableOpacity style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>INDIETRO</Text></TouchableOpacity></View></View>;
  }

  return <View style={styles.root}>
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      outputs={[photoOutput]}
      isActive={true}
      resizeMode="cover"
      implementationMode="performance"
      onPreviewStarted={()=>setStarted(true)}
      onError={(error)=>{setStarted(false);setCameraError('Errore fotocamera: '+error.message)}}
    />
    <View pointerEvents="none" style={styles.dim}/>
    <View pointerEvents="none" style={styles.frame}>
      <View style={[styles.edge,styles.top]}/><View style={[styles.edge,styles.right]}/><View style={[styles.edge,styles.bottom]}/><View style={[styles.edge,styles.left]}/>
      <View style={[styles.corner,styles.tl]}/><View style={[styles.corner,styles.tr]}/><View style={[styles.corner,styles.br]}/><View style={[styles.corner,styles.bl]}/>
    </View>
    <View style={styles.topBar}>
      <View><Text style={styles.kicker}>CARDGRADE • SCANNER</Text><Text style={styles.status}>{started?'Inquadra la carta':'Avvio fotocamera…'}</Text></View>
      <TouchableOpacity style={styles.close} onPress={onCancel}><Text style={styles.closeText}>×</Text></TouchableOpacity>
    </View>
    <View style={styles.hint}><Text style={styles.hintText}>Mantieni visibili tutti e 4 i lati della carta</Text></View>
    {cameraError&&<View style={styles.error}><Text style={styles.errorText}>{cameraError}</Text></View>}
    <View style={styles.bottom}>
      <TouchableOpacity disabled={busy||!started} style={[styles.shutter,!started&&styles.shutterDisabled]} onPress={()=>void capture()}>
        {busy?<ActivityIndicator color="#111" size="small"/>:<View style={styles.shutterInner}/>}
      </TouchableOpacity>
      <Text style={styles.captureLabel}>{busy?'ACQUISIZIONE…':'SCATTA'}</Text>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{...StyleSheet.absoluteFillObject,backgroundColor:'#000',zIndex:1000},
  center:{flex:1,justifyContent:'center',alignItems:'center',padding:28},
  title:{color:'#fff',fontSize:22,fontWeight:'800',textAlign:'center',marginBottom:10},
  copy:{color:'#c9c9c9',fontSize:15,lineHeight:22,textAlign:'center',marginBottom:24},
  primary:{paddingHorizontal:20,paddingVertical:14,borderRadius:12,backgroundColor:'#d7ff52'},
  primaryText:{color:'#101010',fontWeight:'900'},
  secondary:{marginTop:12,paddingHorizontal:20,paddingVertical:12},
  secondaryText:{color:'#fff',fontWeight:'800'},
  dim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.12)'},
  frame:{position:'absolute',left:'9%',right:'9%',top:'17%',bottom:'22%'},
  edge:{position:'absolute',backgroundColor:'#d7ff52',borderRadius:3},
  top:{left:0,right:0,top:0,height:3},right:{right:0,top:0,bottom:0,width:3},bottom:{left:0,right:0,bottom:0,height:3},left:{left:0,top:0,bottom:0,width:3},
  corner:{position:'absolute',backgroundColor:'#fff'},
  tl:{left:0,top:0,width:26,height:4},tr:{right:0,top:0,width:26,height:4},br:{right:0,bottom:0,width:26,height:4},bl:{left:0,bottom:0,width:26,height:4},
  topBar:{position:'absolute',top:0,left:0,right:0,paddingTop:52,paddingHorizontal:20,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},
  kicker:{color:'#d7ff52',fontSize:10,fontWeight:'900',letterSpacing:1.2},status:{color:'#fff',fontSize:17,fontWeight:'800',marginTop:4},
  close:{width:44,height:44,borderRadius:22,backgroundColor:'rgba(0,0,0,.55)',alignItems:'center',justifyContent:'center'},closeText:{color:'#fff',fontSize:30,lineHeight:32,fontWeight:'300'},
  hint:{position:'absolute',top:'10%',left:20,right:20,alignItems:'center'},hintText:{color:'#fff',fontSize:13,fontWeight:'700',textAlign:'center',backgroundColor:'rgba(0,0,0,.48)',paddingHorizontal:14,paddingVertical:8,borderRadius:16},
  error:{position:'absolute',left:20,right:20,bottom:150,backgroundColor:'rgba(120,0,0,.82)',borderRadius:12,padding:12},errorText:{color:'#fff',fontWeight:'700',textAlign:'center'},
  bottom:{position:'absolute',left:0,right:0,bottom:28,alignItems:'center'},shutter:{width:78,height:78,borderRadius:39,backgroundColor:'#fff',alignItems:'center',justifyContent:'center',borderWidth:5,borderColor:'rgba(215,255,82,.9)'},shutterDisabled:{opacity:.45},shutterInner:{width:60,height:60,borderRadius:30,backgroundColor:'#fff'},captureLabel:{color:'#fff',fontSize:11,fontWeight:'900',letterSpacing:1.5,marginTop:8}
});

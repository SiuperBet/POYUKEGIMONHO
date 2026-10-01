import React,{useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {Camera,useCameraDevice,useCameraPermission} from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';

export function ScannerScreen(){
  const device=useCameraDevice('back');
  const {hasPermission,requestPermission}=useCameraPermission();
  const camera=useRef<Camera>(null);
  const [torch,setTorch]=useState(false);
  const [zoom,setZoom]=useState(0);
  const [ready,setReady]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [message,setMessage]=useState('Inquadra una carta');

  useEffect(()=>{if(!hasPermission)void requestPermission()},[hasPermission,requestPermission]);

  if(!hasPermission)return <View style={styles.center}><Text style={styles.title}>Fotocamera necessaria</Text><Text style={styles.copy}>Concedi l'accesso per usare lo scanner nativo.</Text><TouchableOpacity style={styles.primary} onPress={()=>void requestPermission()}><Text style={styles.primaryText}>Consenti fotocamera</Text></TouchableOpacity></View>;
  if(!device)return <View style={styles.center}><Text style={styles.title}>Camera non disponibile</Text></View>;

  const capture=async()=>{
    if(!camera.current||processing)return;
    setProcessing(true);setMessage('Acquisizione…');
    try{await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);const photo=await camera.current.takePhoto({enableShutterSound:false,flash:torch?'on':'off'});console.log('POYUKEGIMONHO_CAPTURE',photo.path);setMessage('Acquisita • detection → crop → recognition');}
    catch{setMessage('Acquisizione non riuscita')}
    finally{setTimeout(()=>{setProcessing(false);setMessage('Inquadra una carta')},900)}
  };

  const actualZoom=device.minZoom+(device.maxZoom-device.minZoom)*zoom;
  return <View style={styles.root}>
    <Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive photo torch={torch?'on':'off'} zoom={actualZoom} onInitialized={()=>setReady(true)}/>
    <View style={styles.scrim}/>
    <View style={styles.top}><View style={styles.pill}><Text style={styles.pillText}>{ready?'● Camera pronta':'● Avvio camera'}</Text></View><View style={styles.pill}><Text style={styles.pillText}>NATIVE • AUTO</Text></View></View>
    <View style={styles.target}><View style={[styles.corner,styles.tl]}/><View style={[styles.corner,styles.tr]}/><View style={[styles.corner,styles.br]}/><View style={[styles.corner,styles.bl]}/><Text style={styles.hint}>{message}</Text></View>
    <View style={styles.bottom}>
      <TouchableOpacity style={styles.side} onPress={()=>setTorch(v=>!v)}><Text style={styles.sideText}>{torch?'☀︎':'☼'}{String.fromCharCode(10)}LUCE</Text></TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Scatta" disabled={processing} style={[styles.shutter,processing&&styles.disabled]} onPress={capture}><View style={styles.shutterInner}/></TouchableOpacity>
      <TouchableOpacity style={styles.side} onPress={()=>setZoom(v=>v>=.66?0:v+.33)}><Text style={styles.sideText}>{zoom===0?'1×':zoom<.66?'2×':'3×'}{String.fromCharCode(10)}ZOOM</Text></TouchableOpacity>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#050608'},scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.12)'},
  center:{flex:1,backgroundColor:'#0b0d10',alignItems:'center',justifyContent:'center',padding:28},title:{color:'#f5f7fa',fontSize:24,fontWeight:'800',textAlign:'center'},copy:{color:'#9aa3af',fontSize:15,textAlign:'center',marginTop:10,marginBottom:22},
  primary:{backgroundColor:'#b8ff5a',paddingHorizontal:18,paddingVertical:13,borderRadius:14},primaryText:{color:'#10130c',fontWeight:'800'},
  top:{position:'absolute',top:54,left:18,right:18,flexDirection:'row',justifyContent:'space-between'},pill:{paddingHorizontal:11,paddingVertical:8,borderRadius:99,backgroundColor:'rgba(8,10,13,.72)',borderWidth:1,borderColor:'rgba(255,255,255,.14)'},pillText:{color:'#fff',fontSize:11,fontWeight:'800'},
  target:{position:'absolute',left:'12%',right:'12%',top:'21%',bottom:'25%',borderWidth:2,borderColor:'#b8ff5a',borderRadius:14,alignItems:'center',justifyContent:'flex-end'},
  corner:{position:'absolute',width:30,height:30,borderColor:'#b8ff5a'},tl:{left:-2,top:-2,borderLeftWidth:4,borderTopWidth:4,borderTopLeftRadius:10},tr:{right:-2,top:-2,borderRightWidth:4,borderTopWidth:4,borderTopRightRadius:10},br:{right:-2,bottom:-2,borderRightWidth:4,borderBottomWidth:4,borderBottomRightRadius:10},bl:{left:-2,bottom:-2,borderLeftWidth:4,borderBottomWidth:4,borderBottomLeftRadius:10},
  hint:{marginBottom:16,color:'#fff',fontWeight:'800',fontSize:13,backgroundColor:'rgba(8,10,13,.72)',paddingHorizontal:12,paddingVertical:8,borderRadius:99},
  bottom:{position:'absolute',left:0,right:0,bottom:38,flexDirection:'row',alignItems:'center',justifyContent:'space-evenly'},side:{width:72,height:58,alignItems:'center',justifyContent:'center'},sideText:{color:'#fff',fontSize:11,fontWeight:'800',textAlign:'center',lineHeight:17},
  shutter:{width:78,height:78,borderRadius:39,borderWidth:5,borderColor:'#fff',backgroundColor:'#b8ff5a',alignItems:'center',justifyContent:'center'},shutterInner:{width:60,height:60,borderRadius:30,borderWidth:2,borderColor:'#10130c'},disabled:{opacity:.55}
});
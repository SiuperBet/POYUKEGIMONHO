import React,{useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View,Image} from 'react-native';
import {DeviceMotion} from 'expo-sensors';
import {Camera,useCameraDevice,useCameraPermission} from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import DocumentScanner from 'react-native-document-scanner-plugin';

type MotionState={available:boolean;roll:number;movement:number};

type Props={onCaptured?:(uri:string)=>void};

export function ScannerScreen({onCaptured}:Props){
  const device=useCameraDevice('back');
  const {hasPermission,requestPermission}=useCameraPermission();
  const camera=useRef<Camera>(null);
  const [torch,setTorch]=useState(false);
  const [zoom,setZoom]=useState(0);
  const [ready,setReady]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [message,setMessage]=useState('Inquadra una carta');
  const [motion,setMotion]=useState<MotionState>({available:false,roll:0,movement:0});
  const [lastPhoto,setLastPhoto]=useState<string|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [scannerOpen,setScannerOpen]=useState(false);

  useEffect(()=>{if(!hasPermission)void requestPermission()},[hasPermission,requestPermission]);

  useEffect(()=>{
    DeviceMotion.setUpdateInterval(100);
    const subscription=DeviceMotion.addListener(({rotation,rotationRate})=>{
      const roll=Math.abs(rotation?.gamma??0);
      const movement=rotationRate?Math.hypot(rotationRate.alpha,rotationRate.beta,rotationRate.gamma):0;
      setMotion({available:true,roll,movement});
    });
    return()=>subscription.remove();
  },[]);

  if(!hasPermission)return <View style={styles.center}><Text style={styles.title}>Fotocamera necessaria</Text><Text style={styles.copy}>Concedi l'accesso per usare lo scanner nativo.</Text><TouchableOpacity style={styles.primary} onPress={()=>void requestPermission()}><Text style={styles.primaryText}>Consenti fotocamera</Text></TouchableOpacity></View>;
  if(!device)return <View style={styles.center}><Text style={styles.title}>Camera non disponibile</Text></View>;

  const levelOk=!motion.available||(motion.roll<=6&&motion.movement<8);
  const levelLabel=!motion.available?'Bolla — sensore n/d':levelOk?'Bolla OK':motion.movement>=8?'Ferma il telefono':'Allinea '+motion.roll.toFixed(0)+'°';
  const targetColor=levelOk?'#b8ff5a':motion.roll>12?'#ff6b6b':'#ffd166';

  const capture=async()=>{
    if(!camera.current||processing)return;
    if(motion.available&&!levelOk){
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setMessage('Stabilizza il telefono prima dello scatto');
      return;
    }
    setProcessing(true);setMessage('Acquisizione…');
    try{
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo=await camera.current.takePhoto({enableShutterSound:false,flash:torch?'on':'off'});
      const uri=photo.path.startsWith('file://')?photo.path:'file://'+photo.path;
      setLastPhoto(uri);setConfirmed(false);setMessage('Controlla l’acquisizione');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }catch{
      setMessage('Acquisizione non riuscita');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }finally{setProcessing(false)}
  };

  const retry=()=>{setLastPhoto(null);setConfirmed(false);setMessage('Inquadra una carta')};

  const smartScan=async()=>{
    if(scannerOpen)return;
    setScannerOpen(true);setMessage('Rilevamento bordi…');
    try{
      const result=await DocumentScanner.scanDocument({maxNumDocuments:1});
      const scanned=result.scannedImages?.[0];
      if(scanned){
        const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;
        setLastPhoto(uri);setConfirmed(true);setMessage('Carta rilevata e ritagliata');
        onCaptured?.(uri);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }else setMessage('Nessuna carta acquisita');
    }catch(error){
      const text=String(error??'').toLowerCase();
      setMessage(text.includes('cancel')?'Scansione annullata':'Scanner automatico non disponibile');
    }finally{setScannerOpen(false)}
  };
  const confirm=()=>{setConfirmed(true);setMessage('Acquisita • pronta per detection → crop → recognition')};
  const actualZoom=device.minZoom+(device.maxZoom-device.minZoom)*zoom;

  return <View style={styles.root}>
    <Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive={!scannerOpen&&!lastPhoto} photo photoQualityBalance="quality" torch={torch?'on':'off'} zoom={actualZoom} onInitialized={()=>setReady(true)}/>
    <View style={styles.scrim}/>
    <View style={styles.top}>
      <View style={styles.pill}><Text style={styles.pillText}>{ready?'● Camera pronta':'● Avvio camera'}</Text></View>
      <View style={styles.pill}><Text style={styles.pillText}>{levelLabel}</Text></View>
    </View>
    <View style={[styles.target,{borderColor:targetColor}]}>
      <View style={[styles.corner,styles.tl,{borderColor:targetColor}]}/><View style={[styles.corner,styles.tr,{borderColor:targetColor}]}/><View style={[styles.corner,styles.br,{borderColor:targetColor}]}/><View style={[styles.corner,styles.bl,{borderColor:targetColor}]}/>
      <Text style={styles.hint}>{message}</Text>
    </View>
    {lastPhoto&&<View style={styles.review}>
      <Image source={{uri:lastPhoto}} style={styles.reviewImage} resizeMode="contain"/>
      <View style={styles.reviewPanel}>
        <Text style={styles.reviewTitle}>{confirmed?'Acquisizione confermata':'Verifica la foto'}</Text>
        <Text style={styles.reviewCopy}>{confirmed?'La foto è pronta per il pipeline condiviso.':'Controlla bordi, riflessi e nitidezza prima di continuare.'}</Text>
        <View style={styles.reviewActions}>
          <TouchableOpacity style={styles.secondary} onPress={retry}><Text style={styles.secondaryText}>Riprova</Text></TouchableOpacity>
          {!confirmed&&<TouchableOpacity style={styles.primary} onPress={confirm}><Text style={styles.primaryText}>Usa foto</Text></TouchableOpacity>}
        </View>
      </View>
    </View>}
    <TouchableOpacity style={styles.smartButton} onPress={()=>void smartScan()} disabled={scannerOpen||!!lastPhoto}><Text style={styles.smartText}>{scannerOpen?'RILEVAMENTO…':'RILEVA BORDI AUTOMATICAMENTE'}</Text></TouchableOpacity>
    <View style={styles.bottom}>
      <TouchableOpacity style={styles.side} onPress={()=>setTorch(v=>!v)}><Text style={styles.sideText}>{torch?'☀︎':'☼'}{String.fromCharCode(10)}LUCE</Text></TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Scatta" disabled={processing||!!lastPhoto} style={[styles.shutter,(processing||lastPhoto)&&styles.disabled]} onPress={capture}><View style={styles.shutterInner}/></TouchableOpacity>
      <TouchableOpacity style={styles.side} onPress={()=>setZoom(v=>v>=.66?0:v+.33)}><Text style={styles.sideText}>{zoom===0?'1×':zoom<.66?'2×':'3×'}{String.fromCharCode(10)}ZOOM</Text></TouchableOpacity>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#050608'},scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.12)'},
  center:{flex:1,backgroundColor:'#0b0d10',alignItems:'center',justifyContent:'center',padding:28},title:{color:'#f5f7fa',fontSize:24,fontWeight:'800',textAlign:'center'},copy:{color:'#9aa3af',fontSize:15,textAlign:'center',marginTop:10,marginBottom:22},
  primary:{backgroundColor:'#b8ff5a',paddingHorizontal:18,paddingVertical:13,borderRadius:14},primaryText:{color:'#10130c',fontWeight:'800'},
  secondary:{backgroundColor:'#1a1e24',paddingHorizontal:18,paddingVertical:13,borderRadius:14,borderWidth:1,borderColor:'#2a3038'},secondaryText:{color:'#f5f7fa',fontWeight:'800'},
  top:{position:'absolute',top:54,left:18,right:18,flexDirection:'row',justifyContent:'space-between'},pill:{paddingHorizontal:11,paddingVertical:8,borderRadius:99,backgroundColor:'rgba(8,10,13,.72)',borderWidth:1,borderColor:'rgba(255,255,255,.14)'},pillText:{color:'#fff',fontSize:11,fontWeight:'800'},
  target:{position:'absolute',left:'12%',right:'12%',top:'21%',bottom:'25%',borderWidth:2,borderRadius:14,alignItems:'center',justifyContent:'flex-end'},
  corner:{position:'absolute',width:30,height:30},tl:{left:-2,top:-2,borderLeftWidth:4,borderTopWidth:4,borderTopLeftRadius:10},tr:{right:-2,top:-2,borderRightWidth:4,borderTopWidth:4,borderTopRightRadius:10},br:{right:-2,bottom:-2,borderRightWidth:4,borderBottomWidth:4,borderBottomRightRadius:10},bl:{left:-2,bottom:-2,borderLeftWidth:4,borderBottomWidth:4,borderBottomLeftRadius:10},
  hint:{marginBottom:16,color:'#fff',fontWeight:'800',fontSize:13,backgroundColor:'rgba(8,10,13,.72)',paddingHorizontal:12,paddingVertical:8,borderRadius:99},
  review:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(5,6,8,.94)',paddingTop:92,paddingHorizontal:18,paddingBottom:150},reviewImage:{flex:1,width:'100%',borderRadius:18},reviewPanel:{marginTop:12,padding:16,borderRadius:18,backgroundColor:'#14171c',borderWidth:1,borderColor:'#2a3038'},reviewTitle:{color:'#f5f7fa',fontSize:18,fontWeight:'800'},reviewCopy:{color:'#9aa3af',fontSize:13,lineHeight:19,marginTop:6},reviewActions:{flexDirection:'row',gap:10,marginTop:14},
  smartButton:{position:'absolute',left:24,right:24,bottom:122,height:46,borderRadius:14,backgroundColor:'#b8ff5a',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#d8ff9c'},smartText:{color:'#10130c',fontWeight:'900',fontSize:12,letterSpacing:.4},
  bottom:{position:'absolute',left:0,right:0,bottom:38,flexDirection:'row',alignItems:'center',justifyContent:'space-evenly'},side:{width:72,height:58,alignItems:'center',justifyContent:'center'},sideText:{color:'#fff',fontSize:11,fontWeight:'800',textAlign:'center',lineHeight:17},
  shutter:{width:78,height:78,borderRadius:39,borderWidth:5,borderColor:'#fff',backgroundColor:'#b8ff5a',alignItems:'center',justifyContent:'center'},shutterInner:{width:60,height:60,borderRadius:30,borderWidth:2,borderColor:'#10130c'},disabled:{opacity:.55}
});
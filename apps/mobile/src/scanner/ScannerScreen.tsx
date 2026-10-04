import React,{useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {CameraView,useCameraPermissions,type CameraType} from 'expo-camera';
import type {CatalogCard} from '../data/catalog';
import type {ProfessionalAnalysis,GradedItem,Condition} from '../data/store';
import type {VisualAnalysis} from '../data/visualGrading';

type Props={
  resumeGraded?:GradedItem;
  onExit?:()=>void;
  onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;
  onCardSelected?:(gradedId:string,card:CatalogCard)=>Promise<void>|void;
  onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;
  onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis,professionalAnalysis?:ProfessionalAnalysis)=>Promise<void>|void;
  onProfessionalAnalysis?:(gradedId:string,analysis:ProfessionalAnalysis)=>Promise<void>|void;
  onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;
  onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void;
};

export function ScannerScreen({onExit}:Props){
  const [permission,requestPermission]=useCameraPermissions();
  const [facing,setFacing]=useState<CameraType>('back');
  const [torch,setTorch]=useState(false);
  const [ready,setReady]=useState(false);
  const camera=useRef<CameraView>(null);

  useEffect(()=>{if(!permission) return; if(!permission.granted) void requestPermission();},[permission,requestPermission]);

  if(!permission){
    return <View style={styles.center}><Text style={styles.copy}>Preparazione fotocamera…</Text></View>;
  }
  if(!permission.granted){
    return <View style={styles.center}>
      <Text style={styles.title}>Fotocamera necessaria</Text>
      <Text style={styles.copy}>CARDGRADE usa la fotocamera solo per acquisire la carta.</Text>
      <TouchableOpacity style={styles.primary} onPress={()=>void requestPermission()}><Text style={styles.primaryText}>CONSENTI FOTOCAMERA</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={onExit}><Text style={styles.secondaryText}>TORNA ALL'APP</Text></TouchableOpacity>
    </View>;
  }

  return <View style={styles.root}>
    <CameraView
      ref={camera}
      style={StyleSheet.absoluteFill}
      facing={facing}
      enableTorch={torch}
      onCameraReady={()=>setReady(true)}
    />

    <View style={styles.scrim} pointerEvents="none"/>
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconButton} onPress={onExit}><Text style={styles.icon}>×</Text></TouchableOpacity>
      <View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>SCANNER</Text></View>
      <TouchableOpacity style={styles.iconButton} onPress={()=>setTorch(v=>!v)}><Text style={styles.icon}>{torch?'☼':'◌'}</Text></TouchableOpacity>
    </View>

    <View style={styles.guide} pointerEvents="none">
      <View style={styles.cardGuide}/>
      <Text style={styles.guideTitle}>Inquadra la carta</Text>
      <Text style={styles.guideCopy}>{ready?'Mantieni la carta interamente dentro la guida':'Avvio fotocamera…'}</Text>
    </View>

    <View style={styles.footer}>
      <TouchableOpacity style={styles.secondary} onPress={()=>setFacing(v=>v==='back'?'front':'back')}>
        <Text style={styles.secondaryText}>CAMBIA</Text>
      </TouchableOpacity>
      <TouchableOpacity
        disabled={!ready}
        style={[styles.shutter,!ready&&styles.shutterDisabled]}
        onPress={async()=>{
          const result=await camera.current?.takePictureAsync({quality:1,skipProcessing:false});
          if(result?.uri) await onCaptured?.(result.uri);
        }}
      >
        <View style={styles.shutterInner}/>
      </TouchableOpacity>
      <View style={styles.sidePlaceholder}/>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#000'},
  center:{flex:1,backgroundColor:'#07090c',alignItems:'center',justifyContent:'center',padding:28},
  scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.18)'},
  header:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  headerTitle:{alignItems:'center'},
  kicker:{color:'#dce3ea',fontSize:10,fontWeight:'900',letterSpacing:1.6},
  mode:{color:'#fff',fontSize:15,fontWeight:'900',letterSpacing:1},
  iconButton:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(0,0,0,.48)',alignItems:'center',justifyContent:'center'},
  icon:{color:'#fff',fontSize:25,fontWeight:'300'},
  guide:{position:'absolute',left:24,right:24,top:'18%',bottom:'24%',alignItems:'center',justifyContent:'center'},
  cardGuide:{width:'76%',aspectRatio:63/88,borderWidth:2,borderColor:'rgba(255,255,255,.8)',borderRadius:12,backgroundColor:'rgba(255,255,255,.035)'},
  guideTitle:{marginTop:18,color:'#fff',fontSize:18,fontWeight:'900'},
  guideCopy:{marginTop:6,color:'rgba(255,255,255,.75)',fontSize:13,textAlign:'center'},
  footer:{position:'absolute',left:24,right:24,bottom:28,height:88,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  shutter:{width:76,height:76,borderRadius:38,borderWidth:5,borderColor:'#fff',alignItems:'center',justifyContent:'center'},
  shutterDisabled:{opacity:.4},
  shutterInner:{width:58,height:58,borderRadius:29,backgroundColor:'#fff'},
  sidePlaceholder:{width:82},
  primary:{marginTop:20,paddingHorizontal:22,paddingVertical:15,borderRadius:14,backgroundColor:'#b8ff5a'},
  primaryText:{color:'#10130c',fontWeight:'900'},
  secondary:{paddingHorizontal:18,paddingVertical:12,borderRadius:13,backgroundColor:'rgba(0,0,0,.55)',minWidth:82,alignItems:'center'},
  secondaryText:{color:'#fff',fontWeight:'800',fontSize:12},
  title:{color:'#fff',fontSize:28,fontWeight:'900',textAlign:'center'},
  copy:{color:'#9aa3af',fontSize:15,lineHeight:22,textAlign:'center',maxWidth:340,marginTop:10}
});

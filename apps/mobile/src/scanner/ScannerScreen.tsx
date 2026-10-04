import React,{useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,useWindowDimensions,View} from 'react-native';
import {CameraView,useCameraPermissions,type CameraType} from 'expo-camera';
import {detectCardGeometry,type CardQuad,type Point} from './cardGeometry';
import type {CatalogCard} from '../data/catalog';
import type {ProfessionalAnalysis,GradedItem,Condition} from '../data/store';
import type {VisualAnalysis} from '../data/visualGrading';

type Props={
  resumeGraded?:GradedItem; onExit?:()=>void;
  onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;
  onCardSelected?:(gradedId:string,card:CatalogCard)=>Promise<void>|void;
  onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;
  onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis,professionalAnalysis?:ProfessionalAnalysis)=>Promise<void>|void;
  onProfessionalAnalysis?:(gradedId:string,analysis:ProfessionalAnalysis)=>Promise<void>|void;
  onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;
  onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void;
};

const CORNER_DELTA=.045,STABLE_FRAMES=3,GOOD_CONFIDENCE=.58;
function avgCornerDelta(a:CardQuad,b:CardQuad){const A=[a.topLeft,a.topRight,a.bottomRight,a.bottomLeft],B=[b.topLeft,b.topRight,b.bottomRight,b.bottomLeft];return A.reduce((s,p,i)=>s+Math.hypot(p.x-B[i].x,p.y-B[i].y),0)/4;}
function lineStyle(a:Point,b:Point,width:number,height:number){const x1=a.x*width,y1=a.y*height,x2=b.x*width,y2=b.y*height,len=Math.hypot(x2-x1,y2-y1),angle=Math.atan2(y2-y1,x2-x1)*180/Math.PI;return {left:(x1+x2-len)/2,top:(y1+y2-3)/2,width:len,transform:[{rotate:angle+'deg'}]};}
function cornerStyle(p:Point,width:number,height:number){return {left:p.x*width-6,top:p.y*height-6};}

export function ScannerScreen({onExit,onCaptured}:Props){
  const {width,height}=useWindowDimensions();
  const [permission,requestPermission]=useCameraPermissions();
  const [facing,setFacing]=useState<CameraType>('back');
  const [torch,setTorch]=useState(false);
  const [ready,setReady]=useState(false);
  const [quad,setQuad]=useState<CardQuad|null>(null);
  const [valid,setValid]=useState(false);
  const [confidence,setConfidence]=useState(0);
  const camera=useRef<CameraView>(null);
  const busy=useRef(false),previous=useRef<CardQuad|null>(null),stableCount=useRef(0),invalidCount=useRef(0);

  useEffect(()=>{if(permission&&!permission.granted)void requestPermission();},[permission,requestPermission]);
  useEffect(()=>{
    if(!ready)return;
    let cancelled=false;
    const tick=async()=>{
      if(cancelled||busy.current||!camera.current)return;
      busy.current=true;
      try{
        const photo=await camera.current.takePictureAsync({quality:.5,skipProcessing:true});
        if(photo?.uri&&!cancelled){
          const result=await detectCardGeometry(photo.uri);
          if(!result){invalidCount.current++;if(invalidCount.current>=2){setValid(false);setQuad(null);stableCount.current=0;previous.current=null;}return;}
          setQuad(result.quad);setConfidence(result.confidence);
          const moving=previous.current?avgCornerDelta(previous.current,result.quad):0;
          const good=result.centered&&result.stableShape&&result.confidence>=GOOD_CONFIDENCE;
          if(good&&moving<CORNER_DELTA){stableCount.current++;invalidCount.current=0;}else{stableCount.current=0;invalidCount.current++;}
          if(good&&stableCount.current>=STABLE_FRAMES){setValid(true);invalidCount.current=0;}
          else if(invalidCount.current>=2)setValid(false);
          previous.current=result.quad;
        }
      }catch{if(!cancelled)setValid(false);}finally{busy.current=false;}
    };
    void tick();
    const timer=setInterval(()=>void tick(),800);
    return()=>{cancelled=true;clearInterval(timer);};
  },[ready]);

  const capture=async()=>{const result=await camera.current?.takePictureAsync({quality:1,skipProcessing:false});if(result?.uri)await onCaptured?.(result.uri);};
  if(!permission)return <View style={styles.center}><Text style={styles.copy}>Preparazione fotocamera…</Text></View>;
  if(!permission.granted)return <View style={styles.center}><Text style={styles.title}>Fotocamera necessaria</Text><Text style={styles.copy}>CARDGRADE usa la fotocamera solo per acquisire la carta.</Text><TouchableOpacity style={styles.primary} onPress={()=>void requestPermission()}><Text style={styles.primaryText}>CONSENTI FOTOCAMERA</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={onExit}><Text style={styles.secondaryText}>TORNA ALL'APP</Text></TouchableOpacity></View>;

  return <View style={styles.root}>
    <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} enableTorch={torch} onCameraReady={()=>setReady(true)}/>
    <View style={styles.scrim} pointerEvents="none"/>
    {quad&&<View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.edge,{backgroundColor:valid?'#b8ff5a':'#fff'},lineStyle(quad.topLeft,quad.topRight,width,height)]}/>
      <View style={[styles.edge,{backgroundColor:valid?'#b8ff5a':'#fff'},lineStyle(quad.topRight,quad.bottomRight,width,height)]}/>
      <View style={[styles.edge,{backgroundColor:valid?'#b8ff5a':'#fff'},lineStyle(quad.bottomRight,quad.bottomLeft,width,height)]}/>
      <View style={[styles.edge,{backgroundColor:valid?'#b8ff5a':'#fff'},lineStyle(quad.bottomLeft,quad.topLeft,width,height)]}/>
      {[quad.topLeft,quad.topRight,quad.bottomRight,quad.bottomLeft].map((p,i)=><View key={i} style={[styles.corner,{backgroundColor:valid?'#b8ff5a':'#fff'},cornerStyle(p,width,height)]}/>)}
    </View>}
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconButton} onPress={onExit}><Text style={styles.icon}>×</Text></TouchableOpacity>
      <View style={styles.headerTitle}><Text style={styles.kicker}>CARDGRADE</Text><Text style={styles.mode}>SCANNER</Text></View>
      <TouchableOpacity style={styles.iconButton} onPress={()=>setTorch(v=>!v)}><Text style={styles.icon}>{torch?'☼':'◌'}</Text></TouchableOpacity>
    </View>
    <View style={styles.status} pointerEvents="none">
      <Text style={[styles.statusTitle,valid&&styles.validText]}>{valid?'Carta centrata — mantieni la posizione':quad?'Rilevamento carta…':'Inquadra la carta'}</Text>
      <Text style={styles.statusCopy}>{quad?(Math.round(confidence*100)+'% geometria • 4 lati + 4 angoli'):'Posiziona la carta interamente nell’inquadratura'}</Text>
    </View>
    <View style={styles.footer}>
      <TouchableOpacity style={styles.secondary} onPress={()=>setFacing(v=>v==='back'?'front':'back')}><Text style={styles.secondaryText}>CAMBIA</Text></TouchableOpacity>
      <TouchableOpacity disabled={!ready} style={[styles.shutter,!ready&&styles.shutterDisabled]} onPress={()=>void capture()}><View style={styles.shutterInner}/></TouchableOpacity>
      <View style={styles.sidePlaceholder}/>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#000'},center:{flex:1,backgroundColor:'#07090c',alignItems:'center',justifyContent:'center',padding:28},
  scrim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.12)'},header:{position:'absolute',top:18,left:18,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},headerTitle:{alignItems:'center'},
  kicker:{color:'#dce3ea',fontSize:10,fontWeight:'900',letterSpacing:1.6},mode:{color:'#fff',fontSize:15,fontWeight:'900',letterSpacing:1},iconButton:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(0,0,0,.48)',alignItems:'center',justifyContent:'center'},icon:{color:'#fff',fontSize:25,fontWeight:'300'},
  status:{position:'absolute',top:84,left:20,right:20,alignItems:'center'},statusTitle:{color:'#fff',fontSize:18,fontWeight:'900',textAlign:'center'},validText:{color:'#b8ff5a'},statusCopy:{marginTop:6,color:'rgba(255,255,255,.78)',fontSize:12,textAlign:'center'},
  edge:{position:'absolute',height:3,borderRadius:2},corner:{position:'absolute',width:12,height:12,borderRadius:6},footer:{position:'absolute',left:24,right:24,bottom:28,height:88,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  shutter:{width:76,height:76,borderRadius:38,borderWidth:5,borderColor:'#fff',alignItems:'center',justifyContent:'center'},shutterDisabled:{opacity:.4},shutterInner:{width:58,height:58,borderRadius:29,backgroundColor:'#fff'},sidePlaceholder:{width:82},
  primary:{marginTop:20,paddingHorizontal:22,paddingVertical:15,borderRadius:14,backgroundColor:'#b8ff5a'},primaryText:{color:'#10130c',fontWeight:'900'},secondary:{paddingHorizontal:18,paddingVertical:12,borderRadius:13,backgroundColor:'rgba(0,0,0,.55)',minWidth:82,alignItems:'center'},secondaryText:{color:'#fff',fontWeight:'800',fontSize:12},
  title:{color:'#fff',fontSize:28,fontWeight:'900',textAlign:'center'},copy:{color:'#9aa3af',fontSize:15,lineHeight:22,textAlign:'center',maxWidth:340,marginTop:10}
});
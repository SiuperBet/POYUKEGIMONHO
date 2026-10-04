import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Dimensions,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {Camera,useCameraDevice,useCameraPermission,useFrameOutput,usePhotoOutput} from 'react-native-vision-camera';
import {scheduleOnRN} from 'react-native-worklets';
import * as Haptics from 'expo-haptics';

type Point={x:number;y:number};
type Detection={points:[Point,Point,Point,Point];confidence:number;valid:boolean;centerX:number;centerY:number;area:number;aspect:number};
type Props={onCaptured:(uri:string)=>void|Promise<void>;onCancel:()=>void};

function clamp(v:number,min=0,max=1){return Math.max(min,Math.min(max,v));}

function detectCard(frame:any):Detection|null{
  'worklet';
  if(!frame?.isPlanar)return null;
  const planes=frame.getPlanes();
  if(!planes?.length)return null;
  const yPlane=planes[0];
  const width=yPlane.width,height=yPlane.height;
  if(!width||!height)return null;
  const pixels=new Uint8Array(yPlane.getPixelBuffer());
  const stride=yPlane.bytesPerRow||width;
  const value=(x:number,y:number)=>{
    const xx=Math.max(0,Math.min(width-1,Math.round(x))),yy=Math.max(0,Math.min(height-1,Math.round(y)));
    return pixels[yy*stride+xx];
  };
  const rowGradient=(y:number)=>{
    let sum=0,n=0;
    for(let x=Math.floor(width*.12);x<Math.floor(width*.88);x+=5){sum+=Math.abs(value(x,y)-value(x,y-2));n++;}
    return sum/Math.max(1,n);
  };
  const colGradient=(x:number)=>{
    let sum=0,n=0;
    for(let y=Math.floor(height*.10);y<Math.floor(height*.90);y+=5){sum+=Math.abs(value(x,y)-value(x-2,y));n++;}
    return sum/Math.max(1,n);
  };
  const peaks=(start:number,end:number,fn:(p:number)=>number)=>{
    const found:{p:number;s:number}[]=[];
    for(let p=start+2;p<end-2;p+=2){
      const s=fn(p);
      if(s<12||s<fn(p-2)||s<fn(p+2))continue;
      let merged=false;
      for(let i=0;i<found.length;i++){
        if(Math.abs(found[i].p-p)<Math.round((end-start)*.07)){merged=true;if(s>found[i].s)found[i]={p,s};break;}
      }
      if(!merged)found.push({p,s});
    }
    found.sort((a,b)=>b.s-a.s);
    return found.slice(0,8);
  };
  const tops=peaks(Math.floor(height*.10),Math.floor(height*.56),rowGradient);
  const bottoms=peaks(Math.floor(height*.44),Math.floor(height*.92),rowGradient);
  const lefts=peaks(Math.floor(width*.06),Math.floor(width*.56),colGradient);
  const rights=peaks(Math.floor(width*.44),Math.floor(width*.94),colGradient);
  if(!tops.length||!bottoms.length||!lefts.length||!rights.length)return null;

  let best:any=null;
  for(const t of tops)for(const b of bottoms){
    const hh=b.p-t.p;if(hh<height*.34)continue;
    for(const l of lefts)for(const r of rights){
      const ww=r.p-l.p;if(ww<width*.30)continue;
      const aspect=hh/Math.max(1,ww);
      const aspectScore=Math.max(0,1-Math.abs(aspect-1.40)/.55);
      const area=(ww*hh)/(width*height);
      const score=(t.s+b.s+l.s+r.s)/4*.006+aspectScore*1.7+Math.min(1,area/.30)*.35;
      if(!best||score>best.score)best={t,b,l,r,score};
    }
  }
  if(!best)return null;

  const fitTop=(x:number)=>{
    let yBest=best.t.p,sBest=-1;
    const lo=Math.max(2,best.t.p-height*.10),hi=Math.min(height-3,best.t.p+height*.10);
    for(let y=Math.floor(lo);y<=Math.floor(hi);y+=2){const s=Math.abs(value(x,y)-value(x,y-2));if(s>sBest){sBest=s;yBest=y;}}
    return {x,y:yBest,s:sBest};
  };
  const fitBottom=(x:number)=>{
    let yBest=best.b.p,sBest=-1;
    const lo=Math.max(2,best.b.p-height*.10),hi=Math.min(height-3,best.b.p+height*.10);
    for(let y=Math.floor(lo);y<=Math.floor(hi);y+=2){const s=Math.abs(value(x,y)-value(x,y-2));if(s>sBest){sBest=s;yBest=y;}}
    return {x,y:yBest,s:sBest};
  };
  const fitLeft=(y:number)=>{
    let xBest=best.l.p,sBest=-1;
    const lo=Math.max(2,best.l.p-width*.10),hi=Math.min(width-3,best.l.p+width*.10);
    for(let x=Math.floor(lo);x<=Math.floor(hi);x+=2){const s=Math.abs(value(x,y)-value(x-2,y));if(s>sBest){sBest=s;xBest=x;}}
    return {x:xBest,y,s:sBest};
  };
  const fitRight=(y:number)=>{
    let xBest=best.r.p,sBest=-1;
    const lo=Math.max(2,best.r.p-width*.10),hi=Math.min(width-3,best.r.p+width*.10);
    for(let x=Math.floor(lo);x<=Math.floor(hi);x+=2){const s=Math.abs(value(x,y)-value(x-2,y));if(s>sBest){sBest=s;xBest=x;}}
    return {x:xBest,y,s:sBest};
  };
  const fitY=(pts:{x:number;y:number;s:number}[])=>{
    let sw=0,sx=0,sy=0,sxx=0,sxy=0;
    for(const p of pts){const w=Math.max(1,p.s);sw+=w;sx+=p.x*w;sy+=p.y*w;sxx+=p.x*p.x*w;sxy+=p.x*p.y*w;}
    const den=sw*sxx-sx*sx;
    if(Math.abs(den)<1)return {a:0,b:sy/Math.max(1,sw)};
    const a=(sw*sxy-sx*sy)/den;
    return {a,b:(sy-a*sx)/Math.max(1,sw)};
  };
  const fitX=(pts:{x:number;y:number;s:number}[])=>{
    let sw=0,sx=0,sy=0,syy=0,sxy=0;
    for(const p of pts){const w=Math.max(1,p.s);sw+=w;sx+=p.x*w;sy+=p.y*w;syy+=p.y*p.y*w;sxy+=p.x*p.y*w;}
    const den=sw*syy-sy*sy;
    if(Math.abs(den)<1)return {a:0,b:sx/Math.max(1,sw)};
    const a=(sw*sxy-sy*sx)/den;
    return {a,b:(sx-a*sy)/Math.max(1,sw)};
  };
  const xs:number[]=[];for(let i=0;i<7;i++)xs.push(best.l.p+(best.r.p-best.l.p)*(.12+i*.126));
  const ys:number[]=[];for(let i=0;i<7;i++)ys.push(best.t.p+(best.b.p-best.t.p)*(.12+i*.126));
  const top=fitY(xs.map(fitTop)),bottom=fitY(xs.map(fitBottom)),left=fitX(ys.map(fitLeft)),right=fitX(ys.map(fitRight));
  const intersect=(h:{a:number;b:number},v:{a:number;b:number})=>{
    let x=0,y=0;
    for(let i=0;i<4;i++){x=v.a*y+v.b;y=h.a*x+h.b;}
    return {x:clamp(x/(width-1)),y:clamp(y/(height-1))};
  };
  const tl=intersect(top,left),tr=intersect(top,right),br=intersect(bottom,right),bl=intersect(bottom,left);
  const area=Math.abs(tl.x*tr.y+tr.x*br.y+br.x*bl.y+bl.x*tl.y-(tr.x*tl.y+br.x*tr.y+bl.x*br.y+tl.x*bl.y))/2;
  const centerX=(tl.x+tr.x+br.x+bl.x)/4,centerY=(tl.y+tr.y+br.y+bl.y)/4;
  const topLen=Math.hypot(tr.x-tl.x,tr.y-tl.y),bottomLen=Math.hypot(br.x-bl.x,br.y-bl.y);
  const leftLen=Math.hypot(bl.x-tl.x,bl.y-tl.y),rightLen=Math.hypot(br.x-tr.x,br.y-tr.y);
  const aspect=(leftLen+rightLen)/Math.max(.001,topLen+bottomLen);
  const edgeQuality=Math.min(1,(best.t.s+best.b.s+best.l.s+best.r.s)/4/85);
  const aspectQuality=Math.max(0,1-Math.abs(aspect-1.40)/.60);
  const sizeQuality=Math.max(0,Math.min(1,(area-.08)/.20));
  const centeredQuality=Math.max(0,1-Math.max(Math.abs(centerX-.5),Math.abs(centerY-.5))/.34);
  const confidence=Math.max(0,Math.min(1,.38*edgeQuality+.22*aspectQuality+.20*sizeQuality+.20*centeredQuality));
  const valid=confidence>=.60&&area>=.11&&aspect>=.95&&aspect<=1.85&&Math.abs(centerX-.5)<=.18&&Math.abs(centerY-.5)<=.18;
  return {points:[tl,tr,br,bl],confidence,valid,centerX,centerY,area,aspect};
}

export function CardLiveCamera({onCaptured,onCancel}:Props){
  const device=useCameraDevice('back',{physicalDevices:['wide-angle']});
  const {hasPermission,requestPermission}=useCameraPermission();
  const photoOutput=usePhotoOutput({qualityPrioritization:'quality',quality:0.95});
  const [busy,setBusy]=useState(false),[started,setStarted]=useState(false),[cameraError,setCameraError]=useState<string|null>(null);
  const [detection,setDetection]=useState<Detection|null>(null),[autoCapture,setAutoCapture]=useState(true);
  const mounted=useRef(true),previousValid=useRef(false),autoTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{mounted.current=false;if(autoTimer.current)clearTimeout(autoTimer.current)},[]);
  useEffect(()=>{if(!hasPermission)void requestPermission()},[hasPermission,requestPermission]);

  const reportDetection=useCallback((next:Detection|null)=>{
    if(!mounted.current)return;
    setDetection(prev=>{
      if(!next)return prev&&prev.valid?{...prev,valid:false,confidence:Math.max(0,prev.confidence*.86)}:null;
      const alpha=next.valid?.65:.45;
      if(!prev)return next;
      const points=next.points.map((p,i)=>({x:prev.points[i].x*(1-alpha)+p.x*alpha,y:prev.points[i].y*(1-alpha)+p.y*alpha})) as [Point,Point,Point,Point];
      return {...next,points,confidence:prev.confidence*(1-alpha)+next.confidence*alpha};
    });
  },[]);

  const frameOutput=useFrameOutput({
    pixelFormat:'yuv',targetResolution:{width:480,height:640},enablePreviewSizedOutputBuffers:true,enablePhysicalBufferRotation:true,dropFramesWhileBusy:true,
    onFrame(frame){
      'worklet';
      try{scheduleOnRN(reportDetection,detectCard(frame));}finally{frame.dispose();}
    }
  });

  const capture=useCallback(async()=>{
    if(busy||!started)return;
    setBusy(true);setCameraError(null);
    try{
      const file=await photoOutput.capturePhotoToFile({flashMode:'off'},{});
      const uri=file.filePath.startsWith('file://')?file.filePath:'file://'+file.filePath;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onCaptured(uri);
    }catch(error){if(mounted.current)setCameraError('Scatto non riuscito. Mantieni ferma la carta e riprova.')}
    finally{if(mounted.current)setBusy(false);}
  },[busy,started,onCaptured,photoOutput]);

  useEffect(()=>{
    if(!autoCapture||!detection?.valid||busy||!started)return;
    autoTimer.current=setTimeout(()=>{if(mounted.current&&!busy&&started&&detection?.valid)void capture()},750);
    return()=>{if(autoTimer.current)clearTimeout(autoTimer.current)};
  },[detection?.valid,autoCapture,busy,started,capture]);

  useEffect(()=>{const now=!!detection?.valid;if(now&&!previousValid.current)void Haptics.selectionAsync();previousValid.current=now},[detection?.valid]);

  const {width,height}=Dimensions.get('window');
  const mapPoint=(p:Point)=>{
    const frameAspect=.75,screenAspect=width/height;
    const cropX=screenAspect<frameAspect?(frameAspect-screenAspect)/(2*frameAspect):0;
    const cropY=screenAspect>frameAspect?(screenAspect-frameAspect)/(2*screenAspect):0;
    return {x:clamp((p.x-cropX)/(1-2*cropX))*width,y:clamp((p.y-cropY)/(1-2*cropY))*height};
  };
  const quad=detection?.points.map(mapPoint) as [Point,Point,Point,Point]|undefined;
  const valid=!!detection?.valid;
  const line=(a:Point,b:Point)=>{
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    return {left:(a.x+b.x)/2-len/2,top:(a.y+b.y)/2-1.5,width:len,transform:[{rotate:Math.atan2(dy,dx)+'rad'}]};
  };

  if(!hasPermission)return <View style={styles.root}><View style={styles.center}><Text style={styles.title}>Accesso alla fotocamera</Text><Text style={styles.copy}>CARDGRADE usa la fotocamera solo durante la scansione della carta.</Text><TouchableOpacity style={styles.primary} onPress={()=>void requestPermission()}><Text style={styles.primaryText}>CONSENTI FOTOCAMERA</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>ANNULLA</Text></TouchableOpacity></View></View>;
  if(!device)return <View style={styles.root}><View style={styles.center}><Text style={styles.title}>Fotocamera non disponibile</Text><Text style={styles.copy}>Non è stato rilevato un dispositivo camera posteriore.</Text><TouchableOpacity style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>INDIETRO</Text></TouchableOpacity></View></View>;

  return <View style={styles.root}>
    <Camera style={StyleSheet.absoluteFill} device={device} outputs={[photoOutput,frameOutput]} constraints={[{fps:15},{resolutionBias:frameOutput}]} isActive={true} resizeMode="cover" implementationMode="performance" onPreviewStarted={()=>setStarted(true)} onError={error=>{setStarted(false);setCameraError('Errore fotocamera: '+error.message)}}/>
    <View pointerEvents="none" style={styles.dim}/>
    {quad&&<View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.detectEdge,valid&&styles.detectEdgeValid,line(quad[0],quad[1])]} />
      <View style={[styles.detectEdge,valid&&styles.detectEdgeValid,line(quad[1],quad[2])]} />
      <View style={[styles.detectEdge,valid&&styles.detectEdgeValid,line(quad[2],quad[3])]} />
      <View style={[styles.detectEdge,valid&&styles.detectEdgeValid,line(quad[3],quad[0])]} />
      {quad.map((p,i)=><View key={i} style={[styles.corner,{left:p.x-7,top:p.y-7},valid&&styles.cornerValid]}/>)}
    </View>}
    <View style={styles.topBar}>
      <View><Text style={styles.kicker}>CARDGRADE • SCANNER</Text><Text style={styles.status}>{valid?'Carta centrata':'Inquadra la carta'}</Text></View>
      <View style={styles.topActions}><TouchableOpacity style={[styles.autoToggle,autoCapture&&styles.autoToggleOn]} onPress={()=>setAutoCapture(v=>!v)}><Text style={[styles.autoText,autoCapture&&styles.autoTextOn]}>AUTO</Text></TouchableOpacity><TouchableOpacity style={styles.close} onPress={onCancel}><Text style={styles.closeText}>×</Text></TouchableOpacity></View>
    </View>
    <View style={styles.hint}><Text style={styles.hintText}>{valid?'Carta centrata — mantieni la posizione':'Porta tutti e 4 i lati della carta dentro l’inquadratura'}</Text></View>
    {valid&&<View style={styles.validBadge}><Text style={styles.validBadgeText}>✓ 4 LATI RILEVATI</Text></View>}
    {cameraError&&<View style={styles.error}><Text style={styles.errorText}>{cameraError}</Text></View>}
    <View style={styles.bottom}><TouchableOpacity disabled={busy||!started} style={[styles.shutter,valid&&styles.shutterValid,!started&&styles.shutterDisabled]} onPress={()=>void capture()}>{busy?<ActivityIndicator color="#111" size="small"/>:<View style={styles.shutterInner}/>}</TouchableOpacity><Text style={styles.captureLabel}>{busy?'ACQUISIZIONE…':autoCapture?'AUTO SCATTO':'SCATTA'}</Text></View>
  </View>;
}

const styles=StyleSheet.create({
  root:{...StyleSheet.absoluteFillObject,backgroundColor:'#000',zIndex:1000},center:{flex:1,justifyContent:'center',alignItems:'center',padding:28},title:{color:'#fff',fontSize:22,fontWeight:'800',textAlign:'center',marginBottom:10},copy:{color:'#c9c9c9',fontSize:15,lineHeight:22,textAlign:'center',marginBottom:24},primary:{paddingHorizontal:20,paddingVertical:14,borderRadius:12,backgroundColor:'#d7ff52'},primaryText:{color:'#101010',fontWeight:'900'},secondary:{marginTop:12,paddingHorizontal:20,paddingVertical:12},secondaryText:{color:'#fff',fontWeight:'800'},dim:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.08)'},
  detectEdge:{position:'absolute',height:3,backgroundColor:'#ff5b5b',borderRadius:2},detectEdgeValid:{backgroundColor:'#d7ff52'},corner:{position:'absolute',width:14,height:14,borderRadius:7,backgroundColor:'#ff5b5b',borderWidth:2,borderColor:'#fff'},cornerValid:{backgroundColor:'#d7ff52'},
  topBar:{position:'absolute',top:0,left:0,right:0,paddingTop:52,paddingHorizontal:20,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},kicker:{color:'#d7ff52',fontSize:10,fontWeight:'900',letterSpacing:1.2},status:{color:'#fff',fontSize:18,fontWeight:'900',marginTop:4},topActions:{flexDirection:'row',gap:8,alignItems:'center'},autoToggle:{height:44,paddingHorizontal:13,borderRadius:22,backgroundColor:'rgba(0,0,0,.55)',borderWidth:1,borderColor:'rgba(255,255,255,.25)',alignItems:'center',justifyContent:'center'},autoToggleOn:{backgroundColor:'#d7ff52',borderColor:'#d7ff52'},autoText:{color:'#fff',fontSize:11,fontWeight:'900'},autoTextOn:{color:'#101010'},close:{width:44,height:44,borderRadius:22,backgroundColor:'rgba(0,0,0,.55)',alignItems:'center',justifyContent:'center'},closeText:{color:'#fff',fontSize:30,lineHeight:32,fontWeight:'300'},
  hint:{position:'absolute',top:'10%',left:20,right:20,alignItems:'center'},hintText:{color:'#fff',fontSize:13,fontWeight:'700',textAlign:'center',backgroundColor:'rgba(0,0,0,.50)',paddingHorizontal:14,paddingVertical:8,borderRadius:16},validBadge:{position:'absolute',top:'15%',alignSelf:'center',backgroundColor:'#10130c',borderRadius:16,paddingHorizontal:14,paddingVertical:8,borderWidth:1,borderColor:'#d7ff52'},validBadgeText:{color:'#d7ff52',fontSize:11,fontWeight:'900'},error:{position:'absolute',left:20,right:20,bottom:150,backgroundColor:'rgba(120,0,0,.82)',borderRadius:12,padding:12},errorText:{color:'#fff',fontWeight:'700',textAlign:'center'},
  bottom:{position:'absolute',left:0,right:0,bottom:28,alignItems:'center'},shutter:{width:78,height:78,borderRadius:39,backgroundColor:'#fff',alignItems:'center',justifyContent:'center',borderWidth:5,borderColor:'rgba(215,255,82,.9)'},shutterValid:{borderColor:'#d7ff52'},shutterDisabled:{opacity:.45},shutterInner:{width:60,height:60,borderRadius:30,backgroundColor:'#fff'},captureLabel:{color:'#fff',fontSize:11,fontWeight:'900',letterSpacing:1.5,marginTop:8}
});
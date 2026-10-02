import React,{useMemo,useRef,useState} from 'react';
import {PanResponder,StyleSheet,Text,TouchableOpacity,View,Image,LayoutChangeEvent} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';

type Props={uri:string;onCancel:()=>void;onConfirm:(uri:string)=>void|Promise<void>};
type Crop={left:number;top:number;right:number;bottom:number};
const pct=(n:number)=>(n*100).toFixed(2)+'%';

export function CardEdgeEditor({uri,onCancel,onConfirm}:Props){
  const [crop,setCrop]=useState<Crop>({left:.012,top:.012,right:.988,bottom:.988});
  const [box,setBox]=useState({width:1,height:1});
  const [working,setWorking]=useState(false);
  const start=useRef<Crop>(crop);

  const updateSide=(side:'left'|'right'|'top'|'bottom',delta:number)=>{
    setCrop(prev=>{
      const next={...prev};
      const min=.495;
      if(side==='left')next.left=Math.min(next.right-.02,Math.max(0,Math.min(min,start.current.left+delta)));
      if(side==='right')next.right=Math.max(next.left+.02,Math.min(1,Math.max(1-min,start.current.right+delta)));
      if(side==='top')next.top=Math.min(next.bottom-.02,Math.max(0,Math.min(min,start.current.top+delta)));
      if(side==='bottom')next.bottom=Math.max(next.top+.02,Math.min(1,Math.max(1-min,start.current.bottom+delta)));
      return next;
    });
  };

  const pan=useMemo(()=>({
    left:PanResponder.create({onStartShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{start.current=crop},onPanResponderMove:(_,g)=>updateSide('left',g.dx/box.width),onPanResponderRelease:()=>setCrop(c=>({...c,left:Math.round(c.left*200)/200}))}),
    right:PanResponder.create({onStartShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{start.current=crop},onPanResponderMove:(_,g)=>updateSide('right',g.dx/box.width),onPanResponderRelease:()=>setCrop(c=>({...c,right:Math.round(c.right*200)/200}))}),
    top:PanResponder.create({onStartShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{start.current=crop},onPanResponderMove:(_,g)=>updateSide('top',g.dy/box.height),onPanResponderRelease:()=>setCrop(c=>({...c,top:Math.round(c.top*200)/200}))}),
    bottom:PanResponder.create({onStartShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{start.current=crop},onPanResponderMove:(_,g)=>updateSide('bottom',g.dy/box.height),onPanResponderRelease:()=>setCrop(c=>({...c,bottom:Math.round(c.bottom*200)/200}))})
  }),[crop,box.width,box.height]);

  const layout=(e:LayoutChangeEvent)=>setBox({width:Math.max(1,e.nativeEvent.layout.width),height:Math.max(1,e.nativeEvent.layout.height)});
  const confirm=async()=>{
    if(working)return;
    setWorking(true);
    try{
      const size=await new Promise<{width:number;height:number}>((resolve,reject)=>Image.getSize(uri,(width,height)=>resolve({width,height}),reject));
      const result=await ImageManipulator.manipulateAsync(uri,[{crop:{
        originX:Math.round(size.width*crop.left),originY:Math.round(size.height*crop.top),
        width:Math.max(1,Math.round(size.width*(crop.right-crop.left))),height:Math.max(1,Math.round(size.height*(crop.bottom-crop.top)))
      }}],{compress:1,format:SaveFormat.JPEG});
      await onConfirm(result.uri);
    }finally{setWorking(false)}
  };

  return <View style={styles.root}>
    <Text style={styles.title}>Rifinitura bordi carta</Text>
    <Text style={styles.hint}>Trascina direttamente il lato che vuoi correggere. Il lato resta dritto e si aggancia a piccoli incrementi per evitare micro-movimenti.</Text>
    <View style={styles.canvas} onLayout={layout}>
      <Image source={{uri}} style={styles.image} resizeMode="contain"/>
      <View pointerEvents="none" style={[styles.crop,{left:pct(crop.left),right:pct(1-crop.right),top:pct(crop.top),bottom:pct(1-crop.bottom)}]}/>
      <View {...pan.top.panHandlers} style={[styles.sideHandle,styles.top,{left:pct(crop.left),right:pct(1-crop.right),top:pct(crop.top)}]}><View style={styles.handleLine}/><Text style={styles.handleLabel}>LATO</Text></View>
      <View {...pan.bottom.panHandlers} style={[styles.sideHandle,styles.bottom,{left:pct(crop.left),right:pct(1-crop.right),bottom:pct(1-crop.bottom)}]}><View style={styles.handleLine}/><Text style={styles.handleLabel}>LATO</Text></View>
      <View {...pan.left.panHandlers} style={[styles.sideHandle,styles.left,{top:pct(crop.top),bottom:pct(1-crop.bottom),left:pct(crop.left)}]}><View style={styles.handleLine}/><Text style={styles.handleLabel}>LATO</Text></View>
      <View {...pan.right.panHandlers} style={[styles.sideHandle,styles.right,{top:pct(crop.top),bottom:pct(1-crop.bottom),right:pct(1-crop.right)}]}><View style={styles.handleLine}/><Text style={styles.handleLabel}>LATO</Text></View>
    </View>
    <View style={styles.row}>
      <TouchableOpacity style={styles.secondary} onPress={onCancel} disabled={working}><Text style={styles.secondaryText}>ANNULLA</Text></TouchableOpacity>
      <TouchableOpacity style={styles.primary} onPress={()=>void confirm()} disabled={working}><Text style={styles.primaryText}>{working?'APPLICO…':'CONFERMA BORDI'}</Text></TouchableOpacity>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{backgroundColor:'#14171c',borderRadius:20,borderWidth:1,borderColor:'#303640',padding:14,marginTop:12},
  title:{color:'#f5f7fa',fontSize:18,fontWeight:'900'},
  hint:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:5,marginBottom:10},
  canvas:{height:390,borderRadius:14,overflow:'hidden',backgroundColor:'#080a0d',position:'relative'},
  image:{...StyleSheet.absoluteFillObject},
  crop:{position:'absolute',borderWidth:2,borderColor:'#b8ff5a'},
  sideHandle:{position:'absolute',backgroundColor:'rgba(184,255,90,.08)',alignItems:'center',justifyContent:'center'},
  top:{height:34},bottom:{height:34},left:{width:34},right:{width:34},
  handleLine:{backgroundColor:'#b8ff5a',borderRadius:4,width:'72%',height:4},
  handleLabel:{color:'#d8ff9c',fontSize:7,fontWeight:'900',marginTop:2},
  row:{flexDirection:'row',gap:8,marginTop:10},
  secondary:{flex:1,backgroundColor:'#20252d',paddingVertical:13,borderRadius:12,alignItems:'center'},
  secondaryText:{color:'#f5f7fa',fontWeight:'900',fontSize:11},
  primary:{flex:1,backgroundColor:'#b8ff5a',paddingVertical:13,borderRadius:12,alignItems:'center'},
  primaryText:{color:'#10130c',fontWeight:'900',fontSize:11}
});
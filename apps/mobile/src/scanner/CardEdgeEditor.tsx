import React,{useMemo,useRef,useState} from 'react';
import {PanResponder,StyleSheet,Text,TouchableOpacity,View,Image,LayoutChangeEvent} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';

type Point={x:number;y:number};
type Quad={tl:Point;tr:Point;br:Point;bl:Point};
type Props={uri:string;onCancel:()=>void;onConfirm:(uri:string)=>void|Promise<void>};

const clamp=(v:number,min=0.01,max=0.99)=>Math.max(min,Math.min(max,v));
const snap=(v:number)=>Math.round(v*200)/200;

export function CardEdgeEditor({uri,onCancel,onConfirm}:Props){
  const [quad,setQuad]=useState<Quad>({tl:{x:.06,y:.035},tr:{x:.94,y:.035},br:{x:.94,y:.965},bl:{x:.06,y:.965}});
  const [box,setBox]=useState({width:1,height:1});
  const [working,setWorking]=useState(false);
  const start=useRef<Quad>(quad);

  const moveCorner=(key:keyof Quad,dx:number,dy:number)=>{
    setQuad(prev=>{
      const next={...prev};
      next[key]={x:snap(clamp(start.current[key].x+dx,.005,.995)),y:snap(clamp(start.current[key].y+dy,.005,.995))};
      return next;
    });
  };
  const cornerPan=useMemo(()=>Object.fromEntries((['tl','tr','br','bl'] as const).map(key=>[key,PanResponder.create({
    onStartShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{start.current=quad},
    onPanResponderMove:(_,g)=>moveCorner(key,g.dx/box.width,g.dy/box.height),
    onPanResponderRelease:()=>setQuad(q=>({...q,[key]:{x:snap(q[key].x),y:snap(q[key].y)}}))
  })])),[quad,box.width,box.height]);

  const layout=(e:LayoutChangeEvent)=>setBox({width:Math.max(1,e.nativeEvent.layout.width),height:Math.max(1,e.nativeEvent.layout.height)});
  const pointStyle=(p:Point)=>({left:p.x*box.width-14,top:p.y*box.height-14});
  const lineStyle=(a:Point,b:Point)=>({left:Math.min(a.x,b.x)*box.width,top:Math.min(a.y,b.y)*box.height,width:Math.max(1,Math.hypot((b.x-a.x)*box.width,(b.y-a.y)*box.height))});
  const angle=(a:Point,b:Point)=>Math.atan2((b.y-a.y)*box.height,(b.x-a.x)*box.width)*180/Math.PI;

  const confirm=async()=>{
    if(working)return;
    setWorking(true);
    try{
      const size=await new Promise<{width:number;height:number}>((resolve,reject)=>Image.getSize(uri,(width,height)=>resolve({width,height}),reject));
      const xs=[quad.tl.x,quad.tr.x,quad.br.x,quad.bl.x],ys=[quad.tl.y,quad.tr.y,quad.br.y,quad.bl.y];
      const left=Math.max(0,Math.min(...xs)),right=Math.min(1,Math.max(...xs)),top=Math.max(0,Math.min(...ys)),bottom=Math.min(1,Math.max(...ys));
      const result=await ImageManipulator.manipulateAsync(uri,[{crop:{originX:Math.round(size.width*left),originY:Math.round(size.height*top),width:Math.max(1,Math.round(size.width*(right-left))),height:Math.max(1,Math.round(size.height*(bottom-top)))}}],{compress:1,format:SaveFormat.JPEG});
      await onConfirm(result.uri);
    }finally{setWorking(false)}
  };

  const sides=[
    {key:'top' as const,a:quad.tl,b:quad.tr},
    {key:'right' as const,a:quad.tr,b:quad.br},
    {key:'bottom' as const,a:quad.br,b:quad.bl},
    {key:'left' as const,a:quad.bl,b:quad.tl}
  ];

  return <View style={styles.root}>
    <Text style={styles.title}>Rifinitura angoli e bordi</Text>
    <Text style={styles.hint}>Sposta solo i 4 angoli. Le 4 linee verdi sono sempre collegate agli angoli e coincidono con i bordi della carta: non esistono maniglie laterali separate.</Text>
    <View style={styles.canvas} onLayout={layout}>
      <Image source={{uri}} style={styles.image} resizeMode="contain"/>
      {sides.map(s=><View key={'line-'+s.key} pointerEvents="none" style={[styles.edgeLine,lineStyle(s.a,s.b),{transform:[{rotate:angle(s.a,s.b)+'deg'}]}]}/>)}
      {(['tl','tr','br','bl'] as const).map(k=><View key={k} {...cornerPan[k].panHandlers} style={[styles.cornerHandle,pointStyle(quad[k])]}><View style={styles.cornerDot}/><Text style={styles.cornerLabel}>{k.toUpperCase()}</Text></View>)}
    </View>
    <View style={styles.legend}><Text style={styles.legendText}>● 4 ANGOLI</Text><Text style={styles.legendText}>━ BORDI COLLEGATI AGLI ANGOLI</Text></View>
    <View style={styles.row}>
      <TouchableOpacity style={styles.secondary} onPress={onCancel} disabled={working}><Text style={styles.secondaryText}>ANNULLA</Text></TouchableOpacity>
      <TouchableOpacity style={styles.primary} onPress={()=>void confirm()} disabled={working}><Text style={styles.primaryText}>{working?'APPLICO…':'CONFERMA GEOMETRIA'}</Text></TouchableOpacity>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{backgroundColor:'#14171c',borderRadius:20,borderWidth:1,borderColor:'#303640',padding:14,marginTop:12},
  title:{color:'#f5f7fa',fontSize:18,fontWeight:'900'},
  hint:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:5,marginBottom:10},
  canvas:{height:430,borderRadius:14,overflow:'hidden',backgroundColor:'#080a0d',position:'relative'},
  image:{...StyleSheet.absoluteFillObject},
  edgeLine:{position:'absolute',height:3,backgroundColor:'#b8ff5a',borderRadius:3,transformOrigin:'left center'},
  cornerHandle:{position:'absolute',width:28,height:28,borderRadius:14,backgroundColor:'#10130c',borderWidth:2,borderColor:'#b8ff5a',alignItems:'center',justifyContent:'center'},
  cornerDot:{width:8,height:8,borderRadius:4,backgroundColor:'#b8ff5a'},
  cornerLabel:{position:'absolute',top:29,color:'#d8ff9c',fontSize:7,fontWeight:'900'},
  legend:{flexDirection:'row',justifyContent:'space-between',marginTop:7},
  legendText:{color:'#9aa3af',fontSize:8,fontWeight:'900'},
  row:{flexDirection:'row',gap:8,marginTop:10},
  secondary:{flex:1,backgroundColor:'#20252d',paddingVertical:13,borderRadius:12,alignItems:'center'},
  secondaryText:{color:'#f5f7fa',fontWeight:'900',fontSize:11},
  primary:{flex:1,backgroundColor:'#b8ff5a',paddingVertical:13,borderRadius:12,alignItems:'center'},
  primaryText:{color:'#10130c',fontWeight:'900',fontSize:11}
});
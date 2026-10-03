import React,{useMemo,useRef,useState} from 'react';
import {PanResponder,StyleSheet,Text,TouchableOpacity,View,Image,LayoutChangeEvent} from 'react-native';

type MarginKey='left'|'right'|'top'|'bottom';
type Margins={left:number;right:number;top:number;bottom:number};
type Centering={left:number;right:number;top:number;bottom:number};
type Props={
  uri:string;
  onCancel:()=>void;
  onConfirm:(uri:string,centering?:Centering)=>void|Promise<void>;
};

const clamp=(v:number,min=0.01,max=0.35)=>Math.max(min,Math.min(max,v));
const snap=(v:number)=>Math.round(v*200)/200;

export function CardEdgeEditor({uri,onCancel,onConfirm}:Props){
  // This is a centering guide, not a corner/perspective editor. The native document
  // scanner has already found and rectified the card; here we inspect the distance
  // between the card edge and the printed frame on all four sides.
  const [margins,setMargins]=useState<Margins>({left:.055,right:.055,top:.055,bottom:.055});
  const [box,setBox]=useState({width:1,height:1});
  const [working,setWorking]=useState(false);
  const start=useRef(margins);

  const moveMargin=(key:MarginKey,delta:number)=>{
    setMargins(prev=>({...prev,[key]:snap(clamp(start.current[key]+delta))}));
  };

  const responders=useMemo(()=>Object.fromEntries((['left','right','top','bottom'] as const).map(key=>[key,PanResponder.create({
    onStartShouldSetPanResponder:()=>true,
    onPanResponderGrant:()=>{start.current=margins},
    onPanResponderMove:(_,g)=>{
      const delta=(key==='left'||key==='right')?g.dx/box.width:g.dy/box.height;
      moveMargin(key,key==='right'||key==='bottom'?-delta:delta);
    },
    onPanResponderRelease:()=>setMargins(q=>({...q,[key]:snap(q[key])}))
  })])),[margins,box.width,box.height]);

  const layout=(e:LayoutChangeEvent)=>setBox({
    width:Math.max(1,e.nativeEvent.layout.width),
    height:Math.max(1,e.nativeEvent.layout.height)
  });

  const inner={
    left:margins.left*box.width,
    top:margins.top*box.height,
    width:Math.max(20,box.width-(margins.left+margins.right)*box.width),
    height:Math.max(20,box.height-(margins.top+margins.bottom)*box.height)
  };

  const centering:Centering={
    left:Math.round(margins.left/(margins.left+margins.right)*100),
    right:Math.round(margins.right/(margins.left+margins.right)*100),
    top:Math.round(margins.top/(margins.top+margins.bottom)*100),
    bottom:Math.round(margins.bottom/(margins.top+margins.bottom)*100)
  };

  const confirm=async()=>{
    if(working)return;
    setWorking(true);
    try{
      // IMPORTANT: do not crop again here. The native document scanner has already
      // rectified the card. A second crop was the source of the crash reported by the user.
      await onConfirm(uri,centering);
    }finally{
      setWorking(false);
    }
  };

  return <View style={styles.root}>
    <Text style={styles.title}>Controllo centratura carta</Text>
    <Text style={styles.hint}>
      Qui non selezioniamo gli angoli: la carta è già stata rilevata e raddrizzata.
      Controlliamo invece la distanza tra il bordo della carta e il bordo stampato,
      separatamente a sinistra, destra, sopra e sotto.
    </Text>

    <View style={styles.canvas} onLayout={layout}>
      <Image source={{uri}} style={styles.image} resizeMode="contain"/>
      <View pointerEvents="none" style={styles.outerFrame}/>
      <View pointerEvents="none" style={[styles.printFrame,{
        left:inner.left,top:inner.top,width:inner.width,height:inner.height
      }]}/>
      <View pointerEvents="none" style={[styles.measureLabel,styles.leftLabel,{top:inner.top+inner.height/2-12}]}>
        <Text style={styles.measureText}>{Math.round(margins.left*100)}%</Text>
      </View>
      <View pointerEvents="none" style={[styles.measureLabel,styles.rightLabel,{top:inner.top+inner.height/2-12}]}>
        <Text style={styles.measureText}>{Math.round(margins.right*100)}%</Text>
      </View>
      <View pointerEvents="none" style={[styles.measureLabel,styles.topLabel,{left:inner.left+inner.width/2-18}]}>
        <Text style={styles.measureText}>{Math.round(margins.top*100)}%</Text>
      </View>
      <View pointerEvents="none" style={[styles.measureLabel,styles.bottomLabel,{left:inner.left+inner.width/2-18}]}>
        <Text style={styles.measureText}>{Math.round(margins.bottom*100)}%</Text>
      </View>

      <View {...responders.left.panHandlers} style={[styles.handle,styles.leftHandle,{top:inner.top+inner.height/2-14}]}>
        <View style={styles.handleDot}/>
      </View>
      <View {...responders.right.panHandlers} style={[styles.handle,styles.rightHandle,{top:inner.top+inner.height/2-14}]}>
        <View style={styles.handleDot}/>
      </View>
      <View {...responders.top.panHandlers} style={[styles.handle,styles.topHandle,{left:inner.left+inner.width/2-14}]}>
        <View style={styles.handleDot}/>
      </View>
      <View {...responders.bottom.panHandlers} style={[styles.handle,styles.bottomHandle,{left:inner.left+inner.width/2-14}]}>
        <View style={styles.handleDot}/>
      </View>
    </View>

    <View style={styles.readout}>
      <View><Text style={styles.readoutLabel}>SINISTRA</Text><Text style={styles.readoutValue}>{centering.left}%</Text></View>
      <View><Text style={styles.readoutLabel}>DESTRA</Text><Text style={styles.readoutValue}>{centering.right}%</Text></View>
      <View><Text style={styles.readoutLabel}>SOPRA</Text><Text style={styles.readoutValue}>{centering.top}%</Text></View>
      <View><Text style={styles.readoutLabel}>SOTTO</Text><Text style={styles.readoutValue}>{centering.bottom}%</Text></View>
    </View>
    <Text style={styles.balance}>CENTRATURA {centering.left}% / {centering.right}% · {centering.top}% / {centering.bottom}%</Text>

    <View style={styles.row}>
      <TouchableOpacity style={styles.secondary} onPress={onCancel} disabled={working}>
        <Text style={styles.secondaryText}>ANNULLA</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.primary} onPress={()=>void confirm()} disabled={working}>
        <Text style={styles.primaryText}>{working?'VERIFICA…':'CONFERMA CENTRATURA'}</Text>
      </TouchableOpacity>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{backgroundColor:'#14171c',borderRadius:20,borderWidth:1,borderColor:'#303640',padding:14,marginTop:12},
  title:{color:'#f5f7fa',fontSize:18,fontWeight:'900'},
  hint:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:5,marginBottom:10},
  canvas:{height:430,borderRadius:14,overflow:'hidden',backgroundColor:'#080a0d',position:'relative'},
  image:{...StyleSheet.absoluteFillObject},
  outerFrame:{...StyleSheet.absoluteFillObject,borderWidth:2,borderColor:'#b8ff5a',borderRadius:12},
  printFrame:{position:'absolute',borderWidth:2,borderColor:'#fff',borderStyle:'dashed',borderRadius:4},
  handle:{position:'absolute',width:28,height:28,borderRadius:14,backgroundColor:'#10130c',borderWidth:2,borderColor:'#b8ff5a',alignItems:'center',justifyContent:'center'},
  leftHandle:{left:4},rightHandle:{right:4},topHandle:{top:4},bottomHandle:{bottom:4},
  handleDot:{width:8,height:8,borderRadius:4,backgroundColor:'#b8ff5a'},
  measureLabel:{position:'absolute',backgroundColor:'#10130c',borderRadius:8,paddingHorizontal:5,paddingVertical:3},
  leftLabel:{left:36},rightLabel:{right:36},topLabel:{top:28},bottomLabel:{bottom:28},
  measureText:{color:'#d8ff9c',fontSize:8,fontWeight:'900'},
  readout:{flexDirection:'row',justifyContent:'space-between',marginTop:10,borderWidth:1,borderColor:'#273142',borderRadius:12,padding:9},
  readoutLabel:{color:'#8d97a5',fontSize:7,fontWeight:'900'},readoutValue:{color:'#f5f7fa',fontSize:14,fontWeight:'900',marginTop:2},
  balance:{color:'#b8ff5a',fontSize:10,fontWeight:'900',marginTop:8,textAlign:'center'},
  row:{flexDirection:'row',gap:8,marginTop:10},
  secondary:{flex:1,backgroundColor:'#20252d',paddingVertical:13,borderRadius:12,alignItems:'center'},
  secondaryText:{color:'#f5f7fa',fontWeight:'900',fontSize:11},
  primary:{flex:1,backgroundColor:'#b8ff5a',paddingVertical:13,borderRadius:12,alignItems:'center'},
  primaryText:{color:'#10130c',fontWeight:'900',fontSize:11}
});
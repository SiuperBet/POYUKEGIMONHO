import React,{useEffect,useMemo,useRef,useState} from 'react';
import {PanResponder,StyleSheet,Text,TouchableOpacity,View,Image,LayoutChangeEvent,ActivityIndicator} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import {SaveFormat} from 'expo-image-manipulator';
import {Skia,ColorType,AlphaType} from '@shopify/react-native-skia';

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

function lum(r:number,g:number,b:number){return .299*r+.587*g+.114*b;}
async function detectPrintedMargins(uri:string):Promise<Margins>{
  const small=await ImageManipulator.manipulateAsync(uri,[{resize:{width:520}}],{compress:.82,format:SaveFormat.JPEG,base64:true});
  if(!small.base64)throw new Error('Immagine non disponibile');
  const image=Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(small.base64));
  if(!image)throw new Error('Decodifica immagine fallita');
  const width=image.width(),height=image.height();
  const pixels=image.readPixels(0,0,{width,height,colorType:ColorType.RGBA_8888,alphaType:AlphaType.Unpremul});
  if(!pixels)throw new Error('Pixel non disponibili');
  const at=(x:number,y:number)=>{const xx=Math.max(0,Math.min(width-1,x)),yy=Math.max(0,Math.min(height-1,y)),i=(yy*width+xx)*4;return lum(pixels[i],pixels[i+1],pixels[i+2]);};
  const score=(side:MarginKey,p:number)=>{let s=0,n=0;if(side==='top'||side==='bottom'){const y=side==='top'?p:height-1-p;for(let x=Math.floor(width*.22);x<width*.78;x+=2){s+=Math.abs(at(x,y)-at(x,y+(side==='top'?1:-1)));n++;}}else{const x=side==='left'?p:width-1-p;for(let y=Math.floor(height*.22);y<height*.78;y+=2){s+=Math.abs(at(x,y)-at(x+(side==='left'?1:-1),y));n++;}}return s/Math.max(1,n);};
  const scan=(side:MarginKey,total:number)=>{let best=total*.055,bestScore=-1;for(let p=Math.floor(total*.02);p<=Math.floor(total*.24);p+=2){const s=score(side,p);if(s>bestScore){bestScore=s;best=p;}}return clamp(best/total);};
  return {left:scan('left',width),right:scan('right',width),top:scan('top',height),bottom:scan('bottom',height)};
}

export function CardEdgeEditor({uri,onCancel,onConfirm}:Props){
  // This is a centering guide, not a corner/perspective editor. The native document
  // scanner has already found and rectified the card; here we inspect the distance
  // between the card edge and the printed frame on all four sides.
  const [margins,setMargins]=useState<Margins>({left:.055,right:.055,top:.055,bottom:.055});
  const [box,setBox]=useState({width:1,height:1});
  const [working,setWorking]=useState(false);
  const [detecting,setDetecting]=useState(true); const [detected,setDetected]=useState(false);
  const start=useRef(margins);

  useEffect(()=>{let alive=true;setDetecting(true);detectPrintedMargins(uri).then(next=>{if(alive){setMargins(next);setDetected(true);}}).catch(()=>{if(alive)setDetected(false);}).finally(()=>{if(alive)setDetecting(false);});return()=>{alive=false};},[uri]);

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
      Il rilevatore analizza automaticamente i quattro lati della cornice stampata.
      La carta è già stata raddrizzata dallo scanner: controlliamo solo la distanza
      tra bordo fisico e bordo stampato, senza effettuare un secondo crop.
    </Text>

    <View style={styles.canvas} onLayout={layout}>
      <Image source={{uri}} style={styles.image} resizeMode="contain"/>
      <View pointerEvents="none" style={styles.outerFrame}/>
      <View pointerEvents="none" style={[styles.edgeGuide,styles.edgeTop,{opacity:detected?1:.55}]}/>
      <View pointerEvents="none" style={[styles.edgeGuide,styles.edgeRight,{opacity:detected?1:.55}]}/>
      <View pointerEvents="none" style={[styles.edgeGuide,styles.edgeBottom,{opacity:detected?1:.55}]}/>
      <View pointerEvents="none" style={[styles.edgeGuide,styles.edgeLeft,{opacity:detected?1:.55}]}/>
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
      {detecting&&<View style={styles.detectBadge}><ActivityIndicator size="small"/><Text style={styles.detectText}>RILEVAMENTO LATI…</Text></View>}
      {!detecting&&<View style={styles.detectBadge}><Text style={styles.detectText}>{detected?'✓ 4 LATI RILEVATI':'GUIDA MANUALE'}</Text></View>}
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
  detectBadge:{position:'absolute',left:10,top:10,backgroundColor:'#10130c',borderRadius:10,paddingHorizontal:8,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:5},
  detectText:{color:'#d8ff9c',fontSize:8,fontWeight:'900'},
  edgeGuide:{position:'absolute',backgroundColor:'#b8ff5a',borderRadius:2},
  edgeTop:{left:0,right:0,top:1,height:3},edgeRight:{right:1,top:0,bottom:0,width:3},
  edgeBottom:{left:0,right:0,bottom:1,height:3},edgeLeft:{left:1,top:0,bottom:0,width:3},
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
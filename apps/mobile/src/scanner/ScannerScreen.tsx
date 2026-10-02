import React,{useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View,Image,ActivityIndicator} from 'react-native';
import DocumentScanner from 'react-native-document-scanner-plugin';
import * as Haptics from 'expo-haptics';

type Props={onCaptured?:(uri:string)=>void};

export function ScannerScreen({onCaptured}:Props){
  const [scannerOpen,setScannerOpen]=useState(false);
  const [lastPhoto,setLastPhoto]=useState<string|null>(null);
  const [message,setMessage]=useState('Premi SCANSIONE: il telefono rileverà automaticamente i 4 bordi.');
  const [error,setError]=useState<string|null>(null);
  const launched=useRef(false);

  const smartScan=async()=>{
    if(scannerOpen)return;
    setError(null);
    setScannerOpen(true);
    setMessage('Apertura scanner nativo…');
    try{
      const result=await DocumentScanner.scanDocument({
        maxNumDocuments:1,
        letUserAdjustCrop:true,
        croppedImageQuality:100,
      });
      const scanned=result.scannedImages?.[0];
      if(scanned){
        const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;
        setLastPhoto(uri);
        setMessage('Carta rilevata: bordi e prospettiva corretti.');
        onCaptured?.(uri);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }else{
        setMessage('Nessuna carta acquisita.');
      }
    }catch(errorValue){
      const text=String(errorValue??'');
      const cancelled=/cancel|dismiss|back/i.test(text);
      setMessage(cancelled?'Scansione annullata.':'Scanner nativo non disponibile.');
      if(!cancelled)setError('Il sistema non ha potuto avviare lo scanner. Puoi riprovare.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(()=>{});
    }finally{
      setScannerOpen(false);
    }
  };

  useEffect(()=>{
    if(!launched.current){
      launched.current=true;
      void smartScan();
    }
  },[]);

  const retry=()=>{setLastPhoto(null);setError(null);setMessage('Pronto: premi SCANSIONE per rilevare automaticamente i quattro bordi.');};
  const rescan=()=>{setLastPhoto(null);void smartScan();};

  return <View style={styles.root}>
    <View style={styles.header}>
      <View>
        <Text style={styles.kicker}>POYUKEGIMONHO • CARD SCANNER</Text>
        <Text style={styles.title}>Scansione automatica</Text>
      </View>
      <View style={styles.nativeBadge}><Text style={styles.nativeBadgeText}>NATIVO</Text></View>
    </View>

    <View style={styles.stage}>
      {lastPhoto?
        <Image source={{uri:lastPhoto}} style={styles.preview} resizeMode="contain"/>:
        <View style={styles.placeholder}>
          <View style={styles.cardOutline}>
            <View style={[styles.corner,styles.tl]}/><View style={[styles.corner,styles.tr]}/><View style={[styles.corner,styles.br]}/><View style={[styles.corner,styles.bl]}/>
            <Text style={styles.cardIcon}>▣</Text>
          </View>
          <Text style={styles.placeholderTitle}>{scannerOpen?'Rilevamento automatico…':'Scanner pronto'}</Text>
          <Text style={styles.placeholderCopy}>Lo scanner nativo del telefono individua la carta, segue i quattro angoli e corregge automaticamente prospettiva e crop.</Text>
          {scannerOpen&&<ActivityIndicator size="small"/>}
        </View>
      }
      <View style={styles.status}>
        <View style={styles.statusDot}/>
        <Text style={styles.statusText}>{message}</Text>
      </View>
    </View>

    {error&&<View style={styles.error}><Text style={styles.errorText}>{error}</Text></View>}

    {lastPhoto&&<View style={styles.resultPanel}>
      <Text style={styles.resultTitle}>Carta acquisita e raddrizzata</Text>
      <Text style={styles.resultCopy}>Questa immagine è il risultato del crop/perspective correction dello scanner nativo ed entra nel pipeline di POYUKEGIMONHO.</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondary} onPress={retry}><Text style={styles.secondaryText}>Riprova</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={rescan}><Text style={styles.primaryText}>Nuova scansione</Text></TouchableOpacity>
      </View>
    </View>}

    {!lastPhoto&&<TouchableOpacity style={styles.scanButton} onPress={()=>void smartScan()} disabled={scannerOpen}>
      <Text style={styles.scanButtonText}>{scannerOpen?'RILEVAMENTO…':'SCANSIONE'}</Text>
      <Text style={styles.scanButtonSub}>BORDI • ANGOLI • PROSPETTIVA</Text>
    </TouchableOpacity>}

    <View style={styles.infoRow}>
      <View style={styles.info}><Text style={styles.infoTitle}>4 BORDI</Text><Text style={styles.infoCopy}>rilevati automaticamente</Text></View>
      <View style={styles.info}><Text style={styles.infoTitle}>CROP</Text><Text style={styles.infoCopy}>prospettiva corretta</Text></View>
      <View style={styles.info}><Text style={styles.infoTitle}>QUALITÀ</Text><Text style={styles.infoCopy}>JPEG al massimo</Text></View>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#050608',paddingHorizontal:16,paddingTop:18,paddingBottom:24},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:14},
  kicker:{color:'#9aa3af',fontSize:10,fontWeight:'900',letterSpacing:1},
  title:{color:'#f5f7fa',fontSize:25,fontWeight:'900',marginTop:4},
  nativeBadge:{backgroundColor:'#b8ff5a',paddingHorizontal:10,paddingVertical:7,borderRadius:10},
  nativeBadgeText:{color:'#10130c',fontSize:10,fontWeight:'900'},
  stage:{flex:1,minHeight:420,borderRadius:24,overflow:'hidden',borderWidth:1,borderColor:'#2a3038',backgroundColor:'#0d1014',alignItems:'center',justifyContent:'center',padding:18},
  preview:{width:'100%',height:'100%',borderRadius:18,backgroundColor:'#080a0d'},
  placeholder:{alignItems:'center',justifyContent:'center',maxWidth:310},
  cardOutline:{width:170,height:238,borderWidth:2,borderColor:'#b8ff5a',borderRadius:12,alignItems:'center',justifyContent:'center',position:'relative',backgroundColor:'#151a1e',shadowColor:'#b8ff5a',shadowOpacity:.15,shadowRadius:20},
  corner:{position:'absolute',width:28,height:28,borderColor:'#b8ff5a'},tl:{left:-2,top:-2,borderLeftWidth:4,borderTopWidth:4,borderTopLeftRadius:9},tr:{right:-2,top:-2,borderRightWidth:4,borderTopWidth:4,borderTopRightRadius:9},br:{right:-2,bottom:-2,borderRightWidth:4,borderBottomWidth:4,borderBottomRightRadius:9},bl:{left:-2,bottom:-2,borderLeftWidth:4,borderBottomWidth:4,borderBottomLeftRadius:9},
  cardIcon:{color:'#b8ff5a',fontSize:42,opacity:.8},
  placeholderTitle:{color:'#f5f7fa',fontSize:18,fontWeight:'900',marginTop:20,textAlign:'center'},
  placeholderCopy:{color:'#9aa3af',fontSize:13,lineHeight:19,textAlign:'center',marginTop:8,marginBottom:16},
  status:{position:'absolute',left:16,right:16,bottom:16,backgroundColor:'rgba(8,10,13,.86)',borderWidth:1,borderColor:'#2a3038',borderRadius:14,padding:11,flexDirection:'row',alignItems:'center',gap:8},
  statusDot:{width:8,height:8,borderRadius:4,backgroundColor:'#b8ff5a'},statusText:{color:'#f5f7fa',fontSize:11,fontWeight:'700',flex:1},
  scanButton:{marginTop:14,backgroundColor:'#b8ff5a',borderRadius:16,paddingVertical:15,alignItems:'center',borderWidth:1,borderColor:'#d8ff9c'},
  scanButtonText:{color:'#10130c',fontSize:16,fontWeight:'900'},scanButtonSub:{color:'#263018',fontSize:9,fontWeight:'900',letterSpacing:1,marginTop:3},
  resultPanel:{marginTop:12,padding:15,borderRadius:17,backgroundColor:'#14171c',borderWidth:1,borderColor:'#2a3038'},
  resultTitle:{color:'#f5f7fa',fontSize:17,fontWeight:'900'},resultCopy:{color:'#9aa3af',fontSize:12,lineHeight:18,marginTop:6},
  actions:{flexDirection:'row',gap:9,marginTop:13},primary:{flex:1,backgroundColor:'#b8ff5a',paddingVertical:12,borderRadius:12,alignItems:'center'},primaryText:{color:'#10130c',fontWeight:'900',fontSize:12},secondary:{flex:1,backgroundColor:'#20252d',paddingVertical:12,borderRadius:12,alignItems:'center'},secondaryText:{color:'#f5f7fa',fontWeight:'900',fontSize:12},
  error:{marginTop:10,padding:11,borderRadius:12,backgroundColor:'#2a1518',borderWidth:1,borderColor:'#5a252b'},errorText:{color:'#ff9b9b',fontSize:11},
  infoRow:{flexDirection:'row',gap:8,marginTop:12},info:{flex:1,padding:11,borderRadius:13,backgroundColor:'#14171c',borderWidth:1,borderColor:'#2a3038'},infoTitle:{color:'#b8ff5a',fontSize:10,fontWeight:'900'},infoCopy:{color:'#9aa3af',fontSize:9,marginTop:3,lineHeight:13}
});
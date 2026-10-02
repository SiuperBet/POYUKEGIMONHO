import React,{useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View,Image,ActivityIndicator,Image as RNImage} from 'react-native';
import type {CatalogCard} from '../data/catalog';
import {CONDITIONS,Condition,estimateCardValueEUR} from '../data/store';
import type {RecognitionResult} from '../data/recognition';
import type {VisualAnalysis} from '../data/visualGrading';
import DocumentScanner from 'react-native-document-scanner-plugin';
import * as Haptics from 'expo-haptics';

type Props={onExit?:()=>void;onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis)=>Promise<void>|void;onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void};

export function ScannerScreen({onExit,onCaptured,onBackCaptured,onSaveCollection,onConditionSelected,onVisualAnalysis}:Props){
  const [scannerOpen,setScannerOpen]=useState(false);
  const [lastPhoto,setLastPhoto]=useState<string|null>(null);const [backPhoto,setBackPhoto]=useState<string|null>(null);const [scanningBack,setScanningBack]=useState(false);
  const [message,setMessage]=useState('Premi SCANSIONE: il telefono rileverà automaticamente i 4 bordi.');
  const [error,setError]=useState<string|null>(null);
  const [recognition,setRecognition]=useState<RecognitionResult|null>(null);
  const [selectedCondition,setSelectedCondition]=useState<Condition>('NM');const [conditionTouched,setConditionTouched]=useState(false);const [visualAnalysis,setVisualAnalysis]=useState<VisualAnalysis|null>(null);
  const [collectionSaved,setCollectionSaved]=useState(false);
  const [gradedId,setGradedId]=useState<string|undefined>();
  const [scanGeometry,setScanGeometry]=useState<{width:number;height:number;aspect:number;ok:boolean}|null>(null);
  const launched=useRef(false);

  const scanBack=async()=>{if(!gradedId||scanningBack)return;setScanningBack(true);setError(null);setMessage('Inquadra il retro della carta…');try{const result=await DocumentScanner.scanDocument({maxNumDocuments:1,croppedImageQuality:100});const scanned=result.scannedImages?.[0];if(!scanned){setMessage('Retro non acquisito. Il retro resta opzionale.');return}const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;setBackPhoto(uri);await onBackCaptured?.(gradedId,uri);setMessage('Analisi fronte + retro in corso…');const {analyzeCardCondition}=await import('../data/visualGrading'); const analysis=await analyzeCardCondition(lastPhoto||uri,uri).catch(()=>null);if(analysis){setVisualAnalysis(analysis);if(!conditionTouched){setSelectedCondition(analysis.condition);await onConditionSelected?.(gradedId,analysis.condition)}await onVisualAnalysis?.(gradedId,analysis)}setMessage('✓ Retro acquisito • valutazione fronte + retro aggiornata');await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}catch(errorValue){const cancelled=/cancel|dismiss|back/i.test(String(errorValue??''));setMessage(cancelled?'Acquisizione retro annullata.':'Impossibile acquisire il retro. Puoi continuare senza retro.');}finally{setScanningBack(false)}};

  const smartScan=async()=>{
    if(scannerOpen)return;
    setError(null);
    setScannerOpen(true);
    setMessage('Apertura scanner nativo…');
    try{
      const result=await DocumentScanner.scanDocument({
        maxNumDocuments:1,
        croppedImageQuality:100,
        // Il rilevamento nativo ML Kit collega automaticamente i quattro lati e corregge la prospettiva.\n        // Manteniamo la schermata di verifica dei vertici per consentire la conferma manuale quando serve.
      });
      const scanned=result.scannedImages?.[0];
      if(scanned){
        const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;
        setLastPhoto(uri);setBackPhoto(null);setVisualAnalysis(null);setConditionTouched(false);
        setMessage('✓ 4 lati rilevati • 4 angoli collegati • prospettiva corretta');
        await new Promise<void>(resolve=>RNImage.getSize(uri, (width,height)=>{const aspect=width/Math.max(1,height);setScanGeometry({width,height,aspect,ok:aspect>=0.66&&aspect<=0.77});resolve();}, ()=>resolve()));
        setMessage('Bordo carta verificato • avvio riconoscimento…');
        const {recognizeCardImage}=await import('../data/recognition'); const identified=await recognizeCardImage(uri,'pokemon').catch(()=>null);
        setRecognition(identified);
        setMessage(identified?.card?'Carta riconosciuta automaticamente.':'Carta acquisita: riconoscimento da verificare.');
        const savedId=await onCaptured?.(uri,identified?.card||undefined);
        setGradedId(savedId);
        setCollectionSaved(false);
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

  const chooseCondition=async(condition:Condition)=>{setConditionTouched(true);setSelectedCondition(condition);if(gradedId)await onConditionSelected?.(gradedId,condition);setCollectionSaved(false)};
  const saveCollection=async()=>{if(!recognition?.card||!onSaveCollection)return;await onSaveCollection(recognition.card,selectedCondition,lastPhoto||undefined,backPhoto||undefined,visualAnalysis||undefined);if(gradedId)await onConditionSelected?.(gradedId,selectedCondition);setCollectionSaved(true);setMessage('Carta salvata nella collezione con la condizione selezionata.');await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)};
  const retry=()=>{setLastPhoto(null);setBackPhoto(null);setVisualAnalysis(null);setConditionTouched(false);setRecognition(null);setScanGeometry(null);setGradedId(undefined);setCollectionSaved(false);setError(null);setMessage('Pronto: inquadra la carta. I 4 lati e i 4 angoli vengono rilevati automaticamente.');};
  const rescan=()=>{setLastPhoto(null);setBackPhoto(null);setRecognition(null);setScanGeometry(null);setGradedId(undefined);setCollectionSaved(false);void smartScan();};

  return <View style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity style={styles.exitButton} onPress={()=>onExit?.()}><Text style={styles.exitText}>‹</Text></TouchableOpacity>
      <View style={styles.headerTitle}>
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
      <View style={styles.edgeVerified}><View style={styles.edgeDot}/><View style={styles.flex}><Text style={styles.edgeTitle}>BORDO CARTA VERIFICATO</Text><Text style={styles.edgeCopy}>{scanGeometry?.ok?'4 lati • 4 angoli • proporzione corretta':'Proporzione da verificare prima del salvataggio'}</Text></View><Text style={styles.edgeCheck}>✓</Text></View>
      {recognition?.card&&<View style={styles.recognitionBox}><Text style={styles.resultTitle}>Riconoscimento</Text><Text style={styles.recognizedName}>{recognition.card.name}</Text><Text style={styles.resultCopy}>{recognition.card.setName||'Set non identificato'}{recognition.card.number?' · '+recognition.card.number:''}{recognition.language?' · '+recognition.language:''}</Text><Text style={styles.confidence}>Confidenza {Math.round(recognition.confidence*100)}%</Text></View>}
      <Text style={styles.resultTitle}>Carta acquisita e raddrizzata</Text>
      {visualAnalysis&&<View style={styles.analysisBox}><View style={styles.analysisHead}><Text style={styles.analysisTitle}>GRADING VISIVO ASSISTITO</Text><Text style={styles.analysisScore}>{visualAnalysis.score}/100</Text></View><Text style={styles.analysisSuggestion}>Suggerimento: <Text style={styles.analysisStrong}>{visualAnalysis.condition}</Text> · confidenza {visualAnalysis.confidence}%{visualAnalysis.hasBack?' · fronte + retro':' · solo fronte'}</Text><View style={styles.defectRow}>{visualAnalysis.defects.filter(d=>d.score>=28).map(d=><View key={d.type} style={styles.defectChip}><Text style={styles.defectChipText}>{d.type.replace('_',' ')} {Math.round(d.score)}</Text></View>)}</View><Text style={styles.analysisNote}>{visualAnalysis.notes[0]}</Text></View>}
      {recognition?.card&&<View style={styles.conditionBox}><Text style={styles.conditionTitle}>CONDIZIONE DELLA CARTA</Text><View style={styles.conditionRow}>{CONDITIONS.map(c=><TouchableOpacity key={c} onPress={()=>void chooseCondition(c)} style={selectedCondition===c?styles.conditionOn:styles.conditionOff}><Text style={selectedCondition===c?styles.conditionOnText:styles.conditionOffText}>{c}</Text></TouchableOpacity>)}</View><View style={styles.valueRow}><Text style={styles.valueLabel}>VALORE STIMATO ({selectedCondition})</Text><Text style={styles.valueText}>{estimateCardValueEUR(recognition.card.priceEUR,selectedCondition)>0?'€ '+estimateCardValueEUR(recognition.card.priceEUR,selectedCondition).toFixed(2):'—'}</Text></View></View>}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondary} onPress={retry}><Text style={styles.secondaryText}>Riprova</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={rescan}><Text style={styles.primaryText}>Nuova scansione</Text></TouchableOpacity>
      </View>
      {recognition?.card&&<TouchableOpacity style={styles.backButton} onPress={()=>void scanBack()} disabled={scanningBack}><Text style={styles.backButtonText}>{scanningBack?'ACQUISIZIONE RETRO…':backPhoto?'✓ RETRO ACQUISITO':'FOTOGRAFA RETRO (OPZIONALE)'}</Text></TouchableOpacity>}
      {backPhoto&&<View style={styles.backPreview}><Image source={{uri:backPhoto}} style={styles.backThumb} resizeMode="contain"/><View style={styles.flex}><Text style={styles.backTitle}>RETRO DISPONIBILE</Text><Text style={styles.backCopy}>La valutazione può considerare fronte e retro.</Text></View></View>}
      {recognition?.card&&onSaveCollection&&<TouchableOpacity style={[styles.collectionButton,collectionSaved&&styles.collectionSaved]} onPress={()=>void saveCollection()} disabled={collectionSaved}><Text style={styles.collectionButtonText}>{collectionSaved?'✓ IN COLLEZIONE':'SALVA IN COLLEZIONE'}</Text></TouchableOpacity>}
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
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:14},headerTitle:{flex:1,marginLeft:10},exitButton:{width:40,height:40,borderRadius:12,backgroundColor:'#20252d',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#303640'},exitText:{color:'#f5f7fa',fontSize:30,lineHeight:32,fontWeight:'700'},
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
  conditionBox:{marginTop:12,padding:12,borderRadius:14,backgroundColor:'#0d1014',borderWidth:1,borderColor:'#303640'},conditionTitle:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},conditionRow:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:9},conditionOn:{backgroundColor:'#b8ff5a',paddingHorizontal:10,paddingVertical:8,borderRadius:10},conditionOff:{backgroundColor:'#20252d',paddingHorizontal:10,paddingVertical:8,borderRadius:10},conditionOnText:{color:'#10130c',fontSize:11,fontWeight:'900'},conditionOffText:{color:'#f5f7fa',fontSize:11,fontWeight:'800'},valueRow:{marginTop:11,paddingTop:10,borderTopWidth:1,borderTopColor:'#2a3038',flexDirection:'row',justifyContent:'space-between',alignItems:'center'},valueLabel:{color:'#9aa3af',fontSize:10,fontWeight:'900'},valueText:{color:'#b8ff5a',fontSize:20,fontWeight:'900'},
  recognitionBox:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#0d1510',borderWidth:1,borderColor:'#426b27'},recognizedName:{color:'#b8ff5a',fontSize:20,fontWeight:'900',marginTop:4},confidence:{color:'#d8ff9c',fontSize:11,fontWeight:'800',marginTop:6},
  resultTitle:{color:'#f5f7fa',fontSize:17,fontWeight:'900'},resultCopy:{color:'#9aa3af',fontSize:12,lineHeight:18,marginTop:6},
  actions:{flexDirection:'row',gap:9,marginTop:13},primary:{flex:1,backgroundColor:'#b8ff5a',paddingVertical:12,borderRadius:12,alignItems:'center'},primaryText:{color:'#10130c',fontWeight:'900',fontSize:12},secondary:{flex:1,backgroundColor:'#20252d',paddingVertical:12,borderRadius:12,alignItems:'center'},secondaryText:{color:'#f5f7fa',fontWeight:'900',fontSize:12},collectionButton:{marginTop:10,backgroundColor:'#20252d',paddingVertical:13,borderRadius:12,alignItems:'center',borderWidth:1,borderColor:'#b8ff5a'},collectionButtonText:{color:'#b8ff5a',fontWeight:'900',fontSize:12},backButton:{marginTop:10,backgroundColor:'#20252d',paddingVertical:12,borderRadius:12,alignItems:'center',borderWidth:1,borderColor:'#4a525e'},backButtonText:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},backPreview:{marginTop:10,padding:10,borderRadius:12,backgroundColor:'#0d1014',borderWidth:1,borderColor:'#303640',flexDirection:'row',alignItems:'center',gap:10},backThumb:{width:58,height:82,borderRadius:7,backgroundColor:'#080a0d'},backTitle:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},backCopy:{color:'#9aa3af',fontSize:10,marginTop:3},collectionSaved:{backgroundColor:'#173016',borderColor:'#426b27'},
  flex:{flex:1},analysisBox:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#11151a',borderWidth:1,borderColor:'#4a525e'},analysisHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},analysisTitle:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},analysisScore:{color:'#b8ff5a',fontSize:20,fontWeight:'900'},analysisSuggestion:{color:'#9aa3af',fontSize:11,marginTop:6},analysisStrong:{color:'#b8ff5a',fontWeight:'900'},defectRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:9},defectChip:{backgroundColor:'#20252d',paddingHorizontal:8,paddingVertical:5,borderRadius:8},defectChipText:{color:'#d8dde5',fontSize:9,fontWeight:'800'},analysisNote:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:8},edgeVerified:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#0d1510',borderWidth:1,borderColor:'#426b27',flexDirection:'row',alignItems:'center',gap:10},edgeDot:{width:10,height:10,borderRadius:5,backgroundColor:'#b8ff5a'},edgeTitle:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},edgeCopy:{color:'#d8ff9c',fontSize:10,marginTop:3},edgeCheck:{color:'#b8ff5a',fontSize:22,fontWeight:'900'},
  error:{marginTop:10,padding:11,borderRadius:12,backgroundColor:'#2a1518',borderWidth:1,borderColor:'#5a252b'},errorText:{color:'#ff9b9b',fontSize:11},
  infoRow:{flexDirection:'row',gap:8,marginTop:12},info:{flex:1,padding:11,borderRadius:13,backgroundColor:'#14171c',borderWidth:1,borderColor:'#2a3038'},infoTitle:{color:'#b8ff5a',fontSize:10,fontWeight:'900'},infoCopy:{color:'#9aa3af',fontSize:9,marginTop:3,lineHeight:13}
});
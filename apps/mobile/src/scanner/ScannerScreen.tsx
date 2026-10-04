import React,{useEffect,useRef,useState} from 'react';
// [build] validate scanner UI and automatic grading pipeline — side detector + centering build
// final Android release trigger
import {StyleSheet,Text,TouchableOpacity,View,Image,ActivityIndicator,Image as RNImage,ScrollView} from 'react-native';
import type {CatalogCard} from '../data/catalog';
import {getPokemonSetCards,getYugiohSetCards} from '../data/catalog';
import {CONDITIONS,Condition,estimateCardValueEUR} from '../data/store';
import type {InspectionPhoto,ProfessionalAnalysis,GradedItem} from '../data/store';
import {PROFESSIONAL_INSPECTION_STEPS} from '../data/inspectionGuidance';
import {CardEdgeEditor} from './CardEdgeEditor';
import type {RecognitionResult} from '../data/recognition';
import type {VisualAnalysis} from '../data/visualGrading';
import * as Haptics from 'expo-haptics';
import {CameraView,useCameraPermissions} from 'expo-camera';

type Props={resumeGraded?:GradedItem;onExit?:()=>void;onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;onCardSelected?:(gradedId:string,card:CatalogCard)=>Promise<void>|void;onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis,professionalAnalysis?:ProfessionalAnalysis)=>Promise<void>|void;onProfessionalAnalysis?:(gradedId:string,analysis:ProfessionalAnalysis)=>Promise<void>|void;onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void};

export function ScannerScreen({resumeGraded,onExit,onCaptured,onBackCaptured,onSaveCollection,onConditionSelected,onVisualAnalysis,onProfessionalAnalysis,onCardSelected}:Props){
  const [scannerOpen,setScannerOpen]=useState(false);
  const [lastPhoto,setLastPhoto]=useState<string|null>(null);const [backPhoto,setBackPhoto]=useState<string|null>(null);const [scanningBack,setScanningBack]=useState(false);
  const [message,setMessage]=useState('Premi SCANSIONE: il telefono rileverà automaticamente i 4 bordi.');
  const [error,setError]=useState<string|null>(null);
  const [recognition,setRecognition]=useState<RecognitionResult|null>(null);
  const [selectedCondition,setSelectedCondition]=useState<Condition>('NM');const [conditionTouched,setConditionTouched]=useState(false);const [visualAnalysis,setVisualAnalysis]=useState<VisualAnalysis|null>(null);
  const [collectionSaved,setCollectionSaved]=useState(false);
  const [gradedId,setGradedId]=useState<string|undefined>();
  const [scanGeometry,setScanGeometry]=useState<{width:number;height:number;aspect:number;ok:boolean;centering?:{left:number;right:number;top:number;bottom:number}}|null>(null);
  const [game,setGame]=useState<'pokemon'|'yugioh'>('pokemon');
  const [professionalAnalysis,setProfessionalAnalysis]=useState<ProfessionalAnalysis|null>(null);
  const [recognizedVariants,setRecognizedVariants]=useState<CatalogCard[]>([]);
  const [selectedRecognizedCard,setSelectedRecognizedCard]=useState<CatalogCard|null>(null);
  const [professionalRunning,setProfessionalRunning]=useState(false);
  const [editorOpen,setEditorOpen]=useState(false);
  const [cameraOpen,setCameraOpen]=useState(false);
  const cameraRef=useRef<CameraView|null>(null);
  const pendingCapture=useRef<((result:{scannedImages:string[]})=>void)|null>(null);
  const [cameraPermission,requestCameraPermission]=useCameraPermissions();
  const launched=useRef(false);

  useEffect(()=>{
    if(!resumeGraded)return;
    setGradedId(resumeGraded.id);
    setLastPhoto(resumeGraded.image||null);
    setBackPhoto(resumeGraded.backImage||null);
    setProfessionalAnalysis(resumeGraded.professionalAnalysis||null);
    setVisualAnalysis(resumeGraded.visualAnalysis||null);
    setSelectedCondition(resumeGraded.condition||'NM');
    setSelectedRecognizedCard(resumeGraded.card||null);
    setRecognizedVariants(resumeGraded.card?[resumeGraded.card]:[]);
    setRecognition(resumeGraded.card?{
      card:resumeGraded.card,
      confidence:1,
      text:'',
      number:resumeGraded.card.number,
      language:resumeGraded.card.language,
      candidates:[resumeGraded.card],
      status:'matched',
      margin:1
    }:null);
    setMessage(resumeGraded.professionalAnalysis
      ? 'Analisi ripresa: puoi aggiungere le foto mancanti e rieseguire il controllo.'
      : 'Grading ripreso: puoi aggiungere retro, angoli, bordi e dettagli della superficie.');
  },[resumeGraded?.id]);


  const scanDocument=async(_options:any={})=>{
    if(!cameraPermission?.granted){
      const permission=await requestCameraPermission();
      if(!permission.granted)return {scannedImages:[]};
    }
    setCameraOpen(true);
    return await new Promise<{scannedImages:string[]}>(resolve=>{pendingCapture.current=resolve;});
  };

  const captureCameraPhoto=async()=>{
    if(!cameraRef.current||!cameraOpen)return;
    try{
      const photo=await cameraRef.current.takePictureAsync({quality:1});
      const uri=photo?.uri;
      if(!uri)return;
      setCameraOpen(false);
      pendingCapture.current?.({scannedImages:[uri]});
      pendingCapture.current=null;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});
    }catch(errorValue){
      setError('Impossibile acquisire la foto. Puoi riprovare.');
    }
  };

  const cancelCameraCapture=()=>{
    setCameraOpen(false);
    pendingCapture.current?.({scannedImages:[]});
    pendingCapture.current=null;
  };

  const scanBack=async()=>{if(!gradedId||scanningBack)return;setScanningBack(true);setError(null);setMessage('Inquadra il retro della carta…');try{const result=await scanDocument({maxNumDocuments:1,croppedImageQuality:100});const scanned=result.scannedImages?.[0];if(!scanned){setMessage('Retro non acquisito. Il retro resta opzionale.');return}const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;setBackPhoto(uri);await onBackCaptured?.(gradedId,uri);setMessage('Analisi fronte + retro in corso…');const {analyzeCardCondition}=await import('../data/visualGrading'); const analysis=await analyzeCardCondition(lastPhoto||uri,uri).catch(()=>null);if(analysis){setVisualAnalysis(analysis);if(!conditionTouched){setSelectedCondition(analysis.condition);await onConditionSelected?.(gradedId,analysis.condition)}await onVisualAnalysis?.(gradedId,analysis)}setMessage('✓ Retro acquisito • valutazione fronte + retro aggiornata');await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}catch(errorValue){const cancelled=/cancel|dismiss|back/i.test(String(errorValue??''));setMessage(cancelled?'Acquisizione retro annullata.':'Impossibile acquisire il retro. Puoi continuare senza retro.');}finally{setScanningBack(false)}};

  const processCapturedPhoto=async(uri:string)=>{
    setLastPhoto(uri);setBackPhoto(null);setVisualAnalysis(null);setConditionTouched(false);setRecognition(null);setRecognizedVariants([]);setSelectedRecognizedCard(null);
    setMessage('Carta acquisita • controllo qualità e riconoscimento multilingua…');
    const [{recognizeCardImage},{analyzeCardCondition}]=await Promise.all([import('../data/recognition'),import('../data/visualGrading')]);
    const [identified,analysis]=await Promise.all([recognizeCardImage(uri,game).catch(()=>null),analyzeCardCondition(uri).catch(()=>null)]);
    setRecognition(identified);
    setRecognizedVariants(identified?.candidates||[]);
    setSelectedRecognizedCard(identified?.card||null);
    if(analysis){setVisualAnalysis(analysis);if(!conditionTouched)setSelectedCondition(analysis.condition);}
    setMessage(identified?.card?'Carta riconosciuta • grading preliminare completato.':identified?.candidates?.length?'Possibile corrispondenza • scegli la stampa corretta.':'Carta acquisita • nessuna corrispondenza certa nel catalogo.');
    const savedId=await onCaptured?.(uri,identified?.card||identified?.candidates?.[0]);
    setGradedId(savedId);
    if(savedId&&analysis){await onVisualAnalysis?.(savedId,analysis);if(!conditionTouched)await onConditionSelected?.(savedId,analysis.condition);}
    setCollectionSaved(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const smartScan=async()=>{
    if(scannerOpen)return;
    setError(null);setScannerOpen(true);setMessage('Apertura scanner nativo…');
    try{
      const result=await scanDocument({maxNumDocuments:1,croppedImageQuality:100});
      const scanned=result.scannedImages?.[0];
      if(scanned){
        const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;
        setLastPhoto(uri);setBackPhoto(null);setVisualAnalysis(null);setConditionTouched(false);setRecognition(null);setRecognizedVariants([]);setSelectedRecognizedCard(null);
        await new Promise<void>(resolve=>RNImage.getSize(uri,(width,height)=>{const aspect=width/Math.max(1,height);setScanGeometry({width,height,aspect,ok:aspect>=0.66&&aspect<=0.77});resolve();},()=>resolve()));
        setMessage('✓ Carta raddrizzata • ora controlliamo la centratura sui 4 margini');
        setEditorOpen(true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }else setMessage('Nessuna carta acquisita.');
    }catch(errorValue){
      const text=String(errorValue??'');const cancelled=/cancel|dismiss|back/i.test(text);
      setMessage(cancelled?'Scansione annullata.':'Scanner nativo non disponibile.');
      if(!cancelled)setError('Il sistema non ha potuto avviare lo scanner. Puoi riprovare.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(()=>{});
    }finally{setScannerOpen(false);}
  };

  useEffect(()=>{
    if(!launched.current){launched.current=true;}
  },[]);

  const runProfessionalInspection=async()=>{if(!lastPhoto||professionalRunning)return;setProfessionalRunning(true);setError(null);try{const existing=professionalAnalysis?.photos||[];const photos:InspectionPhoto[]=[...existing];const addPhoto=(uri:string,purpose:InspectionPhoto['purpose'],label:string)=>{if(!photos.some(p=>p.purpose===purpose))photos.push({id:purpose+'-'+Date.now()+'-'+photos.length,uri,purpose,label,createdAt:new Date().toISOString()});};if(!photos.some(p=>p.purpose==='front'))addPhoto(lastPhoto,'front','Fronte');if(backPhoto&&!photos.some(p=>p.purpose==='back'))addPhoto(backPhoto,'back','Retro');for(const step of PROFESSIONAL_INSPECTION_STEPS){if(photos.some(p=>p.purpose===step.purpose))continue;setMessage(step.title+': '+step.instruction);const result=await scanDocument({maxNumDocuments:1,croppedImageQuality:100});const scanned=result.scannedImages?.[0];if(!scanned)throw new Error('Acquisizione annullata');const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;addPhoto(uri,step.purpose,step.title)}const {analyzeProfessionalInspection}=await import('../data/visualGrading');const analysis=await analyzeProfessionalInspection(photos);setProfessionalAnalysis(analysis);if(analysis.condition&&!conditionTouched){setSelectedCondition(analysis.condition);if(gradedId)await onConditionSelected?.(gradedId,analysis.condition);}if(gradedId)await onProfessionalAnalysis?.(gradedId,analysis);setMessage('✓ Valutazione automatica: '+(analysis.condition||'Da verificare')+' · '+(analysis.overall??'—')+'/100 · '+analysis.confidence+'% confidenza');await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}catch(errorValue){const cancelled=/cancel|dismiss|back|annull/i.test(String(errorValue??''));setMessage(cancelled?'Analisi professionale interrotta.':'Analisi professionale non completata: puoi riprovare.');if(!cancelled)setError('Puoi riprovare: le foto già acquisite restano disponibili.')}finally{setProfessionalRunning(false)}};

  const addExtraGradingPhoto=async()=>{
    if(!lastPhoto||professionalRunning)return;
    setProfessionalRunning(true);setError(null);
    try{
      setMessage('Acquisizione foto aggiuntiva: scegli un dettaglio utile (superficie, angolo o bordo)…');
      const result=await scanDocument({maxNumDocuments:1,croppedImageQuality:100});
      const scanned=result.scannedImages?.[0];
      if(!scanned)throw new Error('Acquisizione annullata');
      const uri=scanned.startsWith('file://')?scanned:'file://'+scanned;
      const existing=professionalAnalysis?.photos||[];
      const extra:InspectionPhoto={
        id:'extra-'+Date.now()+'-'+existing.length,
        uri,
        purpose:'surface_close',
        label:'Foto aggiuntiva',
        createdAt:new Date().toISOString()
      };
      const photos=[...existing,extra];
      const {analyzeProfessionalInspection}=await import('../data/visualGrading');
      const analysis=await analyzeProfessionalInspection(photos);
      setProfessionalAnalysis(analysis);
      if(analysis.condition&&!conditionTouched){setSelectedCondition(analysis.condition);if(gradedId)await onConditionSelected?.(gradedId,analysis.condition);}
      if(gradedId)await onProfessionalAnalysis?.(gradedId,analysis);
      setMessage('✓ Foto aggiuntiva acquisita • valutazione automatica: '+(analysis.condition||'Da verificare')+' · '+(analysis.overall??'—')+'/100');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }catch(errorValue){
      const cancelled=/cancel|dismiss|back|annull/i.test(String(errorValue??''));
      setMessage(cancelled?'Acquisizione foto aggiuntiva annullata.':'Foto aggiuntiva non acquisita.');
      if(!cancelled)setError('La foto non è stata aggiunta. Puoi riprovare.');
    }finally{setProfessionalRunning(false)}
  };

  const chooseCondition=async(condition:Condition)=>{setConditionTouched(true);setSelectedCondition(condition);if(gradedId)await onConditionSelected?.(gradedId,condition);setCollectionSaved(false)};
  const saveCollection=async()=>{const card=selectedRecognizedCard||recognition?.card;if(!card||!onSaveCollection)return;await onSaveCollection(card,selectedCondition,lastPhoto||undefined,backPhoto||undefined,visualAnalysis||undefined,professionalAnalysis||undefined);if(gradedId){await onConditionSelected?.(gradedId,selectedCondition);await onCardSelected?.(gradedId,card);}setCollectionSaved(true);setMessage('Carta salvata nella collezione con la condizione selezionata.');await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)};
  const retry=()=>{setEditorOpen(false);setLastPhoto(null);setBackPhoto(null);setVisualAnalysis(null);setConditionTouched(false);setRecognition(null);setRecognizedVariants([]);setSelectedRecognizedCard(null);setScanGeometry(null);setGradedId(undefined);setCollectionSaved(false);setError(null);setMessage('Pronto: inquadra la carta. Il rilevamento automatico raddrizza la carta e controlla poi la centratura.');};
  const rescan=()=>{setEditorOpen(false);setLastPhoto(null);setBackPhoto(null);setRecognition(null);setRecognizedVariants([]);setSelectedRecognizedCard(null);setScanGeometry(null);setGradedId(undefined);setCollectionSaved(false);void smartScan();};

  return <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={true}>\n  <View>
    <View style={styles.header}>
      <TouchableOpacity style={styles.exitButton} onPress={()=>onExit?.()}><Text style={styles.exitText}>‹</Text></TouchableOpacity>
      <View style={styles.headerTitle}>
        <Text style={styles.kicker}>POYUKEGIMONHO • CARD SCANNER</Text>
        <Text style={styles.title}>Scansione automatica</Text>
      </View>
      <View style={styles.nativeBadge}><Text style={styles.nativeBadgeText}>NATIVO</Text></View>
    </View>

    {editorOpen&&lastPhoto&&<CardEdgeEditor uri={lastPhoto}
      onCancel={()=>{setEditorOpen(false);void processCapturedPhoto(lastPhoto);}}
      onConfirm={async(uri,centering)=>{
        setScanGeometry(prev=>prev?{...prev,centering}:prev);
        setEditorOpen(false);
        await processCapturedPhoto(uri);
      }}
    />}
    <View style={styles.stage}>
      {cameraOpen?
        <View style={styles.cameraShell}>
          <CameraView ref={cameraRef} style={styles.cameraView} facing="back" mode="picture" autofocus="on" ratio="4:3" />
          <View pointerEvents="none" style={styles.cameraGuide}>
            <View style={styles.cameraGuideTop}/><View style={styles.cameraGuideRight}/><View style={styles.cameraGuideBottom}/><View style={styles.cameraGuideLeft}/>
            <Text style={styles.cameraGuideText}>INQUADRA LA CARTA • 4 LATI</Text>
          </View>
          <View style={styles.cameraControls}>
            <TouchableOpacity style={styles.cameraCancel} onPress={cancelCameraCapture}><Text style={styles.cameraCancelText}>ANNULLA</Text></TouchableOpacity>
            <TouchableOpacity style={styles.cameraShutter} onPress={()=>void captureCameraPhoto()}><View style={styles.cameraShutterInner}/></TouchableOpacity>
            <View style={styles.cameraControlSpacer}/>
          </View>
        </View>:
      lastPhoto?
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

    <View style={styles.scanChecklist}>
      <View style={styles.scanChecklistHead}><Text style={styles.scanChecklistTitle}>CONTROLLO SCANSIONE</Text><Text style={styles.scanChecklistHint}>locale · rapido · senza upload duplicati</Text></View>
      <View style={styles.scanChecks}>
        <View style={styles.scanCheck}><Text style={styles.scanCheckIcon}>{lastPhoto?'✓':'1'}</Text><View><Text style={styles.scanCheckTitle}>4 lati</Text><Text style={styles.scanCheckText}>bordo carta</Text></View></View>
        <View style={styles.scanCheck}><Text style={styles.scanCheckIcon}>{scanGeometry?.ok?'✓':'2'}</Text><View><Text style={styles.scanCheckTitle}>Prospettiva</Text><Text style={styles.scanCheckText}>{scanGeometry?.ok?'corretta':'da verificare'}</Text></View></View>
        <View style={styles.scanCheck}><Text style={styles.scanCheckIcon}>{recognition?'✓':'3'}</Text><View><Text style={styles.scanCheckTitle}>Riconoscimento</Text><Text style={styles.scanCheckText}>{recognition?'multilingua':'in attesa'}</Text></View></View>
        <View style={styles.scanCheck}><Text style={styles.scanCheckIcon}>{visualAnalysis?'✓':'4'}</Text><View><Text style={styles.scanCheckTitle}>Condizione</Text><Text style={styles.scanCheckText}>{visualAnalysis?visualAnalysis.condition:'automatica'}</Text></View></View>
      </View>
    </View>

    {lastPhoto&&<View style={styles.resultPanel}>
      <View style={styles.gameRow}><Text style={styles.gameLabel}>GIOCO</Text><TouchableOpacity onPress={()=>setGame('pokemon')} style={game==='pokemon'?styles.gameOn:styles.gameOff}><Text style={game==='pokemon'?styles.gameOnText:styles.gameOffText}>Pokémon</Text></TouchableOpacity><TouchableOpacity onPress={()=>setGame('yugioh')} style={game==='yugioh'?styles.gameOn:styles.gameOff}><Text style={game==='yugioh'?styles.gameOnText:styles.gameOffText}>Yu-Gi-Oh!</Text></TouchableOpacity></View>
      <View style={styles.edgeVerified}><View style={styles.edgeDot}/><View style={styles.flex}><Text style={styles.edgeTitle}>BORDO CARTA VERIFICATO</Text><Text style={styles.edgeCopy}>{scanGeometry?.centering?'centratura '+scanGeometry.centering.left+'% / '+scanGeometry.centering.right+'% · '+scanGeometry.centering.top+'% / '+scanGeometry.centering.bottom+'%':(scanGeometry?.ok?'carta raddrizzata • centratura da verificare':'Proporzione da verificare prima del salvataggio')}</Text></View><Text style={styles.edgeCheck}>✓</Text></View>
      {(recognition?.card||selectedRecognizedCard)&&<View style={styles.recognitionBox}><Text style={styles.resultTitle}>{recognition?.status==='matched'?'Riconoscimento':'Carta selezionata'}</Text><Text style={styles.recognizedName}>{(selectedRecognizedCard||recognition?.card)?.name}</Text><Text style={styles.resultCopy}>{(selectedRecognizedCard||recognition?.card)?.setName||'Set non identificato'}{(selectedRecognizedCard||recognition?.card)?.number?' · '+(selectedRecognizedCard||recognition?.card)?.number:''}{(selectedRecognizedCard||recognition?.card)?.language?' · '+(selectedRecognizedCard||recognition?.card)?.language:''}</Text>{recognition&&<Text style={styles.confidence}>Confidenza {Math.round(recognition.confidence*100)}%{recognition.number?' · numero rilevato '+recognition.number:''}</Text>}</View>}{recognition&&recognition.candidates.length>0&&<View style={styles.candidatesBox}><Text style={styles.printingTitle}>{recognition.status==='matched'?'ALTRE CORRISPONDENZE':'CARTE PROPOSTE'}</Text><Text style={styles.printingHint}>Sono risultati reali del catalogo. Tocca la carta che corrisponde alla stampa che possiedi.</Text><View style={styles.candidateRow}>{recognizedVariants.slice(0,8).map(v=><TouchableOpacity key={v.id} style={selectedRecognizedCard?.id===v.id?styles.candidateOn:styles.candidateOff} onPress={async()=>{setSelectedRecognizedCard(v);setRecognition(prev=>prev?{...prev,card:v,status:'matched',confidence:Math.max(prev.confidence,0.55)}:prev);if(gradedId)await onCardSelected?.(gradedId,v);setCollectionSaved(false)}}>{v.image?<Image source={{uri:v.image}} style={styles.candidateImage} resizeMode="contain"/>:null}<Text style={styles.candidateName} numberOfLines={1}>{v.name}</Text><Text style={styles.candidateMeta} numberOfLines={1}>{v.setName||'Set'}{v.number?' · '+v.number:''}</Text><Text style={styles.candidateMeta}>{v.language||'en'}{v.variantLabel?' · '+v.variantLabel:''}</Text></TouchableOpacity>)}</View></View>}{recognizedVariants.length>1&&<View style={styles.printingBox}><Text style={styles.printingTitle}>STAMPA / NUMERO RILEVATO</Text><Text style={styles.printingHint}>Se la carta ha più stampe, scegli quella che possiedi. Il numero collezionabile resta sempre distinto.</Text><View style={styles.printingRow}>{recognizedVariants.map(v=><TouchableOpacity key={v.id} style={selectedRecognizedCard?.id===v.id?styles.printingOn:styles.printingOff} onPress={async()=>{setSelectedRecognizedCard(v);if(gradedId)await onCardSelected?.(gradedId,v);setCollectionSaved(false)}}><Text style={selectedRecognizedCard?.id===v.id?styles.printingOnText:styles.printingOffText}>{v.number||'—'}</Text><Text style={selectedRecognizedCard?.id===v.id?styles.printingSubOn:styles.printingSubOff}>{v.variantLabel||(/H/i.test(String(v.number||''))?'Holo':'Stampa')}</Text></TouchableOpacity>)}</View></View>}
      <Text style={styles.resultTitle}>Carta acquisita e raddrizzata</Text>
      {visualAnalysis&&<View style={styles.analysisBox}><View style={styles.analysisHead}><Text style={styles.analysisTitle}>GRADING VISIVO ASSISTITO</Text><Text style={styles.analysisScore}>{visualAnalysis.score}/100</Text></View><Text style={styles.analysisSuggestion}>Suggerimento: <Text style={styles.analysisStrong}>{visualAnalysis.condition}</Text> · confidenza {visualAnalysis.confidence}%{visualAnalysis.hasBack?' · fronte + retro':' · solo fronte'}</Text><View style={styles.defectRow}>{visualAnalysis.defects.filter(d=>(d.score??(d.severity==='high'?60:d.severity==='medium'?35:15))>=28).map(d=><View key={d.id} style={styles.defectChip}><Text style={styles.defectChipText}>{d.type.replace('_',' ')} {Math.round(d.score??(d.severity==='high'?60:d.severity==='medium'?35:15))}</Text></View>)}</View><Text style={styles.analysisNote}>{visualAnalysis.notes[0]}</Text></View>}
      {professionalAnalysis&&<View style={styles.professionalBox}><View style={styles.analysisHead}><Text style={styles.analysisTitle}>ANALISI PROFESSIONALE</Text><Text style={styles.analysisScore}>{professionalAnalysis.overall||'—'}/100</Text></View><Text style={styles.analysisSuggestion}>{professionalAnalysis.photos.length} acquisizioni · confidenza {professionalAnalysis.confidence}%</Text>{professionalAnalysis.subgrades&&<View style={styles.subgradeRow}><Text style={styles.subgrade}>CENTER {professionalAnalysis.centeringStatus==='needs-card-geometry'?'DA MISURARE':professionalAnalysis.subgrades.centering}</Text><Text style={styles.subgrade}>CORNERS {professionalAnalysis.subgrades.corners}</Text><Text style={styles.subgrade}>EDGES {professionalAnalysis.subgrades.edges}</Text><Text style={styles.subgrade}>SURFACE {professionalAnalysis.subgrades.surface}</Text></View>}{professionalAnalysis.defects?.length?<View style={styles.defectRow}>{professionalAnalysis.defects.slice(0,12).map(d=><View key={d.id} style={styles.defectChip}><Text style={styles.defectChipText}>{d.type.replace('_',' ')} · {d.side} · {Math.round(d.score??0)}</Text></View>)}</View>:null}{professionalAnalysis.requiresMorePhotos&&<Text style={styles.analysisNote}>Servono altre foto ravvicinate/inclinate per aumentare la confidenza del grading.</Text>}<Text style={styles.analysisNote}>{professionalAnalysis.notes[0]}</Text></View>}
      {recognition?.card&&<TouchableOpacity style={styles.professionalButton} onPress={()=>void runProfessionalInspection()} disabled={professionalRunning}><Text style={styles.professionalButtonText}>{professionalRunning?'ANALISI PROFESSIONALE IN CORSO…':professionalAnalysis?'RIPETI ANALISI PROFESSIONALE':'AVVIA ANALISI PROFESSIONALE'}</Text><Text style={styles.professionalHint}>fronte • retro • ravvicinata • inclinata • angoli • bordi</Text></TouchableOpacity>}
      {recognition?.card&&professionalAnalysis&&<TouchableOpacity style={styles.backButton} onPress={()=>void addExtraGradingPhoto()} disabled={professionalRunning}><Text style={styles.backButtonText}>{professionalRunning?'ACQUISIZIONE FOTO…':'＋ AGGIUNGI FOTO DI VERIFICA'}</Text></TouchableOpacity>}
      {(selectedRecognizedCard||recognition?.card)&&<View style={styles.conditionBox}><Text style={styles.conditionTitle}>CONDIZIONE DELLA CARTA</Text><Text style={styles.conditionHint}>{selectedCondition==='Da verificare'?'Puoi salvarla ora e completare la condizione più tardi.':'Puoi modificarla in qualsiasi momento.'}</Text><View style={styles.conditionRow}>{CONDITIONS.map(c=><TouchableOpacity key={c} onPress={()=>void chooseCondition(c)} style={selectedCondition===c?styles.conditionOn:styles.conditionOff}><Text style={selectedCondition===c?styles.conditionOnText:styles.conditionOffText}>{c}</Text></TouchableOpacity>)}</View><View style={styles.valueRow}><Text style={styles.valueLabel}>VALORE STIMATO ({selectedCondition})</Text><Text style={styles.valueText}>{estimateCardValueEUR((selectedRecognizedCard||recognition?.card)?.priceEUR??0,selectedCondition)>0?'€ '+estimateCardValueEUR((selectedRecognizedCard||recognition?.card)?.priceEUR??0,selectedCondition).toFixed(2):'—'}</Text></View></View>}
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
  </View>\n  </ScrollView>
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#07090d'},scrollContent:{paddingHorizontal:16,paddingTop:18,paddingBottom:160},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:14,paddingHorizontal:2},headerTitle:{flex:1,marginLeft:10},exitButton:{width:40,height:40,borderRadius:12,backgroundColor:'#20252d',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#303640'},exitText:{color:'#f5f7fa',fontSize:30,lineHeight:32,fontWeight:'700'},
  kicker:{color:'#9aa3af',fontSize:10,fontWeight:'900',letterSpacing:1},
  title:{color:'#f5f7fa',fontSize:25,fontWeight:'900',marginTop:4},
  nativeBadge:{backgroundColor:'#b8ff5a',paddingHorizontal:10,paddingVertical:7,borderRadius:10},
  nativeBadgeText:{color:'#10130c',fontSize:10,fontWeight:'900'},
  stage:{flex:1,minHeight:420,borderRadius:24,overflow:'hidden',borderWidth:1,borderColor:'#2a3038',backgroundColor:'#0d1014',alignItems:'center',justifyContent:'center',padding:18},
  preview:{width:'100%',height:'100%',borderRadius:18,backgroundColor:'#080a0d'},
  cameraShell:{width:'100%',height:'100%',minHeight:420,borderRadius:18,overflow:'hidden',backgroundColor:'#000',position:'relative'},
  cameraView:{flex:1},
  cameraGuide:{position:'absolute',left:20,right:20,top:42,bottom:92,borderRadius:18,alignItems:'center',justifyContent:'center'},
  cameraGuideTop:{position:'absolute',left:0,right:0,top:0,height:3,backgroundColor:'#b8ff5a',borderRadius:2},
  cameraGuideRight:{position:'absolute',right:0,top:0,bottom:0,width:3,backgroundColor:'#b8ff5a',borderRadius:2},
  cameraGuideBottom:{position:'absolute',left:0,right:0,bottom:0,height:3,backgroundColor:'#b8ff5a',borderRadius:2},
  cameraGuideLeft:{position:'absolute',left:0,top:0,bottom:0,width:3,backgroundColor:'#b8ff5a',borderRadius:2},
  cameraGuideText:{position:'absolute',top:-25,color:'#b8ff5a',fontSize:10,fontWeight:'900',letterSpacing:1},
  cameraControls:{position:'absolute',left:0,right:0,bottom:16,height:68,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18},
  cameraCancel:{backgroundColor:'rgba(8,10,13,.82)',paddingHorizontal:13,paddingVertical:10,borderRadius:11,borderWidth:1,borderColor:'#606975'},
  cameraCancelText:{color:'#fff',fontSize:10,fontWeight:'900'},
  cameraShutter:{width:62,height:62,borderRadius:31,backgroundColor:'#fff',alignItems:'center',justifyContent:'center',borderWidth:4,borderColor:'rgba(184,255,90,.9)'},
  cameraShutterInner:{width:48,height:48,borderRadius:24,backgroundColor:'#b8ff5a'},
  cameraControlSpacer:{width:72},

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
  conditionBox:{marginTop:12,padding:12,borderRadius:14,backgroundColor:'#0d1014',borderWidth:1,borderColor:'#303640'},conditionHint:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:5},gameRow:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:12},gameLabel:{color:'#9aa3af',fontSize:10,fontWeight:'900',marginRight:4},gameOn:{backgroundColor:'#b8ff5a',paddingHorizontal:10,paddingVertical:7,borderRadius:9},gameOff:{backgroundColor:'#20252d',paddingHorizontal:10,paddingVertical:7,borderRadius:9},gameOnText:{color:'#10130c',fontSize:10,fontWeight:'900'},gameOffText:{color:'#f5f7fa',fontSize:10,fontWeight:'800'},professionalButton:{marginTop:10,padding:13,borderRadius:13,backgroundColor:'#1b2027',borderWidth:1,borderColor:'#b8ff5a',alignItems:'center'},professionalButtonText:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},professionalHint:{color:'#9aa3af',fontSize:9,marginTop:4,textAlign:'center'},professionalBox:{marginTop:10,marginBottom:4,padding:12,borderRadius:14,backgroundColor:'#0d1510',borderWidth:1,borderColor:'#426b27'},subgradeRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:9},subgrade:{backgroundColor:'#20252d',color:'#f5f7fa',paddingHorizontal:8,paddingVertical:5,borderRadius:8,fontSize:9,fontWeight:'900'},conditionTitle:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},conditionRow:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:9},conditionOn:{backgroundColor:'#b8ff5a',paddingHorizontal:10,paddingVertical:8,borderRadius:10},conditionOff:{backgroundColor:'#20252d',paddingHorizontal:10,paddingVertical:8,borderRadius:10},conditionOnText:{color:'#10130c',fontSize:11,fontWeight:'900'},conditionOffText:{color:'#f5f7fa',fontSize:11,fontWeight:'800'},valueRow:{marginTop:11,paddingTop:10,borderTopWidth:1,borderTopColor:'#2a3038',flexDirection:'row',justifyContent:'space-between',alignItems:'center'},valueLabel:{color:'#9aa3af',fontSize:10,fontWeight:'900'},valueText:{color:'#b8ff5a',fontSize:20,fontWeight:'900'},
  recognitionBox:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#0d1510',borderWidth:1,borderColor:'#426b27'},candidatesBox:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#10151b',borderWidth:1,borderColor:'#4a525e'},candidateRow:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:9},candidateOn:{width:'48%',backgroundColor:'#1b3014',borderWidth:1,borderColor:'#b8ff5a',borderRadius:10,padding:7},candidateOff:{width:'48%',backgroundColor:'#20252d',borderWidth:1,borderColor:'#303640',borderRadius:10,padding:7},candidateImage:{width:'100%',height:130,borderRadius:7,backgroundColor:'#0d1014'},candidateName:{color:'#f5f7fa',fontSize:10,fontWeight:'900',marginTop:5},candidateMeta:{color:'#9aa3af',fontSize:8,marginTop:2},recognizedName:{color:'#b8ff5a',fontSize:20,fontWeight:'900',marginTop:4},confidence:{color:'#d8ff9c',fontSize:11,fontWeight:'800',marginTop:6},
  resultTitle:{color:'#f5f7fa',fontSize:17,fontWeight:'900'},resultCopy:{color:'#9aa3af',fontSize:12,lineHeight:18,marginTop:6},
  actions:{flexDirection:'row',gap:9,marginTop:13},primary:{flex:1,backgroundColor:'#b8ff5a',paddingVertical:12,borderRadius:12,alignItems:'center'},primaryText:{color:'#10130c',fontWeight:'900',fontSize:12},secondary:{flex:1,backgroundColor:'#20252d',paddingVertical:12,borderRadius:12,alignItems:'center'},secondaryText:{color:'#f5f7fa',fontWeight:'900',fontSize:12},collectionButton:{marginTop:10,backgroundColor:'#20252d',paddingVertical:13,borderRadius:12,alignItems:'center',borderWidth:1,borderColor:'#b8ff5a'},collectionButtonText:{color:'#b8ff5a',fontWeight:'900',fontSize:12},backButton:{marginTop:10,backgroundColor:'#20252d',paddingVertical:12,borderRadius:12,alignItems:'center',borderWidth:1,borderColor:'#4a525e'},backButtonText:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},backPreview:{marginTop:10,padding:10,borderRadius:12,backgroundColor:'#0d1014',borderWidth:1,borderColor:'#303640',flexDirection:'row',alignItems:'center',gap:10},backThumb:{width:58,height:82,borderRadius:7,backgroundColor:'#080a0d'},backTitle:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},backCopy:{color:'#9aa3af',fontSize:10,marginTop:3},collectionSaved:{backgroundColor:'#173016',borderColor:'#426b27'},printingBox:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#10151b',borderWidth:1,borderColor:'#4a525e'},printingTitle:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},printingHint:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:5},printingRow:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:9},printingOn:{backgroundColor:'#b8ff5a',paddingHorizontal:10,paddingVertical:8,borderRadius:9,minWidth:72},printingOff:{backgroundColor:'#20252d',paddingHorizontal:10,paddingVertical:8,borderRadius:9,minWidth:72},printingOnText:{color:'#10130c',fontSize:11,fontWeight:'900'},printingOffText:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},printingSubOn:{color:'#263018',fontSize:8,fontWeight:'800',marginTop:2},printingSubOff:{color:'#9aa3af',fontSize:8,fontWeight:'800',marginTop:2},
  flex:{flex:1},analysisBox:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#11151a',borderWidth:1,borderColor:'#4a525e'},analysisHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},analysisTitle:{color:'#f5f7fa',fontSize:11,fontWeight:'900'},analysisScore:{color:'#b8ff5a',fontSize:20,fontWeight:'900'},analysisSuggestion:{color:'#9aa3af',fontSize:11,marginTop:6},analysisStrong:{color:'#b8ff5a',fontWeight:'900'},defectRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:9},defectChip:{backgroundColor:'#20252d',paddingHorizontal:8,paddingVertical:5,borderRadius:8},defectChipText:{color:'#d8dde5',fontSize:9,fontWeight:'800'},analysisNote:{color:'#9aa3af',fontSize:10,lineHeight:15,marginTop:8},edgeVerified:{marginBottom:12,padding:12,borderRadius:14,backgroundColor:'#0d1510',borderWidth:1,borderColor:'#426b27',flexDirection:'row',alignItems:'center',gap:10},edgeDot:{width:10,height:10,borderRadius:5,backgroundColor:'#b8ff5a'},edgeTitle:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},edgeCopy:{color:'#d8ff9c',fontSize:10,marginTop:3},edgeCheck:{color:'#b8ff5a',fontSize:22,fontWeight:'900'},
  error:{marginTop:10,padding:11,borderRadius:12,backgroundColor:'#2a1518',borderWidth:1,borderColor:'#5a252b'},errorText:{color:'#ff9b9b',fontSize:11},
  scanChecklist:{marginTop:10,padding:12,borderRadius:18,backgroundColor:'#0e131b',borderWidth:1,borderColor:'#273142'},
  scanChecklistHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  scanChecklistTitle:{color:'#f5f7fa',fontSize:11,fontWeight:'900',letterSpacing:.7},
  scanChecklistHint:{color:'#667184',fontSize:8},
  scanChecks:{flexDirection:'row',gap:6,marginTop:10},
  scanCheck:{flex:1,minHeight:62,backgroundColor:'#121923',borderRadius:12,borderWidth:1,borderColor:'#222d3b',padding:7},
  scanCheckIcon:{color:'#b8ff5a',fontSize:11,fontWeight:'900'},
  scanCheckTitle:{color:'#e9edf3',fontSize:9,fontWeight:'900',marginTop:3},
  scanCheckText:{color:'#7f8998',fontSize:8,marginTop:2},
  infoRow:{flexDirection:'row',gap:8,marginTop:12},info:{flex:1,padding:11,borderRadius:13,backgroundColor:'#14171c',borderWidth:1,borderColor:'#2a3038'},infoTitle:{color:'#b8ff5a',fontSize:10,fontWeight:'900'},infoCopy:{color:'#9aa3af',fontSize:9,marginTop:3,lineHeight:13}
});
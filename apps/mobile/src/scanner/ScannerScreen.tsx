import React,{useEffect,useRef,useState} from 'react';
// scanner UI and automatic grading pipeline — system camera + side detector + centering
// scanner foundation rebuilt with VisionCamera 5
// final Android release trigger
import {StyleSheet,Text,TouchableOpacity,View,Image,ActivityIndicator,Image as RNImage,ScrollView} from 'react-native';
import type {CatalogCard} from '../data/catalog';
import {getPokemonSetCards,getYugiohSetCards} from '../data/catalog';
import {CONDITIONS,Condition,estimateCardValueEUR} from '../data/store';
import type {InspectionPhoto,ProfessionalAnalysis,GradedItem} from '../data/store';
import {PROFESSIONAL_INSPECTION_STEPS} from '../data/inspectionGuidance';
import {CardEdgeEditor} from './CardEdgeEditor';
import {CardLiveCamera} from './CardLiveCamera';
import type {RecognitionResult} from '../data/recognition';
import type {VisualAnalysis} from '../data/visualGrading';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
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
  
  const scanDocument=async(_options:any={})=>{
    try{
      const permission=await ImagePicker.requestCameraPermissionsAsync();
      if(!permission.granted){
        setError('Permesso fotocamera non disponibile. Abilitalo nelle impostazioni e riprova.');
        return {scannedImages:[]};
      }
      const result=await ImagePicker.launchCameraAsync({
        quality:1,
        allowsEditing:false
      });
      const uri=result.canceled?undefined:result.assets?.[0]?.uri;
      return {scannedImages:uri?[uri]:[]};
    }catch(errorValue){
      setError('La fotocamera non è disponibile. Puoi importare una foto dalla galleria.');
      return {scannedImages:[]};
    }
  };


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
    setError(null);
    setMessage('Inquadra la carta: rilevamento camera live pronto.');
    setScannerOpen(true);
  };

  if(scannerOpen){
    return <CardLiveCamera
      onCancel={()=>{setScannerOpen(false);setMessage('Scansione annullata.');}}
      onCaptured={async(uri)=>{
        setScannerOpen(false);
        setLastPhoto(uri);
        setBackPhoto(null);
        setVisualAnalysis(null);
        setConditionTouched(false);
        setRecognition(null);
        setRecognizedVariants([]);
        setSelectedRecognizedCard(null);
        await new Promise<void>(resolve=>RNImage.getSize(uri,(width,height)=>{
          const aspect=width/Math.max(1,height);
          setScanGeometry({width,height,aspect,ok:aspect>=0.66&&aspect<=0.77});
          resolve();
        },()=>resolve()));
        setMessage('Foto acquisita • controllo bordo fisico e cornice stampata.');
        setEditorOpen(true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }}
    />;
  }

;
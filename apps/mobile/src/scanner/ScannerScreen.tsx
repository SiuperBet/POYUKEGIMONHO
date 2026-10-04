import React from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import type {CatalogCard} from '../data/catalog';
import type {InspectionPhoto,ProfessionalAnalysis,GradedItem,Condition} from '../data/store';
import type {VisualAnalysis} from '../data/visualGrading';

type Props={
  resumeGraded?:GradedItem;
  onExit?:()=>void;
  onCaptured?:(uri:string,card?:CatalogCard)=>Promise<string|undefined>|string|undefined;
  onCardSelected?:(gradedId:string,card:CatalogCard)=>Promise<void>|void;
  onBackCaptured?:(gradedId:string,uri:string)=>Promise<void>|void;
  onSaveCollection?:(card:CatalogCard,condition:Condition,scanImage?:string,backImage?:string,visualAnalysis?:VisualAnalysis,professionalAnalysis?:ProfessionalAnalysis)=>Promise<void>|void;
  onProfessionalAnalysis?:(gradedId:string,analysis:ProfessionalAnalysis)=>Promise<void>|void;
  onConditionSelected?:(gradedId:string,condition:Condition)=>Promise<void>|void;
  onVisualAnalysis?:(gradedId:string,analysis:VisualAnalysis)=>Promise<void>|void;
};

export function ScannerScreen({onExit}:Props){
  return <View style={styles.root}>
    <Text style={styles.kicker}>CARDGRADE • SCANNER</Text>
    <Text style={styles.title}>Scanner</Text>
    <Text style={styles.copy}>Il modulo scanner è stato rimosso e verrà ricostruito da zero con un'architettura pulita.</Text>
    <TouchableOpacity style={styles.button} onPress={onExit}><Text style={styles.buttonText}>TORNA ALL'APP</Text></TouchableOpacity>
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#07090c',alignItems:'center',justifyContent:'center',padding:28},
  kicker:{color:'#b8ff5a',fontSize:11,fontWeight:'900',letterSpacing:1.4,marginBottom:10},
  title:{color:'#f5f7fa',fontSize:34,fontWeight:'900',marginBottom:12},
  copy:{color:'#9aa3af',fontSize:15,lineHeight:22,textAlign:'center',maxWidth:360,marginBottom:24},
  button:{backgroundColor:'#b8ff5a',borderRadius:14,paddingHorizontal:22,paddingVertical:14},
  buttonText:{color:'#10130c',fontWeight:'900'}
});

import React from 'react';
import {SafeAreaView,StatusBar,StyleSheet} from 'react-native';
import {ScannerScreen} from './src/scanner/ScannerScreen';

export default function App(){return <SafeAreaView style={styles.root}><StatusBar barStyle="light-content"/><ScannerScreen/></SafeAreaView>;}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#050608'}});

import React,{useEffect,useState} from 'react';
import {AppState,AppStateStatus,Modal,StyleSheet,Text,TouchableOpacity,View,ActivityIndicator,Platform} from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const REPO='SiuperBet/POYUKEGIMONHO';
const RELEASES_API=`https://api.github.com/repos/${REPO}/releases/latest`;

type ReleaseInfo={tag_name:string;name?:string;body?:string;assets?:Array<{name:string;browser_download_url:string;content_type:string}>};

function buildNumber(tag:string){const m=tag.match(/build-(\d+)/i);return m?Number(m[1]):0}

export function AppUpdater(){
  const [release,setRelease]=useState<ReleaseInfo|null>(null);
  const [visible,setVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const lastCheckRef=React.useRef(0);
  const installingRef=React.useRef(false);

  const downloadAndInstall=async(data:ReleaseInfo)=>{
    if(Platform.OS!=='android'||installingRef.current)return;
    const apk=data.assets?.find(a=>a.name.toLowerCase().endsWith('.apk'));
    if(!apk)return;
    installingRef.current=true;
    setBusy(true);setError(null);
    try{
      const build=buildNumber(data.tag_name);
      const localUri=(FileSystem.cacheDirectory||FileSystem.documentDirectory||'')+`poyukegimonho-update-${build}.apk`;
      const result=await FileSystem.downloadAsync(apk.browser_download_url,localUri);
      const contentUri=await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{
        data:contentUri,
        type:'application/vnd.android.package-archive',
        flags:1
      });
    }catch(e){
      setError('Android richiede l’autorizzazione a installare aggiornamenti provenienti da questa app. Abilitala e riprova.');
    }finally{
      installingRef.current=false;
      setBusy(false);
    }
  };

  const check=async(force=false)=>{
    if(Platform.OS!=='android')return;
    const now=Date.now();
    // Avoid hammering the unauthenticated GitHub API while still checking again
    // when the user brings the app back to the foreground.
    if(!force&&now-lastCheckRef.current<10*60*1000)return;
    lastCheckRef.current=now;
    try{
      const response=await fetch(RELEASES_API,{headers:{Accept:'application/vnd.github+json'}});
      if(!response.ok)return;
      const data=await response.json() as ReleaseInfo;
      const remote=buildNumber(data.tag_name);
      const current=Number(Application.nativeBuildVersion||0);
      const apk=data.assets?.find(a=>a.name.toLowerCase().endsWith('.apk'));
      if(remote>current&&apk){
        setRelease(data);
        setVisible(true);
        // Start the update automatically. Android will show its own final
        // installation confirmation/permission screen; a normal APK cannot
        // be installed silently by a regular Android application.
        void downloadAndInstall(data);
      }
    }catch{}
  };

  useEffect(()=>{
    const timer=setTimeout(()=>void check(true),1200);
    const onStateChange=(state:AppStateStatus)=>{
      if(state==='active')void check();
    };
    const sub=AppState.addEventListener('change',onStateChange);
    return()=>{
      clearTimeout(timer);
      sub.remove();
    };
  },[]);

  const retry=async()=>{
    if(release)await downloadAndInstall(release);
    else await check(true);
  };

  const openInstallSettings=async()=>{
    if(Platform.OS!=='android')return;
    try{
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,{data:`package:${Application.applicationId||''}`});
    }catch{}
  };

  if(!release)return null;
  const build=buildNumber(release.tag_name);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={()=>setVisible(false)}>
    <View style={styles.backdrop}><View style={styles.card}>
      <Text style={styles.kicker}>POYUKEGIMONHO</Text>
      <Text style={styles.title}>NUOVO AGGIORNAMENTO</Text>
      <Text style={styles.copy}>È stata rilevata una nuova build. L’aggiornamento viene scaricato automaticamente.</Text>
      <View style={styles.version}><Text style={styles.label}>BUILD INSTALLATA</Text><Text style={styles.value}>{Application.nativeBuildVersion||'—'}</Text><Text style={styles.label}>NUOVA BUILD</Text><Text style={styles.value}>#{build}</Text></View>
      {busy?<View style={styles.loading}><ActivityIndicator/><Text style={styles.copy}>Download aggiornamento…</Text></View>:<><TouchableOpacity style={styles.primary} onPress={()=>void retry()}><Text style={styles.primaryText}>INSTALLA AGGIORNAMENTO</Text></TouchableOpacity>
        {error&&<><Text style={styles.error}>{error}</Text><TouchableOpacity style={styles.secondary} onPress={()=>void openInstallSettings()}><Text style={styles.secondaryText}>APRI IMPOSTAZIONI INSTALLAZIONE</Text></TouchableOpacity></>}
        <TouchableOpacity onPress={()=>setVisible(false)}><Text style={styles.later}>PIÙ TARDI</Text></TouchableOpacity>
      </>}
    </View></View>
  </Modal>
}

const styles=StyleSheet.create({
  backdrop:{flex:1,backgroundColor:'rgba(0,0,0,.78)',alignItems:'center',justifyContent:'center',padding:22},
  card:{width:'100%',maxWidth:420,backgroundColor:'#14171c',borderRadius:22,borderWidth:1,borderColor:'#39414c',padding:20},
  kicker:{color:'#b8ff5a',fontSize:10,fontWeight:'900',letterSpacing:1},title:{color:'#f5f7fa',fontSize:24,fontWeight:'900',marginTop:5},copy:{color:'#9aa3af',fontSize:13,lineHeight:19,marginTop:9},
  version:{marginTop:16,padding:13,borderRadius:14,backgroundColor:'#0d1014',borderWidth:1,borderColor:'#2a3038',flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},label:{color:'#9aa3af',fontSize:9,fontWeight:'900'},value:{color:'#f5f7fa',fontSize:14,fontWeight:'900'},
  primary:{marginTop:16,backgroundColor:'#b8ff5a',borderRadius:13,paddingVertical:14,alignItems:'center'},primaryText:{color:'#10130c',fontSize:13,fontWeight:'900'},secondary:{marginTop:10,backgroundColor:'#20252d',borderRadius:12,paddingVertical:12,alignItems:'center'},secondaryText:{color:'#f5f7fa',fontSize:10,fontWeight:'900'},later:{color:'#9aa3af',textAlign:'center',fontSize:11,fontWeight:'900',marginTop:15},loading:{alignItems:'center',gap:8,marginTop:18},error:{color:'#ff9b9b',fontSize:11,lineHeight:16,marginTop:12}
});

import React,{useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,FlatList,Image,SectionList,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getPokemonCardsForPokemon} from './src/data/catalog';
import type {CatalogCard} from './src/data/catalog';
import type {CollectionItem} from './src/data/store';

type DexPokemon={id:number;name:string;sprite:string};
type DexRow={items:DexPokemon[]};
type DexSection={key:string;title:string;count:number;owned:number;starters:number[];data:DexRow[]};
type RegionDef={key:string;title:string;start:number;end:number;starters:number[]};

const REGIONS:RegionDef[]=[
  {key:'kanto',title:'Kanto',start:1,end:151,starters:[1,4,7]},
  {key:'johto',title:'Johto',start:152,end:251,starters:[152,155,158]},
  {key:'hoenn',title:'Hoenn',start:252,end:386,starters:[252,255,258]},
  {key:'sinnoh',title:'Sinnoh',start:387,end:493,starters:[387,390,393]},
  {key:'unova',title:'Unova',start:494,end:649,starters:[495,498,501]},
  {key:'kalos',title:'Kalos',start:650,end:721,starters:[650,653,656]},
  {key:'alola',title:'Alola',start:722,end:809,starters:[722,725,728]},
  {key:'galar',title:'Galar',start:810,end:898,starters:[810,813,816]},
  {key:'hisui',title:'Hisui',start:899,end:905,starters:[899,900,901]},
  {key:'paldea',title:'Paldea',start:906,end:1025,starters:[906,909,912]},
];
const NATIONAL=1025;
const sprite=(id:number)=>'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+id+'.png';
const pretty=(name:string)=>name.split('-').map(x=>x?x[0].toUpperCase()+x.slice(1):x).join(' ');
const normalize=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim();

export function PokedexScreen({collection,onOpenCard,onScan,onBack}:{collection:CollectionItem[];onOpenCard:(card:CatalogCard)=>void;onScan:()=>void;onBack:()=>void}){
  const [pokemon,setPokemon]=useState<DexPokemon[]>([]);
  const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');
  const [mode,setMode]=useState<'regions'|'national'>('regions');
  const [selected,setSelected]=useState<DexPokemon|null>(null);
  const [expandedRegion,setExpandedRegion]=useState<string|null>(null);
  const [cards,setCards]=useState<CatalogCard[]>([]);
  const [cardsLoading,setCardsLoading]=useState(false);
  const [cardsError,setCardsError]=useState(false);

  useEffect(()=>{
    let active=true;
    (async()=>{
      setLoading(true);
      try{
        const cached=await AsyncStorage.getItem('poyukegimonho:pokedex:v1');
        if(cached){
          const parsed=JSON.parse(cached) as DexPokemon[];
          if(Array.isArray(parsed)&&parsed.length>=NATIONAL){if(active)setPokemon(parsed.slice(0,NATIONAL));setLoading(false);return;}
        }
        const response=await fetch('https://pokeapi.co/api/v2/pokemon?limit='+NATIONAL+'&offset=0');
        const data=await response.json();
        const list=(data.results||[]).map((x:any,i:number)=>({id:i+1,name:String(x.name),sprite:sprite(i+1)} as DexPokemon));
        if(active)setPokemon(list);
        if(list.length)void AsyncStorage.setItem('poyukegimonho:pokedex:v1',JSON.stringify(list));
      }catch{if(active)setPokemon([])}
      finally{if(active)setLoading(false)}
    })();
    return()=>{active=false};
  },[]);

  const ownedSet=useMemo(()=>{
    const set=new Set<number>();
    for(const p of pokemon){
      if(collection.some(c=>c.game==='pokemon'&&normalize(c.name).includes(normalize(p.name))))set.add(p.id);
    }
    return set;
  },[collection,pokemon]);

  const isCardOwned=useMemo(()=>{
    const owned=collection.filter(c=>c.game==='pokemon');
    return (card:CatalogCard)=>{
      if(owned.some(item=>item.id===card.id||item.id.startsWith(card.id+'::')))return true;
      return owned.some(item=>normalize(item.name)===normalize(card.name) &&
        (!card.setId||!item.setId||String(card.setId)===String(item.setId)) &&
        (!card.number||!item.number||String(card.number)===String(item.number)) &&
        (!card.language||!item.language||String(card.language)===String(item.language)));
    };
  },[collection]);

  const visible=useMemo(()=>{
    const q=normalize(query);
    if(!q)return pokemon;
    return pokemon.filter(p=>normalize(p.name).includes(q)||String(p.id)===q.replace(/^#/,''));
  },[pokemon,query]);

  const sections=useMemo<DexSection[]>(()=>{
    const make=(r:RegionDef):DexSection=>{
      const regionPokemon=visible.filter(p=>p.id>=r.start&&p.id<=r.end);
      const data=expandedRegion===r.key?regionPokemon:[];
      return {key:r.key,title:r.title,count:r.end-r.start+1,owned:regionPokemon.filter(p=>ownedSet.has(p.id)).length,starters:r.starters,data:Array.from({length:Math.ceil(data.length/3)},(_,i)=>({items:data.slice(i*3,i*3+3)}))};
    };
    if(mode==='national'){const data=visible;return [{key:'national',title:'National',count:NATIONAL,owned:data.filter(p=>ownedSet.has(p.id)).length,starters:[133,25,448],data:Array.from({length:Math.ceil(data.length/3)},(_,i)=>({items:data.slice(i*3,i*3+3)}))}];}
    return REGIONS.map(make);
  },[mode,visible,ownedSet,expandedRegion]);

  useEffect(()=>{
    if(!selected)return;
    let active=true;
    setCards([]);setCardsError(false);setCardsLoading(true);
    getPokemonCardsForPokemon(selected.name).then(v=>{if(active)setCards(v)}).catch(()=>{if(active)setCardsError(true)}).finally(()=>{if(active)setCardsLoading(false)});
    return()=>{active=false};
  },[selected]);

  if(selected){
    return <View style={styles.root}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.back} onPress={()=>setSelected(null)}><Text style={styles.backText}>‹</Text></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.title}>{pretty(selected.name)}</Text><Text style={styles.sub}>#{String(selected.id).padStart(4,'0')} · tutte le carte trovate</Text></View>
        <TouchableOpacity style={styles.scanTop} onPress={onScan}><Text style={styles.scanTopText}>SCAN</Text></TouchableOpacity>
      </View>
      <View style={styles.pokemonHero}>
        <Image source={{uri:selected.sprite}} style={styles.heroSprite}/>
        <View style={styles.flex}><Text style={styles.heroName}>{pretty(selected.name)}</Text><Text style={styles.muted}>{cards.length} carte nel catalogo TCGdex</Text></View>
      </View>
      {cardsLoading?<View style={styles.loading}><ActivityIndicator/><Text style={styles.muted}>Carico tutte le carte di {pretty(selected.name)}…</Text></View>:cardsError?<Text style={styles.empty}>Impossibile caricare le carte adesso.</Text>:cards.length===0?<Text style={styles.empty}>Nessuna carta trovata per questo Pokémon.</Text>:<FlatList data={cards} keyExtractor={c=>c.id} numColumns={3} contentContainerStyle={styles.grid} columnWrapperStyle={styles.row} renderItem={({item})=>{
        const owned=isCardOwned(item);
        return <TouchableOpacity style={[styles.card,!owned&&styles.cardMissing]} activeOpacity={0.82} onPress={()=>onOpenCard(item)}>
          {item.image?<Image source={{uri:item.image}} style={[styles.cardImage,!owned&&styles.cardImageMissing]} resizeMode="contain"/>:<View style={[styles.cardImage,!owned&&styles.cardImageMissing]}/>}
          {owned&&<View style={styles.cardOwned}><Text style={styles.cardOwnedText}>✓ POSSEDUTA</Text></View>}
          <Text style={[styles.cardName,!owned&&styles.cardNameMissing]} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.cardMeta}>{item.number||'—'}{item.rarity?' · '+item.rarity:''}</Text>
          <Text style={styles.cardSet} numberOfLines={1}>{item.setName||item.sourceId?.split('-')[0]||item.setId||'Set'}</Text>
          <Text style={styles.cardSet} numberOfLines={1}>{item.language||'en'}{item.variantLabel?' · '+item.variantLabel:''}</Text>
        </TouchableOpacity>;
      }}/>}
    </View>;
  }

  const renderSectionHeader=({section}:{section:DexSection})=>{
    const open=mode==='national'||expandedRegion===section.key;
    return <TouchableOpacity activeOpacity={0.88} onPress={()=>mode==='regions'&&setExpandedRegion(open?null:section.key)} style={styles.sectionHeader}>
      <View style={styles.sectionCopy}><View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>{section.title}</Text>{mode==='regions'&&<Text style={styles.sectionArrow}>{open?'⌃':'⌄'}</Text>}</View><Text style={styles.sectionCount}>{section.owned}/{section.count}</Text><View style={styles.progressTrack}><View style={[styles.progressFill,{width:((Math.min(1,section.owned/Math.max(1,section.count))*100)+'%') as `${number}%`}]}/></View></View>
      <View style={styles.starters}>{section.starters.map(id=><Image key={id} source={{uri:sprite(id)}} style={styles.starter}/>)}</View>
    </TouchableOpacity>;
  };

  const renderItem=({item}:{item:DexRow})=><View style={styles.row}>{item.items.map(p=>{
    const owned=ownedSet.has(p.id);
    return <TouchableOpacity key={p.id} style={[styles.pokemonCard,!owned&&styles.pokemonCardMissing]} activeOpacity={0.82} onPress={()=>setSelected(p)}>
      <Text style={styles.dexNumber}>#{p.id}</Text><Image source={{uri:p.sprite}} style={[styles.sprite,!owned&&styles.spriteMissing]}/><Text style={[styles.pokemonName,!owned&&styles.pokemonNameMissing]} numberOfLines={1}>{pretty(p.name)}</Text>{owned&&<View style={styles.owned}><Text style={styles.ownedText}>✓</Text></View>}
    </TouchableOpacity>;
  })}{item.items.length<3&&<View style={styles.pokemonCardGhost}/>}</View>;

  return <View style={styles.root}>
    <View style={styles.header}>
      <View style={styles.headerTop}><TouchableOpacity style={styles.back} onPress={onBack}><Text style={styles.backText}>‹</Text></TouchableOpacity><Text style={styles.title}>Pokédex</Text></View>
      <TextInput value={query} onChangeText={setQuery} placeholder="Cerca un Pokémon" placeholderTextColor="#777f91" style={styles.search}/>
      <View style={styles.modeRow}><TouchableOpacity onPress={()=>setMode('regions')} style={mode==='regions'?styles.modeOn:styles.modeOff}><Text style={mode==='regions'?styles.modeOnText:styles.modeText}>Regioni</Text></TouchableOpacity><TouchableOpacity onPress={()=>setMode('national')} style={mode==='national'?styles.modeOn:styles.modeOff}><Text style={mode==='national'?styles.modeOnText:styles.modeText}>Nazionale</Text></TouchableOpacity></View>
      <Text style={styles.caption}>{mode==='national'?NATIONAL+' Pokémon in ordine nazionale':'10 raccolte regionali · ogni Pokémon apre tutte le sue carte TCG'}</Text>
    </View>
    {loading?<View style={styles.loading}><ActivityIndicator/><Text style={styles.muted}>Carico il Pokédex…</Text></View>:<SectionList sections={sections as any} keyExtractor={(item:DexRow,index:number)=>String(item.items[0]?.id||index)} renderSectionHeader={renderSectionHeader as any} renderItem={renderItem as any} contentContainerStyle={styles.list} stickySectionHeadersEnabled={false} ListHeaderComponent={mode==='regions'?<TouchableOpacity activeOpacity={0.88} onPress={()=>setMode('national')} style={styles.nationalHero}><View style={styles.sectionCopy}><Text style={styles.sectionTitle}>National</Text><Text style={styles.sectionCount}>{visible.filter(p=>ownedSet.has(p.id)).length}/{NATIONAL}</Text><View style={styles.progressTrack}><View style={[styles.progressFill,{width:((Math.min(1,visible.filter(p=>ownedSet.has(p.id)).length/NATIONAL)*100)+'%') as `${number}%`}]}/></View></View><View style={styles.starters}>{[133,25,448].map(id=><Image key={id} source={{uri:sprite(id)}} style={styles.starter}/>)}</View></TouchableOpacity>:null} ListEmptyComponent={<Text style={styles.empty}>Nessun Pokémon trovato.</Text>}/>}
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#050608'},
  flex:{flex:1},
  header:{padding:18,paddingBottom:8},
  topBar:{padding:18,paddingBottom:8,flexDirection:'row',alignItems:'center',gap:10},
  headerTop:{flexDirection:'row',alignItems:'center',gap:12,marginBottom:16},
  back:{width:42,height:42,borderRadius:21,alignItems:'center',justifyContent:'center'},
  backText:{color:'#f5f7fa',fontSize:40,fontWeight:'300',lineHeight:42},
  title:{color:'#f5f7fa',fontSize:30,fontWeight:'900'},
  sub:{color:'#8f98a8',fontSize:11,marginTop:3},
  search:{height:54,borderRadius:16,borderWidth:1,borderColor:'#39476e',backgroundColor:'#080b15',color:'#f5f7fa',paddingHorizontal:16,fontSize:17},
  modeRow:{flexDirection:'row',gap:8,marginTop:10},
  modeOn:{flex:1,backgroundColor:'#b8ff5a',borderRadius:12,paddingVertical:11,alignItems:'center'},
  modeOff:{flex:1,backgroundColor:'#20252d',borderRadius:12,paddingVertical:11,alignItems:'center'},
  modeOnText:{color:'#10130c',fontWeight:'900'},
  modeText:{color:'#f5f7fa',fontWeight:'800'},
  caption:{color:'#8f98a8',fontSize:11,marginTop:8},
  list:{paddingHorizontal:18,paddingBottom:150},
  row:{gap:10,marginBottom:10},
  sectionHeader:{marginTop:8,marginBottom:10,minHeight:118,backgroundColor:'#141b31',borderWidth:1,borderColor:'#303b60',borderRadius:20,overflow:'hidden',flexDirection:'row',alignItems:'center',paddingLeft:16},
  sectionCopy:{flex:1},
  sectionTitleRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  sectionTitle:{color:'#f5f7fa',fontSize:27,fontWeight:'900'},
  sectionArrow:{color:'#d5dceb',fontSize:26,fontWeight:'700',paddingRight:10},
  nationalHero:{marginTop:8,marginBottom:10,minHeight:118,backgroundColor:'#141b31',borderWidth:1,borderColor:'#303b60',borderRadius:20,overflow:'hidden',flexDirection:'row',alignItems:'center',paddingLeft:16},
  sectionCount:{color:'#d5dceb',fontSize:18,fontWeight:'700',marginTop:2},
  progressTrack:{height:9,borderRadius:5,backgroundColor:'#e1e5ec',marginTop:9,overflow:'hidden',width:'92%'},
  progressFill:{height:'100%',backgroundColor:'#8e2bd7'},
  starters:{width:155,height:'100%',flexDirection:'row',alignItems:'flex-end',justifyContent:'center',paddingRight:5},
  starter:{width:66,height:66,marginLeft:-8},
  pokemonCard:{width:'31.9%',minHeight:172,backgroundColor:'#10152a',borderRadius:15,borderWidth:1,borderColor:'#39476e',padding:7,position:'relative'},pokemonCardMissing:{opacity:0.46,borderColor:'#2b3346'},pokemonCardGhost:{width:'31.9%',minHeight:172,opacity:0},
  dexNumber:{color:'#b6bdcb',fontSize:12},
  sprite:{width:'100%',height:100,marginTop:2},spriteMissing:{opacity:0.55},
  pokemonName:{color:'#f5f7fa',fontSize:12,fontWeight:'800',textAlign:'center',marginTop:2},pokemonNameMissing:{color:'#8b93a1'},
  owned:{position:'absolute',right:6,top:6,width:22,height:22,borderRadius:11,backgroundColor:'#b8ff5a',alignItems:'center',justifyContent:'center'},
  ownedText:{color:'#10130c',fontWeight:'900'},
  loading:{flex:1,alignItems:'center',justifyContent:'center',gap:10,padding:30},
  muted:{color:'#9aa3af',fontSize:12},
  empty:{color:'#9aa3af',fontSize:13,textAlign:'center',padding:30},
  scanTop:{backgroundColor:'#b8ff5a',paddingHorizontal:12,paddingVertical:9,borderRadius:10},
  scanTopText:{color:'#10130c',fontWeight:'900',fontSize:10},
  pokemonHero:{marginHorizontal:18,marginBottom:10,padding:12,backgroundColor:'#141b31',borderWidth:1,borderColor:'#303b60',borderRadius:18,flexDirection:'row',alignItems:'center',gap:12},
  heroSprite:{width:80,height:80},
  heroName:{color:'#f5f7fa',fontSize:22,fontWeight:'900'},
  grid:{paddingHorizontal:18,paddingBottom:150},
  card:{width:'31.9%',backgroundColor:'#10152a',borderRadius:12,borderWidth:1,borderColor:'#303b60',padding:7,minHeight:185},
  cardImage:{width:'100%',height:128,backgroundColor:'#080b15',borderRadius:7},
  cardName:{color:'#f5f7fa',fontSize:10,fontWeight:'900',marginTop:6},
  cardMeta:{color:'#b8c0cf',fontSize:9,marginTop:2},
  cardSet:{color:'#70798a',fontSize:8,marginTop:2}
});

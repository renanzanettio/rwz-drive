"use client";
import { createContext,useContext,useEffect,useMemo,useRef,useState } from "react";
import { filesApi } from "@/lib/api-client";
import { musicApi,type MusicCatalog,type MusicTrack } from "@/lib/music-api";
import { bindMediaSession } from "@/lib/media-session";
import { formatDuration } from "@/lib/format";
import { CreateJamButton } from "./JamActions";
import dialogs from "./MediaDialogs.module.css";
import styles from "./MusicPanel.module.css";
interface MusicContextValue {
  catalog:MusicCatalog|null;loading:boolean;error:string;queue:MusicTrack[];current:MusicTrack|null;playing:boolean;
  reload:()=>Promise<void>;play:(tracks:MusicTrack[],id?:string)=>void;enqueue:(track:MusicTrack)=>void;
  setCatalog:React.Dispatch<React.SetStateAction<MusicCatalog|null>>;
}
const Context=createContext<MusicContextValue|null>(null);
export function useMusic(){const value=useContext(Context);if(!value)throw new Error("Player de música indisponível.");return value;}
const mix=<T,>(items:T[])=>{const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
export function MusicProvider({scope,children}:{scope:string;children:React.ReactNode}){
  const [catalog,setCatalog]=useState<MusicCatalog|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [queue,setQueue]=useState<MusicTrack[]>([]),[current,setCurrent]=useState<MusicTrack|null>(null),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(1),[shuffle,setShuffle]=useState(false),[repeat,setRepeat]=useState<"off"|"all"|"one">("off"),[showQueue,setShowQueue]=useState(false),[sessionActive,setSessionActive]=useState(false);
  const audio=useRef<HTMLAudioElement>(null),queueRef=useRef<MusicTrack[]>([]),currentRef=useRef<MusicTrack|null>(null),repeatRef=useRef(repeat),shuffleRef=useRef(shuffle),original=useRef<MusicTrack[]>([]),active=useRef(true),startAt=useRef(0),lastSaved=useRef(0),actionRef=useRef({play:()=>{},pause:()=>{},next:()=>{},previous:()=>{},seek:(_n:number)=>{},stop:()=>{}});
  repeatRef.current=repeat;shuffleRef.current=shuffle;
  const storageKey="rwz-music-player-"+scope;
  const hydrated=useRef(false),catalogRef=useRef(catalog);
  catalogRef.current=catalog;
  function updateQueue(value:MusicTrack[]){queueRef.current=value;setQueue(value);}
  function remember(force=false){
    if(!hydrated.current)return;
    if(!force&&Date.now()-lastSaved.current<5000)return;lastSaved.current=Date.now();
    try{localStorage.setItem(storageKey,JSON.stringify({ids:queueRef.current.map(t=>t.id),current:currentRef.current?.id,position:audio.current?.currentTime??0,volume:audio.current?.volume??1,shuffle:shuffleRef.current,repeat:repeatRef.current}));}catch{}
  }
  async function reload(){
    setLoading(true);setError("");try{const next=await musicApi.catalog();if(!active.current)return;setCatalog(next);
      const available=new Map(next.tracks.map(t=>[t.id,t]));const revised=queueRef.current.filter(t=>available.has(t.id)).map(t=>available.get(t.id)!);updateQueue(revised);
      original.current=original.current.filter(t=>available.has(t.id)).map(t=>available.get(t.id)!);
      if(currentRef.current&&!available.has(currentRef.current.id)){stop();setError("A música atual foi removida do Drive.");}
      else if(currentRef.current){currentRef.current=available.get(currentRef.current.id)!;setCurrent(currentRef.current);}
    }catch(err){if(active.current)setError(err instanceof Error?err.message:"Falha ao abrir músicas.");}finally{if(active.current)setLoading(false);}
  }
  function loadTrack(track:MusicTrack,autoplay=true,offset=0){
    const media=audio.current;if(!media)return;
    currentRef.current=track;setCurrent(track);setPosition(offset);setDuration(track.duration_seconds??0);setError("");startAt.current=offset;
    media.src=filesApi.streamUrl(track.id);media.load();
    if(autoplay){setSessionActive(true);void media.play().catch(()=>{if(active.current){setPlaying(false);setError("Toque em Reproduzir para começar, ou confira se o formato é suportado.");}});}
    else setPlaying(false);
  }
  function play(tracks:MusicTrack[],id?:string){
    if(!tracks.length)return;
    const unique=[...new Map(tracks.map(t=>[t.id,t])).values()].slice(0,1000),selected=unique.find(t=>t.id===id)??unique[0];
    original.current=unique;updateQueue(shuffleRef.current?[selected,...mix(unique.filter(t=>t.id!==selected.id))]:unique);
    loadTrack(selected);remember(true);
  }
  function resume(){if(!audio.current||!currentRef.current)return;setSessionActive(true);void audio.current.play().catch(()=>setError("Toque novamente para liberar o áudio neste aparelho."));}
  function pause(){audio.current?.pause();remember(true);}
  function stop(){audio.current?.pause();audio.current?.removeAttribute("src");audio.current?.load();currentRef.current=null;setCurrent(null);updateQueue([]);setPlaying(false);setSessionActive(false);remember(true);}
  function next(automatic=false){
    const items=queueRef.current,current=currentRef.current;if(!current||!items.length)return;
    if(automatic&&repeatRef.current==="one"){if(audio.current)audio.current.currentTime=0;resume();return;}
    const index=items.findIndex(t=>t.id===current.id),following=items[index+1]??(repeatRef.current!=="off"?items[0]:null);
    if(following)loadTrack(following);else pause();
    remember(true);
  }
  function previous(){const media=audio.current,items=queueRef.current,index=items.findIndex(t=>t.id===currentRef.current?.id);if(media&&media.currentTime>3){media.currentTime=0;return;}if(items.length)loadTrack(items[index-1]??items[0]);}
  function seek(time:number){if(audio.current&&Number.isFinite(audio.current.duration)){audio.current.currentTime=Math.max(0,Math.min(time,audio.current.duration));setPosition(audio.current.currentTime);remember(true);}}
  function enqueue(track:MusicTrack){if(queueRef.current.some(t=>t.id===track.id))return;updateQueue([...queueRef.current,track].slice(0,1000));original.current=[...queueRef.current];if(!currentRef.current)loadTrack(track,false);remember(true);}
  actionRef.current={play:resume,pause,next:()=>next(),previous,seek,stop};
  useEffect(()=>{
    active.current=true;
    async function initialize(){
      let saved:any={};try{saved=JSON.parse(localStorage.getItem(storageKey)??"{}");}catch{}
      try{const data=await musicApi.catalog();if(!active.current)return;setCatalog(data);
        const ids=Array.isArray(saved.ids)?saved.ids.slice(0,1000):[],restored=ids.map((id:string)=>data.tracks.find(t=>t.id===id)).filter(Boolean) as MusicTrack[];
        if(typeof saved.volume==="number"&&saved.volume>=0&&saved.volume<=1){setVolume(saved.volume);if(audio.current)audio.current.volume=saved.volume;}
        setShuffle(Boolean(saved.shuffle));if(["off","all","one"].includes(saved.repeat))setRepeat(saved.repeat);
        updateQueue(restored);original.current=restored;hydrated.current=true;
        const track=restored.find(t=>t.id===saved.current)??restored[0];
        if(track)loadTrack(track,false,typeof saved.position==="number"&&Number.isFinite(saved.position)?Math.max(0,Math.min(saved.position,86400)):0);
      }catch(err){if(active.current)setError(err instanceof Error?err.message:"Não foi possível restaurar suas músicas.");}finally{if(active.current)setLoading(false);}
    }
    void initialize();
    const pagehide=()=>remember(true),otherMedia=(event:Event)=>{if((event as CustomEvent).detail?.source!=="drive-music"){pause();setSessionActive(false);}};
    const openFile=(event:Event)=>{const id=(event as CustomEvent<string>).detail;const track=catalogRef.current?.tracks.find(t=>t.id===id);if(track)play(catalogRef.current!.tracks,id);else void musicApi.catalog().then(data=>{if(active.current){setCatalog(data);const found=data.tracks.find(t=>t.id===id);if(found)play(data.tracks,id);}}).catch(()=>setError("Não foi possível abrir esta música."));};
    window.addEventListener("pagehide",pagehide);window.addEventListener("rwz-media-play",otherMedia);
    window.addEventListener("rwz-music-open",openFile);
    const media=audio.current!;
    return()=>{remember(true);active.current=false;window.removeEventListener("pagehide",pagehide);window.removeEventListener("rwz-media-play",otherMedia);window.removeEventListener("rwz-music-open",openFile);media.pause();media.removeAttribute("src");media.load();};
  },[scope]);
  useEffect(()=>{if(audio.current)audio.current.volume=volume;remember(true);},[volume,shuffle,repeat]);
  useEffect(()=>{
    if(!current||!sessionActive||!audio.current)return;
    return bindMediaSession(audio.current,{title:current.title,artist:current.artist,album:current.album,artwork:current.cover_file_id?filesApi.streamUrl(current.cover_file_id):undefined},{play:()=>actionRef.current.play(),pause:()=>actionRef.current.pause(),next:()=>actionRef.current.next(),previous:()=>actionRef.current.previous(),seek:n=>actionRef.current.seek(n),stop:()=>actionRef.current.stop()});
  },[current?.id,current?.title,current?.artist,current?.album,sessionActive]);
  const context=useMemo(()=>({catalog,loading,error,queue,current,playing,reload,play,enqueue,setCatalog}),[catalog,loading,error,queue,current,playing]);
  return <Context.Provider value={context}>
    <audio ref={audio} preload="metadata" aria-label={current?"Música: "+current.title:"Player de música"}
      onPlay={()=>{setPlaying(true);setSessionActive(true);window.dispatchEvent(new CustomEvent("rwz-media-play",{detail:{source:"drive-music"}}));}}
      onPause={()=>{setPlaying(false);remember(true);}}
      onTimeUpdate={()=>{if(audio.current)setPosition(audio.current.currentTime);remember();}}
      onLoadedMetadata={()=>{const media=audio.current!,track=currentRef.current;if(startAt.current>0&&Number.isFinite(media.duration))media.currentTime=Math.min(startAt.current,media.duration);startAt.current=0;setDuration(media.duration);
        if(track&&Number.isFinite(media.duration)&&media.duration>0&&media.duration<=86400)void musicApi.track(track.id,{duration_seconds:media.duration}).then(updated=>{if(active.current)setCatalog(old=>old?{...old,tracks:old.tracks.map(t=>t.id===updated.id?updated:t)}:old);}).catch(()=>{});}}
      onEnded={()=>next(true)} onError={()=>{if(currentRef.current)setError("Não foi possível tocar esta música. Confira a conexão e se o navegador suporta o formato.");}}/>
    <div className={current?styles.withPlayer:styles.scope}>{children}</div>
    {current&&<div className={styles.player} role="region" aria-label="Player de música fixo"><div className={styles.playerTrack}>{current.cover_file_id?<img src={filesApi.streamUrl(current.cover_file_id)} alt=""/>:<span className={styles.disc}>♫</span>}<div><strong>{current.title}</strong><small>{current.artist}</small></div></div>
      <div className={styles.playback}><div className={styles.transport}><button type="button" aria-label="Música anterior" onClick={previous}>‹</button><button type="button" className={styles.play} onClick={()=>playing?pause():resume()}>{playing?"Pausar":"Reproduzir"}</button><button type="button" aria-label="Próxima música" onClick={()=>next()}>›</button>
        <button type="button" aria-pressed={shuffle} onClick={()=>{const enabled=!shuffle;setShuffle(enabled);updateQueue(enabled?[current,...mix(queue.filter(t=>t.id!==current.id))]:original.current);remember(true);}}>Aleatório</button>
        <label>Repetir<select aria-label="Repetir músicas" value={repeat} onChange={e=>setRepeat(e.target.value as typeof repeat)}><option value="off">Não</option><option value="all">Fila</option><option value="one">Uma</option></select></label></div>
        <div className={styles.timeline}><span>{formatDuration(position)}</span><input aria-label="Posição da música" type="range" min="0" max={Number.isFinite(duration)&&duration>0?duration:1} step="0.1" value={Math.min(position,duration||1)} disabled={!duration} onChange={e=>seek(Number(e.target.value))}/><span>{Number.isFinite(duration)?formatDuration(duration):"—"}</span></div></div>
      <div className={styles.playerActions}><label>Volume<input type="range" aria-label="Volume da música" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><button type="button" onClick={()=>setShowQueue(true)}>Fila ({queue.length})</button><CreateJamButton fileId={current.id} fileIds={queue.map(t=>t.id)} position={()=>audio.current?.currentTime??0}/><button type="button" aria-label="Fechar player de música" onClick={stop}>×</button></div>
      {error&&<p className={styles.playerError} role="status">{error}</p>}</div>}
    {showQueue&&<div className={dialogs.overlay} onClick={()=>setShowQueue(false)}><section className={dialogs.dialog} role="dialog" aria-modal="true" aria-label="Fila de músicas" onClick={e=>e.stopPropagation()}><div className={dialogs.heading}><h2>Fila de músicas</h2><button type="button" className={dialogs.button} onClick={()=>setShowQueue(false)}>Fechar</button></div><ol className={styles.queue}>{queue.map((track,index)=><li key={track.id}><button type="button" onClick={()=>loadTrack(track)} aria-current={current?.id===track.id?"true":undefined}>{track.title}<small>{track.artist}</small></button><button type="button" aria-label={"Subir "+track.title} disabled={!index} onClick={()=>{const items=[...queue];[items[index-1],items[index]]=[items[index],items[index-1]];updateQueue(items);original.current=items;remember(true);}}>↑</button><button type="button" aria-label={"Remover da fila: "+track.title} onClick={()=>{const items=queue.filter(t=>t.id!==track.id);updateQueue(items);original.current=items;if(current?.id===track.id){if(items.length)loadTrack(items[Math.min(index,items.length-1)],playing);else stop();}remember(true);}}>×</button></li>)}</ol></section></div>}
  </Context.Provider>;
}
export function MusicFileButton({fileId}:{fileId:string}){const music=useMusic();return <button type="button" className={styles.primary} onClick={()=>{const track=music.catalog?.tracks.find(t=>t.id===fileId);if(track)music.play(music.catalog!.tracks,track.id);else void music.reload();}}>Reproduzir música</button>;}

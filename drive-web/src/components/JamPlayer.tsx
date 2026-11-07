"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { jamApi, type JamCommand } from "@/lib/jam-api";
import { formatDuration } from "@/lib/format";
import { bindMediaSession } from "@/lib/media-session";
import type { TimedJam } from "./JamRoom";
import styles from "./JamRoom.module.css";

export function JamPlayer({room,token,secret,online,busy,send}:{room:TimedJam;token:string;secret:string;online:boolean;busy:boolean;send:(command:JamCommand)=>Promise<void>}){
  const videoRef=useRef<HTMLMediaElement|null>(null),container=useRef<HTMLDivElement>(null),latest=useRef(room),connected=useRef(online),sendRef=useRef(send);
  const flushProgress=useRef<()=>void>(()=>{});
  const changing=useRef(false),locallyPaused=useRef(false);
  const ignoredPauses=useRef(0);
  const [localPaused,setLocalPaused]=useState(false);
  const isAudio=room.value.media_kind==="audio";
  latest.current=room;connected.current=online;sendRef.current=send;
  const [position,setPosition]=useState(room.value.position_seconds),[duration,setDuration]=useState(0),[draft,setDraft]=useState<number|null>(null),[volume,setVolume]=useState(1),[blocked,setBlocked]=useState(false),[buffering,setBuffering]=useState(false),[error,setError]=useState("");
  const [subtitle,setSubtitle]=useState(""),[size,setSize]=useState("22"),[color,setColor]=useState("#ffffff"),[delay,setDelay]=useState("0");
  const cues=useRef(new WeakMap<TextTrackCue,{start:number;end:number}>());
  const canControl=room.value.can_control&&online&&!busy;
  useEffect(()=>{
    try{const saved=JSON.parse(localStorage.getItem("rwz-jam-player")??"{}");
      if(typeof saved.volume==="number"&&saved.volume>=0&&saved.volume<=1)setVolume(saved.volume);
      if(["16","22","30"].includes(saved.size))setSize(saved.size);
      if(["#ffffff","#ffff00","#00ffff"].includes(saved.color))setColor(saved.color);
    }catch{}
  },[]);
  useEffect(()=>{try{localStorage.setItem("rwz-jam-player",JSON.stringify({volume,size,color}));}catch{}},[volume,size,color]);
  function target(){const state=latest.current;return state.value.position_seconds+(state.value.paused?0:Math.max(0,performance.now()-state.receivedAt)/1000*state.value.playback_rate);}
  function pauseNative(media=videoRef.current){if(media&&!media.paused){ignoredPauses.current++;media.pause();}}
  function synchronize(){
    const video=videoRef.current,state=latest.current.value;
    if(!video||video.readyState<1)return;
    if(!connected.current||locallyPaused.current){pauseNative(video);return;}
    const desired=Math.min(video.duration,target()),difference=desired-video.currentTime;
    if(Number.isFinite(desired)&&Math.abs(difference)>(state.paused?0.06:0.7))video.currentTime=Math.max(0,desired);
    video.playbackRate=state.playback_rate*(state.paused||Math.abs(difference)<0.12||Math.abs(difference)>0.7?1:difference>0?1.04:0.96);
    if(state.paused){pauseNative(video);}
    else if(video.paused&&desired<video.duration-0.05){void video.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));}
    setPosition(video.currentTime);
  }
  useEffect(()=>{
    const video=videoRef.current!;
    changing.current=true;setError("");setDuration(0);setDraft(null);
    const loaded=()=>{
      ignoredPauses.current=0;
      changing.current=false;
      setDuration(video.duration);synchronize();
      if(latest.current.value.is_host&&Number.isFinite(video.duration)&&video.duration>0)void jamApi.duration(token,secret,latest.current.value.file_id,video.duration).catch(()=>{});
    };
    const failed=()=>setError("Não foi possível abrir a mídia. Confira a conexão e se este aparelho suporta o formato.");
    const waiting=()=>setBuffering(true),playing=()=>{setBuffering(false);setBlocked(false);};
    const canplay=()=>setBuffering(false);
    video.addEventListener("loadedmetadata",loaded);video.addEventListener("error",failed);video.addEventListener("waiting",waiting);video.addEventListener("playing",playing);
    video.addEventListener("canplay",canplay);
    const interrupted=()=>{
      if(ignoredPauses.current>0){ignoredPauses.current--;return;}
      const state=latest.current.value;
      if(!isAudio||changing.current||state.paused||!connected.current||locallyPaused.current||video.ended)return;
      locallyPaused.current=true;setLocalPaused(true);
      if(state.can_control)void sendRef.current({action:"pause",position_seconds:video.currentTime});
    };
    video.addEventListener("pause",interrupted);
    if(isAudio)video.addEventListener("timeupdate",synchronize);
    video.src=jamApi.mediaBase(token,room.value.member_id)+"/stream/"+room.value.file_id;video.load();
    const interval=setInterval(synchronize,250);
    return()=>{changing.current=true;flushProgress.current();clearInterval(interval);video.removeEventListener("loadedmetadata",loaded);video.removeEventListener("error",failed);video.removeEventListener("waiting",waiting);video.removeEventListener("playing",playing);video.removeEventListener("canplay",canplay);video.removeEventListener("pause",interrupted);video.removeEventListener("timeupdate",synchronize);pauseNative(video);video.removeAttribute("src");video.load();};
  },[token,secret,room.value.file_id]);
  useEffect(()=>{synchronize();},[room,online]);
  useEffect(()=>{if(isAudio&&room.value.can_control&&room.value.paused){locallyPaused.current=false;setLocalPaused(false);}},[room.value.paused,room.value.can_control,isAudio]);
  useEffect(()=>{
    if(!room.value.is_host||isAudio)return;
    const video=videoRef.current!;let active=true,stopped=false,ready=false,revision:string|null=null,saving=false;
    let pending:{position_seconds:number;duration_seconds:number;completed?:boolean;keepalive:boolean}|null=null;
    let lastPosition=-1;
    async function flush(){
      if(saving||!pending||stopped)return;
      const checkpoint=pending;pending=null;saving=true;
      try{
        const saved=await jamApi.saveProgress(token,secret,room.value.file_id,{position_seconds:checkpoint.position_seconds,duration_seconds:checkpoint.duration_seconds,completed:checkpoint.completed,expected_updated_at:revision},checkpoint.keepalive);
        revision=saved.updated_at;lastPosition=checkpoint.position_seconds;
      }catch(err){if(err instanceof ApiError&&[401,403,409,410].includes(err.status)){stopped=true;if(active)setError(err.message);}else pending??=checkpoint;}
      finally{saving=false;}
      if(pending&&pending!==checkpoint&&!stopped)void flush();
    }
    function persist(force=false,keepalive=false){
      if(!ready||stopped||!connected.current||!Number.isFinite(video.duration)||video.duration<=0||video.error)return;
      if(!force&&Math.abs(lastPosition-video.currentTime)<4)return;
      pending={position_seconds:video.currentTime,duration_seconds:video.duration,completed:video.ended?true:undefined,keepalive};void flush();
    }
    jamApi.progress(token,secret,room.value.file_id).then(progress=>{if(active){revision=progress.updated_at;ready=true;lastPosition=progress.position_seconds;}}).catch(()=>{stopped=true;});
    const pause=()=>persist(true),ended=()=>persist(true),pagehide=()=>persist(true,true);
    flushProgress.current=pagehide;
    const interval=setInterval(()=>{if(!video.paused||pending)persist();},5000);
    video.addEventListener("pause",pause);video.addEventListener("seeked",pause);video.addEventListener("ended",ended);window.addEventListener("pagehide",pagehide);
    return()=>{persist(true,true);flushProgress.current=()=>{};active=false;clearInterval(interval);video.removeEventListener("pause",pause);video.removeEventListener("seeked",pause);video.removeEventListener("ended",ended);window.removeEventListener("pagehide",pagehide);};
  },[token,secret,room.value.file_id,room.value.is_host,isAudio]);
  function applySubtitles(){
    const amount=Math.max(-60,Math.min(60,Number(delay)||0));
    videoRef.current?.querySelectorAll("track").forEach(el=>{
      el.track.mode=el.dataset.id===subtitle?"showing":"disabled";
      if(el.track.cues)for(const cue of Array.from(el.track.cues)){
        let original=cues.current.get(cue);if(!original){original={start:cue.startTime,end:cue.endTime};cues.current.set(cue,original);}
        cue.startTime=Math.max(0,original.start+amount);cue.endTime=Math.max(cue.startTime+0.01,original.end+amount);
      }
    });
  }
  useEffect(()=>{applySubtitles();},[subtitle,delay]);
  async function fullscreen(){
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(container.current?.requestFullscreen)await container.current.requestFullscreen();else await (videoRef.current as HTMLVideoElement&{webkitEnterFullscreen?:()=>void})?.webkitEnterFullscreen?.();}
    catch{setError("Tela cheia indisponível neste aparelho.");}
  }
  function playPause(){
    const state=latest.current.value;if(!state.can_control||!connected.current)return;
    locallyPaused.current=false;setLocalPaused(false);
    if(state.paused)void videoRef.current?.play().catch(()=>{});
    void sendRef.current({action:state.paused?"play":"pause",position_seconds:videoRef.current?.currentTime??state.position_seconds});
  }
  function seek(seconds:number){
    const video=videoRef.current,state=latest.current.value;
    if(video&&state.can_control&&connected.current)void sendRef.current({action:"seek",position_seconds:Math.max(0,Math.min(video.duration,video.currentTime+seconds))});
  }
  useEffect(()=>{
    const keyboard=(event:KeyboardEvent)=>{
      if(event.altKey||event.metaKey||event.ctrlKey||(event.target as HTMLElement)?.closest("input,button,select,textarea,[role=dialog]"))return;
      if([" ","ArrowLeft","ArrowRight"].includes(event.key))event.preventDefault();
      if(event.key===" ")playPause();if(event.key==="ArrowLeft")seek(-10);if(event.key==="ArrowRight")seek(10);
      if(event.key.toLowerCase()==="f")void fullscreen();if(event.key.toLowerCase()==="m")setVolume(previous=>previous?0:1);
    };
    document.addEventListener("keydown",keyboard);return()=>document.removeEventListener("keydown",keyboard);
  },[]);
  useEffect(()=>{if(videoRef.current)videoRef.current.volume=volume;},[volume]);
  useEffect(()=>{
    if(!isAudio||!videoRef.current)return;
    const media=videoRef.current;
    return bindMediaSession(media,{title:room.value.title,artist:room.value.artist,album:room.value.album},{
      play:()=>{
        locallyPaused.current=false;setLocalPaused(false);
        if(latest.current.value.can_control&&latest.current.value.paused)playPause();
        else {void media.play().catch(()=>setBlocked(true));synchronize();}
      },
      pause:()=>{
        locallyPaused.current=true;setLocalPaused(true);pauseNative(media);
        if(latest.current.value.can_control)void sendRef.current({action:"pause",position_seconds:media.currentTime});
      },
      next:room.value.can_control?()=>{const state=latest.current.value,at=state.playlist.findIndex(t=>t.id===state.file_id),next=state.playlist[at+1];if(next)void sendRef.current({action:"select",file_id:next.id});}:undefined,
      previous:room.value.can_control?()=>{const state=latest.current.value,at=state.playlist.findIndex(t=>t.id===state.file_id),previous=state.playlist[at-1];if(previous)void sendRef.current({action:"select",file_id:previous.id});else void sendRef.current({action:"seek",position_seconds:0});}:undefined,
      seek:room.value.can_control?time=>void sendRef.current({action:"seek",position_seconds:Math.max(0,Math.min(media.duration,time))}):undefined,
    });
  },[isAudio,room.value.file_id,room.value.title,room.value.artist,room.value.album,room.value.can_control]);
  const base=jamApi.mediaBase(token,room.value.member_id),index=room.value.playlist.findIndex(item=>item.id===room.value.file_id);
  return <>
    <div ref={container} className={styles.player} style={{"--jam-subtitle-size":size+"px","--jam-subtitle-color":color}as React.CSSProperties}>
      <div className={styles.screen}>{isAudio?<div className={styles.audioStage}><audio ref={element=>{videoRef.current=element;}} preload="metadata" aria-label={room.value.title}/><div className={styles.audioDisc}>♫</div><h2>{room.value.title}</h2><p>{room.value.artist}</p><small>{room.value.album}</small></div>:<video ref={element=>{videoRef.current=element;}} playsInline preload="metadata" aria-label={room.value.title}>
        {room.value.subtitles.map(track=><track key={track.id} kind="subtitles" label={track.label} data-id={track.id} onLoad={applySubtitles} src={`${base}/subtitles/${room.value.file_id}/${track.id}`}/>)}</video>
        }
        {(blocked||localPaused)&&<button type="button" className={styles.activate} onClick={()=>{locallyPaused.current=false;setLocalPaused(false);const video=videoRef.current;if(video)void video.play().then(()=>{setBlocked(false);if(latest.current.value.paused)pauseNative(video);}).catch(()=>setError("Toque novamente para liberar a reprodução neste aparelho."));}}>{isAudio?"Retomar áudio neste aparelho":"Ativar vídeo neste aparelho"}</button>}
        {!online&&<div className={styles.overlayStatus}>Reconectando à sala…</div>}
      </div>
      <div className={styles.transport}>
        <button type="button" className={styles.primary} disabled={!canControl} onClick={playPause}>{room.value.paused?"Reproduzir":"Pausar"}</button>
        <button type="button" className={styles.button} disabled={!canControl} onClick={()=>seek(-10)}>−10s</button><button type="button" className={styles.button} disabled={!canControl} onClick={()=>seek(10)}>+10s</button>
        <span className={styles.time}>{formatDuration(position)} / {formatDuration(duration)}</span>
        <label className={styles.volume}>Volume<input aria-label="Volume neste aparelho" type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
        {isAudio&&!room.value.can_control&&<button type="button" className={styles.button} onClick={()=>{const value=!locallyPaused.current;locallyPaused.current=value;setLocalPaused(value);if(value)pauseNative();else synchronize();}}>{localPaused?"Retomar escuta":"Pausar neste aparelho"}</button>}
        {!isAudio&&<button type="button" className={styles.button} onClick={()=>void fullscreen()}>Tela cheia</button>}
      </div>
      <div className={styles.timeline}><input type="range" aria-label={isAudio?"Posição da música na Jam":"Posição do vídeo na Jam"} min="0" max={duration||1} step="0.1" value={Math.min(duration||1,draft??position)} disabled={!canControl||!duration}
        onChange={e=>setDraft(Number(e.target.value))} onPointerUp={e=>{const value=Number(e.currentTarget.value);setDraft(null);if(canControl)void send({action:"seek",position_seconds:value});}}
        onKeyUp={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key)){const value=Number(e.currentTarget.value);setDraft(null);if(canControl)void send({action:"seek",position_seconds:value});}}}/></div>
      <div className={styles.extraControls}><label>Velocidade<select value={room.value.playback_rate} disabled={!canControl} onChange={e=>void send({action:"rate",playback_rate:Number(e.target.value)})}>{[0.5,0.75,1,1.25,1.5,2].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select></label>
        <button className={styles.button} type="button" onClick={()=>{setError("");synchronize();}}>Sincronizar agora</button>
        {index>0&&<button className={styles.button} disabled={!canControl} type="button" onClick={()=>void send({action:"select",file_id:room.value.playlist[index-1].id})}>{isAudio?"Música anterior":"Episódio anterior"}</button>}
        {index<room.value.playlist.length-1&&<button className={styles.button} disabled={!canControl} type="button" onClick={()=>void send({action:"select",file_id:room.value.playlist[index+1].id})}>{isAudio?"Próxima música":"Próximo episódio"}</button>}
      </div>
      {!isAudio&&<details className={styles.subtitles}><summary>Legendas neste aparelho</summary><div className={styles.extraControls}>
        <label>Legenda<select value={subtitle} onChange={e=>setSubtitle(e.target.value)}><option value="">Desativada</option>{room.value.subtitles.map(track=><option key={track.id} value={track.id}>{track.label}</option>)}</select></label>
        <label>Tamanho<select value={size} onChange={e=>setSize(e.target.value)}><option value="16">Pequena</option><option value="22">Média</option><option value="30">Grande</option></select></label>
        <label>Cor<select value={color} onChange={e=>setColor(e.target.value)}><option value="#ffffff">Branco</option><option value="#ffff00">Amarelo</option><option value="#00ffff">Ciano</option></select></label>
        <label>Atraso (s)<input type="number" min="-60" max="60" step="0.5" value={delay} onChange={e=>setDelay(e.target.value)}/></label>
      </div></details>}
    </div>
    {buffering&&!room.value.paused&&<p className={styles.hint} role="status">Carregando mídia neste aparelho…</p>}{error&&<p className={styles.error} role="alert">{error}</p>}
  </>;
}

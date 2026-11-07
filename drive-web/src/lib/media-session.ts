export interface SessionTrack {title:string;artist?:string;album?:string;artwork?:string}
export interface SessionActions {play:()=>void;pause:()=>void;next?:()=>void;previous?:()=>void;seek?:(time:number)=>void;stop?:()=>void}
let sessionOwner:symbol|null=null;
export function updateMediaPosition(media:HTMLMediaElement){
  if(!("mediaSession"in navigator))return;
  try{if(Number.isFinite(media.duration)&&media.duration>0)navigator.mediaSession.setPositionState({duration:media.duration,playbackRate:media.playbackRate,position:Math.max(0,Math.min(media.currentTime,media.duration))});}catch{}
}
export function bindMediaSession(media:HTMLMediaElement,track:SessionTrack,actions:SessionActions){
  if(!("mediaSession"in navigator))return()=>{};
  const owner=Symbol();sessionOwner=owner;
  try{navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:track.artist??"",album:track.album??"RWZ Drive",artwork:[{src:track.artwork??new URL("/icon2.png",location.origin).href}]});}catch{}
  const handlers:Partial<Record<MediaSessionAction,MediaSessionActionHandler|null>>={
    play:actions.play,pause:actions.pause,stop:actions.stop??actions.pause,
    nexttrack:actions.next??null,previoustrack:actions.previous??null,
    seekto:actions.seek?event=>{if(event.seekTime!==undefined)actions.seek!(event.seekTime);}:null,
    seekbackward:actions.seek?event=>actions.seek!(Math.max(0,media.currentTime-(event.seekOffset??10))):null,
    seekforward:actions.seek?event=>actions.seek!(Math.min(media.duration,media.currentTime+(event.seekOffset??10))):null,
  };
  for(const [action,handler]of Object.entries(handlers))try{navigator.mediaSession.setActionHandler(action as MediaSessionAction,handler);}catch{}
  const state=()=>{if(sessionOwner===owner){navigator.mediaSession.playbackState=media.paused?"paused":"playing";updateMediaPosition(media);}};
  for(const event of ["playing","pause","loadedmetadata","timeupdate","ratechange"])media.addEventListener(event,state);
  state();
  const audioSession=(navigator as Navigator&{audioSession?:{type:string}}).audioSession;
  try{if(audioSession)audioSession.type="playback";}catch{}
  return()=>{
    for(const event of ["playing","pause","loadedmetadata","timeupdate","ratechange"])media.removeEventListener(event,state);
    if(sessionOwner!==owner)return;
    sessionOwner=null;for(const action of Object.keys(handlers))try{navigator.mediaSession.setActionHandler(action as MediaSessionAction,null);}catch{}
    navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState="none";try{navigator.mediaSession.setPositionState();}catch{}
  };
}

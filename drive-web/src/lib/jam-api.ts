import { ApiError, type WatchProgress } from "./api-client";
import { withImpersonation } from "./impersonation";

export interface JamState {
  media_kind:"audio"|"video";artist:string;album:string;
  name:string; revision:number; server_now:number; expires_at:number;
  file_id:string; title:string; show:string; position_seconds:number;paused:boolean;playback_rate:number;
  guests_control:boolean;auto_next:boolean;can_control:boolean;is_host:boolean;member_id:string;
  playlist:{id:string;title:string;show:string;duration:number|null}[];
  subtitles:{id:string;label:string}[];
  participants:{id:string;name:string;role:"host"|"guest"}[];
}
export interface JamMembership {secret:string;state:JamState}
export type JamCommand={action:string;position_seconds?:number;playback_rate?:number;file_id?:string;guests_control?:boolean;auto_next?:boolean;member_id?:string};
async function request<T>(path:string,init:RequestInit={},secret?:string):Promise<T>{
  const res=await fetch("/api/jam"+path,{...init,cache:"no-store",credentials:"same-origin",headers:{
    ...(init.body?{"Content-Type":"application/json"}:{}),...(secret?{Authorization:"Bearer "+secret}:{}),...init.headers,
  }});
  if(!res.ok){const body=await res.json().catch(()=>({}));throw new ApiError(res.status,body.error??"Não foi possível conectar à Jam.");}
  return res.json();
}
export const jamApi={
  create:(file:string,guestsControl:boolean,position?:number,music?:{playlist_id?:string;file_ids?:string[]})=>request<{token:string}>(withImpersonation("/rooms"),{method:"POST",body:JSON.stringify({file_id:file,guests_control:guestsControl,position_seconds:position,...music})}),
  list:()=>request<{rooms:{token:string;name:string;expires_at:number}[]}>("/rooms"),
  preview:(token:string)=>request<{name:string;title:string;expires_at:number;media_kind:"audio"|"video"}>(`/${token}/preview`),
  join:(token:string,name:string,host:boolean)=>request<JamMembership>(`/${token}/join`,{method:"POST",body:JSON.stringify({name,host})}),
  state:(token:string,secret:string)=>request<JamState>(`/${token}/state`,{},secret),
  command:(token:string,secret:string,revision:number,command:JamCommand)=>request<JamState|{closed:true}>(`/${token}/command`,{method:"POST",body:JSON.stringify({...command,revision})},secret),
  duration:(token:string,secret:string,file:string,seconds:number)=>request<JamState>(`/${token}/duration`,{method:"POST",body:JSON.stringify({file_id:file,seconds})},secret),
  leave:(token:string,secret:string)=>request(`/${token}/leave`,{method:"POST"},secret),
  progress:(token:string,secret:string,file:string)=>request<WatchProgress>(`/${token}/progress/${file}`,{},secret),
  saveProgress:(token:string,secret:string,file:string,body:unknown,keepalive=false)=>request<WatchProgress>(`/${token}/progress/${file}`,{method:"PUT",body:JSON.stringify(body),keepalive},secret),
  mediaBase:(token:string,member:string)=>`/api/jam/${token}/media/${member}`,
};

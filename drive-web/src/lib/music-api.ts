import { ApiError } from "./api-client";
import { withImpersonation } from "./impersonation";
export interface MusicTrack {id:string;title:string;artist:string;album:string;duration_seconds:number|null;favorite:boolean;folder_id:string|null;cover_file_id:string|null;original_name:string}
export interface MusicPlaylist {id:string;name:string;description:string;cover_file_id:string|null;file_ids:string[];revision:number;updated_at:string}
export interface MusicCatalog {tracks:MusicTrack[];playlists:MusicPlaylist[]}
async function request<T>(path:string,method="GET",body?:unknown):Promise<T>{
  const response=await fetch(withImpersonation("/api/music"+path),{method,cache:"no-store",credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new ApiError(response.status,data.error??"Não foi possível abrir suas músicas.");}return response.json();
}
export const musicApi={
  catalog:()=>request<MusicCatalog>("/"),
  create:(body:{name:string;description?:string;cover_file_id?:string|null;file_ids?:string[]})=>request<MusicPlaylist>("/playlists","POST",body),
  update:(playlist:MusicPlaylist,body:Partial<Pick<MusicPlaylist,"name"|"description"|"cover_file_id"|"file_ids">>)=>request<MusicPlaylist>("/playlists/"+playlist.id,"PUT",{...body,revision:playlist.revision}),
  remove:(playlist:MusicPlaylist)=>request("/playlists/"+playlist.id,"DELETE",{revision:playlist.revision}),
  addFolder:(playlist:MusicPlaylist,folder:string)=>request<MusicPlaylist>("/playlists/"+playlist.id+"/folder","POST",{folder_id:folder,revision:playlist.revision}),
  track:(id:string,body:Partial<Pick<MusicTrack,"title"|"artist"|"album"|"duration_seconds"|"favorite">>)=>request<MusicTrack>("/tracks/"+id,"PATCH",body),
};

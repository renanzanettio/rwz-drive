import { db, runInTransaction } from "../../db";
import { HttpError } from "../../middlewares/errorHandler";
import { uuid } from "../../utils/uuid";
import { getOwnedFileOrThrow, type FileRecord } from "../files/files.service";
import { getOwnedFolderOrThrow } from "../folders/folders.service";

export const isAudio=(mime:string)=>mime.startsWith("audio/")||mime==="application/ogg";
export interface MusicTrack { id:string;title:string;artist:string;album:string;duration_seconds:number|null;favorite:boolean;folder_id:string|null;cover_file_id:string|null;original_name:string }
export interface MusicPlaylist { id:string;name:string;description:string;cover_file_id:string|null;file_ids:string[];revision:number;updated_at:string }
const compare=new Intl.Collator("pt-BR",{numeric:true,sensitivity:"base"});
function field(value:unknown,max:number,label:string){if(typeof value!=="string"||value.length>max)throw new HttpError(400,label+" inválido.");return value.trim();}
export function ownedAudio(owner:string,id:string){const file=getOwnedFileOrThrow(id,owner);if(!isAudio(file.mime_type))throw new HttpError(400,"Escolha um arquivo de áudio.");return file;}
export function getMusicCatalog(owner:string):{tracks:MusicTrack[];playlists:MusicPlaylist[]} {
  const files=db.prepare(`SELECT f.*,m.title,m.artist,m.album,m.duration_seconds,m.favorite,folder.name AS folder_name,
    (SELECT i.id FROM files i WHERE i.folder_id=f.folder_id AND i.owner_id=f.owner_id AND i.deleted_at IS NULL
      AND i.mime_type LIKE 'image/%' AND lower(i.original_name) IN ('capa.jpg','capa.jpeg','capa.png','capa.webp','cover.jpg','cover.png','cover.webp','poster.jpg','poster.png') ORDER BY i.original_name LIMIT 1) AS cover_file_id
    FROM files f LEFT JOIN music_tracks m ON m.file_id=f.id AND m.owner_id=f.owner_id
    LEFT JOIN folders folder ON folder.id=f.folder_id AND folder.owner_id=f.owner_id AND folder.deleted_at IS NULL
    WHERE f.owner_id=? AND f.deleted_at IS NULL AND (f.mime_type LIKE 'audio/%' OR f.mime_type='application/ogg')`).all(owner) as unknown as (FileRecord&{title:string|null;artist:string|null;album:string|null;duration_seconds:number|null;favorite:number|null;folder_name:string|null;cover_file_id:string|null})[];
  const tracks=files.map(file=>{
    const name=file.original_name.replace(/\.[^.]+$/,"").replace(/_/g," "),split=name.indexOf(" - ");
    return {id:file.id,title:file.title??(split>0?name.slice(split+3):name),artist:file.artist??(split>0?name.slice(0,split):"Artista desconhecido"),album:file.album??file.folder_name??"Seu Drive",duration_seconds:file.duration_seconds??null,favorite:Boolean(file.favorite),folder_id:file.folder_id,cover_file_id:file.cover_file_id,original_name:file.original_name};
  }).sort((a,b)=>compare.compare(a.title,b.title)||a.id.localeCompare(b.id));
  const rows=db.prepare(`SELECT p.* FROM music_playlists p WHERE owner_id=? ORDER BY updated_at DESC,id`).all(owner) as unknown as Omit<MusicPlaylist,"file_ids">[];
  const items=db.prepare(`SELECT i.playlist_id,i.file_id FROM music_playlist_items i JOIN music_playlists p ON p.id=i.playlist_id
    JOIN files f ON f.id=i.file_id WHERE p.owner_id=? AND f.owner_id=p.owner_id AND f.deleted_at IS NULL ORDER BY i.sort_order`).all(owner) as unknown as {playlist_id:string;file_id:string}[];
  const available=new Set(tracks.map(t=>t.id));
  const covers=new Set((db.prepare("SELECT id FROM files WHERE owner_id=? AND deleted_at IS NULL AND mime_type LIKE 'image/%'").all(owner) as unknown as {id:string}[]).map(f=>f.id));
  return {tracks,playlists:rows.map(p=>({id:p.id,name:p.name,description:p.description,cover_file_id:p.cover_file_id&&covers.has(p.cover_file_id)?p.cover_file_id:null,revision:p.revision,updated_at:p.updated_at,file_ids:items.filter(i=>i.playlist_id===p.id&&available.has(i.file_id)).map(i=>i.file_id)}))};
}
export function getPlaylist(owner:string,id:string){const result=getMusicCatalog(owner).playlists.find(p=>p.id===id);if(!result)throw new HttpError(404,"Playlist não encontrada.");return result;}
function cover(owner:string,id:unknown){if(id===null)return null;if(typeof id!=="string"||!getOwnedFileOrThrow(id,owner).mime_type.startsWith("image/"))throw new HttpError(400,"Escolha uma imagem do seu Drive.");return id;}
function trackIds(owner:string,ids:unknown):string[]{
  if(!Array.isArray(ids)||ids.length>1000||new Set(ids).size!==ids.length||ids.some(i=>typeof i!=="string"))throw new HttpError(400,"Use até 1.000 músicas sem duplicatas.");
  for(const id of ids)ownedAudio(owner,id);return ids;
}
export function createPlaylist(owner:string,body:any){
  const name=field(body.name,120,"Nome");if(!name)throw new HttpError(400,"Informe um nome.");
  const description=field(body.description??"",1000,"Descrição"),image=cover(owner,body.cover_file_id??null),ids=trackIds(owner,body.file_ids??[]),id=uuid(),now=new Date().toISOString();
  runInTransaction(()=>{
    db.prepare("INSERT INTO music_playlists(id,owner_id,name,description,cover_file_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,owner,name,description,image,now,now);
    const insert=db.prepare("INSERT INTO music_playlist_items VALUES(?,?,?)");ids.forEach((file,index)=>insert.run(id,file,index));
  });return getPlaylist(owner,id);
}
export function updatePlaylist(owner:string,id:string,body:any){
  const old=getPlaylist(owner,id);
  if(body.revision!==old.revision)throw new HttpError(409,"Esta playlist mudou em outra tela. Atualize para continuar.");
  const name=body.name===undefined?old.name:field(body.name,120,"Nome");if(!name)throw new HttpError(400,"Informe um nome.");
  const description=body.description===undefined?old.description:field(body.description,1000,"Descrição");
  const image=body.cover_file_id===undefined?old.cover_file_id:cover(owner,body.cover_file_id);
  const ids=body.file_ids===undefined?old.file_ids:trackIds(owner,body.file_ids);
  runInTransaction(()=>{
    db.prepare("UPDATE music_playlists SET name=?,description=?,cover_file_id=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=?").run(name,description,image,new Date().toISOString(),id,owner);
    db.prepare("DELETE FROM music_playlist_items WHERE playlist_id=?").run(id);
    const insert=db.prepare("INSERT INTO music_playlist_items VALUES(?,?,?)");ids.forEach((file,index)=>insert.run(id,file,index));
  });return getPlaylist(owner,id);
}
export function addFolderToPlaylist(owner:string,id:string,body:any){
  const old=getPlaylist(owner,id);if(typeof body.folder_id!=="string")throw new HttpError(400,"Escolha uma pasta.");
  getOwnedFolderOrThrow(body.folder_id,owner);
  const files=db.prepare(`WITH RECURSIVE branch(id) AS (SELECT id FROM folders WHERE id=? AND owner_id=? AND deleted_at IS NULL
    UNION SELECT f.id FROM folders f JOIN branch b ON f.parent_id=b.id WHERE f.owner_id=? AND f.deleted_at IS NULL)
    SELECT f.id,f.original_name FROM files f JOIN branch b ON b.id=f.folder_id WHERE f.owner_id=? AND f.deleted_at IS NULL AND (f.mime_type LIKE 'audio/%' OR f.mime_type='application/ogg')`).all(body.folder_id,owner,owner,owner) as unknown as {id:string;original_name:string}[];
  files.sort((a,b)=>compare.compare(a.original_name,b.original_name));
  return updatePlaylist(owner,id,{revision:body.revision,file_ids:[...new Set([...old.file_ids,...files.map(f=>f.id)])]});
}
export function deletePlaylist(owner:string,id:string,revision:unknown){const old=getPlaylist(owner,id);if(revision!==old.revision)throw new HttpError(409,"A playlist mudou. Atualize antes de excluir.");db.prepare("DELETE FROM music_playlists WHERE id=? AND owner_id=?").run(id,owner);}
export function updateTrack(owner:string,id:string,body:any){
  ownedAudio(owner,id);
  const old=db.prepare("SELECT * FROM music_tracks WHERE file_id=? AND owner_id=?").get(id,owner) as any;
  const title=body.title===undefined?old?.title??null:field(body.title,255,"Título");if(title==="")throw new HttpError(400,"Informe um título.");
  const artist=body.artist===undefined?old?.artist??null:field(body.artist,255,"Artista"),album=body.album===undefined?old?.album??null:field(body.album,255,"Álbum");
  if(body.favorite!==undefined&&typeof body.favorite!=="boolean")throw new HttpError(400,"Favorito inválido.");
  const duration=body.duration_seconds===undefined?old?.duration_seconds??null:body.duration_seconds;
  if(duration!==null&&(typeof duration!=="number"||!Number.isFinite(duration)||duration<=0||duration>86400))throw new HttpError(400,"Duração inválida.");
  db.prepare(`INSERT INTO music_tracks(file_id,owner_id,title,artist,album,duration_seconds,favorite,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(file_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,duration_seconds=excluded.duration_seconds,favorite=excluded.favorite,updated_at=excluded.updated_at`)
    .run(id,owner,title,artist,album,duration,Number(body.favorite??old?.favorite??false),new Date().toISOString());
  return getMusicCatalog(owner).tracks.find(t=>t.id===id)!;
}

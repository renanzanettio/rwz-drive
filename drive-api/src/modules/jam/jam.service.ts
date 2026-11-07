import { createHash, randomBytes } from "node:crypto";
import { db } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import { getOwnedFileOrThrow } from "../files/files.service";
import { getProgress } from "../files/watch-progress.service";
import { getMediaCatalog } from "../media/media.service";
import { videoDetails } from "../media/media-settings.service";
import { getMusicCatalog, getPlaylist, isAudio, updateTrack } from "../music/music.service";

interface Program { id: string; title: string; show: string; duration: number | null; artist?:string; album?:string }
export interface Jam {
  id: string; token: string; owner_id: string; host_user_id: string; name: string;
  playlist_json: string; file_id: string; position_seconds: number; anchored_at: number;
  paused: number; playback_rate: number; guests_control: number; auto_next: number;
  revision: number; created_at: number; expires_at: number; closed_at: number | null;
  media_kind:"audio"|"video";
}
export interface Member { id: string; room_id: string; name: string; role: "host" | "guest"; last_seen_at: number; left_at: number | null }
export const secretHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const playlist = (room: Jam): Program[] => JSON.parse(room.playlist_json);
const hostTimeout = 90000;
const activeWindow = 120000;

export function roomPosition(room: Jam, now = Date.now()) {
  const duration = playlist(room).find((p) => p.id === room.file_id)?.duration;
  const position = room.position_seconds + (room.paused ? 0 : Math.max(0,now-room.anchored_at)/1000*room.playback_rate);
  return Math.max(0, Math.min(duration ?? 86400, position));
}
function row(token: string): Jam {
  const room = db.prepare("SELECT * FROM watch_jams WHERE token=?").get(token) as unknown as Jam | undefined;
  if (!room) throw new HttpError(404,"Jam não encontrada.");
  if (room.closed_at || room.expires_at <= Date.now()) throw new HttpError(410,"Esta Jam foi encerrada ou expirou.");
  return room;
}
function validVideo(room: Jam) {
  try { return getOwnedFileOrThrow(room.file_id,room.owner_id); }
  catch { throw new HttpError(410,"O arquivo desta Jam não está mais disponível."); }
}
function anchor(room: Jam, position: number, paused: number, now = Date.now()) {
  db.prepare("UPDATE watch_jams SET position_seconds=?,paused=?,anchored_at=?,revision=revision+1 WHERE id=?")
    .run(position,paused,now,room.id);
}
export function getRoom(token: string, now = Date.now()): Jam {
  let room = row(token);
  validVideo(room);
  const last = db.prepare("SELECT MAX(last_seen_at) seen FROM watch_jam_members WHERE room_id=? AND role='host' AND left_at IS NULL")
    .get(room.id) as { seen: number | null };
  if (!room.paused && now-(last.seen ?? room.created_at) > hostTimeout) {
    anchor(room,roomPosition(room,Math.min(now,(last.seen ?? room.created_at)+hostTimeout)),1,now);
    room = row(token);
  }
  const items = playlist(room);
  const index = items.findIndex((p) => p.id === room.file_id);
  const duration = items[index]?.duration;
  if (!room.paused && duration && roomPosition(room,now) >= duration) {
    const next = room.auto_next ? items.slice(index+1).find((p) => {
      try { const file=getOwnedFileOrThrow(p.id,room.owner_id);return room.media_kind==="audio"?isAudio(file.mime_type):file.mime_type.startsWith("video/"); } catch { return false; }
    }) : null;
    if (next) {
      db.prepare("UPDATE watch_jams SET file_id=?,position_seconds=0,anchored_at=?,revision=revision+1 WHERE id=?").run(next.id,now,room.id);
    } else anchor(room,duration,1,now);
    room = row(token);
  }
  return room;
}
export function preview(token: string) {
  const room = getRoom(token);
  return { name:room.name, title:playlist(room).find((p) => p.id===room.file_id)!.title, expires_at:room.expires_at,media_kind:room.media_kind };
}
export function createJam(owner: string, hostUser: string, body: any) {
  if (typeof body.file_id !== "string") throw new HttpError(400,"Escolha um vídeo.");
  const file = getOwnedFileOrThrow(body.file_id,owner);
  const audio=isAudio(file.mime_type);
  if (!audio&&!file.mime_type.startsWith("video/")) throw new HttpError(400,"Escolha um vídeo ou uma música.");
  if (body.guests_control !== undefined && typeof body.guests_control !== "boolean") throw new HttpError(400,"Permissão inválida.");
  db.prepare("DELETE FROM watch_jams WHERE expires_at<? OR closed_at IS NOT NULL").run(Date.now()-86400000);
  const count = db.prepare("SELECT COUNT(*) n FROM watch_jams WHERE host_user_id=? AND closed_at IS NULL AND expires_at>?")
    .get(hostUser,Date.now()) as {n:number};
  if (count.n>=5) throw new HttpError(400,"Encerre uma das suas cinco Jams antes de criar outra.");
  const title = audio?undefined:getMediaCatalog(owner).titles.find((t) => t.seasons.some((s) => s.episodes.some((e) => e.id===file.id)));
  let items: Program[] = title ? title.seasons.flatMap((s) => s.episodes.map((e) => ({id:e.id,title:e.title,show:title.name,duration:e.duration_seconds})))
    : [{id:file.id,title:file.original_name.replace(/\.[^.]+$/,""),show:"",duration:videoDetails(owner,file.id).duration_seconds}];
  let roomName=title?.name??items[0].title;
  if(audio){
    const music=getMusicCatalog(owner);
    const selected=body.playlist_id===undefined?null:getPlaylist(owner,typeof body.playlist_id==="string"?body.playlist_id:"");
    const ids=selected?.file_ids??body.file_ids??[file.id];
    if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=="string")||!ids.includes(file.id))throw new HttpError(400,"Escolha uma fila de até 500 músicas, incluindo a faixa atual.");
    items=ids.map((id:string)=>{const track=music.tracks.find(t=>t.id===id);if(!track)throw new HttpError(403,"Música fora do seu Drive.");return{id:track.id,title:track.title,show:track.album,artist:track.artist,album:track.album,duration:track.duration_seconds};});
    roomName=selected?.name??(items.length>1?"Fila de músicas":items[0].title);
  }else if(body.playlist_id!==undefined||body.file_ids!==undefined)throw new HttpError(400,"Playlists são usadas nas Jams de música.");
  if (items.length>500) throw new HttpError(400,"Use até 500 itens por Jam.");
  const checkpoint = audio?null:getProgress(file.id,owner);
  let position = checkpoint?.completed_at ? 0 : checkpoint?.position_seconds ?? 0;
  if (body.position_seconds !== undefined) {
    if (typeof body.position_seconds!=="number" || !Number.isFinite(body.position_seconds) || body.position_seconds<0 || body.position_seconds>86400) throw new HttpError(400,"Posição inválida.");
    position = body.position_seconds;
  }
  const duration=items.find((p)=>p.id===file.id)?.duration;
  position=Math.min(position,duration??86400);
  const now=Date.now(), token=randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO watch_jams(id,token,owner_id,host_user_id,name,playlist_json,file_id,position_seconds,anchored_at,guests_control,created_at,expires_at,media_kind)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uuid(),token,owner,hostUser,roomName,JSON.stringify(items),file.id,position,now,Number(body.guests_control??false),now,now+12*3600000,audio?"audio":"video");
  return {token};
}
export function listJams(host: string) {
  return db.prepare("SELECT token,name,expires_at FROM watch_jams WHERE host_user_id=? AND expires_at>? AND closed_at IS NULL ORDER BY created_at DESC")
    .all(host,Date.now());
}
export function joinJam(token: string, name: unknown, host: boolean, authenticatedUser?: string) {
  const room=getRoom(token);
  if (typeof name!=="string" || !name.trim() || name.trim().length>40) throw new HttpError(400,"Informe um nome de até 40 caracteres.");
  if (host && room.host_user_id!==authenticatedUser) throw new HttpError(403,"Entre na conta que criou a Jam para ser anfitrião.");
  const now=Date.now();
  const count=db.prepare("SELECT COUNT(*) n FROM watch_jam_members WHERE room_id=? AND left_at IS NULL AND last_seen_at>?").get(room.id,now-activeWindow) as {n:number};
  if(count.n>=12)throw new HttpError(409,"A sala já tem 12 participantes. Aguarde uma vaga.");
  const id=uuid(), secret=randomBytes(32).toString("hex");
  db.prepare("INSERT INTO watch_jam_members(id,room_id,secret_hash,name,role,last_seen_at) VALUES(?,?,?,?,?,?)")
    .run(id,room.id,secretHash(secret),name.trim(),host?"host":"guest",now);
  return {id,secret,room};
}
export function authorizeMember(token: string, secret: string, id?: string): {room:Jam;member:Member} {
  const room=getRoom(token);
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new HttpError(401,"Entre na Jam novamente.");
  const member=db.prepare("SELECT id,room_id,name,role,last_seen_at,left_at FROM watch_jam_members WHERE secret_hash=? AND room_id=?")
    .get(secretHash(secret),room.id) as unknown as Member|undefined;
  if(!member || member.left_at || (id && member.id!==id))throw new HttpError(401,"Sua entrada na Jam expirou ou foi encerrada.");
  return {room,member};
}
export function touchMember(member: Member) {
  db.prepare("UPDATE watch_jam_members SET last_seen_at=? WHERE id=? AND left_at IS NULL").run(Date.now(),member.id);
}
export function jamSnapshot(room: Jam, member: Member) {
  const now=Date.now();
  const items=playlist(room);
  const current=items.find((p)=>p.id===room.file_id)!;
  const details=videoDetails(room.owner_id,room.file_id);
  return {
    name:room.name, revision:room.revision, server_now:now, expires_at:room.expires_at,media_kind:room.media_kind,
    file_id:room.file_id, title:current.title, show:current.show,
    position_seconds:roomPosition(room,now), paused:Boolean(room.paused), playback_rate:room.playback_rate,
    guests_control:Boolean(room.guests_control),auto_next:Boolean(room.auto_next),
    can_control:member.role==="host" || Boolean(room.guests_control), is_host:member.role==="host", member_id:member.id,
    artist:current.artist??"",album:current.album??"",
    playlist:items.map(({id,title,show,duration,artist,album})=>({id,title,show,duration,artist,album})),subtitles:room.media_kind==="audio"?[]:details.subtitles,
    participants:db.prepare("SELECT id,name,role FROM watch_jam_members WHERE room_id=? AND left_at IS NULL AND last_seen_at>? ORDER BY role DESC,last_seen_at")
      .all(room.id,now-activeWindow),
  };
}
export function command(token: string, secret: string, body: any) {
  const {room,member}=authorizeMember(token,secret);
  touchMember(member);
  if (!Number.isInteger(body.revision) || body.revision!==room.revision) throw new HttpError(409,"A sala mudou. Sincronizando novamente…");
  const host=member.role==="host";
  if(!host && !room.guests_control)throw new HttpError(403,"O anfitrião está controlando a reprodução.");
  const now=Date.now(), action=body.action;
  let position=roomPosition(room,now), paused=room.paused, rate=room.playback_rate, fileId=room.file_id;
  if (action==="play" || action==="pause" || action==="seek") {
    if(body.position_seconds!==undefined){
      if(typeof body.position_seconds!=="number" || !Number.isFinite(body.position_seconds) || body.position_seconds<0 || body.position_seconds>86400)throw new HttpError(400,"Posição inválida.");
      position=body.position_seconds;
    } else if(action==="seek")throw new HttpError(400,"Posição obrigatória.");
    if(action!=="seek")paused=Number(action==="pause");
  } else if(action==="rate") {
    if(![0.5,0.75,1,1.25,1.5,2].includes(body.playback_rate))throw new HttpError(400,"Velocidade inválida.");
    rate=body.playback_rate;
  } else if(action==="select") {
    if(typeof body.file_id!=="string" || !playlist(room).some((p)=>p.id===body.file_id))throw new HttpError(403,"Vídeo fora desta Jam.");
    getOwnedFileOrThrow(body.file_id,room.owner_id);
    fileId=body.file_id;position=0;
  } else if(action==="settings") {
    if(!host)throw new HttpError(403,"Somente o anfitrião pode alterar a sala.");
    if(typeof body.guests_control!=="boolean" || typeof body.auto_next!=="boolean")throw new HttpError(400,"Configuração inválida.");
    db.prepare("UPDATE watch_jams SET guests_control=?,auto_next=? WHERE id=?").run(Number(body.guests_control),Number(body.auto_next),room.id);
  } else if(action==="close") {
    if(!host)throw new HttpError(403,"Somente o anfitrião pode encerrar a Jam.");
    db.prepare("UPDATE watch_jams SET closed_at=?,revision=revision+1 WHERE id=?").run(now,room.id);
    return {closed:true};
  } else if(action==="kick") {
    if(!host)throw new HttpError(403,"Somente o anfitrião pode remover participantes.");
    db.prepare("UPDATE watch_jam_members SET left_at=? WHERE id=? AND room_id=? AND role='guest'").run(now,typeof body.member_id==="string"?body.member_id:"",room.id);
  } else throw new HttpError(400,"Comando inválido.");
  const duration=playlist(room).find((p)=>p.id===fileId)?.duration;
  position=Math.min(position,duration??86400);
  db.prepare("UPDATE watch_jams SET file_id=?,position_seconds=?,paused=?,playback_rate=?,anchored_at=?,revision=revision+1 WHERE id=?")
    .run(fileId,position,paused,rate,now,room.id);
  return jamSnapshot(getRoom(token),member);
}
export function learnDuration(room: Jam, seconds: unknown) {
  if(typeof seconds!=="number" || !Number.isFinite(seconds) || seconds<=0 || seconds>86400)throw new HttpError(400,"Duração inválida.");
  const items=playlist(room);
  const item=items.find((p)=>p.id===room.file_id)!;
  if(!item.duration || Math.abs(item.duration-seconds)>0.25){
    item.duration=seconds;
    db.prepare("UPDATE watch_jams SET playlist_json=? WHERE id=?").run(JSON.stringify(items),room.id);
    if(room.media_kind==="audio")updateTrack(room.owner_id,room.file_id,{duration_seconds:seconds});
  }
}
export function leaveJam(room:Jam,member:Member) {
  db.prepare("UPDATE watch_jam_members SET left_at=? WHERE id=?").run(Date.now(),member.id);
  if(member.role==="host") {
    const other=db.prepare("SELECT 1 FROM watch_jam_members WHERE room_id=? AND role='host' AND left_at IS NULL AND last_seen_at>? LIMIT 1")
      .get(room.id,Date.now()-hostTimeout);
    if(!other)anchor(room,roomPosition(room),1);
  }
}
export function recoverJams() {
  // Ao reiniciar a API, uma sala volta pausada no último relógio conhecido.
  const rooms=db.prepare("SELECT * FROM watch_jams WHERE closed_at IS NULL AND expires_at>? AND paused=0").all(Date.now()) as unknown as Jam[];
  for(const room of rooms) {
    const last=db.prepare("SELECT MAX(last_seen_at) seen FROM watch_jam_members WHERE room_id=? AND role='host'").get(room.id) as {seen:number|null};
    anchor(room,roomPosition(room,Math.min(Date.now(),last.seen??room.anchored_at)),1);
  }
}

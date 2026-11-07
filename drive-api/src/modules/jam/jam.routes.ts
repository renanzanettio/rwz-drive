import fs from "node:fs";
import { Router, type Request, type Response } from "express";
import cookie from "cookie";
import rateLimit from "express-rate-limit";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import { HttpError } from "../../middlewares/errorHandler";
import { env } from "../../config/env";
import { filePath } from "../../services/storage.service";
import { getOwnedFileOrThrow } from "../files/files.service";
import { subtitleText } from "../media/media-settings.service";
import { getProgress, saveProgress } from "../files/watch-progress.service";
import { authorizeMember, command, createJam, getRoom, jamSnapshot, joinJam, learnDuration, leaveJam, listJams, preview, touchMember } from "./jam.service";

export const jamRouter=Router();
const watchers=new Map<string,Set<()=>void>>();
const openResponses=new Set<Response>();
export function closeJamConnections(){for(const response of openResponses)response.destroy();openResponses.clear();}
function observe(token:string, callback:()=>void) {
  const items=watchers.get(token)??new Set();items.add(callback);watchers.set(token,items);
  return ()=>{items.delete(callback);if(!items.size)watchers.delete(token);};
}
function broadcast(token:string){for(const send of [...(watchers.get(token)??[])])send();}
function secret(req:Request){return req.headers.authorization?.replace(/^Bearer /,"")??"";}
const joinLimit=rateLimit({windowMs:15*60000,max:100,standardHeaders:true,legacyHeaders:false,message:{error:"Muitas tentativas. Tente novamente em alguns minutos."}});
const createLimit=rateLimit({windowMs:15*60000,max:20,standardHeaders:true,legacyHeaders:false,message:{error:"Aguarde um pouco antes de criar mais salas."}});
const commandLimit=rateLimit({windowMs:60000,max:240,standardHeaders:true,legacyHeaders:false,message:{error:"Muitos comandos. Aguarde um instante."}});
jamRouter.use((_req,res,next)=>{
  res.setHeader("Cache-Control","private, no-store");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Content-Type-Options","nosniff");next();
});
jamRouter.post("/rooms",requireAuth,resolveEffectiveOwner,createLimit,(req,res,next)=>{
  try{res.status(201).json(createJam(req.effectiveOwnerId!,req.user!.id,req.body??{}));}catch(error){next(error);}
});
jamRouter.get("/rooms",requireAuth,(req,res,next)=>{
  try{res.json({rooms:listJams(req.user!.id)});}catch(error){next(error);}
});
jamRouter.get("/:token/preview",joinLimit,(req,res,next)=>{
  try{res.json(preview(req.params.token));}catch(error){next(error);}
});
jamRouter.post("/:token/join",joinLimit,(req,res,next)=>{
  if(req.body?.host===true)requireAuth(req,res,next);else next();
},(req,res,next)=>{
  try{
    const joined=joinJam(req.params.token,req.body?.name,req.body?.host===true,req.user?.id);
    const path=`/api/jam/${req.params.token}/media/${joined.id}`;
    res.append("Set-Cookie",cookie.serialize("rwz_jam_media",joined.secret,{
      httpOnly:true,sameSite:"lax",secure:env.isProduction,path,maxAge:12*3600,
    }));
    const {room,member}=authorizeMember(req.params.token,joined.secret);
    res.status(201).json({secret:joined.secret,state:jamSnapshot(room,member)});
    broadcast(req.params.token);
  }catch(error){next(error);}
});
jamRouter.get("/:token/state",(req,res,next)=>{
  try{const {room,member}=authorizeMember(req.params.token,secret(req));touchMember(member);res.json(jamSnapshot(room,member));}catch(error){next(error);}
});
const eventCounts=new Map<string,number>();
jamRouter.get("/:token/events",(req,res,next)=>{
  try{
    const access=secret(req),token=req.params.token;
    const {member}=authorizeMember(token,access);
    if((eventCounts.get(member.id)??0)>=4)throw new HttpError(429,"Feche uma das outras conexões desta sala.");
    eventCounts.set(member.id,(eventCounts.get(member.id)??0)+1);
    res.setHeader("Content-Type","text/event-stream; charset=utf-8");
    res.setHeader("X-Accel-Buffering","no");res.flushHeaders();
    openResponses.add(res);
    let stopped=false;
    function send(){
      if(stopped || res.destroyed)return;
      try{
        const {room,member}=authorizeMember(token,access);
        if(room.media_kind==="audio"&&member.role==="host"&&Date.now()-member.last_seen_at>20000)touchMember(member);
        if(res.writableLength>256*1024){res.end();return;}
        res.write(`event: state\ndata: ${JSON.stringify(jamSnapshot(room,member))}\n\n`);
      }catch(error){
        const failure=error instanceof HttpError?error:new HttpError(500,"Conexão interrompida.");
        res.write(`event: closed\ndata: ${JSON.stringify({error:failure.message,status:failure.status})}\n\n`);res.end();
      }
    }
    const unobserve=observe(token,send);
    const timer=setInterval(send,2000);
    res.on("close",()=>{openResponses.delete(res);stopped=true;clearInterval(timer);unobserve();const remaining=(eventCounts.get(member.id)??1)-1;if(remaining)eventCounts.set(member.id,remaining);else eventCounts.delete(member.id);});
    send();
  }catch(error){next(error);}
});
jamRouter.post("/:token/command",commandLimit,(req,res,next)=>{
  try{const state=command(req.params.token,secret(req),req.body??{});res.json(state);broadcast(req.params.token);}catch(error){next(error);}
});
jamRouter.post("/:token/duration",(req,res,next)=>{
  try{
    const {room,member}=authorizeMember(req.params.token,secret(req));
    if(member.role!=="host")throw new HttpError(403,"Somente o anfitrião pode preparar o vídeo.");
    // Uma resposta atrasada do episódio anterior não pode mudar a duração do atual.
    if(req.body?.file_id!==room.file_id)throw new HttpError(409,"O episódio mudou.");
    learnDuration(room,req.body?.seconds);res.json(jamSnapshot(getRoom(req.params.token),member));broadcast(req.params.token);
  }catch(error){next(error);}
});
jamRouter.post("/:token/leave",(req,res,next)=>{
  try{const {room,member}=authorizeMember(req.params.token,secret(req));leaveJam(room,member);res.json({ok:true});broadcast(req.params.token);}catch(error){next(error);}
});
jamRouter.get("/:token/progress/:file",(req,res,next)=>{
  try{
    const {room,member}=authorizeMember(req.params.token,secret(req));
    if(room.media_kind==="audio" || member.role!=="host" || !JSON.parse(room.playlist_json).some((p:{id:string})=>p.id===req.params.file))throw new HttpError(403,"Histórico de vídeo restrito ao anfitrião.");
    getOwnedFileOrThrow(req.params.file,room.owner_id);
    res.json(getProgress(req.params.file,room.owner_id)??{position_seconds:0,duration_seconds:null,updated_at:null,completed_at:null});
  }catch(error){next(error);}
});
jamRouter.put("/:token/progress/:file",commandLimit,(req,res,next)=>{
  try{
    const {room,member}=authorizeMember(req.params.token,secret(req));
    if(room.media_kind==="audio" || member.role!=="host" || !JSON.parse(room.playlist_json).some((p:{id:string})=>p.id===req.params.file))throw new HttpError(403,"Histórico de vídeo restrito ao anfitrião.");
    getOwnedFileOrThrow(req.params.file,room.owner_id);
    const {position_seconds,duration_seconds,expected_updated_at,completed}=req.body??{};
    if(typeof position_seconds!=="number" || !Number.isFinite(position_seconds) || position_seconds<0 || position_seconds>86400
      || typeof duration_seconds!=="number" || !Number.isFinite(duration_seconds) || duration_seconds<=0 || duration_seconds>86400
      || (expected_updated_at!==null && typeof expected_updated_at!=="string") || (completed!==undefined && typeof completed!=="boolean"))throw new HttpError(400,"Progresso inválido.");
    res.json(saveProgress(req.params.file,room.owner_id,position_seconds,duration_seconds,completed,expected_updated_at));
  }catch(error){next(error);}
});

function mediaAccess(req:Request){
  const access=cookie.parse(req.headers.cookie??"").rwz_jam_media??"";
  const auth=authorizeMember(req.params.token,access,req.params.member);
  if(req.params.file!==auth.room.file_id)throw new HttpError(403,"Este vídeo não está passando na Jam.");
  return { ...auth,access };
}
const mediaCounts=new Map<string,number>();
jamRouter.get("/:token/media/:member/stream/:file",(req,res,next)=>{
  try{
    const {room,member}=mediaAccess(req);
    if((mediaCounts.get(member.id)??0)>=6)throw new HttpError(429,"Muitas conexões de vídeo nesta sala.");
    const file=getOwnedFileOrThrow(room.file_id,room.owner_id);
    const physical=filePath(room.owner_id,file.storage_name);
    if(!fs.existsSync(physical))throw new HttpError(410,"O arquivo de vídeo não foi encontrado.");
    const size=fs.statSync(physical).size,range=req.headers.range;
    let start=0,end=size-1;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match || (!match[1]&&!match[2])){res.status(416).setHeader("Content-Range",`bytes */${size}`).end();return;}
      if(!match[1])start=Math.max(0,size-Number(match[2]));
      else {start=Number(match[1]);if(match[2])end=Math.min(size-1,Number(match[2]));}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size){res.status(416).setHeader("Content-Range",`bytes */${size}`).end();return;}
      res.status(206).setHeader("Content-Range",`bytes ${start}-${end}/${size}`);
    }
    res.setHeader("Content-Type",file.mime_type);res.setHeader("Accept-Ranges","bytes");res.setHeader("Content-Length",Math.max(0,end-start+1));
    if(!size){res.end();return;}
    mediaCounts.set(member.id,(mediaCounts.get(member.id)??0)+1);
    openResponses.add(res);
    const stream=fs.createReadStream(physical,{start,end});
    const check=()=>{try{mediaAccess(req);}catch{stream.destroy();res.destroy();}};
    const unobserve=observe(req.params.token,check),timer=setInterval(check,10000);
    res.on("close",()=>{openResponses.delete(res);stream.destroy();clearInterval(timer);unobserve();const remaining=(mediaCounts.get(member.id)??1)-1;if(remaining)mediaCounts.set(member.id,remaining);else mediaCounts.delete(member.id);});
    stream.on("error",()=>res.destroy());stream.pipe(res);
  }catch(error){next(error);}
});
jamRouter.get("/:token/media/:member/subtitles/:file/:subtitle",async(req,res,next)=>{
  try{
    const {room}=mediaAccess(req);
    const content=await subtitleText(room.owner_id,room.file_id,req.params.subtitle);
    mediaAccess(req);
    res.type("text/vtt").send(content);
  }catch(error){next(error);}
});

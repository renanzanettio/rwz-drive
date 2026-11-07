"use client";
import { useState } from "react";
import { jamApi } from "@/lib/jam-api";
import dialogs from "./MediaDialogs.module.css";

export function CreateJamButton({fileId,position,className,fileIds,playlistId}:{fileId:string;position?:()=>number;className?:string;fileIds?:string[];playlistId?:string}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[guests,setGuests]=useState(false),[error,setError]=useState("");
  async function create(){
    setBusy(true);setError("");
    try{const room=await jamApi.create(fileId,guests,position?.(),playlistId?{playlist_id:playlistId}:fileIds?{file_ids:fileIds}:undefined);window.location.assign(`/jam/${room.token}?host=1`);}
    catch(err){setError(err instanceof Error?err.message:"Não foi possível criar a Jam.");setBusy(false);}
  }
  return <><button type="button" className={className} onClick={()=>setOpen(true)}>{fileIds||playlistId?"Ouvir com amigos":"Assistir com amigos"}</button>
    {open&&<div className={dialogs.overlay} onClick={()=>{if(!busy)setOpen(false);}}><section className={dialogs.dialog} role="dialog" aria-modal="true" aria-label="Criar Jam" onClick={e=>e.stopPropagation()}>
      <h2>Uma sessão com seus amigos</h2><p>{fileIds||playlistId?"Cada pessoa abre o convite e ouve a mesma música, junto com você.":"Cada pessoa abre o convite e assiste no próprio aparelho, junto com você."}</p>
      <label><input type="checkbox" checked={guests} disabled={busy} onChange={e=>setGuests(e.target.checked)}/> Convidados também podem controlar a reprodução</label>
      <p className={dialogs.hint}>O convite vale por 12 horas. Quem tiver o link pode entrar na sala. Você pode encerrar a Jam a qualquer momento.</p>
      {error&&<p role="alert" className={dialogs.error}>{error}</p>}
      <div className={dialogs.actions}><button type="button" className={dialogs.button} disabled={busy} onClick={()=>setOpen(false)}>Cancelar</button>
        <button type="button" className={dialogs.primary} disabled={busy} onClick={()=>void create()}>{busy?"Criando…":"Criar Jam"}</button></div>
    </section></div>}</>;
}
export function MyJamsButton({className}:{className?:string}){
  const [open,setOpen]=useState(false),[rooms,setRooms]=useState<{token:string;name:string;expires_at:number}[]|null>(null),[error,setError]=useState("");
  async function show(){setOpen(true);setRooms(null);setError("");try{setRooms((await jamApi.list()).rooms);}catch(err){setError(err instanceof Error?err.message:"Falha ao abrir as salas.");}}
  return <><button type="button" className={className} onClick={()=>void show()}>Minhas Jams</button>
    {open&&<div className={dialogs.overlay} onClick={()=>setOpen(false)}><section className={dialogs.dialog} role="dialog" aria-modal="true" aria-label="Minhas Jams" onClick={e=>e.stopPropagation()}>
      <div className={dialogs.heading}><h2>Minhas Jams</h2><button type="button" className={dialogs.button} onClick={()=>setOpen(false)}>Fechar</button></div>
      {error&&<p role="alert">{error}</p>}{!error&&!rooms&&<p role="status">Abrindo salas…</p>}
      {rooms?.length===0&&<p>Abra um vídeo ou uma playlist e escolha a opção para ouvir ou assistir com amigos.</p>}
      <div className={dialogs.pickerList}>{rooms?.map(room=><a className={dialogs.button} key={room.token} href={`/jam/${room.token}?host=1`}>{room.name} · Voltar à sala</a>)}</div>
    </section></div>}</>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { jamApi, type JamCommand, type JamState } from "@/lib/jam-api";
import { JamPlayer } from "./JamPlayer";
import { ConfirmModal } from "./Modals";
import styles from "./JamRoom.module.css";

export interface TimedJam {value:JamState;receivedAt:number}
export function JamRoom({token}:{token:string}){
  const [room,setRoom]=useState<TimedJam|null>(null),[secret,setSecret]=useState("");
  const [preview,setPreview]=useState<{name:string;title:string;expires_at:number;media_kind:"audio"|"video"}|null>(null);
  const [name,setName]=useState(""),[host,setHost]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[terminal,setTerminal]=useState(""),[online,setOnline]=useState(false),[copied,setCopied]=useState(false),[confirmClose,setConfirmClose]=useState(false);
  const latest=useRef<TimedJam|null>(null),lastMessage=useRef(0),lag=useRef(0),sending=useRef(false),mounted=useRef(true);
  const key="rwz-jam-"+token;
  function accept(value:JamState){
    const previous=latest.current?.value;
    if(previous&&(value.revision<previous.revision||(value.revision===previous.revision&&value.server_now<previous.server_now)))return;
    const next={value,receivedAt:performance.now()-lag.current};latest.current=next;setRoom(next);
    lastMessage.current=Date.now();setOnline(true);
  }
  function clearEntry(){try{sessionStorage.removeItem(key);}catch{}}
  useEffect(()=>{
    mounted.current=true;
    let active=true;
    setHost(new URLSearchParams(window.location.search).get("host")==="1");
    if(!/^[a-f0-9]{64}$/.test(token)){setTerminal("Este convite não é válido.");setLoading(false);return;}
    async function open(){
      try{
        let saved="";try{saved=sessionStorage.getItem(key)??"";}catch{}
        if(saved){
          try{const start=performance.now(),state=await jamApi.state(token,saved);if(!active)return;lag.current=(performance.now()-start)/2;accept(state);setSecret(saved);return;}
          catch(err){if(err instanceof ApiError&&err.status===410)throw err;clearEntry();}
        }
        const data=await jamApi.preview(token);if(active)setPreview(data);
      }catch(err){if(active)setTerminal(err instanceof Error?err.message:"Não foi possível abrir a Jam.");}
      finally{if(active)setLoading(false);}
    }
    void open();return()=>{active=false;mounted.current=false;};
  },[token]);
  useEffect(()=>{
    if(!secret||terminal)return;
    const abort=new AbortController();let active=true,retry:ReturnType<typeof setTimeout>|null=null;
    function stop(message:string){if(!active)return;setTerminal(message);clearEntry();abort.abort();}
    async function ping(){
      const start=performance.now();
      try{const state=await jamApi.state(token,secret);if(active){lag.current=Math.min(1500,(performance.now()-start)/2);accept(state);}}
      catch(err){if(active&&err instanceof ApiError&&[401,403,404,410].includes(err.status))stop(err.message);}
    }
    async function connect(){
      try{
        const response=await fetch(`/api/jam/${token}/events`,{headers:{Authorization:"Bearer "+secret},signal:abort.signal,cache:"no-store"});
        if(!response.ok){const body=await response.json().catch(()=>({}));if([401,403,404,410].includes(response.status)){stop(body.error??"A Jam foi encerrada.");return;}throw new Error("Reconectando…");}
        const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer="";
        try{while(active){
          const chunk=await reader.read();if(chunk.done)break;
          buffer+=decoder.decode(chunk.value,{stream:true});
          if(buffer.length>1024*1024)throw new Error("Resposta inválida.");
          let end:number;
          while((end=buffer.indexOf("\n\n"))!==-1){
            const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
            const data=event.split("\n").find(line=>line.startsWith("data: "))?.slice(6);
            if(!data)continue;
            const value=JSON.parse(data);
            if(event.startsWith("event: closed")){stop(value.error??"A Jam foi encerrada.");return;}
            if(active)accept(value);
          }
        }}finally{void reader.cancel().catch(()=>{});}
      }catch{ /* O estado também é consultado por HTTP durante a reconexão. */ }
      if(active&&!abort.signal.aborted)retry=setTimeout(()=>void connect(),2500);
    }
    void ping();void connect();
    const heartbeat=setInterval(()=>void ping(),5000);
    const freshness=setInterval(()=>{const grace=latest.current?.value.media_kind==="audio"&&document.hidden?120000:12000;if(Date.now()-lastMessage.current>grace)setOnline(false);},1000);
    const visible=()=>{if(!document.hidden)void ping();};
    document.addEventListener("visibilitychange",visible);window.addEventListener("online",visible);
    return()=>{active=false;abort.abort();if(retry)clearTimeout(retry);clearInterval(heartbeat);clearInterval(freshness);document.removeEventListener("visibilitychange",visible);window.removeEventListener("online",visible);};
  },[secret,token,terminal]);
  async function join(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError("");
    try{const entry=await jamApi.join(token,name,host);try{sessionStorage.setItem(key,entry.secret);}catch{}accept(entry.state);setSecret(entry.secret);}
    catch(err){setError(err instanceof Error?err.message:"Não foi possível entrar.");}
    finally{setBusy(false);}
  }
  async function send(command:JamCommand){
    if(!latest.current||sending.current)return;
    sending.current=true;setBusy(true);setError("");
    try{
      const result=await jamApi.command(token,secret,latest.current.value.revision,command);
      if(!mounted.current)return;
      if("closed"in result){setTerminal("Jam encerrada. O convite deixou de funcionar.");clearEntry();}
      else accept(result);
    }catch(err){
      if(!mounted.current)return;
      if(err instanceof ApiError&&err.status===409){try{accept(await jamApi.state(token,secret));}catch{}setError("Outro comando chegou primeiro. A sala foi sincronizada; tente novamente.");}
      else if(err instanceof ApiError&&[401,404,410].includes(err.status)){setTerminal(err.message);clearEntry();}
      else setError(err instanceof Error?err.message:"Falha de conexão.");
    }finally{sending.current=false;if(mounted.current)setBusy(false);}
  }
  async function leave(){
    try{await jamApi.leave(token,secret);}catch{}
    clearEntry();setTerminal("Você saiu da Jam.");
  }
  const state=room?.value;
  const invitation=typeof window!=="undefined"?window.location.origin+"/jam/"+token:"";
  return <main className={styles.page}>
    <header className={styles.header}><a className={styles.brand} href="/drive"><span>RWZ</span> Drive <b>Jam</b></a>
      {state&&!terminal&&<div className={styles.headerActions}><span className={online?styles.connected:styles.disconnected} role="status">{online?"Sala conectada":"Reconectando…"}</span><button type="button" className={styles.button} onClick={()=>void leave()}>Sair da Jam</button></div>}
    </header>
    {loading?<p role="status" className={styles.empty}>Abrindo convite…</p>:terminal?<section className={styles.entry}><p className={styles.eyebrow}>SESSÃO FINALIZADA</p><h1>{terminal}</h1><a className={styles.button} href="/drive">Voltar ao Drive</a></section>:!secret?<section className={styles.entry}>
      <p className={styles.eyebrow}>UMA SESSÃO EM BOA COMPANHIA</p><h1>{preview?.name??"Vamos assistir juntos"}</h1><p>{preview?.title}</p>
      <form onSubmit={join}><label>Como podemos te chamar?<input autoComplete="nickname" required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="Seu nome"/></label>
        <label className={styles.check}><input type="checkbox" checked={host} onChange={e=>setHost(e.target.checked)}/> Sou o anfitrião desta Jam</label>
        <p className={styles.hint}>{host?"Use a mesma conta que criou a sala.":"Você pode entrar pelo convite, sem criar conta."}</p>
        {error&&<p role="alert" className={styles.error}>{error}</p>}
        <button className={styles.primary} disabled={busy}>{busy?"Entrando…":"Entrar na Jam"}</button>
      </form></section>:room&&state?<>
      <div className={styles.titleRow}><div><p className={styles.eyebrow}>{state.media_kind==="audio"?"OUVINDO JUNTOS":"ASSISTINDO JUNTOS"}</p><h1>{state.name}</h1><p>{state.show&&state.show!==state.name?state.show+" · ":""}{state.title}</p></div><span className={styles.badge}>{state.participants.length} na sala</span></div>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div className={styles.layout}><section className={styles.main}>
        <JamPlayer key={state.media_kind==="audio"?"audio":state.file_id} room={room} token={token} secret={secret} online={online} busy={busy} send={send}/>
        <div className={styles.now}><div><h2>{state.title}</h2><p>{state.can_control?"Seus comandos valem para todos na sala.":"O anfitrião controla a reprodução. Os ajustes deste aparelho são independentes."}</p></div>
          <label>{state.media_kind==="audio"?"Música":"Episódio"}<select aria-label={state.media_kind==="audio"?"Música da Jam":"Episódio da Jam"} disabled={!state.can_control||busy||!online} value={state.file_id} onChange={e=>void send({action:"select",file_id:e.target.value})}>
            {state.playlist.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
      </section><aside className={styles.sidebar}>
        <section className={styles.card}><h2>Na sala</h2><ul className={styles.members}>{state.participants.map(person=><li key={person.id}><span className={styles.avatar}>{person.name.slice(0,1).toUpperCase()}</span><div><strong>{person.name}{person.id===state.member_id?" (você)":""}</strong><small>{person.role==="host"?"Anfitrião":"Convidado"}</small></div>
          {state.is_host&&person.role==="guest"&&<button type="button" className={styles.remove} disabled={busy} aria-label={"Remover "+person.name} onClick={()=>void send({action:"kick",member_id:person.id})}>×</button>}</li>)}</ul></section>
        {state.is_host&&<><section className={styles.card}><h2>Convide seus amigos</h2><p>Envie o link para seus amigos entrarem na sessão.</p><input aria-label="Link do convite" readOnly value={invitation} onFocus={e=>e.currentTarget.select()}/>
          <button type="button" className={styles.primary} onClick={async()=>{try{await navigator.clipboard.writeText(invitation);setCopied(true);}catch{setError("Selecione o link acima e copie para enviar.");}}}>{copied?"Link copiado":"Copiar convite"}</button><small>Válido até {new Date(state.expires_at).toLocaleString("pt-BR")}.</small></section>
          <section className={styles.card}><h2>Sua sessão</h2><label className={styles.check}><input type="checkbox" disabled={busy||!online} checked={state.guests_control} onChange={e=>void send({action:"settings",guests_control:e.target.checked,auto_next:state.auto_next})}/> Permitir controles dos convidados</label>
            <label className={styles.check}><input type="checkbox" disabled={busy||!online} checked={state.auto_next} onChange={e=>void send({action:"settings",guests_control:state.guests_control,auto_next:e.target.checked})}/> {state.media_kind==="audio"?"Próxima música automática":"Próximo episódio automático"}</label>
            <button type="button" className={styles.danger} disabled={busy} onClick={()=>setConfirmClose(true)}>Encerrar Jam</button></section></>}
      </aside></div>
    </>:null}
    {confirmClose&&<ConfirmModal title="Encerrar esta Jam?" description="Todos sairão da sessão e o convite deixará de funcionar. Você pode criar outra Jam depois." confirmLabel="Encerrar Jam" danger onCancel={()=>setConfirmClose(false)} onConfirm={async()=>{await send({action:"close"});setConfirmClose(false);}}/>}
  </main>;
}

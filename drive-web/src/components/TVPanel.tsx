"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, mediaApi, tvApi, type MediaCatalog, type TVChannel, type TVProgram } from "@/lib/api-client";
import { filesApi } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { VideoPlayer } from "./VideoPlayer";
import { ConfirmModal } from "./Modals";
import dialogs from "./MediaDialogs.module.css";
import styles from "./TVPanel.module.css";

function measureDuration(id: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const timer = setTimeout(() => finish(new Error("O vídeo demorou para responder.")), 25000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      video.onloadedmetadata = null;
      video.onerror = null;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      const duration = video.duration;
      video.removeAttribute("src");
      video.load();
      if (error) reject(error);
      else if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) reject(new Error("Duração inválida."));
      else resolve(duration);
    }
    const abort = () => finish(new Error("Preparação cancelada."));
    signal.addEventListener("abort", abort, { once: true });
    video.preload = "metadata";
    video.onloadedmetadata = () => finish();
    video.onerror = () => finish(new Error("O navegador não conseguiu ler este formato."));
    if (signal.aborted) abort();
    else video.src = filesApi.streamUrl(id);
  });
}

function ChannelEditor({ catalog, channel, nextNumber, onSaved, onCancel }: {
  catalog: MediaCatalog; channel: TVChannel | null; nextNumber: number;
  onSaved: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(channel?.name ?? "");
  const [number, setNumber] = useState(channel?.number ?? nextNumber);
  const [mode, setMode] = useState<"shuffle" | "ordered">(channel?.mode ?? "shuffle");
  const [selected, setSelected] = useState<string[]>(channel?.selected_title_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const active = useRef(true);
  const shows = catalog.titles.filter((title) => title.kind === "series");
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; abortRef.current?.abort(); };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    try {
      const items = shows.filter((show) => selected.includes(show.id)).flatMap((show) =>
        show.seasons.flatMap((season) => season.episodes));
      const unique = [...new Map(items.map((episode) => [episode.id, episode])).values()];
      if (!unique.length) throw new Error("Selecione pelo menos uma série com episódios.");
      for (let index = 0; index < unique.length; index++) {
        const episode = unique[index];
        if (controller.signal.aborted) throw new Error("Preparação cancelada.");
        setProgress("Preparando " + (index+1) + "/" + unique.length + " · " + episode.title);
        if (!episode.duration_seconds) {
          try {
            const duration = await measureDuration(episode.id, controller.signal);
            await mediaApi.updateVideo(episode.id, { duration_seconds: duration });
          } catch (err) { throw new Error(episode.title + " — " + (err instanceof Error ? err.message : "Falha ao ler duração.")); }
        }
      }
      if (controller.signal.aborted) throw new Error("Preparação cancelada.");
      setCommitting(true);
      setProgress("Salvando programação…");
      const body = { name, number, mode, selected_title_ids: selected, expected_updated_at: channel?.updated_at };
      if (channel) await tvApi.update(channel.id, body); else await tvApi.create(body);
      if (active.current) onSaved();
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "Não foi possível salvar o canal."); }
    finally { if (active.current) { setBusy(false); setCommitting(false); setProgress(""); } }
  }
  return <div className={dialogs.overlay} onClick={() => { if (!busy) onCancel(); }}>
    <form className={dialogs.dialog} role="dialog" aria-modal="true" aria-label={channel ? "Editar canal" : "Criar canal"}
      onSubmit={save} onClick={(event) => event.stopPropagation()}>
      <div className={dialogs.heading}><h2>{channel ? "Editar canal" : "Criar canal"}</h2>
        <button type="button" className={dialogs.button} disabled={busy} onClick={onCancel}>Fechar</button></div>
      {error && <p className={dialogs.error} role="alert">{error}</p>}
      <label>Nome do canal<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
      <label>Número<input type="number" min={1} max={999} required value={number}
        onChange={(event) => setNumber(Number(event.target.value))} disabled={busy} /></label>
      <label>Ordem dos episódios<select value={mode} onChange={(event) => setMode(event.target.value as "shuffle" | "ordered")} disabled={busy}>
        <option value="shuffle">Episódios embaralhados, alternando as séries</option>
        <option value="ordered">Episódios em ordem, alternando as séries</option></select></label>
      <h3>Séries deste canal</h3>
      <div className={dialogs.checkList}>{shows.map((show) => <label key={show.id}>
        <input type="checkbox" disabled={busy} checked={selected.includes(show.id)} onChange={(event) =>
          setSelected((ids) => event.target.checked ? [...ids, show.id] : ids.filter((id) => id !== show.id))} />
        {show.name}</label>)}</div>
      {!shows.length && <p className={dialogs.hint}>Adicione séries à coleção para montar um canal.</p>}
      <p className={dialogs.hint}>O canal repete a programação e continua avançando quando você sai. Salvar gera uma programação nova a partir de agora.</p>
      {progress && <p className={dialogs.hint} role="status">{progress}</p>}
      <div className={dialogs.actions}>
        {busy ? <button type="button" className={dialogs.button} disabled={committing} onClick={() => abortRef.current?.abort()}>Cancelar preparação</button>
          : <button type="button" className={dialogs.button} onClick={onCancel}>Cancelar</button>}
        <button type="submit" className={dialogs.primary} disabled={busy || !selected.length}>{busy ? "Preparando…" : "Salvar e iniciar programação"}</button>
      </div>
    </form>
  </div>;
}

const clock = (time: number) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(time);

export function TVPanel() {
  const [channels, setChannels] = useState<TVChannel[]>([]);
  const [catalog, setCatalog] = useState<MediaCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tuned, setTuned] = useState<{ channel: TVChannel; receivedAt: number } | null>(null);
  const [editing, setEditing] = useState<TVChannel | "new" | null>(null);
  const [deleting, setDeleting] = useState<TVChannel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const refreshRef = useRef<() => void>(() => {});
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setError("");
    try {
      const [list, data] = await Promise.all([tvApi.list(), mediaApi.catalog()]);
      if (!mounted.current) return;
      setChannels(list.channels);
      setCatalog(data);
      setSelectedId((previous) => list.channels.some((channel) => channel.id === previous) ? previous : list.channels[0]?.id ?? null);
    } catch (err) { if (mounted.current) setError(err instanceof ApiError ? err.message : "Não foi possível abrir os canais."); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const interval = setInterval(() => {
      tvApi.list().then((data) => {
        if (!active) return;
        setChannels(data.channels);
        setSelectedId((previous) => data.channels.some((item) => item.id === previous) ? previous : data.channels[0]?.id ?? null);
      }).catch(() => {});
    }, 15000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setTuned(null); return; }
    let active = true;
    let request = 0;
    async function refresh() {
      const index = ++request;
      try {
        const channel = await tvApi.get(selectedId!);
        if (!active || index !== request) return;
        setTuned({ channel, receivedAt: Date.now() });
        setChannels((items) => items.map((item) => item.id === channel.id ? channel : item));
        setError("");
        if (tickRef.current) clearTimeout(tickRef.current);
        if (channel.current) tickRef.current = setTimeout(() => void refresh(),
          Math.max(150, Math.min(60000,channel.current.end_at - channel.server_now + 100)));
      } catch (err) { if (active) setError(err instanceof ApiError ? err.message : "Conexão com o canal interrompida."); }
    }
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const interval = setInterval(() => void refresh(), 15000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(interval);
      if (tickRef.current) clearTimeout(tickRef.current);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [selectedId]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (editing || deleting || (event.target as HTMLElement)?.closest("input,select,textarea,[contenteditable]")) return;
      if (!["ArrowUp","ArrowDown"].includes(event.key) || !channels.length) return;
      event.preventDefault();
      const current = channels.findIndex((channel) => channel.id === selectedId);
      const next = (current + (event.key === "ArrowUp" ? -1 : 1) + channels.length) % channels.length;
      setSelectedId(channels[next].id);
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [channels, selectedId, editing, deleting]);

  const channel = tuned?.channel.id === selectedId ? tuned.channel : null;
  const current = channel?.current;
  const nextNumber = Math.min(999, Math.max(0, ...channels.map((item) => item.number)) + 1);
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await panelRef.current?.requestFullscreen(); }
    catch { setError("Tela cheia indisponível neste navegador."); }
  }
  function ScheduleItem({ program, now = false }: { program: TVProgram; now?: boolean }) {
    return <li><span>{clock(program.start_at)}–{clock(program.end_at)}</span>
      <div><strong>{program.show}</strong><small>{program.title}</small></div>{now && <b>AGORA</b>}</li>;
  }
  return <div ref={panelRef} className={styles.panel}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>SINTONIZE SEU ACERVO</p><h1>Modo TV</h1>
      <p>Canais com as suas séries, passando ao longo do dia.</p></div>
      <div className={styles.actions}><button type="button" className={styles.button} onClick={() => void fullscreen()}>Tela cheia</button>
        <button type="button" className={styles.primary} disabled={!catalog} onClick={() => setEditing("new")}>Criar canal</button>
        <button type="button" className={styles.button} onClick={() => void load()}>Atualizar guia</button></div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading && <p role="status">Abrindo canais…</p>}
    {!loading && !channels.length && <div className={styles.empty}><span>TV</span><h2>Monte sua própria grade</h2>
      <p>Crie um canal, escolha as séries e defina se os episódios passam em ordem ou embaralhados.</p>
      <button type="button" className={styles.primary} disabled={!catalog} onClick={() => setEditing("new")}>Criar meu primeiro canal</button></div>}
    {channels.length > 0 && <div className={styles.layout}>
      <aside className={styles.channels} aria-label="Canais">{channels.map((item) => <button type="button" key={item.id}
        aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
        <span className={styles.channelNumber}>{String(item.number).padStart(2,"0")}</span>
        <span><strong>{item.name}</strong><small>{item.current?.show ?? "Sem programação disponível"}</small></span>
      </button>)}</aside>
      <section className={styles.viewer}>
        {channel && current && tuned ? <>
          <div className={styles.onAir}><span>AO VIVO</span><strong>{channel.number} · {channel.name}</strong>
            <span>{clock(channel.server_now)}</span></div>
          <VideoPlayer key={channel.id + ":" + current.start_at + ":" + current.file_id}
            fileId={current.file_id} title={current.title} className={styles.video}
            live={{ position: current.offset_seconds ?? 0, receivedAt: tuned.receivedAt }}
            onEnded={() => refreshRef.current()} />
          <div className={styles.now}><h2>{current.show}</h2><p>{current.title}</p>
            <span>{clock(current.start_at)}–{clock(current.end_at)} · {formatDuration(current.duration_ms / 1000)}</span>
            <progress max={current.duration_ms} value={channel.server_now-current.start_at} aria-label="Progresso da programação" /></div>
          <div className={styles.actions}><button type="button" className={styles.button} onClick={() => setEditing(channel)}>Editar ou reprogramar canal</button>
            <button type="button" className={styles.button} onClick={() => setDeleting(channel)}>Excluir canal</button></div>
          <h3>A seguir</h3><ol className={styles.schedule}>{channel.next.map((program) =>
            <ScheduleItem key={program.start_at} program={program} />)}</ol>
        </> : <div className={styles.empty}><h2>{channel ? "Este canal precisa de programação" : "Sintonizando…"}</h2>
          {channel && <><p>Os arquivos podem ter sido removidos. Edite o canal para selecionar as séries novamente.</p>
            <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => setEditing(channel)}>Editar canal</button>
              <button type="button" className={styles.button} onClick={() => setDeleting(channel)}>Excluir canal</button></div></>}</div>}
      </section>
    </div>}
    {channels.length > 0 && <section className={styles.guide}><h2>Guia de canais</h2>
      <p className={styles.hint}>Use ↑ e ↓ para trocar de canal. Ao voltar, você entra no ponto atual da programação.</p>
      {channels.map((item) => <button type="button" key={item.id} className={styles.guideRow} onClick={() => setSelectedId(item.id)}>
        <strong>{item.number} · {item.name}</strong><span>Agora · {item.current?.show ?? "—"}<small>{item.current?.title}</small></span>
        <span>A seguir · {item.next[0]?.show ?? "—"}<small>{item.next[0]?.title}</small></span>
      </button>)}
    </section>}
    {editing && catalog && <ChannelEditor channel={editing === "new" ? null : editing} catalog={catalog} nextNumber={nextNumber}
      onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); refreshRef.current(); }} />}
    {deleting && <ConfirmModal title={"Excluir canal " + deleting.name + "?"}
      description="A programação deste canal será removida. Os vídeos continuam no seu Drive."
      danger confirmLabel="Excluir canal" onCancel={() => setDeleting(null)} onConfirm={async () => {
        try { await tvApi.remove(deleting.id); setDeleting(null); await load(); }
        catch (err) { setError(err instanceof ApiError ? err.message : "Não foi possível excluir o canal."); setDeleting(null); }
      }} />}
  </div>;
}

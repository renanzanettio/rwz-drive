"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, filesApi, mediaApi, type VideoDetails, type WatchProgress } from "@/lib/api-client";
import styles from "./VideoPlayer.module.css";
import { CreateJamButton } from "./JamActions";

export function VideoPlayer({
  fileId,
  title,
  className,
  onProgress,
  onEnded,
  live,
}: {
  fileId: string;
  title: string;
  className?: string;
  onProgress?: (progress: WatchProgress) => void;
  onEnded?: () => void;
  live?: { position: number; receivedAt: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const liveRef = useRef(live);
  liveRef.current = live;
  const [details, setDetails] = useState<VideoDetails | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [subtitleSize, setSubtitleSize] = useState("22");
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [delay, setDelay] = useState(0);
  const [delayInput, setDelayInput] = useState("0");
  const [speed, setSpeed] = useState("1");
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [uploading, setUploading] = useState(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const cueTimes = useRef(new WeakMap<TextTrackCue, { start: number; end: number }>());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current!;
    let disposed = false;
    let stopped = false;
    let ready = false;
    let interacted = false;
    let restoring = false;
    let savedPosition = 0;
    let savedEnded = false;
    let revision: string | null = null;
    let initialPosition = 0;
    let pending: { position: number; duration: number; ended: boolean; keepalive: boolean } | null = null;
    let saving = false;

    setError(null);
    setLoading(true);

    async function flush() {
      if (saving || !pending || stopped) return;
      const snapshot = pending;
      pending = null;
      saving = true;
      try {
        const progress = await filesApi.saveProgress(fileId, snapshot.position, snapshot.duration, {
          expectedUpdatedAt: revision,
          completed: snapshot.ended ? true : undefined,
          keepalive: snapshot.keepalive,
        });
        revision = progress.updated_at;
        savedPosition = snapshot.position;
        savedEnded = snapshot.ended;
        onProgressRef.current?.(progress);
        if (!disposed) setError(null);
      } catch (err) {
        if (err instanceof ApiError && [401, 403, 409].includes(err.status)) stopped = true;
        else pending ??= snapshot;
        if (!disposed) setError(err instanceof ApiError ? err.message : "Não foi possível salvar o progresso. Tentando novamente…");
      } finally {
        saving = false;
      }
      // Um novo checkpoint pode ter chegado enquanto a gravação estava em andamento.
      if (pending && !stopped && pending !== snapshot) void flush();
    }

    function persist(force = false, keepalive = false) {
      if (liveRef.current || stopped || !ready || !interacted || video.error || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const position = video.currentTime;
      if (video.ended === savedEnded && Math.abs(position - savedPosition) < (force ? 0.1 : 5) && !pending) return;
      pending = { position, duration: video.duration, ended: video.ended, keepalive };
      void flush();
    }

    const metadata = () => {
      const clock = liveRef.current;
      if (clock) initialPosition = clock.position + (Date.now() - clock.receivedAt) / 1000;
      if (initialPosition > 0 && initialPosition < video.duration) {
        restoring = true;
        video.currentTime = initialPosition;
      }
      video.playbackRate = liveRef.current ? 1 : Number(speedRef.current);
      video.defaultPlaybackRate = video.playbackRate;
      ready = true;
      setLoading(false);
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 86400) {
        mediaApi.updateVideo(fileId, { duration_seconds: video.duration }).catch(() => {});
      }
    };
    const playing = () => {
      window.dispatchEvent(new CustomEvent("rwz-media-play",{detail:{source:"drive-video"}}));
      interacted = true;
      const clock = liveRef.current;
      if (clock) {
        const position = clock.position + (Date.now() - clock.receivedAt) / 1000;
        if (Math.abs(video.currentTime-position) > 3 && position < video.duration) video.currentTime = position;
      }
    };
    const seeked = () => {
      if (restoring) restoring = false;
      else {
        interacted = true;
        persist(true);
      }
    };
    const pause = () => persist(true);
    const ended = () => { interacted = true; persist(true); onEndedRef.current?.(); };
    const hidden = () => { if (document.hidden) persist(true, true); };
    const pagehide = () => persist(true, true);
    const otherMedia=(event:Event)=>{if((event as CustomEvent).detail?.source!=="drive-video")video.pause();};
    const failed = () => {
      if (!disposed) {
        setLoading(false);
        setError("Não foi possível reproduzir este vídeo. Confira o arquivo e se o navegador suporta o formato.");
      }
    };

    video.addEventListener("loadedmetadata", metadata);
    video.addEventListener("playing", playing);
    video.addEventListener("seeked", seeked);
    video.addEventListener("pause", pause);
    video.addEventListener("ended", ended);
    video.addEventListener("error", failed);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("rwz-media-play",otherMedia);
    const interval = setInterval(() => { if (!video.paused || pending) persist(); }, 5000);

    const checkpoint = liveRef.current ? Promise.resolve({ updated_at: null, completed_at: null, position_seconds: 0 })
      : filesApi.getProgress(fileId);
    checkpoint.then((progress) => {
      if (disposed) return;
      revision = progress.updated_at;
      initialPosition = progress.completed_at ? 0 : progress.position_seconds;
      savedPosition = initialPosition;
      video.src = filesApi.streamUrl(fileId);
    }).catch((err) => {
      if (disposed) return;
      setLoading(false);
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar o ponto de retomada.");
    });

    return () => {
      persist(true, true);
      disposed = true;
      clearInterval(interval);
      video.removeEventListener("loadedmetadata", metadata);
      video.removeEventListener("playing", playing);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("pause", pause);
      video.removeEventListener("ended", ended);
      video.removeEventListener("error", failed);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("rwz-media-play",otherMedia);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [fileId, attempt]);

  useEffect(() => {
    let active = true;
    setDetails(null);
    setSubtitle("");
    mediaApi.video(fileId).then((data) => { if (active) setDetails(data); }).catch(() => {});
    return () => { active = false; };
  }, [fileId]);

  useEffect(() => {
    setPipAvailable(Boolean(document.pictureInPictureEnabled));
    try {
      const saved = JSON.parse(localStorage.getItem("rwz-player-options") || "{}");
      if (["16","22","30"].includes(saved.size)) setSubtitleSize(saved.size);
      if (["#ffffff","#ffff00","#00ffff"].includes(saved.color)) setSubtitleColor(saved.color);
      if (["0.5","0.75","1","1.25","1.5","2"].includes(saved.speed)) setSpeed(saved.speed);
    } catch {}
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = live ? 1 : Number(speed);
      videoRef.current.defaultPlaybackRate = videoRef.current.playbackRate;
    }
    try { localStorage.setItem("rwz-player-options", JSON.stringify({ size: subtitleSize, color: subtitleColor, speed })); } catch {}
  }, [speed, subtitleSize, subtitleColor, live]);

  function applySubtitles() {
    const tracks = videoRef.current?.querySelectorAll("track");
    tracks?.forEach((element) => {
      const track = element.track;
      track.mode = element.dataset.subtitleId === subtitle ? "showing" : "disabled";
      if (track.cues) for (const cue of Array.from(track.cues)) {
        let original = cueTimes.current.get(cue);
        if (!original) {
          original = { start: cue.startTime, end: cue.endTime };
          cueTimes.current.set(cue, original);
        }
        cue.startTime = Math.max(0, original.start + delay);
        cue.endTime = Math.max(cue.startTime + 0.01, original.end + delay);
      }
    });
  }
  useEffect(() => { applySubtitles(); }, [subtitle, delay, details]);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch { setError("Tela cheia indisponível neste navegador."); }
  }
  async function pip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch { setError("Picture-in-picture indisponível para este vídeo."); }
  }
  function seek(seconds: number) {
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || (event.target as HTMLElement)?.closest("input,textarea,select,button,[contenteditable]")) return;
      const video = videoRef.current;
      if (!video) return;
      if ([" ","ArrowLeft","ArrowRight"].includes(event.key)) event.preventDefault();
      if (event.key === " ") {
        if (video.paused) void video.play().catch(() => {}); else video.pause();
      }
      if (!liveRef.current && event.key === "ArrowLeft") seek(-10);
      if (!liveRef.current && event.key === "ArrowRight") seek(10);
      if (event.key.toLowerCase() === "f") void fullscreen();
      if (event.key.toLowerCase() === "m") video.muted = !video.muted;
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);

  async function uploadSubtitle(file: File) {
    if (!details) return;
    if (!/\.(srt|vtt)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      setError("Use uma legenda SRT ou VTT de até 2 MB.");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await filesApi.uploadSingle(file, details.file.folder_id);
      const next = await mediaApi.addSubtitle(fileId, uploaded.id, file.name.replace(/\.[^.]+$/, ""));
      setDetails(next);
      setSubtitle(uploaded.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível enviar a legenda."); }
    finally { setUploading(false); }
  }

  return (
    <div ref={containerRef} className={styles.player} style={{
      "--subtitle-size": subtitleSize + "px", "--subtitle-color": subtitleColor,
    } as React.CSSProperties}>
      <video ref={videoRef} controls autoPlay playsInline preload="metadata" aria-label={title} className={className}>
        {details?.subtitles.map((track) => <track key={track.id} kind="subtitles" label={track.label}
          data-subtitle-id={track.id} src={mediaApi.subtitleUrl(fileId, track.id)} onLoad={applySubtitles} />)}
      </video>
      <div className={styles.controls} aria-label="Controles adicionais do vídeo">
        {!live && <CreateJamButton fileId={fileId} position={() => videoRef.current?.currentTime ?? 0} />}
        {!live && <><button type="button" onClick={() => seek(-10)} title="Voltar 10 segundos">−10s</button>
          <button type="button" onClick={() => seek(10)} title="Avançar 10 segundos">+10s</button>
          <label>Velocidade<select value={speed} onChange={(event) => setSpeed(event.target.value)}>
            {["0.5","0.75","1","1.25","1.5","2"].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select></label></>}
        {live && <button type="button" onClick={() => {
          const clock = liveRef.current;
          const video = videoRef.current;
          if (clock && video) {
            video.currentTime = Math.min(video.duration - 0.1, clock.position + (Date.now()-clock.receivedAt)/1000);
            void video.play().catch(() => {});
          }
        }}>Retomar ao vivo</button>}
        <button type="button" onClick={() => void fullscreen()}>Tela cheia</button>
        {pipAvailable && <button type="button" onClick={() => void pip()}>Miniatura (PiP)</button>}
      </div>
      <details className={styles.subtitleSettings}>
        <summary>Legendas e aparência</summary>
        <div className={styles.controls}>
          <label>Legenda<select value={subtitle} onChange={(event) => setSubtitle(event.target.value)}>
            <option value="">Desativada</option>{details?.subtitles.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
          </select></label>
          <button type="button" disabled={!details || uploading} onClick={() => subtitleInputRef.current?.click()}>{uploading ? "Enviando…" : "Carregar SRT/VTT"}</button>
          <input ref={subtitleInputRef} type="file" accept=".srt,.vtt" hidden onChange={(event) => {
            const file = event.target.files?.[0]; if (file) void uploadSubtitle(file); event.target.value = "";
          }} />
          <label>Tamanho<select value={subtitleSize} onChange={(event) => setSubtitleSize(event.target.value)}>
            <option value="16">Pequena</option><option value="22">Média</option><option value="30">Grande</option>
          </select></label>
          <label>Cor<select value={subtitleColor} onChange={(event) => setSubtitleColor(event.target.value)}>
            <option value="#ffffff">Branco</option><option value="#ffff00">Amarelo</option><option value="#00ffff">Ciano</option>
          </select></label>
          <label>Atraso (s)<input type="number" min="-60" max="60" step="0.5" value={delayInput}
            onChange={(event) => {
              setDelayInput(event.target.value);
              setDelay(Math.max(-60,Math.min(60,Number(event.target.value) || 0)));
            }} onBlur={() => setDelayInput(String(delay))} /></label>
        </div>
      </details>
      {loading && <p className={styles.message} role="status">Carregando vídeo…</p>}
      {error && <div className={styles.message} role="status">
        <span>{error}</span>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>Reabrir vídeo</button>
      </div>}
    </div>
  );
}

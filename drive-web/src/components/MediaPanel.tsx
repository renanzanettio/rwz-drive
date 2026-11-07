"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, filesApi, mediaApi, type MediaCatalog, type MediaEpisode, type MediaTitle, type WatchProgress } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { FolderIcon, VideoIcon } from "./icons";
import { DrivePicker } from "./DrivePicker";
import { MediaEditor } from "./MediaEditor";
import dialogs from "./MediaDialogs.module.css";
import { VideoPlayer } from "./VideoPlayer";
import styles from "./MediaPanel.module.css";

const episodesOf = (title: MediaTitle) => title.seasons.flatMap((season) => season.episodes);
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const countLabel = (count: number, singular: string, plural: string) => count + " " + (count === 1 ? singular : plural);

function PlayIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="m8 5 12 7-12 7z" /></svg>;
}

function artwork(title: MediaTitle) {
  return title.cover_file_id
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={filesApi.streamUrl(title.cover_file_id)} alt="" loading="lazy" />
    : <div className={styles.fallback} aria-hidden="true"><VideoIcon size={47} /><span>RWZ DRIVE</span></div>;
}

function progressLabel(episode: MediaEpisode) {
  if (episode.watch_completed_at) return "Assistido";
  if (episode.watch_position_seconds) return "Continue em " + formatDuration(episode.watch_position_seconds);
  return "Ainda não assistido";
}

function ProgressBar({ episode }: { episode: MediaEpisode }) {
  if (!episode.watch_position_seconds || !episode.watch_duration_seconds || episode.watch_completed_at) return null;
  return <progress className={styles.progress} value={episode.watch_position_seconds}
    max={episode.watch_duration_seconds} aria-label="Progresso do vídeo" />;
}

export function MediaPanel({
  query,
  onOpenFolder,
  onOpenTV,
}: {
  query: string;
  onOpenFolder: (folderId: string) => void;
  onOpenTV: () => void;
}) {
  const [catalog, setCatalog] = useState<MediaCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "series" | "movie">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState(false);
  const [sourcePicker, setSourcePicker] = useState(false);
  const [sourceFolder, setSourceFolder] = useState<{ id: string; name: string } | null>(null);
  const [sourceKind, setSourceKind] = useState<"series" | "movies">("series");
  const [autoNext, setAutoNext] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const requestId = useRef(0);

  async function reload(setup = false) {
    const id = ++requestId.current;
    setBusy(true);
    setError(null);
    try {
      const data = await (setup ? mediaApi.setup() : mediaApi.catalog());
      if (mounted.current && id === requestId.current) setCatalog(data);
    } catch (err) {
      if (mounted.current && id === requestId.current) setError(err instanceof ApiError ? err.message : "Não foi possível abrir a coleção.");
    } finally {
      if (mounted.current && id === requestId.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; requestId.current += 1; };
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setPlayingId(null);
  }, [query]);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "start" });
  }, [selectedId, playingId]);

  function applyProgress(progress: WatchProgress) {
    if (!mounted.current) return;
    setCatalog((previous) => previous && ({
      ...previous,
      titles: previous.titles.map((title) => ({
        ...title,
        seasons: title.seasons.map((season) => ({
          ...season,
          episodes: season.episodes.map((episode) => episode.id === progress.file_id ? {
            ...episode,
            watch_position_seconds: progress.position_seconds,
            watch_duration_seconds: progress.duration_seconds,
            watch_completed_at: progress.completed_at,
            watch_updated_at: progress.updated_at,
          } : episode),
        })),
      })),
    }));
  }

  async function toggleWatched(episode: MediaEpisode) {
    setUpdatingId(episode.id);
    setError(null);
    try {
      const progress = await filesApi.saveProgress(episode.id, 0, episode.watch_duration_seconds ?? null, {
        completed: !episode.watch_completed_at,
        expectedUpdatedAt: episode.watch_updated_at ?? null,
      });
      applyProgress(progress);
    } catch (err) {
      if (mounted.current) setError(err instanceof ApiError ? err.message : "Não foi possível atualizar o histórico.");
    } finally {
      if (mounted.current) setUpdatingId(null);
    }
  }

  useEffect(() => {
    try { setAutoNext(localStorage.getItem("rwz-auto-next") !== "off"); } catch {}
  }, []);

  async function registerSource(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceFolder) return;
    setBusy(true);
    setError(null);
    try {
      setCatalog(await mediaApi.addSource(sourceFolder.id, sourceKind));
      setSourceFolder(null);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Não foi possível adicionar a pasta."); }
    finally { setBusy(false); }
  }

  async function toggleWatchlist(title: MediaTitle) {
    setBusy(true);
    try { setCatalog(await mediaApi.updateTitle(title.id, { watchlist: !title.watchlist })); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a lista."); }
    finally { setBusy(false); }
  }

  function selectTitle(title: MediaTitle) {
    setSelectedId(title.id);
    const next = episodesOf(title).find((episode) => !episode.watch_completed_at);
    setSeasonId(title.seasons.find((season) => season.episodes.some((e) => e.id === next?.id))?.id ?? title.seasons[0].id);
    setPlayingId(null);
    setError(null);
  }

  function play(title: MediaTitle, episode: MediaEpisode) {
    setCountdown(null);
    setSelectedId(title.id);
    setSeasonId(title.seasons.find((season) => season.episodes.some((e) => e.id === episode.id))?.id ?? null);
    setPlayingId(episode.id);
    setError(null);
  }

  const titles = catalog?.titles ?? [];
  const selected = titles.find((title) => title.id === selectedId);
  const selectedEpisodes = selected ? episodesOf(selected) : [];
  const playing = selectedEpisodes.find((episode) => episode.id === playingId);
  const playingIndex = selectedEpisodes.findIndex((episode) => episode.id === playingId);
  const previousEpisode = selectedEpisodes[playingIndex - 1];
  const nextEpisode = selectedEpisodes[playingIndex + 1];
  const currentSeason = selected?.seasons.find((season) => season.id === seasonId) ?? selected?.seasons[0];
  const recent = titles.flatMap((title) => title.seasons.flatMap((season) => season.episodes
    .filter((episode) => !episode.watch_completed_at && (episode.watch_position_seconds ?? 0) > 0)
    .map((episode) => ({ title, season, episode }))))
    .sort((a, b) => (b.episode.watch_updated_at ?? "").localeCompare(a.episode.watch_updated_at ?? ""));
  const needle = normalize(query);
  const matches = (title: MediaTitle) => !needle || normalize(title.name).includes(needle)
    || episodesOf(title).some((episode) => normalize(episode.title).includes(needle));
  const visible = titles.filter((title) => {
    const episodes = episodesOf(title);
    const watched = episodes.filter((episode) => episode.watch_completed_at).length;
    const started = watched > 0 || episodes.some((episode) => (episode.watch_position_seconds ?? 0) > 0);
    const statusMatches = statusFilter === "all"
      || (statusFilter === "watchlist" && title.watchlist)
      || (statusFilter === "not_started" && !started)
      || (statusFilter === "in_progress" && started && watched < episodes.length)
      || (statusFilter === "completed" && watched === episodes.length);
    return (filter === "all" || title.kind === filter) && matches(title) && statusMatches;
  });
  const featured = recent[0] ?? (titles[0] ? {
    title: titles[0],
    episode: episodesOf(titles[0]).find((episode) => !episode.watch_completed_at) ?? episodesOf(titles[0])[0],
  } : null);
  const rootFolders = [...(catalog?.roots.series ?? []), ...(catalog?.roots.movies ?? [])];
  const needsSetup = catalog && (!catalog.roots.series.length || !catalog.roots.movies.length);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      if (selected && nextEpisode) play(selected, nextEpisode);
      else setCountdown(null);
      return;
    }
    const timeout = setTimeout(() => setCountdown((value) => value === null ? null : value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [countdown, selected, nextEpisode]);

  function TitleCard({ title }: { title: MediaTitle }) {
    const items = episodesOf(title);
    const watched = items.filter((episode) => episode.watch_completed_at).length;
    return <button type="button" className={styles.titleCard} onClick={() => selectTitle(title)}>
      <div className={styles.poster} data-tone={title.kind}>
        {artwork(title)}
        <span className={styles.kind}>{title.kind === "series" ? "SÉRIE" : "FILME"}</span>
        {title.watchlist && <span className={styles.watchlistBadge}>★ Quero assistir</span>}
        {watched === items.length && <span className={styles.finishedBadge}>✓ Assistido</span>}
      </div>
      <strong>{title.name}</strong>
      <span className={styles.cardMeta}>{title.kind === "series"
        ? countLabel(title.seasons.length, "temporada", "temporadas") + " · " + watched + "/" + items.length + " assistidos"
        : progressLabel(items[0])}</span>
      {title.kind === "movie" && <ProgressBar episode={items[0]} />}
    </button>;
  }

  return <div ref={panelRef} className={styles.panel}>
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>SEU ACERVO PESSOAL</p><h1>Séries e filmes</h1>
        <p className={styles.subtitle}>Continue de onde parou ou escolha o próximo título.</p></div>
      {!playing && <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onOpenTV}>Modo TV</button>
        <button type="button" className={styles.button} onClick={() => setSourcePicker(true)}>Adicionar pasta</button>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void reload()}>
          {busy ? "Atualizando…" : "Atualizar coleção"}
        </button>
      </div>}
    </div>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {!catalog && <p className={styles.status} role="status">{busy ? "Abrindo sua coleção…" : "Use Atualizar coleção para tentar novamente."}</p>}

    {playing && selected ? <section className={styles.watch}>
      <button type="button" className={styles.back} onClick={() => setPlayingId(null)}>← Voltar a {selected.name}</button>
      <div className={styles.playerFrame}>
        <VideoPlayer key={playing.id} fileId={playing.id} title={playing.title}
          className={styles.video} onProgress={applyProgress}
          onEnded={() => { if (autoNext && nextEpisode) setCountdown(8); }} />
      </div>
      {countdown !== null && nextEpisode && <div className={styles.autoNext} role="status">
        <span>Próximo episódio em {countdown}s · {nextEpisode.title}</span>
        <button type="button" className={styles.primary} onClick={() => play(selected, nextEpisode)}>Assistir agora</button>
        <button type="button" className={styles.button} onClick={() => setCountdown(null)}>Cancelar</button>
      </div>}
      <label className={styles.autoNextOption}><input type="checkbox" checked={autoNext} onChange={(event) => {
        setAutoNext(event.target.checked);
        if (!event.target.checked) setCountdown(null);
        try { localStorage.setItem("rwz-auto-next",event.target.checked ? "on" : "off"); } catch {}
      }} /> Reproduzir próximo episódio automaticamente</label>
      <div className={styles.watchMeta}><div><p className={styles.eyebrow}>{currentSeason?.name}</p>
        <h2>{playing.title}</h2><p className={styles.subtitle}>{progressLabel(playing)}</p></div>
        <div className={styles.actions}>
          {previousEpisode && <button type="button" className={styles.button} onClick={() => play(selected, previousEpisode)}>← Anterior</button>}
          {nextEpisode && <button type="button" className={styles.primary} onClick={() => play(selected, nextEpisode)}>Próximo episódio →</button>}
        </div>
      </div>
    </section> : selected ? <section>
      <button type="button" className={styles.back} onClick={() => setSelectedId(null)}>← Voltar à coleção</button>
      <div className={styles.detailHero}>
        <div className={styles.detailPoster} data-tone={selected.kind}>{artwork(selected)}</div>
        <div className={styles.detailCopy}><p className={styles.eyebrow}>{selected.kind === "series" ? "SÉRIE" : "FILME"}</p>
          <h2>{selected.name}</h2>
          {selected.description && <p className={styles.description}>{selected.description}</p>}
          <p className={styles.subtitle}>{selectedEpisodes.filter((e) => e.watch_completed_at).length} de {selectedEpisodes.length} assistidos</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => {
              const resume = recent.find((item) => item.title.id === selected.id)?.episode;
              play(selected, resume ?? selectedEpisodes.find((e) => !e.watch_completed_at) ?? selectedEpisodes[0]);
            }}><PlayIcon /> Assistir</button>
            <button type="button" className={styles.button} onClick={() => onOpenFolder(selected.folder_id)}><FolderIcon size={16} /> Abrir no Drive</button>
            <button type="button" className={styles.button} onClick={() => setEditing(true)}>Editar título e episódios</button>
            <button type="button" className={styles.button} disabled={busy} aria-pressed={selected.watchlist}
              onClick={() => void toggleWatchlist(selected)}>{selected.watchlist ? "★ Na minha lista" : "☆ Quero assistir"}</button>
          </div>
        </div>
      </div>
      <div className={styles.sectionHeading}><h2>{selected.kind === "series" ? "Episódios" : "Seu filme"}</h2>
        {selected.kind === "series" && <label className={styles.seasonLabel}>Temporada
          <select value={currentSeason?.id} onChange={(event) => setSeasonId(event.target.value)}>
            {selected.seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </label>}
      </div>
      <ol className={styles.episodes}>
        {currentSeason?.episodes.map((episode, index) => <li key={episode.id} className={styles.episode}>
          <button type="button" className={styles.episodePlay} onClick={() => play(selected, episode)}>
            <span className={styles.episodeNumber}>{String(index + 1).padStart(2, "0")}</span>
            <span className={styles.episodeName}><strong>{episode.title}</strong><small>{progressLabel(episode)}</small><ProgressBar episode={episode} /></span>
            <span className={styles.playCircle}><PlayIcon /></span>
          </button>
          <button type="button" className={styles.watchedButton} disabled={updatingId !== null}
            aria-label={(episode.watch_completed_at ? "Desmarcar assistido em " : "Marcar como assistido: ") + episode.title}
            aria-pressed={!!episode.watch_completed_at} onClick={() => void toggleWatched(episode)}>
            {updatingId === episode.id ? "Salvando…" : episode.watch_completed_at ? "✓ Assistido" : "Marcar assistido"}
          </button>
        </li>)}
      </ol>
    </section> : catalog && <>
      {!needle && featured && <section className={styles.hero}>
        <div className={styles.heroArt} data-tone={featured.title.kind}>{artwork(featured.title)}</div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{recent.length ? "RETOME SUA SESSÃO" : "DA SUA COLEÇÃO"}</p>
          <h2>{featured.title.name}</h2>
          <p>{featured.episode.title}{featured.episode.watch_position_seconds ? " · " + formatDuration(featured.episode.watch_position_seconds) : ""}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => play(featured.title, featured.episode)}>
              <PlayIcon /> {recent.length ? "Continuar assistindo" : "Assistir"}
            </button>
            <button type="button" className={styles.button} onClick={() => selectTitle(featured.title)}>Ver detalhes</button>
          </div>
        </div>
      </section>}

      {!needle && recent.length > 0 && <section className={styles.section}>
        <div className={styles.sectionHeading}><h2>Continue assistindo</h2><span>Seu histórico acompanha sua conta</span></div>
        <div className={styles.continueGrid}>{recent.slice(0, 8).map(({ title, season, episode }) =>
          <button type="button" key={episode.id} className={styles.continueCard} onClick={() => play(title, episode)}>
            <div className={styles.continueArt} data-tone={title.kind}>{artwork(title)}<span className={styles.playCircle}><PlayIcon /></span></div>
            <div className={styles.continueCopy}><small>{title.name}{title.kind === "series" ? " · " + season.name : ""}</small>
              <strong>{episode.title}</strong><ProgressBar episode={episode} />
              <small>{formatDuration(episode.watch_position_seconds ?? 0)}{episode.watch_duration_seconds ? " de " + formatDuration(episode.watch_duration_seconds) : ""}</small>
            </div>
          </button>)}</div>
      </section>}

      <section className={styles.section}>
        <div className={styles.sectionHeading}><h2>{needle ? "Resultados da busca" : "Minha coleção"}</h2>
          <label className={styles.seasonLabel}>Histórico<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos</option><option value="not_started">Não comecei</option>
            <option value="in_progress">Em andamento</option><option value="completed">Concluídos</option>
            <option value="watchlist">Quero assistir</option></select></label>
          <div className={styles.filters} aria-label="Tipo de vídeo">
            {([["all", "Tudo"], ["series", "Séries"], ["movie", "Filmes"]] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
        </div>
        {visible.length ? <div className={styles.titleGrid}>{visible.map((title) => <TitleCard key={title.id} title={title} />)}</div>
          : <div className={styles.empty}><VideoIcon size={35} />
            <h3>{titles.length || needle ? "Nenhum título encontrado" : "Sua primeira sessão começa aqui"}</h3>
            <p>{titles.length || needle ? "Tente outro nome ou tipo de vídeo." : "Organize os vídeos nas pastas Séries e Filmes do seu Drive. Eles aparecem aqui com o histórico da sua conta."}</p>
            {needsSetup && <button type="button" className={styles.primary} disabled={busy} onClick={() => void reload(true)}>Criar pastas Séries e Filmes</button>}
          </div>}
      </section>

      <details className={styles.organize}>
        <summary>Como organizar minha coleção?</summary>
        <p>Na raiz do Drive, use uma pasta <strong>Séries</strong> e outra <strong>Filmes</strong>.</p>
        <ul><li>Séries → Nome da série → Temporada 1 → 01 - Episódio.mp4</li>
          <li>Filmes → Nome do filme → Nome do filme.mp4</li></ul>
        <p>Use números nos nomes para ordenar episódios e temporadas. Coloque uma imagem <strong>capa.jpg</strong>, <strong>capa.png</strong> ou <strong>capa.webp</strong> na pasta da série ou do filme para usar como capa.</p>
        {(catalog.sources ?? []).length > 0 && <div className={styles.sources}>
          <h3>Pastas adicionadas</h3>{catalog.sources.map((source) => <div key={source.folder_id}>
            <span>{source.name} · {source.kind === "series" ? "Série" : "Filmes"}</span>
            <button type="button" className={styles.button} disabled={busy} onClick={async () => {
              setBusy(true);
              try { setCatalog(await mediaApi.removeSource(source.folder_id)); }
              catch (err) { setError(err instanceof ApiError ? err.message : "Não foi possível remover a classificação."); }
              finally { setBusy(false); }
            }}>Remover classificação</button>
          </div>)}
        </div>}
        <div className={styles.actions}>{rootFolders.map((folder) =>
          <button type="button" className={styles.button} key={folder.id} onClick={() => onOpenFolder(folder.id)}><FolderIcon size={16} /> Abrir {folder.name}</button>)}
          {needsSetup && <button type="button" className={styles.button} disabled={busy} onClick={() => void reload(true)}>Criar pastas que faltam</button>}
        </div>
      </details>
    </>}
    {editing && selected && <MediaEditor title={selected} onCancel={() => setEditing(false)}
      onSaved={(data) => { setCatalog(data); setEditing(false); }} />}
    {sourcePicker && <DrivePicker mode="folder" onCancel={() => setSourcePicker(false)}
      onFolder={(folder) => { setSourceFolder(folder); setSourcePicker(false); }} />}
    {sourceFolder && <div className={dialogs.overlay} onClick={() => { if (!busy) setSourceFolder(null); }}>
      <form className={dialogs.dialog} role="dialog" aria-modal="true" aria-label="Adicionar pasta à coleção"
        onClick={(event) => event.stopPropagation()} onSubmit={registerSource}>
        <h2>{sourceFolder.name}</h2>
        <label>Organizar como<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as "series" | "movies")}>
          <option value="series">Uma série, com temporadas dentro da pasta</option>
          <option value="movies">Uma coleção de filmes</option></select></label>
        <p className={dialogs.hint}>Os arquivos desta pasta entram no catálogo da sua conta.</p>
        {error && <p className={dialogs.error}>{error}</p>}
        <div className={dialogs.actions}><button type="button" className={dialogs.button} disabled={busy} onClick={() => setSourceFolder(null)}>Cancelar</button>
          <button type="submit" className={dialogs.primary} disabled={busy}>{busy ? "Adicionando…" : "Adicionar à coleção"}</button></div>
      </form>
    </div>}
  </div>;
}

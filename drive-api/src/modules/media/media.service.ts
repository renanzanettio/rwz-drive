import { db, runInTransaction } from "../../db";
import { createFolder, listFolders, type FolderRecord } from "../folders/folders.service";
import type { FileRecord } from "../files/files.service";

interface CatalogFile extends FileRecord {
  custom_title: string | null;
  duration_seconds: number | null;
  sort_order: number | null;
}

export interface Episode extends FileRecord {
  title: string;
  duration_seconds: number | null;
  sort_order: number | null;
}

interface Season {
  id: string;
  name: string;
  episodes: Episode[];
}

export interface MediaTitle {
  id: string;
  kind: "series" | "movie";
  name: string;
  folder_id: string;
  cover_file_id: string | null;
  seasons: Season[];
  description?: string;
  watchlist?: boolean;
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const titleOf = (file: FileRecord) => file.original_name.replace(/\.[^.]+$/, "").replace(/_/g, " ");
const compare = (a: { name: string }, b: { name: string }) =>
  collator.compare(a.name, b.name) || a.name.localeCompare(b.name);

function mediaRoots(folders: FolderRecord[]) {
  return {
    series: folders.filter((f) => f.parent_id === null && normalize(f.name) === "series"),
    movies: folders.filter((f) => f.parent_id === null && normalize(f.name) === "filmes"),
  };
}

export function ensureMediaFolders(ownerId: string): void {
  runInTransaction(() => {
    const roots = mediaRoots(listFolders(ownerId, null));
    if (!roots.series.length) createFolder(ownerId, "Séries", null);
    if (!roots.movies.length) createFolder(ownerId, "Filmes", null);
  });
}

export function getMediaCatalog(ownerId: string) {
  const folders = db.prepare(
    "SELECT * FROM folders WHERE owner_id = ? AND deleted_at IS NULL"
  ).all(ownerId) as unknown as FolderRecord[];
  const roots = mediaRoots(folders);
  const files = db.prepare(
    `SELECT f.*, wp.position_seconds AS watch_position_seconds,
            wp.duration_seconds AS watch_duration_seconds,
            wp.completed_at AS watch_completed_at, wp.updated_at AS watch_updated_at,
            m.title AS custom_title, m.sort_order, COALESCE(m.duration_seconds, wp.duration_seconds) AS duration_seconds
     FROM files f
     LEFT JOIN watch_progress wp ON wp.file_id = f.id AND wp.owner_id = f.owner_id
     LEFT JOIN media_file_settings m ON m.file_id = f.id AND m.owner_id = f.owner_id
     WHERE f.owner_id = ? AND f.deleted_at IS NULL
       AND (f.mime_type LIKE 'video/%' OR f.mime_type LIKE 'image/%')`
  ).all(ownerId) as unknown as CatalogFile[];
  const children = new Map<string, FolderRecord[]>();
  const byFolder = new Map<string, CatalogFile[]>();

  for (const folder of folders) {
    if (folder.parent_id) {
      const list = children.get(folder.parent_id) ?? [];
      list.push(folder);
      children.set(folder.parent_id, list);
    }
  }
  for (const file of files) {
    if (file.folder_id) {
      const list = byFolder.get(file.folder_id) ?? [];
      list.push(file);
      byFolder.set(file.folder_id, list);
    }
  }

  function descendants(folderId: string): string[] {
    const found: string[] = [];
    const visited = new Set<string>();
    const pending = [folderId];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      found.push(id);
      pending.push(...(children.get(id) ?? []).map((f) => f.id));
    }
    return found;
  }

  function episodes(folderIds: string[]): Episode[] {
    return folderIds.flatMap((id) => byFolder.get(id) ?? [])
      .filter((f) => f.mime_type.startsWith("video/"))
      .map((file) => ({ ...file, title: file.custom_title || titleOf(file) }))
      .sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
        || collator.compare(a.original_name, b.original_name) || a.id.localeCompare(b.id));
  }

  function cover(folderId: string): string | null {
    return (byFolder.get(folderId) ?? [])
      .filter((f) => f.mime_type.startsWith("image/") && /^(capa|poster|cover)\.[^.]+$/i.test(f.original_name))
      .sort((a, b) => collator.compare(a.original_name, b.original_name))[0]?.id ?? null;
  }

  const sources = db.prepare(
    "SELECT s.folder_id, s.kind, f.name FROM media_sources s JOIN folders f ON f.id = s.folder_id WHERE s.owner_id = ? AND f.owner_id = s.owner_id AND f.deleted_at IS NULL"
  ).all(ownerId) as unknown as { folder_id: string; kind: "series" | "movies"; name: string }[];
  const explicitSeriesPaths = new Set(sources.filter((s) => s.kind === "series").flatMap((s) => descendants(s.folder_id)));
  const explicitMoviePaths = new Set(sources.filter((s) => s.kind === "movies").flatMap((s) => descendants(s.folder_id)));
  const showFolders = new Map<string, FolderRecord>();
  for (const root of roots.series) {
    for (const show of children.get(root.id) ?? []) {
      if (!explicitSeriesPaths.has(show.id) && !explicitMoviePaths.has(show.id)) showFolders.set(show.id, show);
    }
  }
  for (const source of sources.filter((s) => s.kind === "series")) {
    const folder = folders.find((f) => f.id === source.folder_id);
    if (folder) showFolders.set(folder.id, folder);
  }
  const titles: MediaTitle[] = [];
  for (const show of [...showFolders.values()].sort(compare)) {
    const seasons: Season[] = [];
    const direct = episodes([show.id]);
    if (direct.length) seasons.push({ id: show.id, name: "Episódios avulsos", episodes: direct });
    for (const folder of (children.get(show.id) ?? []).sort(compare)) {
      const items = episodes(descendants(folder.id));
      if (items.length) seasons.push({ id: folder.id, name: folder.name, episodes: items });
    }
    if (seasons.length) titles.push({
      id: show.id, kind: "series", name: show.name, folder_id: show.id,
      cover_file_id: cover(show.id), seasons,
    });
  }
  const movieFolders = new Set([
    ...roots.movies.map((r) => r.id),
    ...sources.filter((s) => s.kind === "movies").map((s) => s.folder_id),
  ]);
  const movieIds = new Set<string>();
  for (const folderId of movieFolders) {
    for (const file of episodes(descendants(folderId))) {
      if (movieIds.has(file.id) || explicitSeriesPaths.has(file.folder_id!)) continue;
      movieIds.add(file.id);
      titles.push({
        id: file.id, kind: "movie", name: file.title, folder_id: file.folder_id!,
        cover_file_id: cover(file.folder_id!),
        seasons: [{ id: file.folder_id!, name: "Filme", episodes: [file] }],
      });
    }
  }
  const settings = db.prepare(
    "SELECT * FROM media_title_settings WHERE owner_id = ?"
  ).all(ownerId) as unknown as { target_id: string; name: string | null; description: string; cover_file_id: string | null; watchlist: number }[];
  const settingsById = new Map(settings.map((item) => [item.target_id, item]));
  for (const title of titles) {
    const setting = settingsById.get(title.id);
    title.description = setting?.description ?? "";
    title.watchlist = Boolean(setting?.watchlist);
    if (setting?.name) title.name = setting.name;
    if (setting?.cover_file_id && files.some((f) => f.id === setting.cover_file_id && f.mime_type.startsWith("image/"))) {
      title.cover_file_id = setting.cover_file_id;
    }
  }

  titles.sort(compare);
  return {
    roots: {
      series: roots.series.map(({ id, name }) => ({ id, name })),
      movies: roots.movies.map(({ id, name }) => ({ id, name })),
    },
    titles,
    sources,
  };
}

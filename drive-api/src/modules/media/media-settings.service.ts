import fs from "node:fs/promises";
import { extname } from "node:path";
import { db, runInTransaction } from "../../db";
import { HttpError } from "../../middlewares/errorHandler";
import { getOwnedFileOrThrow } from "../files/files.service";
import { getOwnedFolderOrThrow } from "../folders/folders.service";
import { filePath } from "../../services/storage.service";
import { getMediaCatalog } from "./media.service";

function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length > maximum) throw new HttpError(400, label + " inválido.");
  return value.trim();
}

export function addSource(owner: string, body: any) {
  if (typeof body.folder_id !== "string") throw new HttpError(400, "Escolha uma pasta.");
  const folder = getOwnedFolderOrThrow(body.folder_id, owner);
  if (!["series", "movies"].includes(body.kind)) throw new HttpError(400, "Tipo de coleção inválido.");
  db.prepare("INSERT INTO media_sources(owner_id, folder_id, kind) VALUES(?,?,?) ON CONFLICT(owner_id,folder_id) DO UPDATE SET kind=excluded.kind")
    .run(owner, folder.id, body.kind);
  return getMediaCatalog(owner);
}

export function removeSource(owner: string, id: string) {
  getOwnedFolderOrThrow(id, owner);
  db.prepare("DELETE FROM media_sources WHERE owner_id=? AND folder_id=?").run(owner, id);
  return getMediaCatalog(owner);
}

export function updateTitle(owner: string, id: string, body: any) {
  const title = getMediaCatalog(owner).titles.find((t) => t.id === id);
  if (!title) throw new HttpError(404, "Título não encontrado.");
  const name = body.name === undefined ? title.name : text(body.name, 255, "Nome");
  if (!name) throw new HttpError(400, "Informe um nome.");
  const description = body.description === undefined ? title.description! : text(body.description, 4000, "Descrição");
  if (body.watchlist !== undefined && typeof body.watchlist !== "boolean") throw new HttpError(400, "Lista inválida.");
  const cover = body.cover_file_id === undefined ? title.cover_file_id : body.cover_file_id;
  if (cover !== null) {
    if (typeof cover !== "string" || !getOwnedFileOrThrow(cover, owner).mime_type.startsWith("image/")) {
      throw new HttpError(400, "Selecione uma imagem do seu Drive.");
    }
  }
  const allowed = new Set(title.seasons.flatMap((s) => s.episodes.map((e) => e.id)));
  const names = body.episode_titles;
  if (names !== undefined && (!names || typeof names !== "object" || Array.isArray(names)
    || Object.keys(names).length > 5000 || Object.entries(names).some(([key,value]) =>
      !allowed.has(key) || typeof value !== "string" || !value.trim() || value.length > 255))) {
    throw new HttpError(400, "Nomes de episódios inválidos.");
  }
  const order = body.episode_order;
  if (order !== undefined) {
    if (!Array.isArray(order) || order.length > 5000 || new Set(order).size !== order.length
      || order.some((item) => typeof item !== "string" || !allowed.has(item))) {
      throw new HttpError(400, "Ordem de episódios inválida.");
    }
  }
  runInTransaction(() => {
    db.prepare(`INSERT INTO media_title_settings(owner_id,target_id,name,description,cover_file_id,watchlist,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,target_id) DO UPDATE SET
      name=excluded.name,description=excluded.description,cover_file_id=excluded.cover_file_id,
      watchlist=excluded.watchlist,updated_at=excluded.updated_at`)
      .run(owner, id, name, description, cover, Number(body.watchlist ?? title.watchlist), new Date().toISOString());
    if (names) {
      const statement = db.prepare(`INSERT INTO media_file_settings(file_id,owner_id,title) VALUES(?,?,?)
        ON CONFLICT(file_id) DO UPDATE SET title=excluded.title`);
      for (const [file, name] of Object.entries(names)) statement.run(file, owner, (name as string).trim());
    }
    if (order) {
      const statement = db.prepare(`INSERT INTO media_file_settings(file_id,owner_id,sort_order) VALUES(?,?,?)
        ON CONFLICT(file_id) DO UPDATE SET sort_order=excluded.sort_order`);
      order.forEach((file: string, index: number) => statement.run(file, owner, index));
    }
  });
  return getMediaCatalog(owner);
}

export function updateVideo(owner: string, id: string, body: any) {
  const file = getOwnedFileOrThrow(id, owner);
  if (!file.mime_type.startsWith("video/")) throw new HttpError(400, "Selecione um vídeo.");
  const old = db.prepare("SELECT * FROM media_file_settings WHERE file_id=? AND owner_id=?").get(id, owner) as any;
  const name = body.title === undefined ? old?.title ?? null : text(body.title, 255, "Nome");
  const duration = body.duration_seconds === undefined ? old?.duration_seconds ?? null : body.duration_seconds;
  if (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 86400)) {
    throw new HttpError(400, "Duração inválida.");
  }
  db.prepare(`INSERT INTO media_file_settings(file_id,owner_id,title,duration_seconds) VALUES(?,?,?,?)
    ON CONFLICT(file_id) DO UPDATE SET title=excluded.title,duration_seconds=excluded.duration_seconds`)
    .run(id, owner, name, duration);
  return videoDetails(owner, id);
}

export function videoDetails(owner: string, id: string) {
  const file = getOwnedFileOrThrow(id, owner);
  const settings = db.prepare("SELECT duration_seconds FROM media_file_settings WHERE file_id=? AND owner_id=?").get(id, owner) as any;
  const subtitles = db.prepare(`SELECT s.subtitle_file_id AS id, s.label FROM media_subtitles s
    JOIN files f ON f.id=s.subtitle_file_id
    WHERE s.video_id=? AND s.owner_id=? AND f.owner_id=s.owner_id AND f.deleted_at IS NULL`).all(id, owner);
  return { file, duration_seconds: settings?.duration_seconds ?? null, subtitles };
}

export async function subtitleText(owner: string, videoId: string, subtitleId: string, linked = true) {
  getOwnedFileOrThrow(videoId, owner);
  if (linked && !db.prepare("SELECT 1 FROM media_subtitles WHERE video_id=? AND subtitle_file_id=? AND owner_id=?")
    .get(videoId, subtitleId, owner)) throw new HttpError(404, "Legenda não encontrada.");
  const file = getOwnedFileOrThrow(subtitleId, owner);
  if (![".srt", ".vtt"].includes(extname(file.original_name).toLowerCase()) || file.size > 2 * 1024 * 1024) {
    throw new HttpError(400, "Use uma legenda SRT ou VTT de até 2 MB.");
  }
  const value = (await fs.readFile(filePath(owner, file.storage_name), "utf8")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->/.test(value)) throw new HttpError(400, "A legenda não contém tempos válidos.");
  return /^WEBVTT(?:\s|$)/.test(value) ? value : "WEBVTT\n\n" + value.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

export async function addSubtitle(owner: string, videoId: string, body: any) {
  const file = getOwnedFileOrThrow(videoId, owner);
  if (!file.mime_type.startsWith("video/") || typeof body.subtitle_file_id !== "string") {
    throw new HttpError(400, "Vídeo ou legenda inválidos.");
  }
  await subtitleText(owner, videoId, body.subtitle_file_id, false);
  getOwnedFileOrThrow(videoId, owner);
  getOwnedFileOrThrow(body.subtitle_file_id, owner);
  const label = text(body.label ?? "Português", 80, "Idioma");
  db.prepare(`INSERT INTO media_subtitles(video_id,subtitle_file_id,owner_id,label) VALUES(?,?,?,?)
    ON CONFLICT(video_id,subtitle_file_id) DO UPDATE SET label=excluded.label`).run(videoId, body.subtitle_file_id, owner, label || "Legenda");
  return videoDetails(owner, videoId);
}

export function removeSubtitle(owner: string, video: string, subtitle: string) {
  getOwnedFileOrThrow(video, owner);
  db.prepare("DELETE FROM media_subtitles WHERE video_id=? AND subtitle_file_id=? AND owner_id=?").run(video, subtitle, owner);
  return videoDetails(owner, video);
}

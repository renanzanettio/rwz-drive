import { randomInt } from "node:crypto";
import { db } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import { getMediaCatalog } from "../media/media.service";

interface Program {
  file_id: string;
  title: string;
  show: string;
  duration_ms: number;
}
interface Channel {
  id: string;
  owner_id: string;
  number: number;
  name: string;
  mode: "shuffle" | "ordered";
  selected_titles_json: string;
  lineup_json: string;
  starts_at: number;
  updated_at: string;
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function ownedChannel(owner: string, id: string): Channel {
  const channel = db.prepare("SELECT * FROM tv_channels WHERE id=? AND owner_id=?").get(id, owner) as unknown as Channel | undefined;
  if (!channel) throw new HttpError(404, "Canal não encontrado.");
  return channel;
}

export function saveChannel(owner: string, body: any, id?: string) {
  const old = id ? ownedChannel(owner, id) : null;
  if (old && body.expected_updated_at !== old.updated_at) throw new HttpError(409, "Este canal foi alterado em outro dispositivo. Atualize a lista.");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) throw new HttpError(400, "Informe um nome de até 100 caracteres.");
  if (!Number.isInteger(body.number) || body.number < 1 || body.number > 999) throw new HttpError(400, "Use um número de canal entre 1 e 999.");
  if (!["shuffle", "ordered"].includes(body.mode)) throw new HttpError(400, "Ordem de programação inválida.");
  const selected = body.selected_title_ids;
  if (!Array.isArray(selected) || !selected.length || selected.length > 100
    || selected.some((item) => typeof item !== "string") || new Set(selected).size !== selected.length) {
    throw new HttpError(400, "Selecione de 1 a 100 séries.");
  }
  const catalog = getMediaCatalog(owner);
  const shows = selected.map((showId: string) => {
    const show = catalog.titles.find((t) => t.id === showId && t.kind === "series");
    if (!show) throw new HttpError(400, "Uma das séries foi removida da coleção.");
    return show;
  });
  const groups = shows.map((show) => {
    const programs = show.seasons.flatMap((s) => s.episodes).map((episode) => {
      const duration = episode.duration_seconds;
      if (!duration || !Number.isFinite(duration) || duration <= 0 || duration > 86400) {
        throw new HttpError(400, "Prepare a duração dos episódios antes de salvar o canal.");
      }
      return { file_id: episode.id, title: episode.title, show: show.name, duration_ms: Math.max(1, Math.round(duration * 1000)) };
    });
    return body.mode === "shuffle" ? shuffled(programs) : programs;
  });
  if (groups.reduce((sum, g) => sum + g.length, 0) > 5000) throw new HttpError(400, "Use até 5.000 episódios por canal.");
  const orderedGroups = body.mode === "shuffle" ? shuffled(groups) : groups;
  const lineup: Program[] = [];
  const rounds = Math.max(...orderedGroups.map((g) => g.length));
  for (let index = 0; index < rounds; index++) {
    for (const group of orderedGroups) if (group[index]) lineup.push(group[index]);
  }
  if (!lineup.length) throw new HttpError(400, "As séries selecionadas precisam ter episódios.");
  const duplicate = db.prepare("SELECT id FROM tv_channels WHERE owner_id=? AND number=? AND id<>?")
    .get(owner, body.number, id ?? "");
  if (duplicate) throw new HttpError(409, "Esse número de canal já está em uso.");
  const now = Date.now();
  const updated = new Date(Math.max(now, old ? Date.parse(old.updated_at) + 1 : 0)).toISOString();
  const channelId = id ?? uuid();
  db.prepare(`INSERT INTO tv_channels(id,owner_id,number,name,mode,selected_titles_json,lineup_json,starts_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    number=excluded.number,name=excluded.name,mode=excluded.mode,selected_titles_json=excluded.selected_titles_json,
    lineup_json=excluded.lineup_json,starts_at=excluded.starts_at,updated_at=excluded.updated_at`)
    .run(channelId, owner, body.number, body.name.trim(), body.mode, JSON.stringify(selected), JSON.stringify(lineup), now, updated);
  return channelView(ownedChannel(owner, channelId), now, availableFiles(owner));
}

function availableFiles(owner: string): Set<string> {
  const rows = db.prepare("SELECT id FROM files WHERE owner_id=? AND deleted_at IS NULL AND mime_type LIKE 'video/%'")
    .all(owner) as unknown as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

// Cada cliente usa a mesma lista persistida e a mesma origem de tempo.
// Pausar o player não altera a programação do canal.
export function playout(lineup: Program[], startsAt: number, now: number) {
  const total = lineup.reduce((sum, program) => sum + program.duration_ms, 0);
  if (!total) return { current: null, next: [] };
  const elapsed = Math.max(0, now - startsAt);
  const cycle = Math.floor(elapsed / total);
  let offset = elapsed % total;
  let index = 0;
  let programStart = startsAt + cycle * total;
  while (offset >= lineup[index].duration_ms) {
    offset -= lineup[index].duration_ms;
    programStart += lineup[index].duration_ms;
    index += 1;
  }
  const current = {
    ...lineup[index], start_at: programStart, end_at: programStart + lineup[index].duration_ms,
    offset_seconds: offset / 1000,
  };
  const next = [];
  let followingStart = current.end_at;
  for (let step = 1; step <= 5; step++) {
    const program = lineup[(index + step) % lineup.length];
    next.push({ ...program, start_at: followingStart, end_at: followingStart + program.duration_ms });
    followingStart += program.duration_ms;
  }
  return { current, next };
}

function channelView(channel: Channel, now: number, available: Set<string>) {
  const lineup = (JSON.parse(channel.lineup_json) as Program[]).filter((p) => available.has(p.file_id));
  return {
    id: channel.id, number: channel.number, name: channel.name, mode: channel.mode,
    selected_title_ids: JSON.parse(channel.selected_titles_json) as string[],
    updated_at: channel.updated_at, server_now: now,
    program_count: lineup.length,
    ...playout(lineup, channel.starts_at, now),
  };
}

export function listChannels(owner: string) {
  const channels = db.prepare("SELECT * FROM tv_channels WHERE owner_id=? ORDER BY number")
    .all(owner) as unknown as Channel[];
  const now = Date.now();
  const files = availableFiles(owner);
  return { channels: channels.map((channel) => channelView(channel, now, files)) };
}

export function getChannel(owner: string, id: string) {
  return channelView(ownedChannel(owner, id), Date.now(), availableFiles(owner));
}

export function deleteChannel(owner: string, id: string) {
  ownedChannel(owner, id);
  db.prepare("DELETE FROM tv_channels WHERE owner_id=? AND id=?").run(owner, id);
}

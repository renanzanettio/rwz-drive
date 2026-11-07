import { db } from "../../db";
import { HttpError } from "../../middlewares/errorHandler";

export interface WatchProgress {
  file_id: string;
  owner_id: string;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string;
  completed_at: string | null;
}

export function getProgress(fileId: string, ownerId: string): WatchProgress | null {
  const row = db
    .prepare("SELECT * FROM watch_progress WHERE file_id = ? AND owner_id = ?")
    .get(fileId, ownerId) as unknown as WatchProgress | undefined;
  return row ?? null;
}

export function saveProgress(
  fileId: string,
  ownerId: string,
  positionSeconds: number,
  durationSeconds: number | null,
  completed?: boolean,
  expectedUpdatedAt?: string | null
): WatchProgress {
  const previous = getProgress(fileId, ownerId);
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== (previous?.updated_at ?? null)) {
    throw new HttpError(409, "O histórico foi atualizado em outro player. Reabra o vídeo para continuar salvando aqui.");
  }

  const duration = durationSeconds ?? previous?.duration_seconds ?? null;
  const position = duration ? Math.min(positionSeconds, duration) : positionSeconds;
  const nearEnd = duration !== null && position > 0
    && position >= Math.max(duration - 5, duration * 0.95);
  const alreadyFinished = position < 5 && Boolean(previous?.completed_at);
  const finished = completed ?? (nearEnd || alreadyFinished);
  const previousTime = previous ? Date.parse(previous.updated_at) : 0;
  const now = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();

  db.prepare(
    `INSERT INTO watch_progress
       (file_id, owner_id, position_seconds, duration_seconds, updated_at, completed_at)
     VALUES (@file_id, @owner_id, @position_seconds, @duration_seconds, @updated_at, @completed_at)
     ON CONFLICT(file_id) DO UPDATE SET
       position_seconds = excluded.position_seconds,
       duration_seconds = excluded.duration_seconds,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at`
  ).run({
    file_id: fileId,
    owner_id: ownerId,
    position_seconds: finished || position < 5 ? 0 : position,
    duration_seconds: duration,
    updated_at: now,
    completed_at: finished ? previous?.completed_at ?? now : null,
  });

  return getProgress(fileId, ownerId)!;
}

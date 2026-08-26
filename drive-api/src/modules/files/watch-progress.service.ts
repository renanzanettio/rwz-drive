import { db } from "../../db";

export interface WatchProgress {
  file_id: string;
  owner_id: string;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string;
}

// Abaixo disso não vale a pena guardar/retomar (ex.: 2s de um vídeo de 40min
// não é "continuar assistindo", é ruído).
const RESUME_THRESHOLD_SECONDS = 5;

// A partir daqui do fim, consideramos "assistido" e limpamos o progresso —
// senão o usuário sempre volta pros últimos segundos do vídeo anterior.
const FINISHED_MARGIN_SECONDS = 5;

export function getProgress(fileId: string, ownerId: string): WatchProgress | null {
  const row = db
    .prepare(`SELECT * FROM watch_progress WHERE file_id = ? AND owner_id = ?`)
    .get(fileId, ownerId) as unknown as WatchProgress | undefined;
  return row ?? null;
}

/**
 * Grava (ou limpa) o progresso. Decide sozinho se o valor recebido é "digno"
 * de ser lembrado — perto do início ou perto do fim, a entrada é removida em
 * vez de gravada, pra tabela não acumular lixo e pra próxima abertura do
 * vídeo já começar do zero corretamente.
 */
export function saveProgress(
  fileId: string,
  ownerId: string,
  positionSeconds: number,
  durationSeconds: number | null
): WatchProgress | null {
  const nearEnd =
    durationSeconds !== null &&
    durationSeconds > 0 &&
    positionSeconds >= durationSeconds - FINISHED_MARGIN_SECONDS;

  if (positionSeconds < RESUME_THRESHOLD_SECONDS || nearEnd) {
    clearProgress(fileId, ownerId);
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO watch_progress (file_id, owner_id, position_seconds, duration_seconds, updated_at)
     VALUES (@file_id, @owner_id, @position_seconds, @duration_seconds, @updated_at)
     ON CONFLICT(file_id) DO UPDATE SET
       position_seconds = excluded.position_seconds,
       duration_seconds = excluded.duration_seconds,
       updated_at = excluded.updated_at`
  ).run({
    file_id: fileId,
    owner_id: ownerId,
    position_seconds: positionSeconds,
    duration_seconds: durationSeconds,
    updated_at: now,
  } as unknown as Record<string, string | number | null>);

  return getProgress(fileId, ownerId);
}

export function clearProgress(fileId: string, ownerId: string): void {
  db.prepare(`DELETE FROM watch_progress WHERE file_id = ? AND owner_id = ?`).run(fileId, ownerId);
}

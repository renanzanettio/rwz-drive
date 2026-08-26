import fs from "node:fs/promises";
import path from "node:path";
import { db, runInTransaction } from "../../db";
import { HttpError } from "../../middlewares/errorHandler";
import { getUsedBytes, getQuotaBytes } from "../../services/storage.service";
import { env } from "../../config/env";

export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  storage_quota_bytes: number | null;
  effective_quota_bytes: number;
  used_bytes: number;
  created_at: string;
}

export function listUsers(): UserSummary[] {
  const rows = db
    .prepare(`SELECT id, username, email, role, storage_quota_bytes, created_at FROM users ORDER BY created_at ASC`)
    .all() as unknown as Omit<UserSummary, "effective_quota_bytes" | "used_bytes">[];

  return rows.map((u) => ({
    ...u,
    effective_quota_bytes: getQuotaBytes(u.id),
    used_bytes: getUsedBytes(u.id),
  }));
}

export function updateUserQuota(userId: string, storageQuotaBytes: number | null): void {
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId);
  if (!user) throw new HttpError(404, "Usuário não encontrado.");
  db.prepare(`UPDATE users SET storage_quota_bytes = ?, updated_at = ? WHERE id = ?`).run(
    storageQuotaBytes,
    new Date().toISOString(),
    userId
  );
}

/**
 * Exclui permanentemente uma conta e TODO o conteúdo dela — arquivos,
 * pastas, compartilhamentos públicos que ela criou, progresso de vídeo,
 * sessões, convites emitidos por ela. Não tem como desfazer.
 *
 * Nem toda tabela que referencia `users` tem ON DELETE CASCADE no schema
 * (folders/files e invites.used_by não têm, de propósito — pra nunca
 * apagar dado de ninguém "sem querer" por efeito colateral de outra
 * operação). Aqui, que é o único lugar que realmente QUER apagar tudo,
 * fazemos a limpeza explícita antes de remover a linha do usuário, senão o
 * SQLite bloqueia com violação de chave estrangeira.
 */
export async function deleteUser(userId: string): Promise<void> {
  const user = db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(userId) as unknown as
    | { id: string; role: "admin" | "user" }
    | undefined;

  if (!user) throw new HttpError(404, "Usuário não encontrado.");
  if (user.role === "admin") {
    throw new HttpError(400, "Não é possível excluir uma conta de administrador por aqui.");
  }

  runInTransaction(() => {
    db.prepare(`DELETE FROM files WHERE owner_id = ?`).run(userId);
    db.prepare(`DELETE FROM folders WHERE owner_id = ?`).run(userId);
    db.prepare(`DELETE FROM watch_progress WHERE owner_id = ?`).run(userId);
    db.prepare(`DELETE FROM public_shares WHERE owner_id = ?`).run(userId); // cascateia public_share_sessions
    db.prepare(`UPDATE invites SET used_by = NULL WHERE used_by = ?`).run(userId);
    db.prepare(`DELETE FROM invites WHERE created_by = ?`).run(userId); // usuário comum não cria convites, mas por garantia
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  });

  // A pasta física fica fora da transação do banco de propósito — se isso
  // falhar (ex.: alguma permissão estranha no filesystem), os dados já
  // foram removidos do banco corretamente; só sobra uma pasta órfã pra
  // limpar manualmente depois, o que é recuperável e não deixa o sistema
  // num estado inconsistente.
  const userDir = path.resolve(env.storagePath, "users", userId);
  await fs.rm(userDir, { recursive: true, force: true });
}

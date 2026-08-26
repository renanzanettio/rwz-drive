import { randomBytes } from "node:crypto";
import { db } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";

export interface InviteRecord {
  id: string;
  token: string;
  created_by: string;
  storage_quota_bytes: number | null;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

function generateInviteToken(): string {
  // Mesma entropia dos tokens de compartilhamento público (192 bits) —
  // imprevisível por construção.
  return randomBytes(24).toString("base64url");
}

export function countUsers(): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM users`).get() as unknown as { c: number };
  return row.c;
}

export function createInvite(
  adminId: string,
  options: { storageQuotaBytes?: number | null; expiresAt?: string | null } = {}
): InviteRecord {
  const invite: InviteRecord = {
    id: uuid(),
    token: generateInviteToken(),
    created_by: adminId,
    storage_quota_bytes: options.storageQuotaBytes ?? null,
    expires_at: options.expiresAt ?? null,
    used_by: null,
    used_at: null,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO invites (id, token, created_by, storage_quota_bytes, expires_at, used_by, used_at, created_at)
     VALUES (@id, @token, @created_by, @storage_quota_bytes, @expires_at, @used_by, @used_at, @created_at)`
  ).run(invite as unknown as Record<string, string | number | null>);

  return invite;
}

export function listInvites(adminId: string): InviteRecord[] {
  const rows = db.prepare(`SELECT * FROM invites WHERE created_by = ? ORDER BY created_at DESC`).all(adminId);
  return rows as unknown as InviteRecord[];
}

export function getOwnedInviteOrThrow(inviteId: string, adminId: string): InviteRecord {
  const row = db.prepare(`SELECT * FROM invites WHERE id = ?`).get(inviteId);
  const invite = row as unknown as InviteRecord | undefined;
  if (!invite) throw new HttpError(404, "Convite não encontrado.");
  if (invite.created_by !== adminId) throw new HttpError(403, "Acesso negado a este recurso.");
  return invite;
}

export function revokeInvite(inviteId: string, adminId: string): void {
  const invite = getOwnedInviteOrThrow(inviteId, adminId);
  if (invite.used_by) {
    throw new HttpError(400, "Convite já foi usado, não pode ser revogado.");
  }
  db.prepare(`DELETE FROM invites WHERE id = ?`).run(inviteId);
}

/**
 * Valida um token de convite pro fluxo de REGISTRO (sem exigir que o
 * chamador seja admin — é usado por quem ainda nem tem conta). Lança erro
 * genérico o suficiente pra não distinguir "não existe" de "já usado" de
 * "expirado" no detalhe — só o necessário pra guiar o usuário.
 */
export function validateInviteForRegistration(token: string): InviteRecord {
  const row = db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token);
  const invite = row as unknown as InviteRecord | undefined;

  if (!invite) {
    throw new HttpError(400, "Convite inválido.");
  }
  if (invite.used_by) {
    throw new HttpError(400, "Este convite já foi utilizado.");
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw new HttpError(400, "Este convite expirou.");
  }

  return invite;
}

export function consumeInvite(inviteId: string, newUserId: string): void {
  db.prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?`).run(
    newUserId,
    new Date().toISOString(),
    inviteId
  );
}

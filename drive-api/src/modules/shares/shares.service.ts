import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import { getOwnedFolderOrThrow, softDeleteFolder } from "../folders/folders.service";
import { getOwnedFileOrThrow, softDeleteFile } from "../files/files.service";

const BCRYPT_ROUNDS = 12;
const PUBLIC_SESSION_TTL_HOURS = 24;

export type ShareType = "folder" | "file";
export type ExpiredAction = "make_private" | "delete_content" | "block_uploads";

export interface ShareRecord {
  id: string;
  type: ShareType;
  target_id: string;
  owner_id: string;
  name: string;
  token: string;
  password_hash: string | null;
  status: "active" | "revoked";
  expires_at: string | null;
  expired_action: ExpiredAction;
  allow_view: 0 | 1;
  allow_download: 0 | 1;
  allow_upload: 0 | 1;
  allow_delete: 0 | 1;
  max_file_size: number | null;
  max_total_size: number | null;
  max_files: number | null;
  created_at: string;
  updated_at: string;
}

export interface EffectivePermissions {
  allowView: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  allowDelete: boolean;
}

/** Estado que o painel admin mostra — computado, nunca armazenado. */
export type DisplayStatus = "active" | "expired" | "revoked";

function isExpired(share: ShareRecord): boolean {
  return share.expires_at !== null && new Date(share.expires_at).getTime() < Date.now();
}

export function getDisplayStatus(share: ShareRecord): DisplayStatus {
  if (share.status === "revoked") return "revoked";
  if (isExpired(share)) return "expired";
  return "active";
}

/**
 * Calcula as permissões REALMENTE válidas agora, sempre a partir de
 * expires_at/status/expired_action — nunca confia em um campo "status"
 * potencialmente desatualizado (a varredura periódica só existe para
 * reciclar espaço/atualizar o painel; a decisão de acesso é sempre
 * recalculada na hora, em toda request).
 */
export function getEffectivePermissions(share: ShareRecord): EffectivePermissions {
  if (share.status === "revoked") {
    return { allowView: false, allowDownload: false, allowUpload: false, allowDelete: false };
  }

  if (!isExpired(share)) {
    return {
      allowView: !!share.allow_view,
      allowDownload: !!share.allow_download,
      allowUpload: !!share.allow_upload,
      allowDelete: !!share.allow_delete,
    };
  }

  // Expirado: só o modo "bloquear uploads e manter downloads" continua
  // permitindo visualizar/baixar. Os outros dois modos (tornar privada,
  // excluir conteúdo) bloqueiam tudo imediatamente — a varredura periódica
  // só formaliza isso fisicamente depois (revoga/exclui), mas o acesso já
  // fica negado aqui, na hora, independente do timing da varredura.
  if (share.expired_action === "block_uploads") {
    return {
      allowView: !!share.allow_view,
      allowDownload: !!share.allow_download,
      allowUpload: false,
      allowDelete: false,
    };
  }

  return { allowView: false, allowDownload: false, allowUpload: false, allowDelete: false };
}

function generateToken(): string {
  // 24 bytes = 192 bits de entropia, codificado em base64url (sem
  // caracteres que precisem de escape em URL). Imprevisível por construção
  // — nunca derivado de ID sequencial, nome de arquivo ou caminho real.
  return randomBytes(24).toString("base64url");
}

function rowToShare(row: unknown): ShareRecord {
  return row as ShareRecord;
}

export function getShareByToken(token: string): ShareRecord | null {
  const row = db.prepare(`SELECT * FROM public_shares WHERE token = ?`).get(token);
  return row ? rowToShare(row) : null;
}

export function getOwnedShareOrThrow(shareId: string, ownerId: string): ShareRecord {
  const row = db.prepare(`SELECT * FROM public_shares WHERE id = ?`).get(shareId);
  const share = row ? rowToShare(row) : null;
  if (!share) throw new HttpError(404, "Compartilhamento não encontrado.");
  if (share.owner_id !== ownerId) throw new HttpError(403, "Acesso negado a este recurso.");
  return share;
}

export function listShares(ownerId: string): ShareRecord[] {
  const rows = db
    .prepare(`SELECT * FROM public_shares WHERE owner_id = ? ORDER BY created_at DESC`)
    .all(ownerId);
  return rows.map(rowToShare);
}

export interface CreateShareInput {
  type: ShareType;
  targetId: string;
  name: string;
  password?: string | null;
  expiresAt?: string | null;
  expiredAction?: ExpiredAction;
  allowView?: boolean;
  allowDownload?: boolean;
  allowUpload?: boolean;
  allowDelete?: boolean;
  maxFileSize?: number | null;
  maxTotalSize?: number | null;
  maxFiles?: number | null;
}

export async function createShare(ownerId: string, input: CreateShareInput): Promise<ShareRecord> {
  // Confirma posse do recurso ANTES de criar o link — nunca cria
  // compartilhamento apontando pra algo que não pertence ao admin.
  if (input.type === "folder") {
    getOwnedFolderOrThrow(input.targetId, ownerId);
  } else {
    getOwnedFileOrThrow(input.targetId, ownerId);
  }

  if (!input.name || input.name.trim().length === 0) {
    throw new HttpError(400, "Nome do compartilhamento é obrigatório.");
  }

  const now = new Date().toISOString();
  const share: ShareRecord = {
    id: uuid(),
    type: input.type,
    target_id: input.targetId,
    owner_id: ownerId,
    name: input.name.trim(),
    token: generateToken(),
    password_hash: input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null,
    status: "active",
    expires_at: input.expiresAt ?? null,
    expired_action: input.expiredAction ?? "make_private",
    allow_view: input.allowView === false ? 0 : 1,
    allow_download: input.allowDownload === false ? 0 : 1,
    allow_upload: input.allowUpload ? 1 : 0,
    allow_delete: input.allowDelete ? 1 : 0,
    max_file_size: input.maxFileSize ?? null,
    max_total_size: input.maxTotalSize ?? null,
    max_files: input.maxFiles ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO public_shares (
       id, type, target_id, owner_id, name, token, password_hash, status,
       expires_at, expired_action, allow_view, allow_download, allow_upload, allow_delete,
       max_file_size, max_total_size, max_files, created_at, updated_at
     ) VALUES (
       @id, @type, @target_id, @owner_id, @name, @token, @password_hash, @status,
       @expires_at, @expired_action, @allow_view, @allow_download, @allow_upload, @allow_delete,
       @max_file_size, @max_total_size, @max_files, @created_at, @updated_at
     )`
  ).run(share as unknown as Record<string, string | number | null>);

  return share;
}

export interface UpdateShareInput {
  name?: string;
  expiresAt?: string | null;
  expiredAction?: ExpiredAction;
  allowView?: boolean;
  allowDownload?: boolean;
  allowUpload?: boolean;
  allowDelete?: boolean;
  maxFileSize?: number | null;
  maxTotalSize?: number | null;
  maxFiles?: number | null;
}

export function updateShare(shareId: string, ownerId: string, input: UpdateShareInput): ShareRecord {
  const share = getOwnedShareOrThrow(shareId, ownerId);

  const updated: ShareRecord = {
    ...share,
    name: input.name !== undefined ? input.name.trim() || share.name : share.name,
    expires_at: input.expiresAt !== undefined ? input.expiresAt : share.expires_at,
    expired_action: input.expiredAction ?? share.expired_action,
    allow_view: input.allowView !== undefined ? (input.allowView ? 1 : 0) : share.allow_view,
    allow_download: input.allowDownload !== undefined ? (input.allowDownload ? 1 : 0) : share.allow_download,
    allow_upload: input.allowUpload !== undefined ? (input.allowUpload ? 1 : 0) : share.allow_upload,
    allow_delete: input.allowDelete !== undefined ? (input.allowDelete ? 1 : 0) : share.allow_delete,
    max_file_size: input.maxFileSize !== undefined ? input.maxFileSize : share.max_file_size,
    max_total_size: input.maxTotalSize !== undefined ? input.maxTotalSize : share.max_total_size,
    max_files: input.maxFiles !== undefined ? input.maxFiles : share.max_files,
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE public_shares SET
       name = @name, expires_at = @expires_at, expired_action = @expired_action,
       allow_view = @allow_view, allow_download = @allow_download,
       allow_upload = @allow_upload, allow_delete = @allow_delete,
       max_file_size = @max_file_size, max_total_size = @max_total_size, max_files = @max_files,
       updated_at = @updated_at
     WHERE id = @id`
  ).run(updated as unknown as Record<string, string | number | null>);

  return updated;
}

export async function setSharePassword(shareId: string, ownerId: string, password: string | null): Promise<ShareRecord> {
  const share = getOwnedShareOrThrow(shareId, ownerId);
  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;
  const now = new Date().toISOString();

  db.prepare(`UPDATE public_shares SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
    passwordHash,
    now,
    shareId
  );

  // Trocar/remover a senha invalida quem já tinha "desbloqueado" o link
  // com a senha antiga — evita acesso órfão por sessão pública velha.
  db.prepare(`DELETE FROM public_share_sessions WHERE share_id = ?`).run(shareId);

  return { ...share, password_hash: passwordHash, updated_at: now };
}

export function setShareStatus(shareId: string, ownerId: string, status: "active" | "revoked"): ShareRecord {
  const share = getOwnedShareOrThrow(shareId, ownerId);
  const now = new Date().toISOString();
  db.prepare(`UPDATE public_shares SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, shareId);

  if (status === "revoked") {
    // Sessões públicas ativas daquele link param de funcionar imediatamente.
    db.prepare(`DELETE FROM public_share_sessions WHERE share_id = ?`).run(shareId);
  }

  return { ...share, status, updated_at: now };
}

export function deleteShare(shareId: string, ownerId: string, deleteContent: boolean): void {
  const share = getOwnedShareOrThrow(shareId, ownerId);

  if (deleteContent) {
    try {
      if (share.type === "folder") {
        softDeleteFolder(share.target_id, ownerId);
      } else {
        softDeleteFile(share.target_id, ownerId);
      }
    } catch {
      /* conteúdo já pode ter sido removido separadamente — segue o fluxo */
    }
  }

  db.prepare(`DELETE FROM public_shares WHERE id = ?`).run(shareId);
}

/**
 * Varredura periódica (chamada de tempos em tempos pelo server.ts, igual à
 * limpeza de sessões expiradas). NÃO é o mecanismo que decide se um acesso
 * é permitido — isso é sempre recalculado na hora via getEffectivePermissions.
 * Aqui só formaliza fisicamente o que a expiração já significa: revoga o
 * status e, se configurado, exclui o conteúdo de fato.
 */
export function sweepExpiredShares(): number {
  const now = new Date().toISOString();
  const expired = db
    .prepare(`SELECT * FROM public_shares WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`)
    .all(now)
    .map(rowToShare);

  let processed = 0;
  for (const share of expired) {
    if (share.expired_action === "block_uploads") continue; // permanece ativo, só bloqueia upload (já tratado em getEffectivePermissions)

    if (share.expired_action === "delete_content") {
      try {
        if (share.type === "folder") {
          softDeleteFolder(share.target_id, share.owner_id);
        } else {
          softDeleteFile(share.target_id, share.owner_id);
        }
      } catch {
        /* conteúdo já pode não existir mais */
      }
    }

    db.prepare(`UPDATE public_shares SET status = 'revoked', updated_at = ? WHERE id = ?`).run(now, share.id);
    db.prepare(`DELETE FROM public_share_sessions WHERE share_id = ?`).run(share.id);
    processed += 1;
  }

  return processed;
}

// ---------- Sessões públicas (só para compartilhamentos com senha) ----------

export function createPublicSession(shareId: string): { id: string; expiresAt: string } {
  const now = new Date();
  const expires = new Date(now.getTime() + PUBLIC_SESSION_TTL_HOURS * 60 * 60 * 1000);
  const id = uuid();

  db.prepare(
    `INSERT INTO public_share_sessions (id, share_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(id, shareId, now.toISOString(), expires.toISOString());

  return { id, expiresAt: expires.toISOString() };
}

export function isPublicSessionValid(sessionId: string, shareId: string): boolean {
  const row = db
    .prepare(`SELECT expires_at FROM public_share_sessions WHERE id = ? AND share_id = ?`)
    .get(sessionId, shareId) as unknown as { expires_at: string } | undefined;

  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM public_share_sessions WHERE id = ?`).run(sessionId);
    return false;
  }
  return true;
}

export function deleteExpiredPublicSessions(): number {
  const result = db.prepare(`DELETE FROM public_share_sessions WHERE expires_at < ?`).run(
    new Date().toISOString()
  );
  return Number(result.changes);
}

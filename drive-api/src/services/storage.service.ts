import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { db } from "../db";

/**
 * Este é o ÚNICO módulo do sistema autorizado a montar caminhos físicos de
 * arquivo. Ele nunca aceita um caminho vindo de fora — apenas IDs (UUIDs)
 * que já foram validados/gerados pelo backend (spec §9, §11, §31).
 *
 * Regra de ouro: se um dia você precisar concatenar `req.body` ou
 * `req.params` diretamente em um caminho de arquivo, pare — isso não deve
 * acontecer em lugar nenhum do código.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Valor inválido para ${label}: esperado UUID`);
  }
}

export function userDir(userId: string): string {
  assertValidUuid(userId, "userId");
  const dir = path.join(env.storagePath, "users", userId);
  assertContained(dir);
  return dir;
}

export function filePath(userId: string, fileId: string): string {
  assertValidUuid(userId, "userId");
  assertValidUuid(fileId, "fileId");
  const full = path.join(userDir(userId), fileId);
  assertContained(full);
  return full;
}

/** Garante que o caminho final nunca escapa de storage/, como cinto de segurança extra. */
function assertContained(fullPath: string): void {
  const root = path.resolve(env.storagePath);
  const resolved = path.resolve(fullPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Caminho fora do diretório de storage — operação bloqueada.");
  }
}

export async function ensureUserDir(userId: string): Promise<void> {
  await fsp.mkdir(userDir(userId), { recursive: true });
}

export async function deletePhysicalFile(userId: string, fileId: string): Promise<void> {
  const target = filePath(userId, fileId);
  await fsp.rm(target, { force: true });
}

export function physicalFileExists(userId: string, fileId: string): boolean {
  return fs.existsSync(filePath(userId, fileId));
}

export function physicalFileSize(userId: string, fileId: string): number {
  return fs.statSync(filePath(userId, fileId)).size;
}

/** Soma o uso de storage do usuário a partir dos metadados (não varre o disco). */
export function getUsedBytes(ownerId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(size), 0) as total FROM files WHERE owner_id = ? AND deleted_at IS NULL`
    )
    .get(ownerId) as unknown as { total: number };
  return row.total;
}

export function getQuotaBytes(ownerId: string): number {
  const row = db.prepare(`SELECT storage_quota_bytes FROM users WHERE id = ?`).get(ownerId) as unknown as
    | { storage_quota_bytes: number | null }
    | undefined;
  // Cota individual (definida pelo admin no painel de usuários) tem
  // prioridade; sem ela, cai no padrão global do .env.
  return row?.storage_quota_bytes ?? env.storageQuotaBytes;
}

export function hasSpaceFor(ownerId: string, incomingBytes: number): boolean {
  return getUsedBytes(ownerId) + incomingBytes <= getQuotaBytes(ownerId);
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fromFile as detectFileType } from "file-type";
import { db } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import {
  deletePhysicalFile,
  filePath,
  getQuotaBytes,
  getUsedBytes,
  hasSpaceFor,
} from "../../services/storage.service";
import { getOwnedFolderOrThrow } from "../folders/folders.service";
import { BLOCKED_EXTENSIONS } from "../../config/constants";

export interface FileRecord {
  id: string;
  owner_id: string;
  folder_id: string | null;
  original_name: string;
  storage_name: string;
  mime_type: string;
  size: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Presentes só quando a consulta faz JOIN com watch_progress (ver listFiles).
  watch_position_seconds?: number | null;
  watch_duration_seconds?: number | null;
  watch_completed_at?: string | null;
  watch_updated_at?: string | null;
}

function validateName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HttpError(400, "Nome do arquivo é obrigatório.");
  }
  const trimmed = name.trim();
  if (trimmed.length > 255) {
    throw new HttpError(400, "Nome do arquivo excede o tamanho máximo.");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new HttpError(400, "Nome do arquivo não pode conter separadores de caminho.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new HttpError(400, "Nome de arquivo inválido.");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) {
    throw new HttpError(400, "Nome de arquivo contém caracteres inválidos.");
  }
}

export function getOwnedFileOrThrow(fileId: string, ownerId: string): FileRecord {
  const file = db
    .prepare(`SELECT * FROM files WHERE id = ? AND deleted_at IS NULL`)
    .get(fileId) as unknown as FileRecord | undefined;

  if (!file) throw new HttpError(404, "Arquivo não encontrado.");
  if (file.owner_id !== ownerId) throw new HttpError(403, "Acesso negado a este recurso.");
  return file;
}

/**
 * Confirma o upload já gravado em disco pelo multer: valida o conteúdo real
 * (magic bytes, não a extensão declarada — spec §10), checa quota, e só
 * então cria o registro de metadados. Se algo falhar, remove o arquivo
 * físico órfão.
 */
export async function finalizeUpload(params: {
  ownerId: string;
  folderId: string | null;
  originalName: string;
  storageName: string; // == file id, gerado pelo multer
  declaredMimeType: string;
  sizeBytes: number;
}): Promise<FileRecord> {
  const { ownerId, folderId, originalName, storageName, declaredMimeType, sizeBytes } = params;
  const physicalPath = filePath(ownerId, storageName);

  const cleanupAndThrow = async (status: number, message: string): Promise<never> => {
    await fsp.rm(physicalPath, { force: true });
    throw new HttpError(status, message);
  };

  try {
    validateName(originalName);

    if (folderId !== null) {
      getOwnedFolderOrThrow(folderId, ownerId);
    }

    if (!hasSpaceFor(ownerId, sizeBytes)) {
      return await cleanupAndThrow(413, "Quota de armazenamento excedida.");
    }

    // Validação de conteúdo por magic bytes — a extensão/mimetype declarados
    // pelo cliente NUNCA são confiáveis sozinhos (spec §10).
    const detected = await detectFileType(physicalPath);
    const effectiveMime = detected?.mime ?? declaredMimeType ?? "application/octet-stream";

    if (detected?.ext && BLOCKED_EXTENSIONS.has(`.${detected.ext}`)) {
      return await cleanupAndThrow(400, `Conteúdo de arquivo não permitido (detectado: .${detected.ext}).`);
    }

    const now = new Date().toISOString();
    const record: FileRecord = {
      id: storageName,
      owner_id: ownerId,
      folder_id: folderId,
      original_name: originalName.trim(),
      storage_name: storageName,
      mime_type: effectiveMime,
      size: sizeBytes,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };

    db.prepare(
      `INSERT INTO files (id, owner_id, folder_id, original_name, storage_name, mime_type, size, deleted_at, created_at, updated_at)
       VALUES (@id, @owner_id, @folder_id, @original_name, @storage_name, @mime_type, @size, @deleted_at, @created_at, @updated_at)`
    ).run(record as unknown as Record<string, string | number | null>);

    return record;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return cleanupAndThrow(500, "Falha ao processar upload.");
  }
}

export function listFiles(ownerId: string, folderId: string | null, query?: string): FileRecord[] {
  if (folderId !== null) {
    getOwnedFolderOrThrow(folderId, ownerId);
  }

  if (query && query.trim().length > 0) {
    // Pesquisa sobre metadados no banco, nunca varrendo o filesystem (spec §18).
    return db
      .prepare(
        `SELECT files.*, wp.position_seconds AS watch_position_seconds, wp.duration_seconds AS watch_duration_seconds,
                wp.completed_at AS watch_completed_at, wp.updated_at AS watch_updated_at
         FROM files
         LEFT JOIN watch_progress wp ON wp.file_id = files.id AND wp.owner_id = files.owner_id
         WHERE files.owner_id = ? AND files.deleted_at IS NULL AND files.original_name LIKE ?
         ORDER BY files.original_name`
      )
      .all(ownerId, `%${query.trim()}%`) as unknown as FileRecord[];
  }

  if (folderId === null) {
    return db
      .prepare(
        `SELECT files.*, wp.position_seconds AS watch_position_seconds, wp.duration_seconds AS watch_duration_seconds,
                wp.completed_at AS watch_completed_at, wp.updated_at AS watch_updated_at
         FROM files
         LEFT JOIN watch_progress wp ON wp.file_id = files.id AND wp.owner_id = files.owner_id
         WHERE files.owner_id = ? AND files.folder_id IS NULL AND files.deleted_at IS NULL
         ORDER BY files.original_name`
      )
      .all(ownerId) as unknown as FileRecord[];
  }

  return db
    .prepare(
      `SELECT files.*, wp.position_seconds AS watch_position_seconds, wp.duration_seconds AS watch_duration_seconds,
                wp.completed_at AS watch_completed_at, wp.updated_at AS watch_updated_at
       FROM files
       LEFT JOIN watch_progress wp ON wp.file_id = files.id AND wp.owner_id = files.owner_id
       WHERE files.owner_id = ? AND files.folder_id = ? AND files.deleted_at IS NULL
       ORDER BY files.original_name`
    )
    .all(ownerId, folderId) as unknown as FileRecord[];
}

export function renameOrMoveFile(
  fileId: string,
  ownerId: string,
  updates: { name?: string; folder_id?: string | null }
): FileRecord {
  const file = getOwnedFileOrThrow(fileId, ownerId);

  const name = updates.name !== undefined ? updates.name : file.original_name;
  const folderId = updates.folder_id !== undefined ? updates.folder_id : file.folder_id;

  if (updates.name !== undefined) validateName(name);
  if (updates.folder_id !== undefined && folderId !== null) {
    getOwnedFolderOrThrow(folderId, ownerId);
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE files SET original_name = ?, folder_id = ?, updated_at = ? WHERE id = ?`).run(
    name.trim(),
    folderId,
    now,
    fileId
  );

  return { ...file, original_name: name.trim(), folder_id: folderId, updated_at: now };
}

export async function softDeleteFile(fileId: string, ownerId: string): Promise<void> {
  getOwnedFileOrThrow(fileId, ownerId);
  const now = new Date().toISOString();
  db.prepare(`UPDATE files SET deleted_at = ? WHERE id = ? AND owner_id = ?`).run(now, fileId, ownerId);
  // Soft delete lógico primeiro; a remoção física pode ser feita por um job
  // de limpeza futuro (lixeira - spec §17). Mantemos o arquivo físico por ora.
}

export function storageUsage(ownerId: string) {
  const used = getUsedBytes(ownerId);
  const quota = getQuotaBytes(ownerId);
  const fileCount = (
    db.prepare(`SELECT COUNT(*) as c FROM files WHERE owner_id = ? AND deleted_at IS NULL`).get(ownerId) as unknown as {
      c: number;
    }
  ).c;
  const folderCount = (
    db.prepare(`SELECT COUNT(*) as c FROM folders WHERE owner_id = ? AND deleted_at IS NULL`).get(ownerId) as unknown as {
      c: number;
    }
  ).c;

  return { usedBytes: used, quotaBytes: quota, fileCount, folderCount };
}

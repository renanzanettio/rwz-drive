import { db } from "../../db";
import { HttpError } from "../../middlewares/errorHandler";
import type { ShareRecord } from "./shares.service";

/**
 * Confirma que `folderId` é a própria `ancestorId` ou está DENTRO dela na
 * árvore de pastas do mesmo dono. Esse é o guard-rail central que impede um
 * visitante de trocar o `folder_id` na requisição e escapar da pasta
 * compartilhada para o resto do Drive privado.
 */
export function isDescendantOrSelf(folderId: string, ancestorId: string, ownerId: string): boolean {
  if (folderId === ancestorId) return true;

  let current: string | null = folderId;
  const guard = new Set<string>();

  while (current !== null) {
    if (guard.has(current)) return false; // proteção contra ciclo (não deveria existir, mas não confia)
    guard.add(current);

    const row = db
      .prepare(`SELECT parent_id FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`)
      .get(current, ownerId) as unknown as { parent_id: string | null } | undefined;

    if (!row) return false;
    if (row.parent_id === ancestorId) return true;
    current = row.parent_id;
  }

  return false;
}

/** Resolve e valida um folder_id recebido de um visitante público contra a árvore do compartilhamento. */
export function resolvePublicFolderId(share: ShareRecord, requestedFolderId: string | null | undefined): string {
  if (share.type !== "folder") {
    throw new HttpError(400, "Este compartilhamento é de um arquivo, não de uma pasta.");
  }
  const folderId = requestedFolderId ?? share.target_id;
  if (!isDescendantOrSelf(folderId, share.target_id, share.owner_id)) {
    throw new HttpError(403, "Pasta fora do escopo deste compartilhamento.");
  }
  return folderId;
}

/**
 * Uso acumulado (bytes e contagem) de toda a subárvore de uma pasta, via CTE recursiva.
 * `findOrCreateSubfolder`/`sanitizeSegmentName` (usadas no upload de pasta
 * inteira, público e privado) vivem em folders.service.ts — reexportadas
 * aqui só por conveniência de import nas rotas de compartilhamento.
 */
export { findOrCreateSubfolder, sanitizeSegmentName } from "../folders/folders.service";

export function getFolderSubtreeUsage(folderId: string, ownerId: string): { totalBytes: number; fileCount: number } {
  const row = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id WHERE f.deleted_at IS NULL
       )
       SELECT COALESCE(SUM(files.size), 0) AS total_bytes, COUNT(files.id) AS file_count
       FROM files
       WHERE files.owner_id = ? AND files.deleted_at IS NULL
         AND (files.folder_id IN (SELECT id FROM subtree) OR files.folder_id = ?)`
    )
    .get(folderId, ownerId, ownerId, folderId) as unknown as { total_bytes: number; file_count: number };

  return { totalBytes: row.total_bytes, fileCount: row.file_count };
}

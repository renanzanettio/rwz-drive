import { db, runInTransaction } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";

export interface FolderRecord {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function validateName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HttpError(400, "Nome da pasta é obrigatório.");
  }
  const trimmed = name.trim();
  if (trimmed.length > 255) {
    throw new HttpError(400, "Nome da pasta excede o tamanho máximo.");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new HttpError(400, "Nome da pasta não pode conter separadores de caminho.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new HttpError(400, "Nome de pasta inválido.");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) {
    throw new HttpError(400, "Nome de pasta contém caracteres inválidos.");
  }
}

/** Autorização: garante que a pasta existe, não foi excluída e pertence ao usuário. */
export function getOwnedFolderOrThrow(folderId: string, ownerId: string): FolderRecord {
  const folder = db
    .prepare(`SELECT * FROM folders WHERE id = ? AND deleted_at IS NULL`)
    .get(folderId) as unknown as FolderRecord | undefined;

  if (!folder) throw new HttpError(404, "Pasta não encontrada.");
  if (folder.owner_id !== ownerId) throw new HttpError(403, "Acesso negado a este recurso.");
  return folder;
}

function assertParentOwnership(parentId: string | null, ownerId: string): void {
  if (parentId === null) return;
  getOwnedFolderOrThrow(parentId, ownerId);
}

/** Impede mover uma pasta para dentro de si mesma ou de um de seus descendentes. */
function assertNotCyclic(folderId: string, newParentId: string | null, ownerId: string): void {
  if (newParentId === null) return;
  let current: string | null = newParentId;
  const guard = new Set<string>();
  while (current !== null) {
    if (current === folderId) {
      throw new HttpError(400, "Não é possível mover uma pasta para dentro dela mesma.");
    }
    if (guard.has(current)) break; // proteção extra contra ciclo pré-existente
    guard.add(current);
    const parent = getOwnedFolderOrThrow(current, ownerId);
    current = parent.parent_id;
  }
}

export function listFolders(ownerId: string, parentId: string | null): FolderRecord[] {
  if (parentId !== null) {
    getOwnedFolderOrThrow(parentId, ownerId);
    return db
      .prepare(`SELECT * FROM folders WHERE owner_id = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY name`)
      .all(ownerId, parentId) as unknown as FolderRecord[];
  }
  return db
    .prepare(`SELECT * FROM folders WHERE owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY name`)
    .all(ownerId) as unknown as FolderRecord[];
}

export function createFolder(ownerId: string, name: string, parentId: string | null): FolderRecord {
  validateName(name);
  assertParentOwnership(parentId, ownerId);

  const now = new Date().toISOString();
  const folder: FolderRecord = {
    id: uuid(),
    owner_id: ownerId,
    parent_id: parentId,
    name: name.trim(),
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO folders (id, owner_id, parent_id, name, deleted_at, created_at, updated_at)
     VALUES (@id, @owner_id, @parent_id, @name, @deleted_at, @created_at, @updated_at)`
  ).run(folder as unknown as Record<string, string | null>);

  return folder;
}

export function renameOrMoveFolder(
  folderId: string,
  ownerId: string,
  updates: { name?: string; parent_id?: string | null }
): FolderRecord {
  const folder = getOwnedFolderOrThrow(folderId, ownerId);

  const name = updates.name !== undefined ? updates.name : folder.name;
  const parentId = updates.parent_id !== undefined ? updates.parent_id : folder.parent_id;

  if (updates.name !== undefined) validateName(name);
  if (updates.parent_id !== undefined) {
    assertParentOwnership(parentId, ownerId);
    assertNotCyclic(folderId, parentId, ownerId);
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?`).run(
    name.trim(),
    parentId,
    now,
    folderId
  );

  return { ...folder, name: name.trim(), parent_id: parentId, updated_at: now };
}

/** Soft delete recursivo: marca a pasta e todas as subpastas/arquivos como excluídos. */
export function softDeleteFolder(folderId: string, ownerId: string): void {
  getOwnedFolderOrThrow(folderId, ownerId);
  const now = new Date().toISOString();

  // Função "crua" (sem transação própria) chamada recursivamente — o
  // node:sqlite não suporta BEGIN aninhado como o helper .transaction() do
  // better-sqlite3 suportava, então a transação envolve só a chamada
  // externa, em runInTransaction() logo abaixo.
  function deleteRecursive(id: string): void {
    db.prepare(`UPDATE folders SET deleted_at = ? WHERE id = ? AND owner_id = ?`).run(now, id, ownerId);
    db.prepare(`UPDATE files SET deleted_at = ? WHERE folder_id = ? AND owner_id = ?`).run(now, id, ownerId);

    const children = db
      .prepare(`SELECT id FROM folders WHERE parent_id = ? AND owner_id = ? AND deleted_at IS NULL`)
      .all(id, ownerId) as unknown as { id: string }[];

    for (const child of children) {
      deleteRecursive(child.id);
    }
  }

  runInTransaction(() => deleteRecursive(folderId));
}

/** Retorna o caminho (breadcrumb) da raiz até a pasta, para navegação na UI. */
export function getBreadcrumb(folderId: string, ownerId: string): FolderRecord[] {
  const trail: FolderRecord[] = [];
  let current: string | null = folderId;
  while (current !== null) {
    const folder = getOwnedFolderOrThrow(current, ownerId);
    trail.unshift(folder);
    current = folder.parent_id;
  }
  return trail;
}

/**
 * Sanitiza um segmento de caminho vindo do navegador (webkitRelativePath,
 * usado no upload de pasta inteira). Nunca é usado pra montar caminho de
 * filesystem (o arquivo físico sempre tem nome UUID, ver storage.service),
 * mas ainda assim rejeita tudo que não seja um nome de pasta "normal" —
 * defesa em profundidade e higiene de dados.
 */
export function sanitizeSegmentName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f]/g, "").trim();
  if (name.length === 0 || name === "." || name === "..") {
    throw new HttpError(400, "Nome de pasta inválido no caminho enviado.");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new HttpError(400, "Nome de pasta não pode conter separadores de caminho.");
  }
  if (name.length > 255) {
    throw new HttpError(400, "Nome de pasta excede o tamanho máximo.");
  }
  return name;
}

/**
 * Encontra (ou cria) uma subpasta pelo nome dentro de um pai — usado no
 * upload de pasta inteira (privado e público), pra reconstruir a estrutura
 * enviada pelo navegador sem nunca tocar em caminho de filesystem.
 */
export function findOrCreateSubfolder(ownerId: string, parentId: string | null, rawName: string): string {
  const name = sanitizeSegmentName(rawName);

  const existing = db
    .prepare(
      `SELECT id FROM folders WHERE owner_id = ? AND ${parentId === null ? "parent_id IS NULL" : "parent_id = ?"} AND name = ? AND deleted_at IS NULL`
    )
    .get(...(parentId === null ? [ownerId, name] : [ownerId, parentId, name])) as unknown as { id: string } | undefined;

  if (existing) return existing.id;

  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO folders (id, owner_id, parent_id, name, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, ownerId, parentId, name, now, now);

  return id;
}

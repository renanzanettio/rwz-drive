import { Router } from "express";
import { db, runInTransaction } from "../../db";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import { getOwnedFileOrThrow, renameOrMoveFile } from "../files/files.service";
import { getOwnedFolderOrThrow, renameOrMoveFolder } from "../folders/folders.service";
import { HttpError } from "../../middlewares/errorHandler";

export const driveRouter = Router();
driveRouter.use(requireAuth, resolveEffectiveOwner);
driveRouter.post("/batch", (req, res, next) => {
  try {
    const owner = req.effectiveOwnerId!;
    const { action, file_ids, folder_ids, target_folder_id } = req.body ?? {};
    if (!["move", "trash"].includes(action) || !Array.isArray(file_ids) || !Array.isArray(folder_ids)
      || file_ids.length + folder_ids.length < 1 || file_ids.length + folder_ids.length > 1000
      || [...file_ids, ...folder_ids].some((id) => typeof id !== "string")) {
      throw new HttpError(400, "Selecione de 1 a 1.000 itens.");
    }
    if (action === "move" && target_folder_id !== null && typeof target_folder_id !== "string") {
      throw new HttpError(400, "Destino inválido.");
    }
    runInTransaction(() => {
      const selectedFolders = [...new Set<string>(folder_ids)].map((id) => getOwnedFolderOrThrow(id, owner));
      const selectedFiles = [...new Set<string>(file_ids)].map((id) => getOwnedFileOrThrow(id, owner));
      if (action === "move" && target_folder_id) getOwnedFolderOrThrow(target_folder_id, owner);
      const selected = new Set(selectedFolders.map((f) => f.id));
      const tree = db.prepare("SELECT id,parent_id FROM folders WHERE owner_id=? AND deleted_at IS NULL")
        .all(owner) as unknown as { id: string; parent_id: string | null }[];
      const parents = new Map(tree.map((f) => [f.id, f.parent_id]));
      function insideSelection(parent: string | null) {
        const visited = new Set<string>();
        while (parent && !visited.has(parent)) {
          if (selected.has(parent)) return true;
          visited.add(parent);
          parent = parents.get(parent) ?? null;
        }
        return false;
      }
      const topFolders = selectedFolders.filter((f) => !insideSelection(f.parent_id));
      const topFiles = selectedFiles.filter((f) => !insideSelection(f.folder_id));
      if (action === "move") {
        for (const folder of topFolders) renameOrMoveFolder(folder.id, owner, { parent_id: target_folder_id });
        for (const file of topFiles) renameOrMoveFile(file.id, owner, { folder_id: target_folder_id });
      } else {
        const now = new Date().toISOString();
        const subtree = db.prepare(`WITH RECURSIVE branch(id) AS (
          SELECT id FROM folders WHERE id=? AND owner_id=? AND deleted_at IS NULL
          UNION SELECT f.id FROM folders f JOIN branch b ON f.parent_id=b.id WHERE f.owner_id=? AND f.deleted_at IS NULL
        ) SELECT id FROM branch`);
        for (const folder of topFolders) {
          const ids = subtree.all(folder.id, owner, owner) as unknown as { id: string }[];
          for (const row of ids) {
            db.prepare("UPDATE files SET deleted_at=? WHERE folder_id=? AND owner_id=? AND deleted_at IS NULL").run(now, row.id, owner);
            db.prepare("UPDATE folders SET deleted_at=? WHERE id=? AND owner_id=?").run(now, row.id, owner);
          }
        }
        for (const file of topFiles) db.prepare("UPDATE files SET deleted_at=? WHERE id=? AND owner_id=?").run(now, file.id, owner);
      }
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

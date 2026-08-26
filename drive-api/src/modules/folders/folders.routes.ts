import { Router } from "express";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import {
  createFolder,
  getBreadcrumb,
  getOwnedFolderOrThrow,
  listFolders,
  renameOrMoveFolder,
  softDeleteFolder,
} from "./folders.service";
import { streamFolderAsZip } from "../../services/zip.service";
import { logEvent } from "../../utils/logger";
import { HttpError } from "../../middlewares/errorHandler";

export const foldersRouter = Router();
foldersRouter.use(requireAuth);
foldersRouter.use(resolveEffectiveOwner);

foldersRouter.get("/", (req, res, next) => {
  try {
    const parentId = typeof req.query.parent_id === "string" ? req.query.parent_id : null;
    const folders = listFolders(req.effectiveOwnerId!, parentId);
    res.json({ folders });
  } catch (err) {
    next(err);
  }
});

foldersRouter.get("/:id/download-zip", (req, res, next) => {
  try {
    const folder = getOwnedFolderOrThrow(req.params.id, req.effectiveOwnerId!);
    logEvent("FILE_DOWNLOAD", { userId: req.effectiveOwnerId!, folderId: folder.id, zip: true });
    streamFolderAsZip(req.effectiveOwnerId!, folder.id, folder.name, res);
  } catch (err) {
    next(err);
  }
});

foldersRouter.get("/:id/breadcrumb", (req, res, next) => {
  try {
    const trail = getBreadcrumb(req.params.id, req.effectiveOwnerId!);
    res.json({ breadcrumb: trail });
  } catch (err) {
    next(err);
  }
});

foldersRouter.post("/", (req, res, next) => {
  try {
    const { name, parent_id } = req.body ?? {};
    if (typeof name !== "string") throw new HttpError(400, "name é obrigatório.");
    const folder = createFolder(req.effectiveOwnerId!, name, typeof parent_id === "string" ? parent_id : null);
    logEvent("FOLDER_CREATE", { userId: req.effectiveOwnerId!, folderId: folder.id });
    res.status(201).json(folder);
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch("/:id", (req, res, next) => {
  try {
    const { name, parent_id } = req.body ?? {};
    const updates: { name?: string; parent_id?: string | null } = {};
    if (name !== undefined) updates.name = name;
    if (parent_id !== undefined) updates.parent_id = parent_id;

    const folder = renameOrMoveFolder(req.params.id, req.effectiveOwnerId!, updates);
    logEvent(name !== undefined ? "FOLDER_RENAME" : "FOLDER_MOVE", {
      userId: req.effectiveOwnerId!,
      folderId: folder.id,
    });
    res.json(folder);
  } catch (err) {
    next(err);
  }
});

foldersRouter.delete("/:id", (req, res, next) => {
  try {
    softDeleteFolder(req.params.id, req.effectiveOwnerId!);
    logEvent("FOLDER_DELETE", { userId: req.effectiveOwnerId!, folderId: req.params.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

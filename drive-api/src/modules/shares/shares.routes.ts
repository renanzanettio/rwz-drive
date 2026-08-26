import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { HttpError } from "../../middlewares/errorHandler";
import { logEvent } from "../../utils/logger";
import {
  createShare,
  listShares,
  getOwnedShareOrThrow,
  updateShare,
  setSharePassword,
  setShareStatus,
  deleteShare,
  getDisplayStatus,
  getEffectivePermissions,
  type ShareType,
  type ExpiredAction,
} from "./shares.service";

export const sharesRouter = Router();
sharesRouter.use(requireAuth);

function serialize(share: ReturnType<typeof getOwnedShareOrThrow>) {
  return {
    id: share.id,
    type: share.type,
    target_id: share.target_id,
    name: share.name,
    token: share.token,
    publicUrl: share.type === "folder" ? `/p/${share.token}` : `/f/${share.token}`,
    hasPassword: !!share.password_hash,
    displayStatus: getDisplayStatus(share),
    expires_at: share.expires_at,
    expired_action: share.expired_action,
    permissions: {
      allow_view: !!share.allow_view,
      allow_download: !!share.allow_download,
      allow_upload: !!share.allow_upload,
      allow_delete: !!share.allow_delete,
    },
    effectivePermissions: getEffectivePermissions(share),
    max_file_size: share.max_file_size,
    max_total_size: share.max_total_size,
    max_files: share.max_files,
    created_at: share.created_at,
    updated_at: share.updated_at,
  };
}

sharesRouter.get("/", (req, res, next) => {
  try {
    const shares = listShares(req.user!.id).map(serialize);
    res.json({ shares });
  } catch (err) {
    next(err);
  }
});

sharesRouter.get("/:id", (req, res, next) => {
  try {
    const share = getOwnedShareOrThrow(req.params.id, req.user!.id);
    res.json(serialize(share));
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const type: ShareType = body.type;
    if (type !== "folder" && type !== "file") {
      throw new HttpError(400, "type deve ser 'folder' ou 'file'.");
    }
    if (typeof body.target_id !== "string") {
      throw new HttpError(400, "target_id é obrigatório.");
    }
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new HttpError(400, "name é obrigatório.");
    }

    // Upload/exclusão só fazem sentido pra compartilhamento de pasta —
    // forçado aqui no servidor, independente do que o cliente mandar.
    const allowUpload = type === "folder" ? !!body.allow_upload : false;
    const allowDelete = type === "folder" ? !!body.allow_delete : false;

    const share = await createShare(req.user!.id, {
      type,
      targetId: body.target_id,
      name: body.name,
      password: typeof body.password === "string" && body.password.length > 0 ? body.password : null,
      expiresAt: typeof body.expires_at === "string" ? body.expires_at : null,
      expiredAction: (body.expired_action as ExpiredAction) ?? "make_private",
      allowView: body.allow_view !== false,
      allowDownload: body.allow_download !== false,
      allowUpload,
      allowDelete,
      maxFileSize: typeof body.max_file_size === "number" ? body.max_file_size : null,
      maxTotalSize: typeof body.max_total_size === "number" ? body.max_total_size : null,
      maxFiles: typeof body.max_files === "number" ? body.max_files : null,
    });

    logEvent("SHARE_CREATE", { userId: req.user!.id, shareId: share.id });
    res.status(201).json(serialize(share));
  } catch (err) {
    next(err);
  }
});

sharesRouter.patch("/:id", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const existing = getOwnedShareOrThrow(req.params.id, req.user!.id);

    const share = updateShare(req.params.id, req.user!.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      expiresAt: body.expires_at !== undefined ? body.expires_at : undefined,
      expiredAction: body.expired_action !== undefined ? (body.expired_action as ExpiredAction) : undefined,
      allowView: body.allow_view !== undefined ? !!body.allow_view : undefined,
      allowDownload: body.allow_download !== undefined ? !!body.allow_download : undefined,
      allowUpload: body.allow_upload !== undefined ? (existing.type === "folder" ? !!body.allow_upload : false) : undefined,
      allowDelete: body.allow_delete !== undefined ? (existing.type === "folder" ? !!body.allow_delete : false) : undefined,
      maxFileSize: body.max_file_size !== undefined ? body.max_file_size : undefined,
      maxTotalSize: body.max_total_size !== undefined ? body.max_total_size : undefined,
      maxFiles: body.max_files !== undefined ? body.max_files : undefined,
    });

    res.json(serialize(share));
  } catch (err) {
    next(err);
  }
});

sharesRouter.put("/:id/password", async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    if (password !== null && typeof password !== "string") {
      throw new HttpError(400, "password deve ser string ou null.");
    }
    const share = await setSharePassword(req.params.id, req.user!.id, password);
    res.json(serialize(share));
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/:id/revoke", (req, res, next) => {
  try {
    const share = setShareStatus(req.params.id, req.user!.id, "revoked");
    logEvent("SHARE_REVOKE", { userId: req.user!.id, shareId: share.id });
    res.json(serialize(share));
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/:id/reactivate", (req, res, next) => {
  try {
    const share = setShareStatus(req.params.id, req.user!.id, "active");
    res.json(serialize(share));
  } catch (err) {
    next(err);
  }
});

sharesRouter.delete("/:id", (req, res, next) => {
  try {
    const deleteContent = req.query.deleteContent === "true";
    deleteShare(req.params.id, req.user!.id, deleteContent);
    logEvent("SHARE_DELETE", { userId: req.user!.id, shareId: req.params.id, deleteContent });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

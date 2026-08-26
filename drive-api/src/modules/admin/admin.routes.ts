import { Router } from "express";
import { requireAuth, requireAdmin } from "../../middlewares/auth";
import { HttpError } from "../../middlewares/errorHandler";
import { createInvite, listInvites, revokeInvite, getOwnedInviteOrThrow } from "./invites.service";
import { listUsers, updateUserQuota, deleteUser } from "./users.service";
import { env } from "../../config/env";
import { logEvent } from "../../utils/logger";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

function serializeInvite(invite: ReturnType<typeof getOwnedInviteOrThrow>) {
  return {
    id: invite.id,
    token: invite.token,
    inviteUrl: `/register?invite=${invite.token}`,
    storage_quota_bytes: invite.storage_quota_bytes,
    expires_at: invite.expires_at,
    used_by: invite.used_by,
    used_at: invite.used_at,
    created_at: invite.created_at,
  };
}

adminRouter.get("/invites", (req, res, next) => {
  try {
    const invites = listInvites(req.user!.id).map(serializeInvite);
    res.json({ invites });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/invites", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const storageQuotaBytes =
      typeof body.storage_quota_mb === "number" && body.storage_quota_mb > 0
        ? Math.round(body.storage_quota_mb * 1024 * 1024)
        : null;
    const expiresAt = typeof body.expires_at === "string" ? body.expires_at : null;

    const invite = createInvite(req.user!.id, { storageQuotaBytes, expiresAt });
    logEvent("INVITE_CREATE", { userId: req.user!.id, inviteId: invite.id });
    res.status(201).json(serializeInvite(invite));
  } catch (err) {
    next(err);
  }
});

adminRouter.delete("/invites/:id", (req, res, next) => {
  try {
    revokeInvite(req.params.id, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/users", (req, res, next) => {
  try {
    res.json({ users: listUsers(), globalDefaultQuotaBytes: env.storageQuotaBytes });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/users/:id", (req, res, next) => {
  try {
    const body = req.body ?? {};

    if (req.params.id === req.user!.id) {
      throw new HttpError(400, "Não é possível alterar a própria cota por aqui.");
    }

    let storageQuotaBytes: number | null | undefined;
    if (body.storage_quota_mb === null) {
      storageQuotaBytes = null; // volta a usar o padrão global
    } else if (typeof body.storage_quota_mb === "number" && body.storage_quota_mb > 0) {
      storageQuotaBytes = Math.round(body.storage_quota_mb * 1024 * 1024);
    } else {
      throw new HttpError(400, "storage_quota_mb inválido (número positivo ou null).");
    }

    updateUserQuota(req.params.id, storageQuotaBytes);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.delete("/users/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.user!.id) {
      throw new HttpError(400, "Não é possível excluir a própria conta por aqui.");
    }

    await deleteUser(req.params.id);
    logEvent("USER_DELETE", { userId: req.user!.id, deletedUserId: req.params.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

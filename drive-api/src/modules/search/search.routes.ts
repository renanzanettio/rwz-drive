import { Router } from "express";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import { db } from "../../db";
import { HttpError } from "../../middlewares/errorHandler";

export const searchRouter = Router();
searchRouter.use(requireAuth);
searchRouter.use(resolveEffectiveOwner);

// Pesquisa por nome sobre os metadados do banco — nunca percorre o
// filesystem diretamente (spec §18).
searchRouter.get("/", (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length === 0) {
      throw new HttpError(400, "Parâmetro de busca 'q' é obrigatório.");
    }

    const like = `%${q}%`;
    const files = db
      .prepare(
        `SELECT * FROM files WHERE owner_id = ? AND deleted_at IS NULL AND original_name LIKE ? ORDER BY original_name LIMIT 50`
      )
      .all(req.effectiveOwnerId!, like);

    const folders = db
      .prepare(
        `SELECT * FROM folders WHERE owner_id = ? AND deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 50`
      )
      .all(req.effectiveOwnerId!, like);

    res.json({ files, folders });
  } catch (err) {
    next(err);
  }
});

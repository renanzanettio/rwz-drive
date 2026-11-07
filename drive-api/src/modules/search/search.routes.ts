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
        `SELECT f.*,wp.position_seconds AS watch_position_seconds,wp.duration_seconds AS watch_duration_seconds,
          wp.completed_at AS watch_completed_at,wp.updated_at AS watch_updated_at
         FROM files f LEFT JOIN watch_progress wp ON wp.file_id=f.id AND wp.owner_id=f.owner_id
         WHERE f.owner_id = ? AND f.deleted_at IS NULL AND f.original_name LIKE ? ORDER BY f.original_name LIMIT 50`
      )
      .all(req.effectiveOwnerId!, like);

    const folders = db
      .prepare(
        `WITH RECURSIVE matches AS (
          SELECT * FROM folders WHERE owner_id=? AND deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 50
        ), branch(root_id,id) AS (
          SELECT id,id FROM matches UNION
          SELECT b.root_id,f.id FROM folders f JOIN branch b ON f.parent_id=b.id WHERE f.owner_id=? AND f.deleted_at IS NULL
        ), sizes AS (
          SELECT b.root_id,COALESCE(SUM(f.size),0) AS size_bytes,COUNT(f.id) AS file_count
          FROM branch b LEFT JOIN files f ON f.folder_id=b.id AND f.owner_id=? AND f.deleted_at IS NULL GROUP BY b.root_id
        ) SELECT m.*,COALESCE(s.size_bytes,0) AS size_bytes,COALESCE(s.file_count,0) AS file_count
        FROM matches m LEFT JOIN sizes s ON s.root_id=m.id ORDER BY m.name`
      )
      .all(req.effectiveOwnerId!, like, req.effectiveOwnerId!, req.effectiveOwnerId!);

    res.json({ files, folders });
  } catch (err) {
    next(err);
  }
});

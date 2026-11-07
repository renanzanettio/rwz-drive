import fs from "node:fs";
import { Router } from "express";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import { uploadRateLimit } from "../../middlewares/rateLimit";
import { upload } from "./files.upload";
import { finalizeUpload, getOwnedFileOrThrow, listFiles, renameOrMoveFile, softDeleteFile, storageUsage } from "./files.service";
import { filePath, hasSpaceFor } from "../../services/storage.service";
import { streamFolderAsZip } from "../../services/zip.service";
import { findOrCreateSubfolder, getOwnedFolderOrThrow } from "../folders/folders.service";
import { getProgress, saveProgress } from "./watch-progress.service";
import { logEvent } from "../../utils/logger";
import { HttpError } from "../../middlewares/errorHandler";

export const filesRouter = Router();
filesRouter.use(requireAuth);
filesRouter.use(resolveEffectiveOwner);

/** Checagem otimista de quota baseada no Content-Length declarado, antes de
 *  aceitar o stream de upload. A checagem definitiva acontece de novo em
 *  finalizeUpload() com o tamanho real gravado em disco. */
function preflightQuotaCheck(req: any, _res: any, next: any) {
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (declaredLength > 0 && !hasSpaceFor(req.effectiveOwnerId, declaredLength)) {
    next(new HttpError(413, "Quota de armazenamento excedida."));
    return;
  }
  next();
}

filesRouter.get("/", (req, res, next) => {
  try {
    const folderId = typeof req.query.folder_id === "string" ? req.query.folder_id : null;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const files = listFiles(req.effectiveOwnerId!, folderId, q);
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

filesRouter.post(
  "/upload",
  uploadRateLimit,
  preflightQuotaCheck,
  upload.array("files"),
  async (req, res, next) => {
    try {
      const folderId = typeof req.body.folder_id === "string" && req.body.folder_id !== "" ? req.body.folder_id : null;
      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];

      if (uploadedFiles.length === 0) {
        throw new HttpError(400, "Nenhum arquivo enviado.");
      }

      // Upload de pasta inteira: o cliente manda o caminho relativo de cada
      // arquivo num campo separado (o multipart descarta qualquer "/" que
      // venha dentro do nome do arquivo em si — comportamento do parser).
      let relativePaths: (string | null)[] = uploadedFiles.map(() => null);
      if (typeof req.body.relativePaths === "string") {
        try {
          const parsed = JSON.parse(req.body.relativePaths);
          if (Array.isArray(parsed) && parsed.length === uploadedFiles.length) {
            relativePaths = parsed;
          }
        } catch {
          /* campo malformado — ignora, trata como upload avulso */
        }
      }

      const results = [];
      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const rawPath = relativePaths[i];
        const segments = rawPath ? rawPath.split("/").filter((s) => s.length > 0) : [];
        const leafName = segments.length > 0 ? segments.pop()! : file.originalname;

        let targetFolderId = folderId;
        for (const segment of segments) {
          targetFolderId = findOrCreateSubfolder(req.effectiveOwnerId!, targetFolderId, segment);
        }

        const record = await finalizeUpload({
          ownerId: req.effectiveOwnerId!,
          folderId: targetFolderId,
          originalName: leafName,
          storageName: file.filename,
          declaredMimeType: file.mimetype,
          sizeBytes: file.size,
        });
        logEvent("FILE_UPLOAD", { userId: req.effectiveOwnerId!, fileId: record.id, size: record.size });
        results.push(record);
      }

      res.status(201).json({ files: results });
    } catch (err) {
      next(err);
    }
  }
);

filesRouter.get("/:id", (req, res, next) => {
  try {
    const file = getOwnedFileOrThrow(req.params.id, req.effectiveOwnerId!);
    res.json(file);
  } catch (err) {
    next(err);
  }
});

/**
 * Progresso de reprodução: como fica no banco (não no navegador), abrir o
 * mesmo vídeo em outro dispositivo — logado na mesma conta — já retoma do
 * ponto certo automaticamente. Não existe nenhum mecanismo de "sync" além
 * disso: é só onde o dado é guardado.
 */
filesRouter.get("/:id/progress", (req, res, next) => {
  try {
    const file = getOwnedFileOrThrow(req.params.id, req.effectiveOwnerId!);
    const progress = getProgress(file.id, req.effectiveOwnerId!);
    res.json(
      progress ?? {
        file_id: file.id,
        owner_id: req.effectiveOwnerId!,
        position_seconds: 0,
        duration_seconds: null,
        updated_at: null,
        completed_at: null,
      }
    );
  } catch (err) {
    next(err);
  }
});

filesRouter.put("/:id/progress", (req, res, next) => {
  try {
    const file = getOwnedFileOrThrow(req.params.id, req.effectiveOwnerId!);
    const { position_seconds, duration_seconds, completed, expected_updated_at } = req.body ?? {};

    if (typeof position_seconds !== "number" || !Number.isFinite(position_seconds) || position_seconds < 0) {
      throw new HttpError(400, "position_seconds inválido.");
    }
    const duration =
      typeof duration_seconds === "number" && Number.isFinite(duration_seconds) && duration_seconds > 0
        ? duration_seconds
        : null;

    if (completed !== undefined && typeof completed !== "boolean") {
      throw new HttpError(400, "completed inválido.");
    }
    if (expected_updated_at !== undefined && expected_updated_at !== null
      && (typeof expected_updated_at !== "string" || !Number.isFinite(Date.parse(expected_updated_at)))) {
      throw new HttpError(400, "expected_updated_at inválido.");
    }
    const progress = saveProgress(
      file.id, req.effectiveOwnerId!, position_seconds, duration, completed, expected_updated_at
    );
    res.json(
      progress ?? {
        file_id: file.id,
        owner_id: req.effectiveOwnerId!,
        position_seconds: 0,
        duration_seconds: null,
        updated_at: null,
        completed_at: null,
      }
    );
  } catch (err) {
    next(err);
  }
});

filesRouter.get("/:id/download", (req, res, next) => {
  try {
    // 1) autenticado (middleware), 2) arquivo existe + pertence ao usuário,
    // 3) localizar caminho físico, 4) verificar existência real, 5) enviar (spec §12).
    const file = getOwnedFileOrThrow(req.params.id, req.effectiveOwnerId!);
    const physicalPath = filePath(req.effectiveOwnerId!, file.storage_name);

    if (!fs.existsSync(physicalPath)) {
      throw new HttpError(410, "Arquivo físico não encontrado (pode ter sido removido).");
    }

    logEvent("FILE_DOWNLOAD", { userId: req.effectiveOwnerId!, fileId: file.id });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.original_name)}"`
    );
    res.setHeader("Content-Type", file.mime_type);
    fs.createReadStream(physicalPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

filesRouter.get("/:id/stream", (req, res, next) => {
  try {
    const file = getOwnedFileOrThrow(req.params.id, req.effectiveOwnerId!);
    const physicalPath = filePath(req.effectiveOwnerId!, file.storage_name);

    if (!fs.existsSync(physicalPath)) {
      throw new HttpError(410, "Arquivo físico não encontrado.");
    }

    const stat = fs.statSync(physicalPath);
    const range = req.headers.range;

    // Suporte a HTTP Range Requests (spec §14): permite que o navegador
    // inicie a reprodução antes do download completo e busque só as partes
    // necessárias, evitando carregar o vídeo inteiro na RAM do S21 FE.
    if (!range) {
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Type", file.mime_type);
      res.setHeader("Accept-Ranges", "bytes");
      fs.createReadStream(physicalPath).pipe(res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return;
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

    if (start >= stat.size || end >= stat.size || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return;
    }

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", end - start + 1);
    res.setHeader("Content-Type", file.mime_type);
    fs.createReadStream(physicalPath, { start, end }).pipe(res);
  } catch (err) {
    next(err);
  }
});

filesRouter.patch("/:id", (req, res, next) => {
  try {
    const { name, folder_id } = req.body ?? {};
    const updates: { name?: string; folder_id?: string | null } = {};
    if (name !== undefined) updates.name = name;
    if (folder_id !== undefined) updates.folder_id = folder_id;

    const file = renameOrMoveFile(req.params.id, req.effectiveOwnerId!, updates);
    logEvent(name !== undefined ? "FILE_RENAME" : "FILE_MOVE", { userId: req.effectiveOwnerId!, fileId: file.id });
    res.json(file);
  } catch (err) {
    next(err);
  }
});

filesRouter.delete("/:id", async (req, res, next) => {
  try {
    await softDeleteFile(req.params.id, req.effectiveOwnerId!);
    logEvent("FILE_DELETE", { userId: req.effectiveOwnerId!, fileId: req.params.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export const storageRouter = Router();
storageRouter.use(requireAuth);
storageRouter.use(resolveEffectiveOwner);
storageRouter.get("/usage", (req, res, next) => {
  try {
    res.json(storageUsage(req.effectiveOwnerId!));
  } catch (err) {
    next(err);
  }
});

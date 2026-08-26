import fs from "node:fs";
import fsp from "node:fs/promises";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import {
  publicUnlockRateLimit,
  publicBrowseRateLimit,
  publicDownloadRateLimit,
  publicUploadRateLimit,
} from "../../middlewares/rateLimit";
import { HttpError } from "../../middlewares/errorHandler";
import { resolveShare, requireUnlocked, isShareUnlocked, setPublicSessionCookie } from "./public-share.middleware";
import {
  createPublicSession,
  type EffectivePermissions,
} from "./shares.service";
import {
  isDescendantOrSelf,
  resolvePublicFolderId,
  findOrCreateSubfolder,
  getFolderSubtreeUsage,
} from "./share-access.service";
import { listFolders, getBreadcrumb, getOwnedFolderOrThrow } from "../folders/folders.service";
import { listFiles, getOwnedFileOrThrow, finalizeUpload, softDeleteFile } from "../files/files.service";
import { filePath, hasSpaceFor } from "../../services/storage.service";
import { streamFolderAsZip } from "../../services/zip.service";
import { publicUpload } from "./public.upload";
import { logEvent } from "../../utils/logger";

export const publicSharesRouter = Router();

// O token faz parte do caminho de TODA rota pública — resolvido uma única
// vez aqui e reaproveitado (req.share / req.shareEffective) pelas rotas.
publicSharesRouter.param("token", (req, res, next) => resolveShare(req, res, next));

function requirePermission(flag: keyof EffectivePermissions, message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.shareEffective || !req.shareEffective[flag]) {
      next(new HttpError(403, message));
      return;
    }
    next();
  };
}

// ---------- Metadados + desbloqueio por senha ----------

publicSharesRouter.get("/:token", publicBrowseRateLimit, (req, res) => {
  const share = req.share!;
  const effective = req.shareEffective!;
  const requiresPassword = !!share.password_hash;
  const unlocked = isShareUnlocked(req, share);

  res.json({
    name: share.name,
    type: share.type,
    requiresPassword,
    unlocked,
    permissions: unlocked ? effective : null,
  });
});

publicSharesRouter.post("/:token/unlock", publicUnlockRateLimit, async (req, res, next) => {
  try {
    const share = req.share!;
    if (!share.password_hash) {
      throw new HttpError(400, "Este link não requer senha.");
    }

    const { password } = req.body ?? {};
    if (typeof password !== "string") {
      throw new HttpError(400, "Senha é obrigatória.");
    }

    const valid = await bcrypt.compare(password, share.password_hash);
    if (!valid) {
      logEvent("SHARE_UNLOCK_FAILED", { shareId: share.id, ip: req.ip });
      throw new HttpError(401, "Senha incorreta.");
    }

    const session = createPublicSession(share.id);
    setPublicSessionCookie(res, share.token, session.id, session.expiresAt);
    logEvent("SHARE_UNLOCK_SUCCESS", { shareId: share.id });
    res.json({ unlocked: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Navegação ----------

publicSharesRouter.get(
  "/:token/browse",
  publicBrowseRateLimit,
  requireUnlocked,
  requirePermission("allowView", "Visualização não permitida neste compartilhamento."),
  (req, res, next) => {
    try {
      const share = req.share!;

      if (share.type === "file") {
        const file = getOwnedFileOrThrow(share.target_id, share.owner_id);
        res.json({ type: "file", file, breadcrumb: [] });
        return;
      }

      const requestedFolderId = typeof req.query.folder_id === "string" ? req.query.folder_id : null;
      const folderId = resolvePublicFolderId(share, requestedFolderId);

      const currentFolder = getOwnedFolderOrThrow(folderId, share.owner_id);
      const folders = listFolders(share.owner_id, folderId);
      const files = listFiles(share.owner_id, folderId);

      const fullBreadcrumb = getBreadcrumb(folderId, share.owner_id);
      const shareIndex = fullBreadcrumb.findIndex((f) => f.id === share.target_id);
      // Corta tudo ACIMA da pasta compartilhada — o visitante nunca deve
      // saber o nome de pastas privadas por onde o caminho real passa.
      const breadcrumb = shareIndex >= 0 ? fullBreadcrumb.slice(shareIndex) : [currentFolder];

      res.json({ type: "folder", currentFolder, folders, files, breadcrumb });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Download ----------

publicSharesRouter.get(
  "/:token/download",
  publicDownloadRateLimit,
  requireUnlocked,
  requirePermission("allowDownload", "Download não permitido neste compartilhamento."),
  (req, res, next) => {
    try {
      const share = req.share!;
      let fileId: string;

      if (share.type === "file") {
        fileId = share.target_id;
      } else {
        const requested = typeof req.query.file_id === "string" ? req.query.file_id : null;
        if (!requested) throw new HttpError(400, "file_id é obrigatório.");
        fileId = requested;
      }

      const file = getOwnedFileOrThrow(fileId, share.owner_id);

      if (share.type === "folder") {
        // Barreira central: o arquivo só pode ser entregue se estiver
        // DENTRO da árvore compartilhada — nunca em outro lugar do Drive.
        if (file.folder_id === null || !isDescendantOrSelf(file.folder_id, share.target_id, share.owner_id)) {
          throw new HttpError(403, "Arquivo fora do escopo deste compartilhamento.");
        }
      }

      const physicalPath = filePath(share.owner_id, file.storage_name);
      if (!fs.existsSync(physicalPath)) {
        throw new HttpError(410, "Arquivo não encontrado.");
      }

      logEvent("FILE_DOWNLOAD", { shareId: share.id, fileId: file.id, public: true });

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`);
      res.setHeader("Content-Type", file.mime_type);
      fs.createReadStream(physicalPath).pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Stream (preview de imagem/vídeo inline, com suporte a Range) ----------

publicSharesRouter.get(
  "/:token/stream",
  publicDownloadRateLimit,
  requireUnlocked,
  requirePermission("allowView", "Visualização não permitida neste compartilhamento."),
  (req, res, next) => {
    try {
      const share = req.share!;
      let fileId: string;

      if (share.type === "file") {
        fileId = share.target_id;
      } else {
        const requested = typeof req.query.file_id === "string" ? req.query.file_id : null;
        if (!requested) throw new HttpError(400, "file_id é obrigatório.");
        fileId = requested;
      }

      const file = getOwnedFileOrThrow(fileId, share.owner_id);

      if (share.type === "folder") {
        if (file.folder_id === null || !isDescendantOrSelf(file.folder_id, share.target_id, share.owner_id)) {
          throw new HttpError(403, "Arquivo fora do escopo deste compartilhamento.");
        }
      }

      const physicalPath = filePath(share.owner_id, file.storage_name);
      if (!fs.existsSync(physicalPath)) {
        throw new HttpError(410, "Arquivo não encontrado.");
      }

      const stat = fs.statSync(physicalPath);
      const range = req.headers.range;

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
  }
);

// ---------- Download da pasta inteira em .zip ----------
//
// Exceção deliberada à recomendação original da especificação (que pedia
// pra nunca oferecer isso a visitantes) — o admin pediu explicitamente.
// Mitigado com streaming: nunca monta o .zip inteiro em memória/disco, e
// compressão em nível moderado pra não pesar demais na CPU do celular.
publicSharesRouter.get(
  "/:token/download-zip",
  publicDownloadRateLimit,
  requireUnlocked,
  requirePermission("allowDownload", "Download não permitido neste compartilhamento."),
  (req, res, next) => {
    try {
      const share = req.share!;
      const requestedFolderId = typeof req.query.folder_id === "string" ? req.query.folder_id : null;
      const folderId = resolvePublicFolderId(share, requestedFolderId);
      const folder = getOwnedFolderOrThrow(folderId, share.owner_id);

      logEvent("FILE_DOWNLOAD", { shareId: share.id, folderId: folder.id, zip: true, public: true });
      streamFolderAsZip(share.owner_id, folder.id, folder.name, res);
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Upload ----------

function publicUploadPreflight(req: Request, res: Response, next: NextFunction) {
  try {
    const share = req.share!;
    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (declaredLength <= 0) {
      next();
      return;
    }

    if (!hasSpaceFor(share.owner_id, declaredLength)) {
      throw new HttpError(413, "Quota de armazenamento do Drive excedida.");
    }

    if (share.max_total_size !== null) {
      const usage = getFolderSubtreeUsage(share.target_id, share.owner_id);
      if (usage.totalBytes + declaredLength > share.max_total_size) {
        throw new HttpError(413, "Limite de armazenamento deste compartilhamento excedido.");
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

publicSharesRouter.post(
  "/:token/upload",
  publicUploadRateLimit,
  requireUnlocked,
  requirePermission("allowUpload", "Upload não permitido neste compartilhamento."),
  publicUploadPreflight,
  publicUpload.array("files"),
  async (req, res, next) => {
    try {
      const share = req.share!;
      const baseFolderId = resolvePublicFolderId(
        share,
        typeof req.body.folder_id === "string" && req.body.folder_id !== "" ? req.body.folder_id : null
      );

      const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];
      if (uploadedFiles.length === 0) {
        throw new HttpError(400, "Nenhum arquivo enviado.");
      }

      // Upload de pasta inteira: o multer/busboy descarta qualquer "/" que
      // venha dentro do nome do arquivo do multipart (comportamento próprio
      // do parser, por segurança) — então o caminho relativo NUNCA chega
      // via file.originalname. O cliente manda separadamente um campo
      // "relativePaths" (JSON: array de strings, mesma ordem dos "files")
      // só quando está enviando uma pasta; upload avulso não precisa dele.
      let relativePaths: (string | null)[] = uploadedFiles.map(() => null);
      if (typeof req.body.relativePaths === "string") {
        try {
          const parsed = JSON.parse(req.body.relativePaths);
          if (Array.isArray(parsed) && parsed.length === uploadedFiles.length) {
            relativePaths = parsed;
          }
        } catch {
          /* campo malformado — ignora e trata como upload avulso (fallback seguro) */
        }
      }

      if (share.max_files !== null) {
        const usage = getFolderSubtreeUsage(share.target_id, share.owner_id);
        if (usage.fileCount + uploadedFiles.length > share.max_files) {
          // Limpa os arquivos físicos já gravados pelo multer antes de rejeitar o lote.
          for (const f of uploadedFiles) {
            await fsp.rm(f.path, { force: true });
          }
          throw new HttpError(400, `Limite de ${share.max_files} arquivo(s) deste compartilhamento seria excedido.`);
        }
      }

      const results: unknown[] = [];
      const rejected: { name: string; reason: string }[] = [];

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        try {
          if (share.max_file_size !== null && file.size > share.max_file_size) {
            await fsp.rm(file.path, { force: true });
            rejected.push({ name: file.originalname, reason: "Excede o tamanho máximo deste compartilhamento." });
            continue;
          }

          // Se veio caminho relativo pra esse arquivo (upload de pasta),
          // os segmentos viram pastas reais no banco — nunca caminho de
          // filesystem — e o último vira o nome do arquivo. Sem caminho
          // relativo, usa o nome do arquivo direto (upload avulso normal).
          const rawPath = relativePaths[i];
          const segments = rawPath ? rawPath.split("/").filter((s) => s.length > 0) : [];
          const leafName = segments.length > 0 ? segments.pop()! : file.originalname;
          if (!leafName) {
            rejected.push({ name: file.originalname, reason: "Nome de arquivo inválido." });
            continue;
          }

          let targetFolderId = baseFolderId;
          for (const segment of segments) {
            targetFolderId = findOrCreateSubfolder(share.owner_id, targetFolderId, segment);
          }

          const record = await finalizeUpload({
            ownerId: share.owner_id,
            folderId: targetFolderId,
            originalName: leafName,
            storageName: file.filename,
            declaredMimeType: file.mimetype,
            sizeBytes: file.size,
          });

          logEvent("FILE_UPLOAD", { shareId: share.id, fileId: record.id, size: record.size, public: true });
          results.push(record);
        } catch (err) {
          rejected.push({ name: file.originalname, reason: err instanceof HttpError ? err.message : "Falha no upload." });
        }
      }

      res.status(201).json({ files: results, rejected });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Exclusão (desativada por padrão — allow_delete) ----------

publicSharesRouter.delete(
  "/:token/files/:fileId",
  requireUnlocked,
  requirePermission("allowDelete", "Exclusão não permitida neste compartilhamento."),
  async (req, res, next) => {
    try {
      const share = req.share!;
      if (share.type !== "folder") {
        throw new HttpError(400, "Este compartilhamento não permite exclusão de arquivos.");
      }

      const file = getOwnedFileOrThrow(req.params.fileId, share.owner_id);
      if (file.folder_id === null || !isDescendantOrSelf(file.folder_id, share.target_id, share.owner_id)) {
        throw new HttpError(403, "Arquivo fora do escopo deste compartilhamento.");
      }

      await softDeleteFile(file.id, share.owner_id);
      logEvent("FILE_DELETE", { shareId: share.id, fileId: file.id, public: true });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

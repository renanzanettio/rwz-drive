import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { env } from "../../config/env";
import { userDir } from "../../services/storage.service";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import { BLOCKED_EXTENSIONS } from "../../config/constants";

/**
 * multer com diskStorage (NUNCA memoryStorage): o arquivo é gravado em disco
 * via stream à medida que chega, sem nunca carregar o conteúdo inteiro na
 * RAM do processo (spec §10, §28 — crítico no S21 FE).
 *
 * O nome físico é sempre um UUID gerado aqui no servidor — o nome original
 * do usuário nunca é usado como caminho (spec §11).
 */
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      if (!req.user) throw new HttpError(401, "Não autenticado.");
      const dir = userDir(req.user.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err as Error, "");
    }
  },
  filename: (_req, _file, cb) => {
    cb(null, uuid());
  },
});

function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    cb(new HttpError(400, `Tipo de arquivo não permitido: ${ext}`) as unknown as null, false);
    return;
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.uploadMaxFileSizeBytes,
    files: env.uploadMaxFilesPerRequest,
  },
});

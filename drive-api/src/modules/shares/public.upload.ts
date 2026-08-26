import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { env } from "../../config/env";
import { userDir } from "../../services/storage.service";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import { BLOCKED_EXTENSIONS } from "../../config/constants";

/**
 * Mesmo padrão de segurança do upload privado (diskStorage, streaming, nome
 * físico sempre UUID) — a diferença é que o "dono" do upload é
 * `req.share.owner_id` (o admin), resolvido pelo middleware `resolveShare`
 * que já rodou antes deste multer entrar em ação (via router.param).
 *
 * `file.originalname` pode conter "/" quando o visitante está enviando uma
 * pasta inteira (ex.: "Dia 01/foto1.jpg") — isso é só o NOME que vai virar
 * registros de pasta no banco; nunca é usado pra montar caminho físico.
 */
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      if (!req.share) throw new HttpError(404, "Link indisponível.");
      const dir = userDir(req.share.owner_id);
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

export const publicUpload = multer({
  storage,
  fileFilter,
  limits: {
    // Teto global do servidor sempre se aplica; o teto por-compartilhamento
    // (share.max_file_size), quando configurado, é checado depois — o
    // multer não permite limite dinâmico por request.
    fileSize: env.uploadMaxFileSizeBytes,
    files: env.uploadMaxFilesPerRequest,
  },
});

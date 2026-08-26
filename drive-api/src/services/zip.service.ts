import fs from "node:fs";
import type { Response } from "express";
import archiver from "archiver";
import { listFolders } from "../modules/folders/folders.service";
import { listFiles } from "../modules/files/files.service";
import { filePath } from "./storage.service";

/**
 * Segunda camada de defesa contra "zip slip" (uma entrada de .zip com nome
 * tipo "../../etc/algo" que escapa da pasta de destino ao ser extraída).
 * A validação na criação de pastas/arquivos já bloqueia nomes "." e ".."
 * — isso aqui é redundante por design: garante que mesmo um nome
 * problemático que exista por algum motivo (dado antigo, bug futuro em
 * outro lugar) nunca vira uma entrada de zip perigosa.
 */
function sanitizeZipSegment(name: string): string {
  return name.replace(/\.\./g, "__").replace(/[\u0000-\u001f]/g, "_");
}

/**
 * Transmite uma pasta (recursivamente) como .zip diretamente pra resposta
 * HTTP, sem nunca montar o arquivo compactado inteiro em memória ou disco —
 * essencial rodando num celular com RAM limitada. Cada arquivo é lido e
 * comprimido em stream, um de cada vez.
 *
 * Nível de compressão moderado (não máximo): o S21 FE tem CPU limitada, e a
 * maioria do conteúdo de um Drive pessoal (fotos, vídeos) já vem comprimida
 * — comprimir mais não economiza quase nada de espaço, só gasta CPU/bateria
 * à toa.
 */
export function streamFolderAsZip(ownerId: string, rootFolderId: string, rootName: string, res: Response): void {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(sanitizeZipSegment(rootName))}.zip"`);

  const archive = archiver("zip", { zlib: { level: 4 } });

  archive.on("warning", () => {
    /* arquivo sumiu/mudou no meio da compactação — segue o fluxo, não é fatal */
  });
  archive.on("error", (err) => {
    // A resposta já pode ter começado a ser enviada — não dá mais pra
    // responder com um JSON de erro decente, só encerrar a conexão.
    res.destroy(err);
  });

  archive.pipe(res);

  function walk(folderId: string, prefix: string) {
    const files = listFiles(ownerId, folderId);
    for (const file of files) {
      const physical = filePath(ownerId, file.storage_name);
      if (fs.existsSync(physical)) {
        archive.append(fs.createReadStream(physical), { name: `${prefix}${sanitizeZipSegment(file.original_name)}` });
      }
    }

    const folders = listFolders(ownerId, folderId);
    for (const folder of folders) {
      walk(folder.id, `${prefix}${sanitizeZipSegment(folder.name)}/`);
    }
  }

  walk(rootFolderId, `${sanitizeZipSegment(rootName)}/`);
  archive.finalize();
}

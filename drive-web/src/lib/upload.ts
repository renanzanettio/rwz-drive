/**
 * Upload resiliente a rede instável: cada arquivo vai numa requisição
 * separada (não um FormData gigante com tudo junto), então uma falha de
 * rede no meio de um upload de vários vídeos afeta só o arquivo atual —
 * não cancela o lote inteiro. Falhas de REDE (conexão caiu, timeout) são
 * re-tentadas automaticamente com backoff; falhas de VALIDAÇÃO do servidor
 * (tipo de arquivo bloqueado, quota excedida etc.) não são re-tentadas,
 * pois tentar de novo não muda o resultado.
 */

export interface UploadItem {
  file: File;
  relativePath: string | null; // caminho dentro da pasta, quando enviando uma pasta inteira
}

export interface UploadItemResult {
  item: UploadItem;
  success: boolean;
  error?: string;
}

export interface UploadBatchProgress {
  completed: number; // itens finalizados (sucesso ou falha definitiva)
  total: number;
  currentFile: string | null;
  currentFilePct: number; // 0-100
  retrying: boolean;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** status 0 = a requisição nem chegou a ter resposta (rede caiu, DNS falhou, etc.) — vale re-tentar. */
function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Envia UM arquivo via XHR, com retry automático em falha de rede.
 * `sendOne` deve fazer a requisição em si (assim quem chama controla o
 * endpoint/campos extras) e retornar a resposta parseada.
 */
export async function uploadOneWithRetry<T>(
  sendOne: (onProgress: (pct: number) => void) => Promise<{ status: number; body: T; networkError: boolean }>,
  onProgress: (pct: number) => void,
  onRetrying?: (attempt: number) => void
): Promise<T> {
  let attempt = 0;

  while (true) {
    const result = await sendOne(onProgress);

    if (!result.networkError && result.status >= 200 && result.status < 300) {
      return result.body;
    }

    const retryable = result.networkError || isRetryableStatus(result.status);
    if (!retryable || attempt >= MAX_RETRIES) {
      const err: any = new Error(
        result.networkError ? "Falha de rede persistente." : `Servidor recusou o upload (status ${result.status}).`
      );
      err.status = result.status;
      err.body = result.body;
      throw err;
    }

    attempt += 1;
    onRetrying?.(attempt);
    // Backoff exponencial com teto de 20s — dá tempo da conexão do celular voltar.
    await sleep(Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), 20000));
  }
}

/**
 * Processa uma lista de arquivos SEQUENCIALMENTE (um de cada vez — mais
 * previsível numa rede ruim de celular do que disparar tudo em paralelo),
 * reportando progresso agregado e continuando pro próximo arquivo mesmo se
 * um falhar definitivamente (após esgotar as tentativas).
 */
export async function uploadBatchSequential(
  items: UploadItem[],
  uploadOne: (item: UploadItem, onProgress: (pct: number) => void, onRetrying?: (attempt: number) => void) => Promise<unknown>,
  onProgress: (progress: UploadBatchProgress) => void
): Promise<UploadItemResult[]> {
  const results: UploadItemResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress({ completed: i, total: items.length, currentFile: item.file.name, currentFilePct: 0, retrying: false });

    try {
      await uploadOne(
        item,
        (pct) => onProgress({ completed: i, total: items.length, currentFile: item.file.name, currentFilePct: pct, retrying: false }),
        () => onProgress({ completed: i, total: items.length, currentFile: item.file.name, currentFilePct: 0, retrying: true })
      );
      results.push({ item, success: true });
    } catch (err) {
      results.push({ item, success: false, error: err instanceof Error ? err.message : "Falha no upload." });
    }
  }

  onProgress({ completed: items.length, total: items.length, currentFile: null, currentFilePct: 100, retrying: false });
  return results;
}

/** Extrai File[] + relativePath[] de um FileList vindo de <input webkitdirectory> ou drag&drop de pasta. */
export function toUploadItems(fileList: FileList | File[]): UploadItem[] {
  return Array.from(fileList).map((file) => ({
    file,
    relativePath: (file as any).webkitRelativePath || null,
  }));
}

/**
 * Envia UM arquivo via XHR pra uma URL de upload, sem nunca rejeitar a
 * Promise — falhas de rede viram `networkError: true` em vez de exceção,
 * pra quem chama (uploadOneWithRetry) decidir se vale re-tentar.
 */
export function xhrUploadSingle(
  url: string,
  item: UploadItem,
  extraFields: Record<string, string | null | undefined>,
  onProgress: (pct: number) => void
): Promise<{ status: number; body: any; networkError: boolean }> {
  return new Promise((resolve) => {
    const formData = new FormData();
    formData.append("files", item.file);
    if (item.relativePath) {
      formData.append("relativePaths", JSON.stringify([item.relativePath]));
    }
    for (const [key, value] of Object.entries(extraFields)) {
      if (value) formData.append(key, value);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = 5 * 60 * 1000; // 5min por arquivo — generoso pra vídeo grande em rede de celular ruim
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(Math.round((evt.loaded / evt.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* resposta sem corpo JSON */
      }
      resolve({ status: xhr.status, body, networkError: false });
    };
    xhr.onerror = () => resolve({ status: 0, body: null, networkError: true });
    xhr.ontimeout = () => resolve({ status: 0, body: null, networkError: true });
    xhr.send(formData);
  });
}

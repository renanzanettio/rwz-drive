import { ApiError } from "./api-client";
import { uploadOneWithRetry, uploadBatchSequential, xhrUploadSingle, type UploadItem, type UploadItemResult, type UploadBatchProgress } from "./upload";

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/public${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* sem corpo JSON */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface PublicShareMeta {
  name: string;
  type: "folder" | "file";
  requiresPassword: boolean;
  unlocked: boolean;
  permissions: { allowView: boolean; allowDownload: boolean; allowUpload: boolean; allowDelete: boolean } | null;
}

export interface PublicFolderItem {
  id: string;
  parent_id: string | null;
  name: string;
}

export interface PublicFileItem {
  id: string;
  folder_id: string | null;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface PublicBrowseFolderResult {
  type: "folder";
  currentFolder: PublicFolderItem;
  folders: PublicFolderItem[];
  files: PublicFileItem[];
  breadcrumb: PublicFolderItem[];
}

export interface PublicBrowseFileResult {
  type: "file";
  file: PublicFileItem;
  breadcrumb: [];
}

export const publicShareApi = {
  getMeta: (token: string) => publicRequest<PublicShareMeta>(`/shares/${token}`),

  unlock: (token: string, password: string) =>
    publicRequest<{ unlocked: boolean }>(`/shares/${token}/unlock`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  browse: (token: string, folderId?: string | null) => {
    const qs = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : "";
    return publicRequest<PublicBrowseFolderResult | PublicBrowseFileResult>(`/shares/${token}/browse${qs}`);
  },

  downloadUrl: (token: string, fileId?: string) =>
    `/api/public/shares/${token}/download${fileId ? `?file_id=${encodeURIComponent(fileId)}` : ""}`,

  streamUrl: (token: string, fileId?: string) =>
    `/api/public/shares/${token}/stream${fileId ? `?file_id=${encodeURIComponent(fileId)}` : ""}`,

  downloadZipUrl: (token: string, folderId?: string | null) =>
    `/api/public/shares/${token}/download-zip${folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ""}`,

  removeFile: (token: string, fileId: string) =>
    publicRequest<void>(`/shares/${token}/files/${fileId}`, { method: "DELETE" }),

  /**
   * Upload resiliente (mesma lógica do privado): um arquivo por requisição,
   * retry automático em falha de rede, continua pro próximo mesmo se um
   * falhar definitivamente.
   */
  upload: (
    token: string,
    items: UploadItem[],
    folderId: string | null,
    onProgress: (progress: UploadBatchProgress) => void
  ): Promise<UploadItemResult[]> => {
    const uploadOne = (item: UploadItem, onFileProgress: (pct: number) => void, onRetrying?: (attempt: number) => void) =>
      uploadOneWithRetry<{ files: unknown[]; rejected: { name: string; reason: string }[] }>(
        (progressCb) => xhrUploadSingle(`/api/public/shares/${token}/upload`, item, { folder_id: folderId }, progressCb),
        onFileProgress,
        onRetrying
      );
    return uploadBatchSequential(items, uploadOne, onProgress);
  },
};

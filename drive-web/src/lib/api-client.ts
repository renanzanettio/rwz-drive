import { uploadOneWithRetry, uploadBatchSequential, xhrUploadSingle, type UploadItem, type UploadItemResult, type UploadBatchProgress } from "./upload";
import { withImpersonation, getImpersonation } from "./impersonation";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${withImpersonation(path)}`, {
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
      // resposta sem corpo JSON, mantém mensagem padrão
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Tipos ----
export interface FolderItem {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface FileItem {
  id: string;
  owner_id: string;
  folder_id: string | null;
  original_name: string;
  storage_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  updated_at: string;
  // Presentes quando o arquivo vem da listagem de pasta (não da busca).
  watch_position_seconds?: number | null;
  watch_duration_seconds?: number | null;
}

export interface WatchProgress {
  file_id: string;
  owner_id: string;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string | null;
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  folderCount: number;
}

// ---- Auth ----
export type UserRole = "admin" | "user";

export const authApi = {
  login: (username: string, password: string) =>
    request<{ id: string; username: string; role: UserRole }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string, email?: string, inviteToken?: string | null) =>
    request<{ id: string; username: string; role: UserRole }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, email, invite_token: inviteToken ?? undefined }),
    }),
  registrationStatus: () => request<{ openRegistration: boolean }>("/auth/registration-status"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ id: string; username: string; email: string | null; role: UserRole }>("/auth/me"),
};

// ---- Folders ----
export const foldersApi = {
  list: (parentId: string | null) =>
    request<{ folders: FolderItem[] }>(`/folders${parentId ? `?parent_id=${parentId}` : ""}`),
  breadcrumb: (folderId: string) =>
    request<{ breadcrumb: FolderItem[] }>(`/folders/${folderId}/breadcrumb`),
  create: (name: string, parentId: string | null) =>
    request<FolderItem>("/folders", { method: "POST", body: JSON.stringify({ name, parent_id: parentId }) }),
  rename: (id: string, name: string) =>
    request<FolderItem>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  move: (id: string, parentId: string | null) =>
    request<FolderItem>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify({ parent_id: parentId }) }),
  remove: (id: string) => request<void>(`/folders/${id}`, { method: "DELETE" }),
  downloadZipUrl: (id: string) => withImpersonation(`/api/folders/${id}/download-zip`),
};

// ---- Files ----
export const filesApi = {
  list: (folderId: string | null, q?: string) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder_id", folderId);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request<{ files: FileItem[] }>(`/files${qs ? `?${qs}` : ""}`);
  },
  /**
   * Upload resiliente: cada arquivo vai numa requisição própria, com retry
   * automático em falha de rede (não cancela o lote inteiro por causa de
   * um arquivo). Aceita itens vindos de seleção de pasta (com relativePath)
   * pra reconstruir a estrutura no destino.
   */
  upload: (
    items: UploadItem[],
    folderId: string | null,
    onProgress: (progress: UploadBatchProgress) => void
  ): Promise<UploadItemResult[]> => {
    const uploadOne = (item: UploadItem, onFileProgress: (pct: number) => void, onRetrying?: (attempt: number) => void) => {
      const impersonation = getImpersonation();
      const url = impersonation
        ? `/api/files/upload?as_user_id=${encodeURIComponent(impersonation.userId)}`
        : "/api/files/upload";
      return uploadOneWithRetry<{ files: FileItem[] }>(
        (progressCb) => xhrUploadSingle(url, item, { folder_id: folderId }, progressCb),
        onFileProgress,
        onRetrying
      );
    };
    return uploadBatchSequential(items, uploadOne, onProgress);
  },
  rename: (id: string, name: string) =>
    request<FileItem>(`/files/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  move: (id: string, folderId: string | null) =>
    request<FileItem>(`/files/${id}`, { method: "PATCH", body: JSON.stringify({ folder_id: folderId }) }),
  remove: (id: string) => request<void>(`/files/${id}`, { method: "DELETE" }),
  downloadUrl: (id: string) => withImpersonation(`/api/files/${id}/download`),
  streamUrl: (id: string) => withImpersonation(`/api/files/${id}/stream`),
  getProgress: (id: string) => request<WatchProgress>(`/files/${id}/progress`),
  saveProgress: (id: string, positionSeconds: number, durationSeconds: number | null) =>
    request<WatchProgress>(`/files/${id}/progress`, {
      method: "PUT",
      body: JSON.stringify({ position_seconds: positionSeconds, duration_seconds: durationSeconds }),
    }),
};

// ---- Search ----
export const searchApi = {
  search: (q: string) => request<{ files: FileItem[]; folders: FolderItem[] }>(`/search?q=${encodeURIComponent(q)}`),
};

// ---- Storage ----
export const storageApi = {
  usage: () => request<StorageUsage>("/storage/usage"),
};

// ---- Compartilhamentos públicos (admin) ----
export type ShareType = "folder" | "file";
export type ExpiredAction = "make_private" | "delete_content" | "block_uploads";
export type ShareDisplayStatus = "active" | "expired" | "revoked";

export interface SharePermissions {
  allow_view: boolean;
  allow_download: boolean;
  allow_upload: boolean;
  allow_delete: boolean;
}

export interface ShareItem {
  id: string;
  type: ShareType;
  target_id: string;
  name: string;
  token: string;
  publicUrl: string;
  hasPassword: boolean;
  displayStatus: ShareDisplayStatus;
  expires_at: string | null;
  expired_action: ExpiredAction;
  permissions: SharePermissions;
  effectivePermissions: { allowView: boolean; allowDownload: boolean; allowUpload: boolean; allowDelete: boolean };
  max_file_size: number | null;
  max_total_size: number | null;
  max_files: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateShareInput {
  type: ShareType;
  target_id: string;
  name: string;
  password?: string | null;
  expires_at?: string | null;
  expired_action?: ExpiredAction;
  allow_view?: boolean;
  allow_download?: boolean;
  allow_upload?: boolean;
  allow_delete?: boolean;
  max_file_size?: number | null;
  max_total_size?: number | null;
  max_files?: number | null;
}

export type UpdateShareInput = Partial<Omit<CreateShareInput, "type" | "target_id" | "password">>;

export const sharesApi = {
  list: () => request<{ shares: ShareItem[] }>("/shares"),
  get: (id: string) => request<ShareItem>(`/shares/${id}`),
  create: (input: CreateShareInput) => request<ShareItem>("/shares", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: UpdateShareInput) =>
    request<ShareItem>(`/shares/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  setPassword: (id: string, password: string | null) =>
    request<ShareItem>(`/shares/${id}/password`, { method: "PUT", body: JSON.stringify({ password }) }),
  revoke: (id: string) => request<ShareItem>(`/shares/${id}/revoke`, { method: "POST" }),
  reactivate: (id: string) => request<ShareItem>(`/shares/${id}/reactivate`, { method: "POST" }),
  remove: (id: string, deleteContent: boolean) =>
    request<void>(`/shares/${id}?deleteContent=${deleteContent ? "true" : "false"}`, { method: "DELETE" }),
};

// ---- Administração (convites e usuários) ----
export interface InviteItem {
  id: string;
  token: string;
  inviteUrl: string;
  storage_quota_bytes: number | null;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  storage_quota_bytes: number | null;
  effective_quota_bytes: number;
  used_bytes: number;
  created_at: string;
}

export const adminApi = {
  listInvites: () => request<{ invites: InviteItem[] }>("/admin/invites"),
  createInvite: (storageQuotaMb: number | null, expiresAt: string | null) =>
    request<InviteItem>("/admin/invites", {
      method: "POST",
      body: JSON.stringify({ storage_quota_mb: storageQuotaMb, expires_at: expiresAt }),
    }),
  revokeInvite: (id: string) => request<void>(`/admin/invites/${id}`, { method: "DELETE" }),
  listUsers: () => request<{ users: UserSummary[]; globalDefaultQuotaBytes: number }>("/admin/users"),
  updateUserQuota: (userId: string, storageQuotaMb: number | null) =>
    request<void>(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ storage_quota_mb: storageQuotaMb }) }),
  deleteUser: (userId: string) => request<void>(`/admin/users/${userId}`, { method: "DELETE" }),
};

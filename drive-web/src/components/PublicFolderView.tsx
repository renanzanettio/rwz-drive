"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "@/app/public.module.css";
import driveStyles from "@/app/drive/drive.module.css";
import {
  publicShareApi,
  type PublicShareMeta,
  type PublicBrowseFolderResult,
  type PublicFolderItem,
  type PublicFileItem,
} from "@/lib/public-api-client";
import { ApiError } from "@/lib/api-client";
import { toUploadItems, type UploadBatchProgress } from "@/lib/upload";
import { formatBytes, fileKind } from "@/lib/format";
import { FolderIcon, FileIcon, ImageIcon, VideoIcon, PdfIcon, DownloadIcon, LockIcon, UploadIcon } from "./icons";
import { Toast } from "./Toast";

type Crumb = { id: string | null; name: string };

export function PublicFolderView({ token }: { token: string }) {
  const [meta, setMeta] = useState<PublicShareMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<PublicFolderItem[]>([]);
  const [files, setFiles] = useState<PublicFileItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadBatchProgress | null>(null);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const [toast, setToast] = useState<{ message: string; danger?: boolean } | null>(null);

  const [preview, setPreview] = useState<PublicFileItem | null>(null);

  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const currentFolderId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : null;

  function notify(message: string, danger = false) {
    setToast({ message, danger });
    setTimeout(() => setToast(null), 3500);
  }

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const data = await publicShareApi.getMeta(token);
      setMeta(data);
    } catch (err) {
      setMetaError(err instanceof ApiError ? err.message : "Link indisponível.");
    } finally {
      setMetaLoading(false);
    }
  }, [token]);

  const loadFolder = useCallback(
    async (folderId: string | null) => {
      setBrowseLoading(true);
      try {
        const data = await publicShareApi.browse(token, folderId);
        if (data.type === "folder") {
          const d = data as PublicBrowseFolderResult;
          setFolders(d.folders);
          setFiles(d.files);
          setBreadcrumb(d.breadcrumb.map((f) => ({ id: f.id, name: f.name })));
        }
      } catch (err) {
        notify(err instanceof ApiError ? err.message : "Não foi possível carregar a pasta.", true);
      } finally {
        setBrowseLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (meta?.unlocked) {
      loadFolder(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.unlocked]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError(null);
    try {
      await publicShareApi.unlock(token, password);
      await loadMeta();
    } catch (err) {
      setUnlockError(err instanceof ApiError ? err.message : "Senha incorreta.");
    } finally {
      setUnlocking(false);
    }
  }

  function navigateTo(folderId: string, name: string) {
    setBreadcrumb((prev) => [...prev, { id: folderId, name }]);
  }

  function navigateToCrumb(index: number) {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
  }

  useEffect(() => {
    if (meta?.unlocked && breadcrumb.length > 0) {
      loadFolder(currentFolderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  async function doUpload(fileList: FileList) {
    const items = toUploadItems(fileList);
    if (items.length === 0) return;

    setRejected([]);
    try {
      const results = await publicShareApi.upload(token, items, currentFolderId, setUploadProgress);
      const okCount = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);

      if (failed.length > 0) {
        setRejected(failed.map((f) => ({ name: f.item.file.name, reason: f.error ?? "Falha no upload." })));
      }
      notify(`${okCount} arquivo(s) enviado(s).`);
      await loadFolder(currentFolderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Falha no upload.", true);
    } finally {
      setUploadProgress(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  }

  function iconFor(mime: string) {
    const kind = fileKind(mime);
    if (kind === "image") return <ImageIcon size={18} />;
    if (kind === "video") return <VideoIcon size={18} />;
    if (kind === "pdf") return <PdfIcon size={18} />;
    return <FileIcon size={18} />;
  }

  // ---------- Estados de carregamento / erro ----------

  if (metaLoading) {
    return (
      <div className={styles.shell}>
        <Brand />
        <div className={styles.card}>
          <div className={styles.stateCard}>Carregando...</div>
        </div>
      </div>
    );
  }

  if (metaError || !meta) {
    return (
      <div className={styles.shell}>
        <Brand />
        <div className={styles.card}>
          <div className={styles.stateCard}>
            <p>{metaError ?? "Link indisponível."}</p>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Portão de senha ----------

  if (meta.requiresPassword && !meta.unlocked) {
    return (
      <div className={styles.shell}>
        <Brand />
        <div className={styles.card}>
          <div className={styles.gateCard}>
            <div className={styles.gateIcon}>
              <LockIcon size={30} />
            </div>
            <h1 className={styles.gateTitle}>{meta.name}</h1>
            <p className={styles.gateSubtitle}>Esta pasta é protegida por senha.</p>
            <form onSubmit={handleUnlock}>
              <input
                type="password"
                className={styles.gateInput}
                placeholder="Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              {unlockError && <div className={styles.gateError}>{unlockError}</div>}
              <button type="submit" className={`${driveStyles.btn} ${driveStyles.btnPrimary}`} disabled={unlocking} style={{ width: "100%" }}>
                Entrar
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Conteúdo ----------

  const isEmpty = !browseLoading && folders.length === 0 && files.length === 0;
  const permissions = meta.permissions!;

  return (
    <div className={styles.shell}>
      <Brand />
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>
            <FolderIcon size={22} /> {meta.name}
          </h1>
          <div className={styles.subtitle}>
            {folders.length} pasta(s) · {files.length} arquivo(s)
          </div>
          {permissions.allowDownload && (folders.length > 0 || files.length > 0) && (
            <a
              className={driveStyles.btn}
              href={publicShareApi.downloadZipUrl(token, currentFolderId)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10 }}
            >
              <DownloadIcon size={13} /> Baixar tudo (.zip)
            </a>
          )}
        </div>

        {breadcrumb.length > 1 && (
          <div className={styles.breadcrumbs}>
            {breadcrumb.map((crumb, idx) =>
              idx === breadcrumb.length - 1 ? (
                <span key={crumb.id ?? "root"}>{crumb.name}</span>
              ) : (
                <span key={crumb.id ?? "root"} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => navigateToCrumb(idx)}>{crumb.name}</button>
                  <span>/</span>
                </span>
              )
            )}
          </div>
        )}

        <div className={styles.list}>
          {isEmpty && <div className={styles.emptyList}>Esta pasta está vazia.</div>}

          {folders.map((folder) => (
            <div
              key={folder.id}
              className={`${styles.row} ${styles.rowFolder}`}
              onClick={() => navigateTo(folder.id, folder.name)}
            >
              <div className={styles.rowIcon}>
                <FolderIcon size={18} />
              </div>
              <div className={styles.rowName}>{folder.name}</div>
            </div>
          ))}

          {files.map((file) => {
            const kind = fileKind(file.mime_type);
            const previewable = kind === "image" || kind === "video";
            return (
              <div
                key={file.id}
                className={styles.row}
                style={previewable && permissions.allowView ? { cursor: "pointer" } : undefined}
                onClick={() => {
                  if (previewable && permissions.allowView) setPreview(file);
                }}
              >
                <div className={styles.rowIcon}>
                  {kind === "image" && permissions.allowView ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={publicShareApi.streamUrl(token, file.id)} alt={file.original_name} className={styles.rowThumb} />
                  ) : (
                    iconFor(file.mime_type)
                  )}
                </div>
                <div className={styles.rowName}>{file.original_name}</div>
                <div className={styles.rowMeta}>{formatBytes(file.size)}</div>
                {permissions.allowDownload && (
                  <a
                    className={styles.downloadBtn}
                    href={publicShareApi.downloadUrl(token, file.id)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DownloadIcon size={13} /> Baixar
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {permissions.allowUpload && (
          <div
            className={`${styles.uploadZone} ${dragOver ? styles.uploadZoneDragging : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              dragCounter.current += 1;
              setDragOver(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              e.preventDefault();
              dragCounter.current -= 1;
              if (dragCounter.current <= 0) setDragOver(false);
            }}
            onDrop={handleDrop}
          >
            <UploadIcon size={22} />
            <p style={{ margin: "10px 0 0", fontSize: 13.5 }}>Arraste arquivos aqui</p>
            <div className={styles.uploadButtons}>
              <button className={driveStyles.btn} onClick={() => fileInputRef.current?.click()}>
                Selecionar arquivos
              </button>
              <button className={driveStyles.btn} onClick={() => folderInputRef.current?.click()}>
                Selecionar pasta
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) doUpload(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              hidden
              // @ts-expect-error - atributo não padronizado, mas suportado pelos navegadores baseados em Chromium/Safari
              webkitdirectory=""
              onChange={(e) => {
                if (e.target.files?.length) doUpload(e.target.files);
                e.target.value = "";
              }}
            />

            {uploadProgress && (
              <>
                <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--text-dim)" }}>
                  {uploadProgress.retrying
                    ? `Conexão instável, tentando de novo: ${uploadProgress.currentFile}`
                    : uploadProgress.currentFile
                    ? `Enviando (${uploadProgress.completed + 1}/${uploadProgress.total}): ${uploadProgress.currentFile}`
                    : "Upload concluído"}
                </p>
                <div className={styles.uploadProgressBar}>
                  <div
                    className={styles.uploadProgressFill}
                    style={{
                      width: `${Math.round(((uploadProgress.completed + uploadProgress.currentFilePct / 100) / uploadProgress.total) * 100)}%`,
                      background: uploadProgress.retrying ? "#e5a84d" : undefined,
                    }}
                  />
                </div>
              </>
            )}

            {rejected.length > 0 && (
              <ul className={styles.rejectedList}>
                {rejected.map((r, i) => (
                  <li key={i}>
                    {r.name}: {r.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className={driveStyles.previewOverlay} onClick={() => setPreview(null)}>
          <button className={driveStyles.previewClose} onClick={() => setPreview(null)}>
            ✕
          </button>
          <div onClick={(e) => e.stopPropagation()}>
            {fileKind(preview.mime_type) === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={publicShareApi.streamUrl(token, preview.id)}
                alt={preview.original_name}
                className={driveStyles.previewImg}
              />
            ) : (
              <video src={publicShareApi.streamUrl(token, preview.id)} controls autoPlay className={driveStyles.previewVideo} />
            )}
          </div>
          <div className={driveStyles.previewCaption}>
            {preview.original_name} · {formatBytes(preview.size)}
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} variant={toast.danger ? "danger" : "default"} />}
    </div>
  );
}

function Brand() {
  return (
    <div className={styles.brand}>
      RWZ <span>Drive</span>
    </div>
  );
}

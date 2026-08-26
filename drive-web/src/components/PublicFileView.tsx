"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/app/public.module.css";
import driveStyles from "@/app/drive/drive.module.css";
import { publicShareApi, type PublicShareMeta, type PublicBrowseFileResult } from "@/lib/public-api-client";
import { ApiError } from "@/lib/api-client";
import { formatBytes, fileKind } from "@/lib/format";
import { FileIcon, ImageIcon, VideoIcon, PdfIcon, DownloadIcon, LockIcon } from "./icons";

export function PublicFileView({ token }: { token: string }) {
  const [meta, setMeta] = useState<PublicShareMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [file, setFile] = useState<PublicBrowseFileResult["file"] | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

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

  const loadFile = useCallback(async () => {
    setFileLoading(true);
    try {
      const data = await publicShareApi.browse(token);
      if (data.type === "file") setFile(data.file);
    } catch {
      /* erro tratado pelo estado de meta, que já cobre o link indisponível */
    } finally {
      setFileLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (meta?.unlocked) loadFile();
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

  function iconFor(mime: string) {
    const kind = fileKind(mime);
    if (kind === "image") return <ImageIcon size={40} />;
    if (kind === "video") return <VideoIcon size={40} />;
    if (kind === "pdf") return <PdfIcon size={40} />;
    return <FileIcon size={40} />;
  }

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
            <p className={styles.gateSubtitle}>Este arquivo é protegido por senha.</p>
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
              <button
                type="submit"
                className={`${driveStyles.btn} ${driveStyles.btnPrimary}`}
                disabled={unlocking}
                style={{ width: "100%" }}
              >
                Entrar
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const permissions = meta.permissions!;

  return (
    <div className={styles.shell}>
      <Brand />
      <div className={styles.card}>
        <div className={styles.singleFileCard}>
          <div className={styles.singleFileIcon}>{file ? iconFor(file.mime_type) : <FileIcon size={40} />}</div>
          <h1 className={styles.singleFileName}>{fileLoading ? "Carregando..." : file?.original_name ?? meta.name}</h1>
          {file && <p className={styles.singleFileMeta}>{formatBytes(file.size)}</p>}
          {permissions.allowDownload && file && (
            <a
              className={`${driveStyles.btn} ${driveStyles.btnPrimary}`}
              href={publicShareApi.downloadUrl(token)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <DownloadIcon size={15} /> Baixar arquivo
            </a>
          )}
        </div>
      </div>
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

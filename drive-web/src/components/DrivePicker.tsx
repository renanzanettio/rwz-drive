"use client";

import { useEffect, useState } from "react";
import { ApiError, filesApi, foldersApi, type FileItem, type FolderItem } from "@/lib/api-client";
import { FolderIcon } from "./icons";
import styles from "./MediaDialogs.module.css";

export function DrivePicker({ mode, onFolder, onImage, onCancel }: {
  mode: "folder" | "image";
  onFolder?: (folder: { id: string; name: string }) => void;
  onImage?: (file: FileItem) => void;
  onCancel: () => void;
}) {
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "Meu Drive" }]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const current = trail[trail.length - 1];
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([foldersApi.list(current.id), mode === "image" ? filesApi.list(current.id) : Promise.resolve({ files: [] })])
      .then(([a, b]) => { if (active) { setFolders(a.folders); setFiles(b.files.filter((f) => f.mime_type.startsWith("image/"))); } })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : "Não foi possível abrir a pasta."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [current.id, mode]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);
  return <div className={styles.overlay} onClick={onCancel}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={mode === "folder" ? "Escolher pasta" : "Escolher capa"}
      onClick={(event) => event.stopPropagation()}>
      <div className={styles.heading}><h2>{mode === "folder" ? "Escolher pasta" : "Escolher capa"}</h2>
        <button type="button" className={styles.button} onClick={onCancel}>Fechar</button></div>
      <nav className={styles.trail} aria-label="Caminho">{trail.map((folder, index) =>
        <button key={folder.id ?? "root"} type="button" disabled={index === trail.length - 1}
          onClick={() => setTrail(trail.slice(0, index + 1))}>{folder.name}</button>)}</nav>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loading ? <p role="status">Carregando…</p> : <div className={styles.pickerList}>
        {folders.map((folder) => <button type="button" key={folder.id} onClick={() => setTrail([...trail, { id: folder.id, name: folder.name }])}>
          <FolderIcon size={20} />{folder.name}<span>→</span></button>)}
        {files.map((file) => <button type="button" key={file.id} onClick={() => onImage?.(file)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={filesApi.streamUrl(file.id)} alt="" />{file.original_name}</button>)}
        {!folders.length && !files.length && <p>Nenhum item aqui.</p>}
      </div>}
      {mode === "folder" && <button type="button" className={styles.primary} disabled={!current.id || loading}
        onClick={() => current.id && onFolder?.({ id: current.id, name: current.name })}>Usar esta pasta</button>}
    </section>
  </div>;
}

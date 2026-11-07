"use client";

import { useEffect, useState } from "react";
import { ApiError, filesApi, foldersApi, storageApi, type FolderItem, type StorageUsage } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import styles from "./StoragePanel.module.css";

export function StoragePanel({ onOpenFolder }: { onOpenFolder: (id: string) => void }) {
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "Meu Drive" }]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [fileBytes, setFileBytes] = useState(0);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = trail[trail.length-1];
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([foldersApi.list(current.id),filesApi.list(current.id),storageApi.usage()])
      .then(([a,b,c]) => {
        if (!active) return;
        setFolders([...a.folders].sort((x,y) => (y.size_bytes ?? 0)-(x.size_bytes ?? 0)));
        setFileBytes(b.files.reduce((sum,file) => sum+file.size,0));
        setUsage(c);
      }).catch((err) => { if (active) setError(err instanceof ApiError ? err.message : "Não foi possível calcular o espaço."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [current.id]);
  const total = fileBytes + folders.reduce((sum,folder) => sum + (folder.size_bytes ?? 0),0);
  return <section className={styles.panel}>
    <p className={styles.eyebrow}>SEU ESPAÇO</p><h1>Armazenamento</h1>
    <p className={styles.subtitle}>{usage ? formatBytes(usage.usedBytes) + " usados de " + formatBytes(usage.quotaBytes) : "Calculando…"}</p>
    <nav className={styles.trail} aria-label="Pastas de armazenamento">{trail.map((folder,index) =>
      <button type="button" key={folder.id ?? "root"} disabled={index === trail.length-1}
        onClick={() => setTrail(trail.slice(0,index+1))}>{folder.name}</button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Calculando pastas…</p> : <>
      <div className={styles.total}><strong>{formatBytes(total)}</strong><span>nesta pasta e nas subpastas</span>
        {current.id && <button type="button" onClick={() => onOpenFolder(current.id!)}>Abrir no Drive</button>}</div>
      <ul className={styles.list}>{folders.map((folder) => <li key={folder.id}>
        <button type="button" onClick={() => setTrail([...trail,{ id:folder.id,name:folder.name }])}>
          <span>{folder.name}<small>{folder.file_count ?? 0} {folder.file_count === 1 ? "arquivo nesta pasta e subpastas" : "arquivos nesta pasta e subpastas"}</small></span><strong>{formatBytes(folder.size_bytes ?? 0)}</strong>
          <progress max={Math.max(1,total)} value={folder.size_bytes ?? 0} aria-label={"Espaço de "+folder.name} />
        </button></li>)}
        <li className={styles.direct}><span>Arquivos diretamente nesta pasta</span><strong>{formatBytes(fileBytes)}</strong></li>
      </ul>
    </>}
  </section>;
}

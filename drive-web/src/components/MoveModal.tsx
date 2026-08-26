"use client";

import { useEffect, useState } from "react";
import { foldersApi, type FolderItem } from "@/lib/api-client";
import { FolderIcon } from "./icons";
import styles from "@/app/drive/drive.module.css";

export function MoveModal({
  excludeFolderId,
  onMove,
  onCancel,
}: {
  /** Se estivermos movendo uma pasta, sua própria subárvore não deve ser navegável. */
  excludeFolderId?: string;
  onMove: (targetFolderId: string | null) => void;
  onCancel: () => void;
}) {
  const [stack, setStack] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "Meu Drive" }]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);

  const current = stack[stack.length - 1];

  useEffect(() => {
    setLoading(true);
    foldersApi
      .list(current.id)
      .then((res) => setFolders(res.folders.filter((f) => f.id !== excludeFolderId)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>Mover para...</h2>

        <div className={styles.breadcrumbs} style={{ marginBottom: 10 }}>
          {stack.map((s, idx) => (
            <span key={s.id ?? "root"} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {idx > 0 && <span>/</span>}
              <button
                className={styles.breadcrumbItem}
                onClick={() => setStack(stack.slice(0, idx + 1))}
                disabled={idx === stack.length - 1}
                style={idx === stack.length - 1 ? { color: "var(--text)" } : undefined}
              >
                {s.name}
              </button>
            </span>
          ))}
        </div>

        <div className={styles.moveList}>
          {loading && <div style={{ padding: 14, fontSize: 13, color: "var(--text-dim)" }}>Carregando...</div>}
          {!loading && folders.length === 0 && (
            <div style={{ padding: 14, fontSize: 13, color: "var(--text-faint)" }}>Nenhuma subpasta aqui.</div>
          )}
          {!loading &&
            folders.map((f) => (
              <div key={f.id} className={styles.moveRow} onClick={() => setStack([...stack, { id: f.id, name: f.name }])}>
                <FolderIcon size={16} />
                <span>{f.name}</span>
              </div>
            ))}
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onMove(current.id)}>
            Mover para "{current.name}"
          </button>
        </div>
      </div>
    </div>
  );
}

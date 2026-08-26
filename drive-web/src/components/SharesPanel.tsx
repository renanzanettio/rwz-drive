"use client";

import { useEffect, useState } from "react";
import styles from "@/app/drive/drive.module.css";
import { sharesApi, ApiError, type ShareItem } from "@/lib/api-client";
import { formatBytes, formatDate } from "@/lib/format";
import { FolderIcon, FileIcon, LinkIcon, LockIcon, EditIcon, TrashIcon, ClockIcon, ShareIcon } from "./icons";
import { ShareModal } from "./ShareModal";

const STATUS_LABEL: Record<ShareItem["displayStatus"], string> = {
  active: "Ativo",
  expired: "Expirado",
  revoked: "Revogado",
};

const STATUS_CLASS: Record<ShareItem["displayStatus"], string> = {
  active: "badgeActive",
  expired: "badgeExpired",
  revoked: "badgeRevoked",
};

export function SharesPanel({ notify }: { notify: (message: string, danger?: boolean) => void }) {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingShare, setEditingShare] = useState<ShareItem | null>(null);
  const [deletingShare, setDeletingShare] = useState<ShareItem | null>(null);
  const [deleteContentToo, setDeleteContentToo] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { shares } = await sharesApi.list();
      setShares(shares);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível carregar os compartilhamentos.", true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyLink(share: ShareItem) {
    const url = `${window.location.origin}${share.publicUrl}`;
    navigator.clipboard
      .writeText(url)
      .then(() => notify("Link copiado."))
      .catch(() => notify("Não foi possível copiar o link.", true));
  }

  async function toggleStatus(share: ShareItem) {
    try {
      const updated =
        share.displayStatus === "revoked" ? await sharesApi.reactivate(share.id) : await sharesApi.revoke(share.id);
      setShares((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      notify(share.displayStatus === "revoked" ? "Compartilhamento reativado." : "Compartilhamento revogado.");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível alterar o status.", true);
    }
  }

  async function confirmDelete() {
    if (!deletingShare) return;
    try {
      await sharesApi.remove(deletingShare.id, deleteContentToo);
      setShares((prev) => prev.filter((s) => s.id !== deletingShare.id));
      notify(deleteContentToo ? "Compartilhamento e conteúdo excluídos." : "Compartilhamento excluído.");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível excluir.", true);
    } finally {
      setDeletingShare(null);
      setDeleteContentToo(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, margin: "0 0 20px" }}>
        Compartilhamentos públicos
      </h1>

      {loading && <p style={{ color: "var(--text-dim)" }}>Carregando...</p>}

      {!loading && shares.length === 0 && (
        <div className={styles.emptySharesState}>
          <ShareIcon size={36} />
          <p style={{ marginTop: 12 }}>
            Nenhum compartilhamento ainda. Use "Compartilhar" no menu de uma pasta ou arquivo pra criar um link
            público.
          </p>
        </div>
      )}

      {!loading && shares.length > 0 && (
        <div className={styles.sharesList}>
          {shares.map((share) => (
            <div key={share.id} className={styles.shareRow}>
              <div className={styles.shareRowIcon}>
                {share.type === "folder" ? <FolderIcon size={22} /> : <FileIcon size={22} />}
              </div>

              <div className={styles.shareRowMain}>
                <div className={styles.shareRowName}>{share.name}</div>
                <div className={styles.shareRowMeta}>
                  <span className={`${styles.badge} ${styles[STATUS_CLASS[share.displayStatus]]}`}>
                    {STATUS_LABEL[share.displayStatus]}
                  </span>
                  {share.hasPassword && (
                    <span title="Protegido por senha">
                      <LockIcon size={13} />
                    </span>
                  )}
                  {share.expires_at && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <ClockIcon size={13} /> {formatDate(share.expires_at)}
                    </span>
                  )}
                  {share.max_total_size !== null && <span>até {formatBytes(share.max_total_size)}</span>}
                </div>
              </div>

              <div className={styles.shareRowActions}>
                <button className={styles.iconBtn} title="Copiar link" onClick={() => copyLink(share)}>
                  <LinkIcon size={16} />
                </button>
                <button className={styles.iconBtn} title="Editar" onClick={() => setEditingShare(share)}>
                  <EditIcon size={16} />
                </button>
                <button className={styles.btn} onClick={() => toggleStatus(share)}>
                  {share.displayStatus === "revoked" ? "Reativar" : "Revogar"}
                </button>
                <button className={styles.iconBtn} title="Excluir" onClick={() => setDeletingShare(share)}>
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingShare && (
        <ShareModal
          mode="edit"
          share={editingShare}
          onCancel={() => setEditingShare(null)}
          onSaved={(updated) => {
            setShares((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setEditingShare(null);
          }}
          notify={notify}
        />
      )}

      {deletingShare && (
        <div
          className={styles.overlay}
          onClick={() => {
            setDeletingShare(null);
            setDeleteContentToo(false);
          }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Excluir compartilhamento</h2>
            <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginBottom: 14 }}>
              O link de "{deletingShare.name}" deixará de funcionar.
            </p>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={deleteContentToo} onChange={(e) => setDeleteContentToo(e.target.checked)} />
              Excluir também {deletingShare.type === "folder" ? "a pasta e seu conteúdo" : "o arquivo"} do Drive
            </label>
            <div className={styles.modalActions} style={{ marginTop: 14 }}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  setDeletingShare(null);
                  setDeleteContentToo(false);
                }}
              >
                Cancelar
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={confirmDelete}>
                Excluir compartilhamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import styles from "@/app/drive/drive.module.css";
import {
  sharesApi,
  ApiError,
  type ShareItem,
  type ShareType,
  type ExpiredAction,
} from "@/lib/api-client";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/format";
import { LockIcon } from "./icons";

interface ShareModalProps {
  // Criação: passa type/targetId/targetName. Edição: passa share existente.
  mode: "create" | "edit";
  type?: ShareType;
  targetId?: string;
  targetName?: string;
  share?: ShareItem;
  onSaved: (share: ShareItem) => void;
  onCancel: () => void;
  notify: (message: string, danger?: boolean) => void;
}

function mbToBytes(mb: string): number | null {
  const n = Number(mb);
  return mb.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 1024 * 1024) : null;
}

function bytesToMb(bytes: number | null): string {
  return bytes !== null ? String(Math.round((bytes / (1024 * 1024)) * 100) / 100) : "";
}

export function ShareModal({ mode, type, targetId, targetName, share, onSaved, onCancel, notify }: ShareModalProps) {
  const effectiveType: ShareType = share?.type ?? type ?? "folder";

  const [name, setName] = useState(share?.name ?? targetName ?? "");
  const [hasExpiration, setHasExpiration] = useState(!!share?.expires_at);
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(share?.expires_at ?? null));
  const [expiredAction, setExpiredAction] = useState<ExpiredAction>(share?.expired_action ?? "make_private");
  const [password, setPassword] = useState("");
  const [allowView, setAllowView] = useState(share?.permissions.allow_view ?? true);
  const [allowDownload, setAllowDownload] = useState(share?.permissions.allow_download ?? true);
  const [allowUpload, setAllowUpload] = useState(share?.permissions.allow_upload ?? false);
  const [allowDelete, setAllowDelete] = useState(share?.permissions.allow_delete ?? false);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(bytesToMb(share?.max_file_size ?? null));
  const [maxTotalSizeMb, setMaxTotalSizeMb] = useState(bytesToMb(share?.max_total_size ?? null));
  const [maxFiles, setMaxFiles] = useState(share?.max_files !== null && share?.max_files !== undefined ? String(share.max_files) : "");
  const [saving, setSaving] = useState(false);
  const [passwordAction, setPasswordAction] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return;
    setSaving(true);

    try {
      const expiresAtIso = hasExpiration ? fromDatetimeLocalValue(expiresAt) : null;

      if (mode === "create") {
        const created = await sharesApi.create({
          type: effectiveType,
          target_id: targetId!,
          name,
          password: password.trim().length > 0 ? password : null,
          expires_at: expiresAtIso,
          expired_action: expiredAction,
          allow_view: allowView,
          allow_download: allowDownload,
          allow_upload: allowUpload,
          allow_delete: allowDelete,
          max_file_size: mbToBytes(maxFileSizeMb),
          max_total_size: mbToBytes(maxTotalSizeMb),
          max_files: maxFiles.trim() !== "" ? Number(maxFiles) : null,
        });
        notify("Compartilhamento criado.");
        onSaved(created);
      } else {
        const updated = await sharesApi.update(share!.id, {
          name,
          expires_at: expiresAtIso,
          expired_action: expiredAction,
          allow_view: allowView,
          allow_download: allowDownload,
          allow_upload: allowUpload,
          allow_delete: allowDelete,
          max_file_size: mbToBytes(maxFileSizeMb),
          max_total_size: mbToBytes(maxTotalSizeMb),
          max_files: maxFiles.trim() !== "" ? Number(maxFiles) : null,
        });
        notify("Compartilhamento atualizado.");
        onSaved(updated);
      }
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível salvar.", true);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordAction(remove: boolean) {
    if (!share) return;
    setPasswordAction(true);
    try {
      const updated = await sharesApi.setPassword(share.id, remove ? null : password);
      notify(remove ? "Senha removida." : "Senha atualizada.");
      setPassword("");
      onSaved(updated);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível alterar a senha.", true);
    } finally {
      setPasswordAction(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={`${styles.modal} ${styles.sharesModal}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>
          {mode === "create" ? "Criar compartilhamento" : "Editar compartilhamento"}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Nome público</label>
            <input className={styles.textInput} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className={styles.field}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={hasExpiration} onChange={(e) => setHasExpiration(e.target.checked)} />
              Definir expiração
            </label>
            {hasExpiration && (
              <>
                <input
                  type="datetime-local"
                  className={styles.textInput}
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  style={{ marginTop: 8, marginBottom: 8 }}
                />
                <select
                  className={styles.selectInput}
                  value={expiredAction}
                  onChange={(e) => setExpiredAction(e.target.value as ExpiredAction)}
                >
                  <option value="make_private">Ao expirar: tornar privada</option>
                  <option value="block_uploads">Ao expirar: bloquear uploads, manter downloads</option>
                  <option value="delete_content">Ao expirar: excluir conteúdo</option>
                </select>
              </>
            )}
          </div>

          <hr className={styles.sectionDivider} />
          <div className={styles.sectionTitle}>Permissões</div>

          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={allowView} onChange={(e) => setAllowView(e.target.checked)} />
            Visualizar
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
            Baixar arquivos
          </label>
          {effectiveType === "folder" && (
            <>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={allowUpload} onChange={(e) => setAllowUpload(e.target.checked)} />
                Permitir upload de visitantes
              </label>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={allowDelete} onChange={(e) => setAllowDelete(e.target.checked)} />
                Permitir exclusão por visitantes
              </label>
            </>
          )}

          {effectiveType === "folder" && (allowUpload || mode === "edit") && (
            <>
              <hr className={styles.sectionDivider} />
              <div className={styles.sectionTitle}>Limites de upload (opcional)</div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Tam. máx. por arquivo (MB)</label>
                  <input
                    className={styles.textInput}
                    type="number"
                    min="0"
                    value={maxFileSizeMb}
                    onChange={(e) => setMaxFileSizeMb(e.target.value)}
                    placeholder="sem limite"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Tam. máx. total (MB)</label>
                  <input
                    className={styles.textInput}
                    type="number"
                    min="0"
                    value={maxTotalSizeMb}
                    onChange={(e) => setMaxTotalSizeMb(e.target.value)}
                    placeholder="sem limite"
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Nº máx. de arquivos</label>
                <input
                  className={styles.textInput}
                  type="number"
                  min="0"
                  value={maxFiles}
                  onChange={(e) => setMaxFiles(e.target.value)}
                  placeholder="sem limite"
                />
              </div>
            </>
          )}

          <hr className={styles.sectionDivider} />
          <div className={styles.sectionTitle}>
            <LockIcon size={13} /> Senha {mode === "edit" && share?.hasPassword ? "(já definida)" : "(opcional)"}
          </div>
          <div className={styles.field}>
            <input
              className={styles.textInput}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "edit" ? "Digite pra trocar a senha" : "Deixe em branco pra não exigir senha"}
            />
            {mode === "edit" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={passwordAction || password.trim().length === 0}
                  onClick={() => handlePasswordAction(false)}
                >
                  Salvar senha
                </button>
                {share?.hasPassword && (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={passwordAction}
                    onClick={() => handlePasswordAction(true)}
                  >
                    Remover senha
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.modalActions}>
            <button type="button" className={styles.btn} onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {mode === "create" ? "Criar link" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

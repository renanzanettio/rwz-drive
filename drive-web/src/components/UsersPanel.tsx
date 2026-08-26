"use client";

import { useEffect, useState } from "react";
import styles from "@/app/drive/drive.module.css";
import { adminApi, ApiError, type UserSummary, type InviteItem } from "@/lib/api-client";
import { formatBytes, formatDate } from "@/lib/format";
import { UsersIcon, MailIcon, LinkIcon, TrashIcon, FolderIcon } from "./icons";
import { ConfirmModal } from "./Modals";

type Tab = "users" | "invites";

export function UsersPanel({
  notify,
  onViewAsUser,
}: {
  notify: (message: string, danger?: boolean) => void;
  onViewAsUser: (userId: string, username: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("users");

  const [users, setUsers] = useState<UserSummary[]>([]);
  const [globalDefaultQuota, setGlobalDefaultQuota] = useState(0);
  const [usersLoading, setUsersLoading] = useState(true);
  const [editingQuotaFor, setEditingQuotaFor] = useState<string | null>(null);
  const [quotaInput, setQuotaInput] = useState("");
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null);
  const [deletingInProgress, setDeletingInProgress] = useState(false);

  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [newInviteQuota, setNewInviteQuota] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const data = await adminApi.listUsers();
      setUsers(data.users);
      setGlobalDefaultQuota(data.globalDefaultQuotaBytes);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível carregar os usuários.", true);
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadInvites() {
    setInvitesLoading(true);
    try {
      const { invites } = await adminApi.listInvites();
      setInvites(invites);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível carregar os convites.", true);
    } finally {
      setInvitesLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveQuota(userId: string) {
    try {
      const mb = quotaInput.trim() === "" ? null : Number(quotaInput);
      if (mb !== null && (!Number.isFinite(mb) || mb <= 0)) {
        notify("Informe um número positivo de MB, ou deixe em branco pro padrão.", true);
        return;
      }
      await adminApi.updateUserQuota(userId, mb);
      notify("Cota atualizada.");
      setEditingQuotaFor(null);
      loadUsers();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível salvar a cota.", true);
    }
  }

  async function confirmDeleteUser() {
    if (!deletingUser) return;
    setDeletingInProgress(true);
    try {
      await adminApi.deleteUser(deletingUser.id);
      notify(`Conta de "${deletingUser.username}" excluída, junto com todos os arquivos dela.`);
      setUsers((prev) => prev.filter((u) => u.id !== deletingUser.id));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível excluir a conta.", true);
    } finally {
      setDeletingInProgress(false);
      setDeletingUser(null);
    }
  }

  async function createInvite() {
    setCreatingInvite(true);
    try {
      const mb = newInviteQuota.trim() === "" ? null : Number(newInviteQuota);
      const invite = await adminApi.createInvite(mb, null);
      notify("Convite criado.");
      setNewInviteQuota("");
      setInvites((prev) => [invite, ...prev]);
      copyInviteLink(invite);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível criar o convite.", true);
    } finally {
      setCreatingInvite(false);
    }
  }

  function copyInviteLink(invite: InviteItem) {
    const url = `${window.location.origin}${invite.inviteUrl}`;
    navigator.clipboard
      .writeText(url)
      .then(() => notify("Link de convite copiado."))
      .catch(() => notify("Não foi possível copiar o link.", true));
  }

  async function revokeInvite(invite: InviteItem) {
    try {
      await adminApi.revokeInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      notify("Convite revogado.");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível revogar.", true);
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>
        Usuários e convites
      </h1>
      <p style={{ color: "var(--text-faint)", fontSize: 13, margin: "0 0 20px" }}>
        Cadastro é fechado — novas contas só entram com um link de convite seu.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`${styles.btn} ${tab === "users" ? styles.btnPrimary : ""}`} onClick={() => setTab("users")}>
          <UsersIcon size={14} /> Usuários
        </button>
        <button className={`${styles.btn} ${tab === "invites" ? styles.btnPrimary : ""}`} onClick={() => setTab("invites")}>
          <MailIcon size={14} /> Convites
        </button>
      </div>

      {tab === "users" && (
        <>
          {usersLoading && <p style={{ color: "var(--text-dim)" }}>Carregando...</p>}

          {!usersLoading && (
            <div className={styles.sharesList}>
              {users.map((u) => {
                const pct = Math.min(100, Math.round((u.used_bytes / u.effective_quota_bytes) * 100));
                return (
                  <div key={u.id} className={styles.shareRow}>
                    <div className={styles.shareRowIcon}>
                      <UsersIcon size={22} />
                    </div>
                    <div className={styles.shareRowMain}>
                      <div className={styles.shareRowName}>
                        {u.username}
                        {u.role === "admin" && (
                          <span className={`${styles.badge} ${styles.badgeActive}`} style={{ marginLeft: 8 }}>
                            admin
                          </span>
                        )}
                      </div>
                      <div className={styles.shareRowMeta}>
                        <span>
                          {formatBytes(u.used_bytes)} de {formatBytes(u.effective_quota_bytes)} ({pct}%)
                        </span>
                        {u.storage_quota_bytes === null && <span>· cota padrão</span>}
                        <span>· desde {formatDate(u.created_at)}</span>
                      </div>

                      {editingQuotaFor === u.id && (
                        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                          <input
                            className={styles.textInput}
                            style={{ width: 140 }}
                            type="number"
                            min="0"
                            placeholder={`padrão: ${formatBytes(globalDefaultQuota)}`}
                            value={quotaInput}
                            onChange={(e) => setQuotaInput(e.target.value)}
                          />
                          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>MB</span>
                          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => saveQuota(u.id)}>
                            Salvar
                          </button>
                          <button className={styles.btn} onClick={() => setEditingQuotaFor(null)}>
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>

                    {u.role !== "admin" && (
                      <div className={styles.shareRowActions}>
                        <button
                          className={styles.btn}
                          onClick={() => {
                            setEditingQuotaFor(u.id);
                            setQuotaInput(u.storage_quota_bytes !== null ? String(Math.round(u.storage_quota_bytes / (1024 * 1024))) : "");
                          }}
                        >
                          Cota
                        </button>
                        <button className={styles.btn} onClick={() => onViewAsUser(u.id, u.username)}>
                          <FolderIcon size={14} /> Ver arquivos
                        </button>
                        <button className={styles.iconBtn} title="Excluir conta" onClick={() => setDeletingUser(u)}>
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "invites" && (
        <>
          <div className={styles.shareRow} style={{ marginBottom: 16 }}>
            <div className={styles.shareRowMain}>
              <div className={styles.fieldLabel} style={{ marginBottom: 8 }}>
                Novo convite — cota de armazenamento (MB, opcional)
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className={styles.textInput}
                  style={{ maxWidth: 200 }}
                  type="number"
                  min="0"
                  placeholder={`padrão: ${formatBytes(globalDefaultQuota)}`}
                  value={newInviteQuota}
                  onChange={(e) => setNewInviteQuota(e.target.value)}
                />
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={creatingInvite} onClick={createInvite}>
                  Criar convite
                </button>
              </div>
            </div>
          </div>

          {invitesLoading && <p style={{ color: "var(--text-dim)" }}>Carregando...</p>}

          {!invitesLoading && invites.length === 0 && (
            <div className={styles.emptySharesState}>
              <MailIcon size={32} />
              <p style={{ marginTop: 12 }}>Nenhum convite criado ainda.</p>
            </div>
          )}

          {!invitesLoading && invites.length > 0 && (
            <div className={styles.sharesList}>
              {invites.map((invite) => (
                <div key={invite.id} className={styles.shareRow}>
                  <div className={styles.shareRowIcon}>
                    <MailIcon size={20} />
                  </div>
                  <div className={styles.shareRowMain}>
                    <div className={styles.shareRowName}>
                      {invite.used_by ? (
                        <span className={`${styles.badge} ${styles.badgeRevoked}`}>Usado</span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeActive}`}>Disponível</span>
                      )}
                    </div>
                    <div className={styles.shareRowMeta}>
                      <span>
                        {invite.storage_quota_bytes !== null ? formatBytes(invite.storage_quota_bytes) : "cota padrão"}
                      </span>
                      <span>· criado {formatDate(invite.created_at)}</span>
                      {invite.used_at && <span>· usado {formatDate(invite.used_at)}</span>}
                    </div>
                  </div>
                  {!invite.used_by && (
                    <div className={styles.shareRowActions}>
                      <button className={styles.iconBtn} title="Copiar link" onClick={() => copyInviteLink(invite)}>
                        <LinkIcon size={16} />
                      </button>
                      <button className={styles.iconBtn} title="Revogar" onClick={() => revokeInvite(invite)}>
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {deletingUser && (
        <ConfirmModal
          title="Excluir conta"
          description={`Isso apaga a conta de "${deletingUser.username}" e TODOS os arquivos dela permanentemente (${formatBytes(
            deletingUser.used_bytes
          )} em uso). Não tem como desfazer.`}
          confirmLabel={deletingInProgress ? "Excluindo..." : "Excluir permanentemente"}
          danger
          onConfirm={confirmDeleteUser}
          onCancel={() => setDeletingUser(null)}
        />
      )}
    </div>
  );
}

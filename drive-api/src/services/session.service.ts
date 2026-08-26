import { db } from "../db";
import { env } from "../config/env";
import { uuid } from "../utils/uuid";

export interface Session {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

/**
 * A tabela `sessions` é a única fonte da verdade sobre login (spec §7 e
 * decisão do time): nada de sessão em memória do processo Node. Isso
 * garante que reiniciar o processo/celular não derruba usuários logados.
 */
export function createSession(userId: string, userAgent?: string, ip?: string): Session {
  const now = new Date();
  const expires = new Date(now.getTime() + env.sessionTtlDays * 24 * 60 * 60 * 1000);

  const session: Session = {
    id: uuid(),
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    user_agent: userAgent ?? null,
    ip: ip ?? null,
  };

  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip)
     VALUES (@id, @user_id, @created_at, @expires_at, @user_agent, @ip)`
  ).run(session as unknown as Record<string, string | null>);

  return session;
}

export function getValidSession(sessionId: string): Session | null {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as unknown as Session | undefined;

  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(sessionId);
    return null;
  }
  return session;
}

export function renewSession(sessionId: string): void {
  const expires = new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000);
  db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(
    expires.toISOString(),
    sessionId
  );
}

export function deleteSession(sessionId: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

export function deleteExpiredSessions(): number {
  const result = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(
    new Date().toISOString()
  );
  return Number(result.changes);
}

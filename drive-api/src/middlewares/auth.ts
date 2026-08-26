import type { NextFunction, Request, Response } from "express";
import cookie from "cookie";
import { SESSION_COOKIE_NAME } from "../config/constants";
import { getValidSession, renewSession } from "../services/session.service";
import { db } from "../db";

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      effectiveOwnerId?: string;
    }
  }
}

function extractSessionId(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  return parsed[SESSION_COOKIE_NAME] ?? null;
}

/**
 * Autenticação: garante que existe uma sessão válida.
 * Não confunde com autorização (isso é feito depois, por recurso — spec §8).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionId = extractSessionId(req);
  if (!sessionId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }

  const session = getValidSession(sessionId);
  if (!session) {
    res.status(401).json({ error: "Sessão inválida ou expirada." });
    return;
  }

  const user = db
    .prepare(`SELECT id, username, email, role FROM users WHERE id = ?`)
    .get(session.user_id) as unknown as AuthUser | undefined;

  if (!user) {
    res.status(401).json({ error: "Usuário não encontrado." });
    return;
  }

  // Renova a validade da sessão a cada uso (janela deslizante).
  renewSession(sessionId);

  req.user = user;
  req.sessionId = sessionId;
  next();
}

/** Exige que o usuário autenticado seja admin — usado nas rotas de gestão de convites/usuários. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Acesso restrito ao administrador." });
    return;
  }
  next();
}

/**
 * Resolve QUEM é o "dono" efetivo dos dados pra essa request. Normalmente é
 * o próprio usuário logado — mas se for admin E vier um `as_user_id` na
 * query, o admin está "olhando" o Drive de outro usuário (recurso do
 * painel de gestão). Um usuário comum nunca consegue usar esse parâmetro
 * pra ver dados de ninguém além de si mesmo — a checagem de role acontece
 * aqui, no servidor, não é uma opção que o cliente "escolhe".
 */
export function resolveEffectiveOwner(req: Request, res: Response, next: NextFunction): void {
  const asUserId = typeof req.query.as_user_id === "string" ? req.query.as_user_id : null;

  if (asUserId && req.user!.role === "admin") {
    const target = db.prepare(`SELECT id FROM users WHERE id = ?`).get(asUserId) as unknown as { id: string } | undefined;
    if (!target) {
      res.status(404).json({ error: "Usuário não encontrado." });
      return;
    }
    req.effectiveOwnerId = target.id;
  } else {
    req.effectiveOwnerId = req.user!.id;
  }

  next();
}

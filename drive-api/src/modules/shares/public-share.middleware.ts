import type { NextFunction, Request, Response } from "express";
import cookie from "cookie";
import { env } from "../../config/env";
import { HttpError } from "../../middlewares/errorHandler";
import {
  getShareByToken,
  getEffectivePermissions,
  isPublicSessionValid,
  type ShareRecord,
  type EffectivePermissions,
} from "./shares.service";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      share?: ShareRecord;
      shareEffective?: EffectivePermissions;
    }
  }
}

export function publicSessionCookieName(token: string): string {
  return `rwz_public_${token}`;
}

/**
 * Resolve o token da URL para um compartilhamento. Mensagem de erro
 * SEMPRE genérica — não existe, expirou e foi revogado retornam a mesma
 * resposta, de propósito, pra não dar sinal de "quase acertei o token" pra
 * quem estiver tentando adivinhar.
 */
export function resolveShare(req: Request, res: Response, next: NextFunction): void {
  const token = req.params.token;
  const share = token ? getShareByToken(token) : null;

  if (!share) {
    next(new HttpError(404, "Link indisponível."));
    return;
  }

  req.share = share;
  req.shareEffective = getEffectivePermissions(share);

  if (!req.shareEffective.allowView && !req.shareEffective.allowDownload && !req.shareEffective.allowUpload) {
    // Compartilhamento existe mas está revogado/expirado sem nenhuma
    // permissão residual (ex.: "tornar privada") — trata como inexistente.
    next(new HttpError(404, "Link indisponível."));
    return;
  }

  next();
}

/** Checagem pura (sem lançar erro) — usada tanto no middleware quanto na rota de metadados. */
export function isShareUnlocked(req: Request, share: ShareRecord): boolean {
  if (!share.password_hash) return true;

  const header = req.headers.cookie;
  const cookies = header ? cookie.parse(header) : {};
  const sessionId = cookies[publicSessionCookieName(share.token)];

  return !!sessionId && isPublicSessionValid(sessionId, share.id);
}

/** Exige que a pasta/arquivo tenha senha resolvida (ou não precise de senha). */
export function requireUnlocked(req: Request, res: Response, next: NextFunction): void {
  const share = req.share!;

  if (!isShareUnlocked(req, share)) {
    next(new HttpError(401, "Este link requer senha."));
    return;
  }

  next();
}

export function setPublicSessionCookie(res: Response, token: string, sessionId: string, expiresAt: string): void {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const serialized = cookie.serialize(publicSessionCookieName(token), sessionId, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  res.setHeader("Set-Cookie", serialized);
}

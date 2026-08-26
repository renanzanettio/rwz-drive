import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { logEvent } from "../utils/logger";

function handler(name: string) {
  return (req: any, res: any) => {
    logEvent("RATE_LIMIT_HIT", { route: name, ip: req.ip });
    res.status(429).json({ error: "Muitas tentativas. Tente novamente mais tarde." });
  };
}

// Limites razoáveis e configuráveis (spec §23) — nunca bloqueio permanente,
// apenas uma janela de tempo.
export const loginRateLimit = rateLimit({
  windowMs: env.rateLimit.loginWindowMin * 60 * 1000,
  max: env.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("login"),
});

export const registerRateLimit = rateLimit({
  windowMs: env.rateLimit.registerWindowMin * 60 * 1000,
  max: env.rateLimit.registerMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("register"),
});

export const uploadRateLimit = rateLimit({
  windowMs: env.rateLimit.uploadWindowMin * 60 * 1000,
  max: env.rateLimit.uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("upload"),
});

// ---------- Rotas públicas (compartilhamentos) ----------
// Separados dos limiters administrativos — um visitante abusando de um
// link público não deve conseguir esgotar a cota que protege o login admin,
// e vice-versa.

export const publicUnlockRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // tentativas de senha por IP a cada 15min — força bruta de senha de compartilhamento
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("public-unlock"),
});

export const publicBrowseRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // navegação/listagem é lida com frequência (troca de pasta, refresh), limite generoso
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("public-browse"),
});

export const publicUploadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("public-upload"),
});

export const publicDownloadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("public-download"),
});

import { Router } from "express";
import cookie from "cookie";
import { registerUser, verifyCredentials } from "./auth.service";
import { countUsers } from "../admin/invites.service";
import { createSession, deleteSession } from "../../services/session.service";
import { requireAuth } from "../../middlewares/auth";
import { loginRateLimit, registerRateLimit } from "../../middlewares/rateLimit";
import { SESSION_COOKIE_NAME } from "../../config/constants";
import { env } from "../../config/env";
import { logEvent } from "../../utils/logger";
import { HttpError } from "../../middlewares/errorHandler";

export const authRouter = Router();

function setSessionCookie(res: any, sessionId: string): void {
  const serialized = cookie.serialize(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: env.isProduction, // atrás do Cloudflare Tunnel a origem pública é HTTPS
    sameSite: "lax",
    path: "/",
    maxAge: env.sessionTtlDays * 24 * 60 * 60,
  });
  res.setHeader("Set-Cookie", serialized);
}

function clearSessionCookie(res: any): void {
  const serialized = cookie.serialize(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.setHeader("Set-Cookie", serialized);
}

// Informa ao frontend se o cadastro livre está disponível (só quando ainda
// não existe nenhuma conta) — evita mostrar o formulário de registro
// "aberto" pra quem só devia ver "cadastro por convite apenas".
authRouter.get("/registration-status", (req, res) => {
  res.json({ openRegistration: countUsers() === 0 });
});

authRouter.post("/register", registerRateLimit, async (req, res, next) => {
  try {
    const { username, password, email, invite_token } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      throw new HttpError(400, "username e password são obrigatórios.");
    }

    const user = await registerUser(
      username,
      password,
      typeof email === "string" ? email : undefined,
      typeof invite_token === "string" ? invite_token : null
    );
    const session = createSession(user.id, req.get("user-agent"), req.ip);
    setSessionCookie(res, session.id);

    logEvent("REGISTER_SUCCESS", { userId: user.id, username: user.username, role: user.role });
    res.status(201).json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", loginRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      throw new HttpError(400, "username e password são obrigatórios.");
    }

    const user = await verifyCredentials(username, password);
    if (!user) {
      logEvent("LOGIN_FAILED", { username, ip: req.ip });
      throw new HttpError(401, "Usuário ou senha inválidos.");
    }

    const session = createSession(user.id, req.get("user-agent"), req.ip);
    setSessionCookie(res, session.id);

    logEvent("LOGIN_SUCCESS", { userId: user.id, username: user.username });
    res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, (req, res, next) => {
  try {
    if (req.sessionId) {
      deleteSession(req.sessionId);
    }
    clearSessionCookie(res);
    logEvent("LOGOUT", { userId: req.user?.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

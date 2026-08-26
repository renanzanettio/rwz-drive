import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRouter } from "./modules/auth/auth.routes";
import { foldersRouter } from "./modules/folders/folders.routes";
import { filesRouter, storageRouter } from "./modules/files/files.routes";
import { searchRouter } from "./modules/search/search.routes";
import { sharesRouter } from "./modules/shares/shares.routes";
import { publicSharesRouter } from "./modules/shares/public-shares.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";

export const app = express();

// Necessário para que req.ip / X-Forwarded-Proto sejam confiáveis atrás do
// Cloudflare Tunnel + proxy do Next.js (spec §21).
if (env.trustProxy) {
  app.set("trust proxy", 1);
}

// CORS: origem explícita, nunca coringa (spec §24) — a API só deve ser
// chamada pelo Next.js (mesma origem no navegador) ou, em dev, diretamente
// pela origem configurada.
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" })); // uploads não passam por aqui (multipart via multer)

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/files", filesRouter);
app.use("/api/search", searchRouter);
app.use("/api/storage", storageRouter);
app.use("/api/shares", sharesRouter);
app.use("/api/admin", adminRouter);
// Rotas públicas: sem middleware de sessão admin, isoladas por token
// (spec §3, §13 — visitante nunca deve alcançar nada além do que foi
// explicitamente compartilhado).
app.use("/api/public/shares", publicSharesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

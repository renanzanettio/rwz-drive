import { app } from "./app";
import { env } from "./config/env";
import { runMigrations, db } from "./db";
import { deleteExpiredSessions } from "./services/session.service";
import { sweepExpiredShares, deleteExpiredPublicSessions } from "./modules/shares/shares.service";
import { recoverJams } from "./modules/jam/jam.service";
import { closeJamConnections } from "./modules/jam/jam.routes";

runMigrations();
recoverJams();

const server = app.listen(env.port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[drive-api] ouvindo em http://127.0.0.1:${env.port} (${env.nodeEnv})`);
});

// Limpeza periódica: sessões expiradas (privadas e públicas) + varredura de
// compartilhamentos expirados (aplica "tornar privada"/"excluir conteúdo"
// — o acesso em si já é bloqueado na hora, independente deste timer; ver
// getEffectivePermissions em shares.service.ts).
const cleanupInterval = setInterval(() => {
  const removed = deleteExpiredSessions();
  if (removed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[cleanup] ${removed} sessão(ões) expirada(s) removida(s)`);
  }

  const removedPublic = deleteExpiredPublicSessions();
  if (removedPublic > 0) {
    // eslint-disable-next-line no-console
    console.log(`[cleanup] ${removedPublic} sessão(ões) pública(s) expirada(s) removida(s)`);
  }

  const sweptShares = sweepExpiredShares();
  if (sweptShares > 0) {
    // eslint-disable-next-line no-console
    console.log(`[cleanup] ${sweptShares} compartilhamento(s) expirado(s) processado(s)`);
  }
}, 60 * 60 * 1000);

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`[drive-api] recebido ${signal}, encerrando...`);
  clearInterval(cleanupInterval);
  recoverJams();
  closeJamConnections();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

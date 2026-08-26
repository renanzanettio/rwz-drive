/**
 * Logger minimalista. Deliberadamente simples: o objetivo aqui não é
 * performance de logging, é garantir que NUNCA registramos senha, tokens,
 * cookies, credenciais ou conteúdo de arquivos (ver seção 26 da spec).
 */

type EventName =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "REGISTER_SUCCESS"
  | "LOGOUT"
  | "FILE_UPLOAD"
  | "FILE_DOWNLOAD"
  | "FILE_DELETE"
  | "FILE_RENAME"
  | "FILE_MOVE"
  | "FOLDER_CREATE"
  | "FOLDER_DELETE"
  | "FOLDER_RENAME"
  | "FOLDER_MOVE"
  | "SHARE_CREATE"
  | "SHARE_UPDATE"
  | "SHARE_REVOKE"
  | "SHARE_REACTIVATE"
  | "SHARE_DELETE"
  | "SHARE_UNLOCK_SUCCESS"
  | "SHARE_UNLOCK_FAILED"
  | "INVITE_CREATE"
  | "INVITE_REVOKE"
  | "USER_DELETE"
  | "RATE_LIMIT_HIT"
  | "UNHANDLED_ERROR";

export function logEvent(event: EventName, details: Record<string, unknown> = {}): void {
  const safeDetails = { ...details };
  // Camada extra de proteção: remove campos sensíveis mesmo se alguém
  // acidentalmente passar um deles.
  for (const key of ["password", "password_hash", "token", "cookie", "session", "secret"]) {
    delete safeDetails[key];
  }
  const line = {
    ts: new Date().toISOString(),
    event,
    ...safeDetails,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export function logError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ts: new Date().toISOString(), event: "ERROR", context, message, stack }));
}

/**
 * Quando o admin clica em "Ver arquivos" no painel de usuários, esse estado
 * guarda qual usuário está sendo visualizado. Toda chamada de API passa a
 * incluir `as_user_id` automaticamente — o servidor decide, com base no
 * `role` da sessão real, se aceita isso ou ignora (nunca é o cliente quem
 * decide; ver `resolveEffectiveOwner` no backend).
 */

let impersonatingUserId: string | null = null;
let impersonatingUsername: string | null = null;

export function setImpersonation(userId: string, username: string): void {
  impersonatingUserId = userId;
  impersonatingUsername = username;
}

export function clearImpersonation(): void {
  impersonatingUserId = null;
  impersonatingUsername = null;
}

export function getImpersonation(): { userId: string; username: string } | null {
  return impersonatingUserId ? { userId: impersonatingUserId, username: impersonatingUsername! } : null;
}

/** Adiciona `as_user_id` a um caminho de API, se estiver personificando alguém. */
export function withImpersonation(path: string): string {
  if (!impersonatingUserId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}as_user_id=${encodeURIComponent(impersonatingUserId)}`;
}

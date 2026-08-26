import bcrypt from "bcryptjs";
import { db } from "../../db";
import { uuid } from "../../utils/uuid";
import { HttpError } from "../../middlewares/errorHandler";
import { ensureUserDir } from "../../services/storage.service";
import { countUsers, validateInviteForRegistration, consumeInvite } from "../admin/invites.service";

const BCRYPT_ROUNDS = 12;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

// Hash "fantasma" válido, pré-computado, usado só para equalizar o tempo de
// resposta quando o usuário não existe (mitigação simples de timing attack).
// Não corresponde a nenhuma senha real.
const DUMMY_HASH = bcrypt.hashSync("rwz-drive-dummy-password", BCRYPT_ROUNDS);

export type UserRole = "admin" | "user";

export interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: UserRole;
  storage_quota_bytes: number | null;
  created_at: string;
  updated_at: string;
}

function validateUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, "Nome de usuário inválido (use 3-32 caracteres: letras, números, . _ -).");
  }
}

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "A senha deve ter pelo menos 8 caracteres.");
  }
  if (password.length > 512) {
    throw new HttpError(400, "Senha excede o tamanho máximo permitido.");
  }
}

/**
 * Cadastro trancado: só a PRIMEIRA conta do sistema se registra livremente
 * (e vira admin automaticamente). Qualquer conta depois disso exige um
 * convite válido, criado pelo admin — sem convite, sem cadastro (spec do
 * "acesso restrito" pedida pelo dono do sistema).
 */
export async function registerUser(
  username: string,
  password: string,
  email: string | undefined,
  inviteToken: string | null
): Promise<UserRecord> {
  validateUsername(username);
  validatePassword(password);

  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  if (existing) {
    throw new HttpError(409, "Nome de usuário já está em uso.");
  }

  const isFirstUser = countUsers() === 0;
  let role: UserRole = "user";
  let storageQuotaBytes: number | null = null;
  let invite: ReturnType<typeof validateInviteForRegistration> | null = null;

  if (isFirstUser) {
    role = "admin";
  } else {
    if (!inviteToken) {
      throw new HttpError(403, "Cadastro disponível apenas por convite.");
    }
    invite = validateInviteForRegistration(inviteToken);
    storageQuotaBytes = invite.storage_quota_bytes;
  }

  // Senha NUNCA é armazenada em texto puro (spec §6) — bcryptjs escolhido
  // no lugar do Argon2id por compatibilidade nativa com o ambiente Termux
  // (Argon2 exige compilação de binário nativo que não roda de forma
  // confiável quando o build é feito em outra plataforma).
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const now = new Date().toISOString();
  const user: UserRecord = {
    id: uuid(),
    username,
    email: email ?? null,
    password_hash: passwordHash,
    role,
    storage_quota_bytes: storageQuotaBytes,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, storage_quota_bytes, created_at, updated_at)
     VALUES (@id, @username, @email, @password_hash, @role, @storage_quota_bytes, @created_at, @updated_at)`
  ).run(user as unknown as Record<string, string | number | null>);

  await ensureUserDir(user.id);

  if (invite) {
    consumeInvite(invite.id, user.id);
  }

  return user;
}

export async function verifyCredentials(username: string, password: string): Promise<UserRecord | null> {
  const user = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as unknown as
    | UserRecord
    | undefined;

  if (!user) {
    // Ainda assim executa um compare para não vazar, por tempo de resposta,
    // se o usuário existe ou não (mitigação básica de timing attack).
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  return valid ? user : null;
}

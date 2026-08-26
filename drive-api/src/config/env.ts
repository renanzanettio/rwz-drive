import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true";
}

const rootDir = path.resolve(__dirname, "..", "..");

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: optionalInt("PORT", 3011),

  databasePath: path.resolve(rootDir, process.env.DATABASE_PATH ?? "../data/rwz-drive.db"),
  storagePath: path.resolve(rootDir, process.env.STORAGE_PATH ?? "../storage"),

  sessionSecret: process.env.NODE_ENV === "production" ? required("SESSION_SECRET") : (process.env.SESSION_SECRET ?? "dev-only-secret"),
  sessionTtlDays: optionalInt("SESSION_TTL_DAYS", 7),

  corsOrigin: process.env.CORS_ORIGIN ?? "http://127.0.0.1:3010",

  storageQuotaBytes: optionalInt("STORAGE_QUOTA_GB", 30) * 1024 * 1024 * 1024,

  uploadMaxFileSizeBytes: optionalInt("UPLOAD_MAX_FILE_SIZE_MB", 2048) * 1024 * 1024,
  uploadMaxFilesPerRequest: optionalInt("UPLOAD_MAX_FILES_PER_REQUEST", 10),
  uploadMaxRequestSizeBytes: optionalInt("UPLOAD_MAX_REQUEST_SIZE_MB", 4096) * 1024 * 1024,

  rateLimit: {
    loginWindowMin: optionalInt("RATE_LIMIT_LOGIN_WINDOW_MIN", 15),
    loginMax: optionalInt("RATE_LIMIT_LOGIN_MAX", 10),
    registerWindowMin: optionalInt("RATE_LIMIT_REGISTER_WINDOW_MIN", 60),
    registerMax: optionalInt("RATE_LIMIT_REGISTER_MAX", 5),
    uploadWindowMin: optionalInt("RATE_LIMIT_UPLOAD_WINDOW_MIN", 1),
    uploadMax: optionalInt("RATE_LIMIT_UPLOAD_MAX", 30),
  },

  trustProxy: optionalBool("TRUST_PROXY", true),
};

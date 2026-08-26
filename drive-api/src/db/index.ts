import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "../config/env";

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

/**
 * Usamos o módulo `node:sqlite`, embutido no próprio Node.js (disponível
 * sem flag desde a v22.13), no lugar de `better-sqlite3`.
 *
 * Isso elimina TODA dependência de compilação nativa do backend — não só o
 * hashing de senha (por isso já usávamos bcryptjs), mas agora também o
 * banco. `better-sqlite3` exige um binário `.node` pré-compilado ou
 * compilação local via node-gyp (que por sua vez exige Visual Studio Build
 * Tools no Windows, ou toolchain de compilação no Termux) — problema que
 * apareceu na prática tanto no Windows (Node muito recente sem prebuild
 * disponível) quanto era o risco antecipado para o Termux.
 *
 * `node:sqlite` remove essa classe inteira de problema: mesmo binário do
 * Node, mesmo comportamento, em qualquer SO/arquitetura suportada pelo
 * próprio runtime.
 */
export const db = new DatabaseSync(env.databasePath);

// WAL: permite leitura concorrente durante escrita — essencial aqui, já que
// upload/download/listagem podem acontecer ao mesmo tempo (ver decisão da spec §27/§28).
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA synchronous = NORMAL;");

/**
 * Substitui o helper `db.transaction()` do better-sqlite3, que não existe
 * no node:sqlite. Diferente daquele, este helper NÃO suporta chamadas
 * aninhadas (nested) — se `fn` chamar outra função também envolvida em
 * `runInTransaction`, o SQLite vai rejeitar o `BEGIN` duplicado. Nos
 * lugares onde isso importava (ex.: exclusão recursiva de pastas), a
 * recursão foi reescrita como uma função "crua" chamada uma única vez de
 * dentro de um `runInTransaction` no nível mais externo.
 */
export function runInTransaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function runMigrations(): void {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as unknown as { name: string }[]).map((r) => r.name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    runInTransaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString()
      );
    });
    // eslint-disable-next-line no-console
    console.log(`[migrations] aplicada: ${file}`);
  }
}

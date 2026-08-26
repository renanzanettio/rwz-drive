-- Compartilhamentos públicos (pastas ou arquivos individuais).
--
-- Decisão de segurança: o TOKEN fica em texto puro no banco (não hash),
-- porque o painel admin precisa conseguir mostrar/copiar o link a qualquer
-- momento depois de criado (spec §10 — "Copiar link" é uma ação recorrente,
-- não algo mostrado uma única vez). Isso é aceitável porque o token É o
-- próprio link público por definição — ele não protege nada que o
-- compartilhamento já não exponha a quem tem a URL. Quem realmente precisa
-- de proteção é a SENHA (essa sim, sempre hash, nunca texto puro).
--
-- target_id aponta para folders.id ou files.id dependendo de "type" — é
-- polimórfico de propósito, então não tem FK direta; a validação de posse
-- (pertence ao owner_id, existe, não foi excluído) é sempre feita em
-- código, nunca assumida pelo schema.
CREATE TABLE IF NOT EXISTS public_shares (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('folder','file')),
  target_id         TEXT NOT NULL,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  token             TEXT NOT NULL,
  password_hash     TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at        TEXT,
  expired_action    TEXT NOT NULL DEFAULT 'make_private' CHECK (expired_action IN ('make_private','delete_content','block_uploads')),
  allow_view        INTEGER NOT NULL DEFAULT 1,
  allow_download    INTEGER NOT NULL DEFAULT 1,
  allow_upload      INTEGER NOT NULL DEFAULT 0,
  allow_delete      INTEGER NOT NULL DEFAULT 0,
  max_file_size     INTEGER,
  max_total_size    INTEGER,
  max_files         INTEGER,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_shares_token ON public_shares(token);
CREATE INDEX IF NOT EXISTS idx_public_shares_owner ON public_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_public_shares_target ON public_shares(type, target_id);
CREATE INDEX IF NOT EXISTS idx_public_shares_status ON public_shares(status);

-- Sessão de acesso público: só existe pra compartilhamentos com senha (a
-- forma de "lembrar" que o visitante já digitou a senha certa, sem pedir de
-- novo a cada request). Mesmo padrão da tabela `sessions` privada: fonte da
-- verdade em SQLite, nunca em memória do processo.
CREATE TABLE IF NOT EXISTS public_share_sessions (
  id           TEXT PRIMARY KEY,
  share_id     TEXT NOT NULL REFERENCES public_shares(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_share_sessions_share ON public_share_sessions(share_id);
CREATE INDEX IF NOT EXISTS idx_public_share_sessions_expires ON public_share_sessions(expires_at);

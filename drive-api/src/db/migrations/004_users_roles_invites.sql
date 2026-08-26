-- Papel do usuário (admin vs comum) e cota de armazenamento individual
-- (NULL = usa o padrão global STORAGE_QUOTA_GB do .env).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user'));
ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER;

-- Promove o usuário mais antigo já cadastrado a admin. Cobre tanto uma
-- instalação nova (o primeiro registro vira admin no próprio fluxo de
-- registro, mas essa migration garante consistência mesmo se rodar antes
-- disso por algum motivo) quanto uma instalação já existente sendo
-- atualizada (o admin "de fato" que já estava usando o app vira o admin
-- "oficial" automaticamente, sem precisar de nenhuma ação manual).
UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);

-- Convites: única forma de criar conta além da primeira (que vira admin
-- automaticamente). Token em texto puro (mesma decisão já tomada para o
-- token de compartilhamento público — é o próprio link, precisa ser
-- reexibido/copiado no painel; ver comentário em public_shares).
CREATE TABLE IF NOT EXISTS invites (
  id                   TEXT PRIMARY KEY,
  token                TEXT NOT NULL,
  created_by           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_quota_bytes  INTEGER,
  expires_at           TEXT,
  used_by              TEXT REFERENCES users(id),
  used_at              TEXT,
  created_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by);

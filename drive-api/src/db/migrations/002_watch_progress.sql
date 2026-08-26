-- Progresso de reprodução de vídeo, por usuário + arquivo. Como fica no
-- banco central (não no navegador/localStorage), qualquer dispositivo
-- logado na mesma conta já enxerga a mesma posição automaticamente — a
-- sincronia entre aparelhos é consequência direta de onde o dado mora, não
-- precisa de nenhum mecanismo extra de "sync".
CREATE TABLE IF NOT EXISTS watch_progress (
  file_id           TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_seconds  REAL NOT NULL,
  duration_seconds  REAL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_progress_owner ON watch_progress(owner_id);

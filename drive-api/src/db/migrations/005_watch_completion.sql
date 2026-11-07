-- O histórico existente continua válido. Conclusões anteriores à atualização
-- não podem ser recuperadas porque a versão antiga removia essas entradas.
ALTER TABLE watch_progress ADD COLUMN completed_at TEXT;

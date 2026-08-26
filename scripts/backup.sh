#!/data/data/com.termux/files/usr/bin/bash
#
# Backup do RWZ Drive: banco de dados (via cópia online, segura mesmo com o
# servidor rodando em WAL mode) + arquivos de storage, compactados com data.
# Mantém as últimas N execuções e descarta o resto.
#
# Uso: ./scripts/backup.sh
# Agendar (opcional) via cron do Termux (pacote `cronie`) ou rodar manualmente.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"
STORAGE_DIR="$PROJECT_DIR/storage"
BACKUP_DIR="${RWZ_BACKUP_DIR:-$HOME/storage/shared/RWZDrive_Backups}"  # via termux-setup-storage
KEEP_LAST="${RWZ_BACKUP_KEEP:-5}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$BACKUP_DIR/$TIMESTAMP"

mkdir -p "$DEST"

echo "[backup] iniciando em $DEST"

# 1) Backup do SQLite: usa o comando ".backup" do próprio sqlite3, que é
#    seguro para rodar com o banco em uso (WAL mode) sem corromper nada.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA_DIR/rwz-drive.db" ".backup '$DEST/rwz-drive.db'"
  echo "[backup] banco de dados copiado."
else
  echo "[backup] AVISO: sqlite3 CLI não encontrado (pkg install sqlite), copiando arquivo diretamente (menos seguro com o servidor rodando)."
  cp "$DATA_DIR/rwz-drive.db" "$DEST/rwz-drive.db"
fi

# 2) Storage: compactado para economizar espaço.
tar -czf "$DEST/storage.tar.gz" -C "$PROJECT_DIR" storage
echo "[backup] storage compactado."

# 3) Rotação: mantém só os N backups mais recentes.
cd "$BACKUP_DIR"
ls -1t | tail -n +$((KEEP_LAST + 1)) | while read -r old; do
  echo "[backup] removendo backup antigo: $old"
  rm -rf "${BACKUP_DIR:?}/$old"
done

echo "[backup] concluído: $DEST"

#!/data/data/com.termux/files/usr/bin/bash
#
# Chamado automaticamente pelo Termux:Boot quando o celular liga.
# Instale o app "Termux:Boot" (F-Droid/Play) e coloque um symlink ou cópia
# deste arquivo em ~/.termux/boot/boot.sh (veja docs/TERMUX.md).

set -euo pipefail

LOG_FILE="$HOME/boot.log"
PROJECT_DIR="$HOME/rwz-drive"   # ajuste se o projeto estiver em outro caminho

echo "[$(date -Iseconds)] boot.sh iniciado" >> "$LOG_FILE"

# Evita que o Android suspenda a CPU e mate o processo em background —
# essencial para o servidor continuar rodando com a tela apagada (spec §33).
termux-wake-lock
echo "[$(date -Iseconds)] wake-lock adquirido" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# Se o cloudflared estiver instalado e configurado como serviço próprio do
# Termux (recomendado), ele deve iniciar por conta própria. Caso contrário,
# descomente a linha abaixo para subir o túnel manualmente:
# nohup cloudflared tunnel run rwz-drive >> "$HOME/cloudflared.log" 2>&1 &

# Sobe (ou religa) os processos gerenciados pelo PM2.
if pm2 list | grep -q "drive-api\|drive-web"; then
  pm2 resurrect >> "$LOG_FILE" 2>&1 || pm2 start ecosystem.config.js >> "$LOG_FILE" 2>&1
else
  pm2 start ecosystem.config.js >> "$LOG_FILE" 2>&1
fi

echo "[$(date -Iseconds)] boot.sh concluído" >> "$LOG_FILE"

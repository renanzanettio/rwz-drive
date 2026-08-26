# Operação — RWZ Drive

Guia rápido do dia a dia. Para o setup inicial no celular, veja `TERMUX.md`.

## Migrando de um deploy antigo (S21 Drive → RWZ Drive)

Se você já tem uma instalação rodando com o nome antigo (pasta `~/s21-drive`),
a troca de nome não exige reinstalar nada — é só renomear a pasta e reiniciar:

```bash
pm2 stop all
mv ~/s21-drive ~/rwz-drive
cd ~/rwz-drive
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

Detalhe: o cookie de sessão mudou de nome internamente (`s21_session` →
`rwz_session`), então todo mundo vai precisar logar de novo uma vez — sem
perda de dados, é só o cookie antigo que fica inválido.

Se o `scripts/boot.sh` estava referenciado via symlink em
`~/.termux/boot/boot.sh`, ele aponta para o caminho relativo dentro da
própria pasta, então continua funcionando sem ajuste — mas confira com
`cat ~/.termux/boot/boot.sh` se por algum motivo o caminho tiver sido escrito
como absoluto.

## Iniciar / parar

```bash
cd ~/rwz-drive
pm2 start ecosystem.config.js   # primeira vez
pm2 restart all                 # depois de um `git pull` ou mudança de código
pm2 stop all
pm2 delete all                  # remove os processos da lista do PM2
```

## Ver logs

```bash
pm2 logs                 # logs ao vivo dos dois processos
pm2 logs drive-api        # só a API
pm2 logs drive-web        # só o frontend
pm2 status                # visão geral (uptime, restarts, memória)
```

Os arquivos de log ficam em `~/rwz-drive/logs/`.

## Atualizar o código

**`drive-api`**:

```bash
cd ~/rwz-drive/drive-api
git pull                # se estiver usando git
npm install
npm run build
pm2 restart drive-api
```

**`drive-web` (build no PC, deploy standalone)** — não tem dependência
nativa, então o build roda no computador e só o resultado é copiado:

```bash
# No PC
cd drive-web
npm install
npm run build

# Copiar para o celular (FileZilla/scp/rsync):
#   drive-web/.next/standalone/          -> ~/rwz-drive/drive-web/.next/standalone/
#   drive-web/.next/static/  (conteúdo)  -> ~/rwz-drive/drive-web/.next/standalone/.next/static/

# No celular, depois de copiar:
pm2 restart drive-web
```

Detalhes completos do porquê e do passo a passo em `TERMUX.md` (seção
"Build no PC / deploy standalone").

## Verificar que está tudo no ar

```bash
curl http://127.0.0.1:3011/health     # deve responder {"status":"ok"}
curl -I http://127.0.0.1:3010         # deve responder 200/307
```

De fora, acesse a URL pública do Cloudflare Tunnel normalmente.

## Backup manual

```bash
./scripts/backup.sh
```

Por padrão salva em `~/storage/shared/RWZDrive_Backups/<timestamp>/`
(requer `termux-setup-storage` já configurado) e mantém os últimos 5
backups. Ajustável via `RWZ_BACKUP_DIR` e `RWZ_BACKUP_KEEP`.

## Ajustar a quota de armazenamento

Edite `drive-api/.env`:

```
STORAGE_QUOTA_GB=30
```

Depois:

```bash
pm2 restart drive-api
```

## Trocar a porta, TTL de sessão, limites de upload etc.

Tudo fica em `drive-api/.env` — veja `.env.example` para a lista completa
de variáveis com comentários. Depois de editar, sempre `pm2 restart drive-api`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| App para de responder depois de um tempo com a tela apagada | `termux-wake-lock` não foi adquirido | Rode `termux-wake-lock` manualmente e confira `~/boot.log` |
| Erro de login "argon2"/binário nativo | Não deveria mais acontecer (projeto usa bcryptjs) | Confirme que está usando o código deste repositório |
| Upload falha com 413 | Quota de armazenamento atingida | Ajuste `STORAGE_QUOTA_GB` ou libere espaço apagando arquivos |
| `Could not locate the bindings file` / erro de binário nativo do banco | Não deveria mais acontecer (projeto usa `node:sqlite`, embutido no Node, não `better-sqlite3`) | Confirme que está usando o código deste repositório e que o Node é ≥ 22.5 |
| Túnel Cloudflare não conecta | `cloudflared` não está rodando ou credenciais expiradas | `cloudflared tunnel login` novamente, revisar `TERMUX.md` |
| Vídeo não dá play/continua carregando | Range Requests bloqueadas por algum proxy no meio | Confirme que nada entre o Cloudflare e o Next.js remove o header `Range` |
| `next build` trava ou o Termux mata o processo | Webpack build é pesado, RAM insuficiente no aparelho | Buildar no PC e copiar `.next/standalone` — ver `TERMUX.md` |
| `drive-web` não sobe (`pm2 status` = errored) | Faltou copiar `.next/static` pra dentro de `.next/standalone/.next/static` | Revisar passo de cópia em `TERMUX.md`; conferir `pm2 logs drive-web` |
| Porta em conflito com outro app no PM2 | Outro serviço já usa 3010/3011 | Ajustar `PORT` no `.env` da API e no bloco `env` do `drive-web` em `ecosystem.config.js` |
| `ENOENT ... dist/db/migrations` ao rodar `node dist/server.js` | `tsc` só compila `.ts`, não copia os `.sql` das migrations | Já corrigido: `npm run build` agora roda `copy-assets` depois do `tsc`. Se acontecer de novo, rode `npm run build` (não só `tsc`) |
| Upload falha com `ERR_PACKAGE_PATH_NOT_EXPORTED` mencionando `file-type` | O pacote `file-type` a partir da v17 é ESM-only e é frágil pra carregar via `require`/`import()` dinâmico dependendo do Node/ambiente | Já corrigido: o projeto usa `file-type@16.5.4` (a última versão totalmente CJS), importado normalmente no topo do arquivo — sem import dinâmico |

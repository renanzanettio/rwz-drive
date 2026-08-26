# Setup no Termux (Android) — RWZ Drive

Este guia cobre a parte que a especificação original identificou como o
maior risco prático do projeto: rodar tudo dentro do Termux, no próprio
Samsung S21 FE.

## 1. Pacotes base

```bash
pkg update && pkg upgrade
pkg install nodejs git sqlite openssh cronie
npm install -g pnpm pm2
```

> **Importante sobre a versão do Node**: este projeto usa o módulo
> `node:sqlite`, embutido no Node.js a partir da v22 (sem flag desde a
> v22.13). Isso elimina qualquer necessidade de compilar módulo nativo
> pro banco de dados — mas exige Node **22.5 ou mais recente**. Confira com
> `node -v` depois de instalar; se o pacote `nodejs` do Termux vier com uma
> versão mais antiga, use `pkg install nodejs-lts` e confira de novo (o LTS
> do Termux normalmente já acompanha versões recentes o suficiente).

## 2. Termux:Boot (iniciar sozinho quando o celular ligar)

1. Instale o app **Termux:Boot** (F-Droid é a fonte recomendada; a versão
   da Play Store costuma ficar desatualizada).
2. Abra o Termux:Boot uma vez (só para o Android registrar a permissão).
3. Crie a pasta de boot e aponte para o script do projeto:

```bash
mkdir -p ~/.termux/boot
ln -s ~/rwz-drive/scripts/boot.sh ~/.termux/boot/boot.sh
```

4. Nas configurações do Android, **desative a otimização de bateria** para
   o Termux e para o Termux:Boot (Configurações → Apps → Termux → Bateria →
   Irrestrito). Sem isso, o Android pode matar o processo mesmo com
   `termux-wake-lock` ativo.
5. Reinicie o celular uma vez para testar. Depois, confira:

```bash
cat ~/boot.log
pm2 status
```

## 2.1. Portas usadas neste projeto

Se o celular já roda outros serviços via PM2 (ex.: outro app ocupando
3000/3001/3002), o RWZ Drive usa por padrão:

- `drive-api` → **3011** (`drive-api/.env` → `PORT`)
- `drive-web` → **3010** (via `PORT` no ambiente do PM2 / `.env`)

Ajuste livremente em `drive-api/.env` (`PORT`, `CORS_ORIGIN`) e no bloco
`env` do app `drive-web` em `ecosystem.config.js`, mantendo os dois
consistentes com `CORS_ORIGIN` e `API_INTERNAL_URL`. No `cloudflared`,
aponte o `ingress` para a porta do `drive-web` (3010 por padrão).

## 3. Clonando e instalando o projeto

**Importante:** instale as dependências direto no celular (não copie uma
pasta `node_modules` gerada no computador). Diferente de versões
anteriores deste projeto, hoje o `drive-api` **não tem nenhuma dependência
com binário nativo** — `bcryptjs` é JS puro e o banco usa `node:sqlite`,
embutido no próprio Node — então o `npm install` aqui deve ser rápido e
sem risco de falha de compilação. Mesmo assim, o hábito de instalar no
próprio dispositivo continua sendo a prática correta (evita qualquer
dependência transitiva futura assumir isso).

```bash
cd ~
git clone <url-do-seu-repositorio> rwz-drive
cd rwz-drive

cd drive-api
cp .env.example .env
# edite .env: gere um SESSION_SECRET aleatório, ajuste STORAGE_QUOTA_GB etc.
npm install
npm run build
cd ..

cd drive-web
cp .env.example .env
npm install
npm run build
cd ..
```

> **Se o `next build` travar, ficar horas rodando ou o Termux matar o
> processo (OOM)** — comum em celulares com pouca RAM livre, já que o
> webpack build do Next.js é pesado — não insista tentando buildar no
> aparelho. Pule direto para a seção **"Build no PC / deploy standalone"**
> logo abaixo. É a forma recomendada para este projeto, não um workaround
> improvisado. (Isso é específico do `drive-web` — o `drive-api` não usa
> webpack e o `npm install` dele deve ser rápido, sem compilação nativa.)

## 3.1. Build no PC / deploy standalone (recomendado para o `drive-web`)

O `next.config.js` já está configurado com `output: "standalone"`. Isso faz
o `next build` gerar uma pasta autocontida (`.next/standalone/`) com um
`server.js` mínimo e só os módulos realmente usados — sem depender do
`node_modules` completo nem do comando `next start` no destino.

Como o `drive-web` **não tem nenhuma dependência nativa** (diferente da
API), o resultado desse build é portável entre plataformas: pode compilar
no PC (Windows/Linux/Mac) e rodar o `server.js` gerado direto no Termux com
`node`, sem recompilar nada lá. É exatamente o fluxo que vocês já estavam
fazendo na prática — a diferença é copiar a pasta certa e rodar do jeito
certo.

Nota sobre deploy no mobile:
Caso o build do drive-web seja executado no PC e posteriormente enviado para o mobile, e os estilos não sejam carregados corretamente, é necessário copiar:

.next/static/ → .next/standalone/.next/static/
public/ → .next/standalone/public/

Isso é necessário porque o build standalone do Next.js não inclui automaticamente esses arquivos no diretório standalone.

**No PC:**

```bash
cd drive-web
cp .env.example .env      # ajuste API_INTERNAL_URL se necessário
npm install
npm run build
```

Isso gera:

```
drive-web/.next/standalone/     ← server.js + node_modules mínimo
drive-web/.next/static/         ← assets estáticos (JS/CSS do build)
```

**Copie para o celular** (via FileZilla, `scp`, `rsync`, o que preferir) a
estrutura final:

```
~/rwz-drive/drive-web/.next/standalone/    (tudo que está dentro dessa pasta no PC)
~/rwz-drive/drive-web/.next/standalone/.next/static/   ← copiar o conteúdo de .next/static do PC pra cá
```

Ou seja: o `server.js` fica em `drive-web/.next/standalone/server.js`, e a
pasta `static/` do build precisa ser colocada *dentro* de
`drive-web/.next/standalone/.next/static/` (o Next.js não inclui isso
automaticamente no standalone — é o único passo manual). Se algum dia
adicionarem uma pasta `drive-web/public/`, ela também precisa ser copiada
para dentro de `drive-web/.next/standalone/public/`.

**No celular**, não precisa rodar `npm install` nem `npm run build` para o
`drive-web` — o `ecosystem.config.js` já aponta para
`drive-web/.next/standalone/server.js`. Só suba com o PM2 normalmente (veja
a seção 4).

Sempre que o frontend mudar: repita o build no PC e sobrescreva a pasta
`.next/standalone/` no celular (`pm2 restart drive-web` depois).

## 4. Subindo com PM2

```bash
cd ~/rwz-drive
pm2 start ecosystem.config.js
pm2 save            # necessário para o `pm2 resurrect` funcionar no boot
```

## 5. Cloudflare Tunnel

```bash
pkg install cloudflared      # ou baixe o binário ARM64 releases do GitHub
cloudflared tunnel login
cloudflared tunnel create rwz-drive
cloudflared tunnel route dns rwz-drive drive.seudominio.com
```

Crie `~/.cloudflared/config.yml`:

```yaml
tunnel: rwz-drive
credentials-file: /data/data/com.termux/files/home/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: drive.seudominio.com
    service: http://127.0.0.1:3010
  - service: http_status:404
```

Teste manualmente primeiro:

```bash
cloudflared tunnel run rwz-drive
```

Se funcionar, rode como serviço persistente (para reiniciar sozinho junto
com o boot): adicione a chamada no `scripts/boot.sh` (já há uma linha
comentada pronta para descomentar) ou configure-o como serviço systemd-like
via `termux-services` (`pkg install termux-services`).

## 6. Armazenamento físico e quota

- O storage vive dentro do próprio armazenamento interno do celular, em
  `~/rwz-drive/storage/` (caminho configurável via `STORAGE_PATH` no
  `.env` da API).
- Ajuste `STORAGE_QUOTA_GB` no `.env` da API conforme o espaço livre real
  do aparelho (a spec sugere começar em 30 GB e crescer depois).
- Não é necessário `termux-setup-storage` para o funcionamento do drive em
  si (ele não usa o storage compartilhado do Android) — mas é necessário
  se você quiser que o `scripts/backup.sh` salve os backups em um local
  visível fora do Termux (ex.: pasta acessível pelo app de Arquivos do
  Android). Rode `termux-setup-storage` uma vez e aceite a permissão.

## 7. Checklist final

- [ ] `pm2 status` mostra `drive-api` e `drive-web` como `online`
- [ ] `curl http://127.0.0.1:3011/health` responde `{"status":"ok"}`
- [ ] Reiniciar o celular e, sem abrir o Termux manualmente, os processos
      voltam sozinhos (`pm2 status` depois de um tempo confirma)
- [ ] Acesso pela URL pública do Cloudflare Tunnel funciona no navegador
      de outro dispositivo (fora da rede local)
- [ ] Otimização de bateria desativada para Termux e Termux:Boot
- [ ] `pm2 save` foi executado pelo menos uma vez após o primeiro `pm2 start`

## Nota sobre `node:sqlite`

O módulo é classificado pelo próprio Node.js como "Release Candidate"
(estável o suficiente para a API não mudar mais, mas ainda sob avaliação) e
emite um aviso `ExperimentalWarning` no console ao iniciar — isso é
esperado, não é erro, e não impede o funcionamento. Se algum dia isso virar
um problema real (bug do módulo, mudança de comportamento entre versões do
Node), a alternativa sem nenhuma compilação nativa é o `sql.js` (SQLite
compilado para WebAssembly), ao custo de manter o banco em memória e
persistir em disco manualmente a cada escrita. Não foi necessário neste
projeto, mas fica documentado.


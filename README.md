# RWZ Drive

Armazenamento de arquivos pessoal, self-hosted, rodando em um Samsung S21 FE
via Termux e exposto à internet através de um Cloudflare Tunnel.

## Estrutura

```
rwz-drive/
├── drive-api/     Backend — Express + TypeScript + SQLite (better-sqlite3)
├── drive-web/     Frontend — Next.js (App Router) + TypeScript
├── scripts/       boot.sh (Termux:Boot) e backup.sh
├── ecosystem.config.js   Configuração do PM2 para os dois processos
└── docs/
    ├── OPERACAO.md   Comandos do dia a dia (start/stop/logs/backup/update)
    └── TERMUX.md     Setup completo no Android/Termux, do zero
```

## Stack e decisões-chave

- **bcryptjs** (não Argon2id) — evita dependência de compilação nativa.
- **`node:sqlite`** (não `better-sqlite3`) — módulo de SQLite embutido no
  próprio Node.js (sem flag desde a v22.13), eliminando por completo a
  necessidade de compilar um binário nativo pra rodar o banco. Isso resolveu
  na prática tanto um erro de build no Windows (Node muito recente sem
  binário pré-compilado disponível para `better-sqlite3`) quanto o mesmo
  risco que já era esperado no Termux.
- **`file-type@16.5.4`** (não a v19+) — a partir da v17 o pacote é
  ESM-only, o que causava falhas de resolução de módulo (`ERR_PACKAGE_PATH_NOT_EXPORTED`)
  em produção no Termux. A v16.5.4 é a última totalmente CommonJS,
  importada normalmente, sem import dinâmico nem workaround.
- **SQLite em WAL mode** — permite leitura concorrente durante escrita,
  necessário com upload/download simultâneos.
- **multer com `diskStorage`** — arquivos vão direto para o disco via
  stream, nunca carregados inteiros na RAM do celular.
- **Sessões em SQLite** (não em memória do processo) — reiniciar o
  processo ou o celular não derruba usuários logados.
- **Next.js como BFF**: o navegador só fala com uma origem; um proxy
  genérico (`drive-web/src/app/api/[...path]/route.ts`) repassa tudo para
  a API Express, que nunca é exposta diretamente à internet.
- **Quota de armazenamento configurável** via `.env`, checada antes e
  depois de cada upload.
- **Nome físico dos arquivos = UUID gerado no servidor**, nunca derivado
  do nome original — path traversal é estruturalmente impossível porque o
  único módulo que monta caminhos (`storage.service.ts`) nunca aceita
  input externo.

## Começando

Setup completo (Termux, Cloudflare Tunnel, PM2, boot automático):
👉 **[`docs/TERMUX.md`](docs/TERMUX.md)**

Depois de rodando, o dia a dia (logs, restart, backup, atualização):
👉 **[`docs/OPERACAO.md`](docs/OPERACAO.md)**

### Portas

Escolhidas para não colidir com outros serviços rodando no mesmo PM2
(ajuste livremente em `drive-api/.env` e no bloco `env` de `drive-web` em
`ecosystem.config.js`):

- `drive-web` → **3010**
- `drive-api` → **3011**

### Rodando localmente para desenvolvimento (não no celular)

```bash
# Terminal 1
cd drive-api
cp .env.example .env
npm install
npm run dev        # http://127.0.0.1:3011

# Terminal 2
cd drive-web
cp .env.example .env
npm install
npm run dev         # http://127.0.0.1:3010
```

### Build do frontend: PC vs. celular

`drive-web` não tem nenhuma dependência nativa, então buildar no PC e
copiar só o resultado (`next.config.js` já usa `output: "standalone"`) para
o celular é o fluxo recomendado — evita rodar o webpack build (pesado)
dentro do Termux. Passo a passo completo em
[`docs/TERMUX.md`](docs/TERMUX.md#31-build-no-pc--deploy-standalone-recomendado-para-o-drive-web).

Ambos foram testados de ponta a ponta (registro, login, criação de pasta,
upload via proxy, listagem, quota) antes da entrega.

## Cadastro e usuários

O sistema é fechado por padrão: a **primeira conta criada** vira admin
automaticamente (sem convite). A partir daí, todo cadastro exige um link de
convite gerado pelo admin em "Usuários" → "Convites". Cada usuário
convidado tem seu próprio espaço no Drive, com cota de armazenamento
individual configurável (ou herda o padrão global do `.env`). O admin pode
"Ver arquivos" de qualquer usuário pelo painel — navega no Drive dele sem
precisar da senha, mas um usuário comum nunca consegue fazer o inverso
(checado sempre no servidor, nunca confia em nada vindo do cliente).

Se você já tinha uma instalação rodando antes dessa feature, não precisa
fazer nada manual: ao atualizar, a conta mais antiga já cadastrada vira
admin automaticamente na migração do banco.

## Compartilhamentos públicos

Além do Drive privado (conta única do administrador), é possível publicar
pastas ou arquivos individuais através de links com token aleatório
(`/p/<token>` para pastas, `/f/<token>` para arquivos), com senha opcional,
expiração configurável e permissões separadas (visualizar, baixar, enviar,
excluir). Gerenciamento em "Compartilhamentos" na sidebar do painel admin.

Decisões de segurança relevantes:
- Token em texto puro no banco (não hash) — é o próprio link, o admin
  precisa poder copiá-lo a qualquer momento pelo painel. A **senha**, essa
  sim, é sempre hash (bcryptjs), nunca texto puro.
- Toda navegação dentro de uma pasta pública valida ancestralidade contra
  a pasta compartilhada — impossível escapar pra outro lugar do Drive
  trocando o `folder_id` na requisição.
- Link revogado, expirado ou inexistente sempre retornam a mesma resposta
  genérica — não dá pra diferenciar um do outro tentando token por token.
- Permissões efetivas são recalculadas em toda request a partir de
  `expires_at`/`status`/`expired_action` — nunca dependem do timing da
  varredura periódica, que só formaliza a expiração fisicamente depois.
- Upload de pasta inteira reconstrói a hierarquia só no banco (nunca vira
  caminho de filesystem) — o caminho relativo chega num campo separado
  (`relativePaths`), já que o multipart descarta qualquer "/" no nome do
  arquivo.
- Rotas públicas (`/api/public/shares/*`) são isoladas das administrativas,
  com rate limiting próprio.

## Segurança — resumo

Path traversal, IDOR, upload malicioso, CSRF, rate limiting em rotas
sensíveis, cookies HttpOnly/Secure/SameSite, validação de conteúdo por
magic bytes (não apenas extensão) — tudo implementado conforme a
especificação original. Detalhes de cada mitigação estão comentados
diretamente no código-fonte, próximos ao trecho relevante.

Antes de cada release, uma auditoria de segurança é feita e documentada em
[`SECURITY.md`](./SECURITY.md) — inclui o que foi revisado, o que foi
corrigido, e o modelo de ameaças do sistema.

## Checklist antes de publicar

Coisas pra conferir localmente antes de subir pro GitHub (nenhuma delas
afeta segredos — o repositório em si não tem nada sensível, mas vale
confirmar):

- [ ] `git status` não mostra `.env`, `data/*.db*` ou `storage/users/*`
      como arquivos a serem commitados (o `.gitignore` já cobre isso, é só
      conferir)
- [ ] Nenhum `.env` real (com `SESSION_SECRET` de verdade) foi colocado
      dentro do repositório — só os `.env.example`
- [ ] `CHANGELOG.md` reflete a versão que está sendo publicada


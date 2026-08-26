# Changelog

## v1.0.0 — Primeira versão estável

### Núcleo do Drive
- Autenticação por sessão (cookie `HttpOnly`/`Secure`/`SameSite=Lax`),
  senha com hash `bcryptjs`.
- Pastas e arquivos com upload (streaming, sem carregar tudo na RAM),
  download, renomear, mover, excluir (soft delete).
- Upload de pasta inteira (preserva subpastas), com retry automático em
  falha de rede — cada arquivo numa requisição própria, não cancela o
  lote inteiro se um falhar.
- Download de pasta inteira em `.zip`, via streaming.
- Busca por nome, sobre metadados (nunca varre o filesystem).
- Preview de imagem/vídeo com suporte a `Range` (streaming parcial).
- Progresso de reprodução de vídeo sincronizado entre dispositivos (fica
  no banco do servidor, não no navegador).
- Banco SQLite (`node:sqlite`, embutido no Node — zero dependência de
  compilação nativa) em modo WAL.

### Compartilhamentos públicos
- Links de pasta (`/p/<token>`) ou arquivo único (`/f/<token>`), com token
  aleatório de alta entropia.
- Senha opcional, expiração configurável com três comportamentos
  (tornar privada / excluir conteúdo / bloquear só uploads).
- Permissões separadas: visualizar, baixar, enviar, excluir.
- Preview de mídia e download em `.zip` também disponíveis para
  visitantes (quando permitido).
- Upload de pasta inteira também disponível para visitantes.
- Limites configuráveis por compartilhamento (tamanho por arquivo, total,
  quantidade de arquivos).

### Usuários e administração
- Cadastro fechado: a primeira conta criada vira admin automaticamente;
  toda conta seguinte exige um link de convite gerado pelo admin.
- Cota de armazenamento configurável por usuário (ou herdada do padrão
  global).
- Painel de administração: gestão de convites, lista de usuários com uso
  de armazenamento, edição de cota, exclusão de conta (com limpeza
  completa de dados).
- Admin pode "ver arquivos" de qualquer usuário, sempre validado no
  servidor.

### Segurança
- Auditoria completa antes do release — ver [`SECURITY.md`](./SECURITY.md).
- Corrigido: possível "zip slip" via nome de pasta/arquivo malicioso no
  gerador de `.zip` (dupla camada de proteção: validação na criação +
  sanitização no momento de gerar o arquivo).

### Infraestrutura
- Deploy pensado para Termux (Android) via PM2, com Cloudflare Tunnel.
- Frontend em modo `standalone` do Next.js — permite compilar num
  computador e rodar no celular sem precisar do `node_modules` completo
  nem repetir o build no aparelho.

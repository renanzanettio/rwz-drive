# Segurança — RWZ Drive

Este documento resume o modelo de ameaças, as decisões de segurança
tomadas ao longo do desenvolvimento, e o resultado da auditoria feita antes
da primeira versão estável (v1.0).

## Modelo de ameaças

RWZ Drive é uma nuvem de arquivos pessoal, self-hosted, com:
- Um **admin** único por padrão (a primeira conta criada), com acesso total.
- **Usuários convidados** (cadastro fechado — só entra quem recebe um link
  de convite do admin), cada um com seu próprio espaço isolado.
- **Compartilhamentos públicos** opcionais (pastas ou arquivos), acessíveis
  por qualquer pessoa com o link, sem precisar de conta.

Os limites de confiança que o sistema garante:
1. Um usuário comum nunca acessa dado de outro usuário.
2. Um visitante de um link público nunca acessa nada além do que foi
   explicitamente compartilhado — nem a estrutura privada do Drive, nem o
   painel administrativo, nem outros compartilhamentos.
3. Só o admin acessa rotas administrativas (`/api/admin/*`) e só o admin
   consegue "ver como" outro usuário (e mesmo assim, sempre validado no
   servidor — nunca é uma opção que o cliente escolhe sozinho).

## Auditoria pré-v1.0 (o que foi revisado)

### Achados corrigidos

**1. Zip slip via nome de pasta/arquivo (severidade: média)**

A funcionalidade de "baixar pasta como .zip" monta o caminho de cada
entrada do arquivo compactado a partir do nome de pastas/arquivos
cadastrados no banco. Antes da correção, nada impedia alguém de nomear uma
pasta literalmente `..` — o que, dependendo da ferramenta usada por quem
extrai o `.zip` depois, poderia escapar do diretório de destino ao
descompactar (a classe de vulnerabilidade conhecida como
["Zip Slip"](https://security.snyk.io/research/zip-slip-vulnerability)).

Corrigido em duas camadas:
- Nomes de pasta/arquivo `.` e `..`, e caracteres de controle, agora são
  rejeitados na criação (`folders.service.ts` e `files.service.ts`).
- Defesa extra dentro do próprio gerador de `.zip`
  (`services/zip.service.ts`): qualquer `..` que apareça em um nome, por
  qualquer motivo, é neutralizado antes de virar uma entrada do arquivo —
  redundante por design, não depende só da validação de entrada.

**2. Download/preview quebrado durante "ver como outro usuário" (funcional, não uma falha de segurança)**

Ao construir a funcionalidade de admin "ver arquivos de um usuário", o
parâmetro que carrega essa informação (`as_user_id`) era aplicado
automaticamente em toda chamada de API — exceto nos links diretos de
download, preview de imagem/vídeo e download em `.zip`, que são URLs
usadas direto em `href`/`src`, não chamadas via `fetch`. Resultado: o admin
conseguia **navegar** nos arquivos do usuário normalmente, mas baixar ou
pré-visualizar qualquer arquivo específico falhava (404) enquanto
"personificando" alguém.

Não é uma falha de segurança — o sistema falhava fechado (negava acesso
em vez de vazar dado errado) — mas quebrava a funcionalidade que acabou de
ser construída, então foi corrigido junto.

### Áreas verificadas e consideradas seguras

- **SQL Injection**: toda consulta usa parâmetros vinculados (`?`/`@nome`).
  Nenhuma interpolação de dado de entrada diretamente em texto SQL em
  nenhum lugar do código.
- **Path traversal (upload/download privado)**: o nome físico de todo
  arquivo é sempre um UUID gerado no servidor; a hierarquia de pastas
  existe só no banco, nunca no filesystem. O único módulo autorizado a
  montar caminhos físicos (`storage.service.ts`) nunca aceita input
  externo.
- **IDOR / acesso cruzado entre usuários**: toda rota de dado privado
  (pastas, arquivos, busca, progresso de vídeo) valida posse
  (`owner_id`) antes de qualquer operação. Testado com tentativas reais de
  acessar/baixar recurso de outro usuário — sempre bloqueado (403/404).
- **Isolamento de compartilhamento público**: testado com tentativas reais
  de escapar da pasta compartilhada trocando `folder_id`/`file_id` na
  requisição — sempre bloqueado (403). Link revogado, expirado e
  inexistente retornam exatamente a mesma resposta genérica, sem
  diferenciar um do outro.
- **Escalação de privilégio no cadastro**: `role` e cota de armazenamento
  nunca vêm do corpo da requisição — são sempre calculados no servidor
  (primeira conta = admin; demais = o que o convite usado definir).
- **Personificação restrita a admin de verdade**: testado com um usuário
  comum tentando usar `as_user_id` pra ver dados do admin — o parâmetro é
  ignorado silenciosamente pra quem não é admin (a checagem de `role`
  acontece no servidor, nunca é uma opção do cliente).
- **Exclusão de usuário**: limpa todas as tabelas que referenciam o
  usuário (arquivos, pastas, compartilhamentos, sessões, convites) antes
  de remover a conta, evitando erro de integridade referencial. Bloqueada
  para contas admin e para autoexclusão. Testado de ponta a ponta,
  incluindo confirmação de que a pasta física em disco é removida.
- **Senhas e tokens**: senha de conta e de compartilhamento público sempre
  com hash (`bcryptjs`, 12 rounds), nunca texto puro. Tokens de
  compartilhamento e de convite gerados com `crypto.randomBytes` (192 bits
  de entropia) — o texto do token em si fica em texto puro no banco (não
  hash), decisão deliberada: é o próprio link, o admin precisa poder
  copiá-lo de novo a qualquer momento pelo painel. Só a senha (o segredo
  de verdade) é sempre hash.
- **XSS**: nenhum uso de `dangerouslySetInnerHTML` ou equivalente no
  frontend. React escapa conteúdo dinâmico por padrão.
- **CSRF**: cookies de sessão (privados e de compartilhamento público) são
  `HttpOnly`, `SameSite=Lax` e `Secure` em produção — uma requisição
  disparada por outro site não carrega o cookie.
- **Segredos**: `.env.example` não contém nenhum segredo real, só
  placeholders. `.gitignore` exclui `.env`, o banco de dados
  (`data/*.db*`), e os arquivos dos usuários (`storage/users/*`).
- **Rate limiting**: login, registro, upload, e as rotas públicas
  (desbloqueio de senha, navegação, download, upload) têm limites próprios
  e independentes entre si.

## Reportando um problema

Se você encontrar uma vulnerabilidade, não abra uma issue pública — é um
projeto pessoal/self-hosted, mas ainda assim, prefira avisar diretamente
quem administra o repositório antes de divulgar publicamente, pra dar
tempo de corrigir.

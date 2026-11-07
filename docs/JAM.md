# Assistir com amigos: Jam

Para playlists, Jam de áudio e reprodução em segundo plano no celular, consulte [Músicas](MUSICAS.md).

A Jam é uma sala temporária do RWZ Drive. Cada participante recebe o vídeo diretamente do seu servidor; os comandos e o relógio da reprodução são compartilhados. Não é necessário transmitir a tela nem instalar outro aplicativo.

## Aplicar esta atualização

Este pacote complementa a versão com Séries e filmes e Modo TV que você já instalou. Extraia os arquivos na raiz do projeto, mantendo as pastas `drive-api`, `drive-web` e `docs`.

1. Faça um backup do SQLite. Com o caminho padrão, na raiz do projeto no Termux:

   ```bash
   sqlite3 data/rwz-drive.db ".backup 'data/rwz-drive-antes-da-jam-$(date +%Y%m%d-%H%M%S).db'"
   ```

2. Compile e reinicie a API no Termux:

   ```bash
   cd drive-api
   npm run build
   pm2 restart drive-api
   ```

   A migration `007_watch_jams.sql` é aplicada automaticamente. Ela cria as tabelas das salas e participantes e conserva os arquivos e o histórico existentes.

3. No PC, em `drive-web`, execute `npm run build`. Copie o conteúdo de `.next/standalone/` para `drive-web/.next/standalone/` no telefone, e o conteúdo de `.next/static/` para `drive-web/.next/standalone/.next/static/`.
4. No Termux, rode `pm2 restart drive-web` e recarregue a página.

Não há novas dependências, variáveis de ambiente ou portas. A Jam usa o mesmo domínio HTTPS e o proxy da aplicação que já passa pelo cloudflared.

## Criar e entrar

1. Abra um filme, uma série ou o player de um vídeo no Drive e escolha **Assistir com amigos**.
2. Você pode permitir que os convidados também controlem a reprodução. O padrão deixa os comandos com o anfitrião.
3. Clique em **Criar Jam**, informe seu nome e entre como anfitrião. Essa opção exige a mesma conta que criou a sala.
4. Use **Copiar convite** e envie o link aos amigos. Eles informam um nome e entram sem precisar de conta no Drive.
5. Quando todos estiverem prontos, clique em **Reproduzir**. Alguns navegadores pedem um toque em **Ativar vídeo neste aparelho** para liberar a reprodução com som.

O link de convite abre a sala no mesmo domínio usado para criá-la. Para seus amigos entrarem pela internet, crie a Jam usando o domínio público do Drive.

## Reprodução compartilhada

- Reproduzir, pausar, avançar ou voltar, buscar um ponto e mudar a velocidade se aplicam à sala.
- Quem entrar depois recebe o episódio e o ponto atuais.
- Em uma série, os episódios da coleção ficam disponíveis no seletor e nos botões anterior/próximo. O anfitrião também pode habilitar o próximo episódio automático.
- O relógio do servidor corrige diferenças entre os players. **Sincronizar agora** reaplica o estado atual.
- Os controles de volume, tela cheia e legendas afetam apenas o aparelho de quem mexeu. Legendas SRT/VTT já vinculadas ao vídeo ficam disponíveis com tamanho, cor e atraso locais.
- O progresso é salvo no histórico do dono do acervo pelos players do anfitrião. Os convidados não escrevem nesse histórico. Se outro player atualizar o mesmo histórico ao mesmo tempo, o aviso de conflito preserva o registro mais recente.

Espaço reproduz/pausa, as setas esquerda/direita voltam/avançam dez segundos, F abre tela cheia e M ativa/desativa o som. Os comandos compartilhados respeitam a permissão definida pelo anfitrião.

## Reconectar, sair e encerrar

As mensagens usam uma conexão de eventos em tempo real, com consulta periódica de estado como alternativa durante a reconexão. Se a conexão com a sala parar de responder, o player local pausa e mostra **Reconectando**. Ao retornar, ele busca o ponto atual.

A entrada é lembrada por aba; recarregar essa aba permite voltar à mesma sessão. Em **Séries e filmes → Minhas Jams**, o criador pode voltar às salas abertas. Se não houver mais um anfitrião conectado por cerca de 90 segundos, a sala pausa. **Sair da Jam** pausa imediatamente quando sai o último anfitrião presente. Após reiniciar a API, as salas voltam pausadas no último relógio conhecido.

O anfitrião pode remover a entrada atual de um convidado. Como o convite continua válido, alguém com esse link pode entrar novamente. **Encerrar Jam** fecha a sala para todos e invalida o convite. Para convidar outra vez depois disso, crie uma nova Jam.

## Acesso e limites

O convite funciona como a chave de entrada: compartilhe com quem vai assistir. Ele vale por **12 horas**. Cada conta pode manter até **5 salas abertas**, com até **12 participantes presentes por sala** e até **500 episódios por série**.

O convidado recebe apenas informações da sessão e acesso ao vídeo que está passando e às legendas vinculadas a ele. A sala não libera navegação pelo Drive, uploads, exclusão de arquivos nem acesso aos demais canais. Ao trocar de episódio, as novas requisições e transmissões ainda abertas do arquivo anterior são interrompidas. Dados que o navegador já recebeu podem continuar no seu buffer.

Cada pessoa consome uma transmissão do seu servidor. A qualidade da sincronização depende da conexão e do buffer de cada aparelho; ela não é uma garantia de precisão quadro a quadro. O navegador precisa suportar os codecs dos arquivos, e o telefone precisa ter velocidade de upload suficiente para todos assistirem ao mesmo tempo. Não há transcodificação nesta atualização.

## Validação de desenvolvimento

Na pasta `drive-api`:

```bash
npm run build
node tests/jam.integration.cjs
```

O teste usa banco e arquivos temporários. Ele verifica a migração a partir da versão anterior, convites, permissões, Range, legendas, eventos, comandos, entrada tardia, conflitos, troca de episódio, histórico, ausência do anfitrião, reinício, remoção, encerramento e expiração.

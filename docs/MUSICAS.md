# Músicas, playlists e Jam de áudio

O menu **Músicas** reúne os arquivos de áudio da sua conta, em qualquer pasta do Drive. O player fixo mantém a música tocando ao navegar entre as telas do Drive.

## Instalar a atualização

Este pacote complementa a versão com Séries e filmes e Modo TV. Ele inclui também a Jam de vídeo entregue anteriormente: funciona tanto se você já a aplicou quanto se ainda não aplicou aquele ZIP. Copie as pastas do ZIP para a raiz do repositório.

1. Faça backup do banco SQLite. Com o caminho padrão, execute na raiz do projeto no Termux:

   ```bash
   sqlite3 data/rwz-drive.db ".backup 'data/rwz-drive-antes-das-musicas-$(date +%Y%m%d-%H%M%S).db'"
   ```

2. Compile e reinicie a API no Termux:

   ```bash
   cd drive-api
   npm run build
   pm2 restart drive-api
   ```

   A migration `007_watch_jams.sql` é aplicada se a Jam anterior ainda não estiver instalada. A migration `008_music_library.sql` cria a biblioteca de músicas e as playlists. As Jams existentes passam a ter o tipo vídeo por padrão. Os arquivos, o histórico de vídeos e as salas anteriores são preservados.

3. No PC, dentro de `drive-web`, rode `npm run build`. Copie o conteúdo de `.next/standalone/` para `drive-web/.next/standalone/` no telefone, e o conteúdo de `.next/static/` para `drive-web/.next/standalone/.next/static/`.
4. No Termux, rode `pm2 restart drive-web` e recarregue a PWA.

São usadas as dependências e portas existentes. O endereço público HTTPS configurado no cloudflared continua sendo o endereço do app.

## Sua biblioteca

Envie músicas pelo **Novo → Enviar arquivos** ou envie uma pasta. Abra **Músicas → Atualizar músicas**. Um clique no arquivo de áudio no Meu Drive também abre o player musical.

O navegador precisa suportar o formato e os codecs dos arquivos. MP3 é uma opção prática para testar entre aparelhos. A biblioteca reconhece arquivos com tipo de áudio, incluindo Ogg. Não há conversão automática dos arquivos.

Os nomes iniciais vêm do nome do arquivo. O padrão `Artista - Música.mp3` separa artista e título. O menu **••• → Editar informações** permite ajustar título, artista e álbum; esses dados são usados no player e nos controles do celular. O coração adiciona a música às **Favoritas**. A busca encontra títulos, artistas e álbuns.

Uma imagem `capa.jpg`, `capa.png`, `capa.webp`, `cover.jpg` ou `cover.png` na pasta do áudio pode aparecer como arte do álbum. O editor de playlists permite escolher uma imagem do seu Drive como capa.

## Playlists e fila

- Use **Nova playlist** ou selecione músicas e escolha **Criar com a seleção**.
- **Adicionar à playlist** acrescenta a seleção a uma playlist existente, sem duplicatas.
- Na playlist, **Adicionar pasta** inclui os áudios da pasta e de suas subpastas.
- Os botões de subir e descer definem a ordem das músicas. Também é possível editar nome, descrição e capa e remover músicas da seleção.
- Excluir uma playlist conserva os arquivos no Drive.

**Reproduzir coleção** monta a fila. Clicar em uma música começa por aquela faixa. O menu **Adicionar à fila** acrescenta uma música; **Fila** permite escolher, subir e remover itens da fila atual.

O player oferece anterior/próxima, busca de um ponto, volume, aleatório e repetição da fila ou de uma faixa. A próxima música é aberta no mesmo elemento de áudio. Abrir um vídeo ou um canal de TV pausa a música, e iniciar uma música pausa o vídeo.

Fila, ponto da música, volume e preferências ficam salvos no navegador, separados por conta. Ao recarregar, a fila volta pausada. As playlists, os favoritos e os metadados ficam no banco e acompanham a conta entre dispositivos. Uma playlist ou fila aceita até 1.000 músicas; uma Jam aceita até 500.

## Jam de música

Na playlist, escolha **Ouvir com amigos** para criar uma sala com aquela seleção. A mesma opção no player fixo usa a fila e o ponto atuais.

Informe seu nome como anfitrião e copie o convite. Os amigos entram pelo link, sem precisar criar conta. O padrão deixa o controle com você; **Permitir controles dos convidados** libera reprodução, pausa, busca, velocidade e troca de música para eles também.

A sala usa uma cópia da playlist no momento da criação. Depois de alterar a playlist original, crie outra Jam para usar a nova seleção. **Próxima música automática** avança a sala ao final da faixa; o seletor permite escolher qualquer música daquela Jam.

Os controles de mídia do anfitrião comandam a sala. Para um convidado sem permissão de controle, pausar pelos controles do sistema ou por **Pausar neste aparelho** suspende apenas sua escuta. Ao retomar, ele volta ao ponto atual da sala. Volume continua independente por aparelho.

O acesso do convidado se limita à faixa atual da sala. Ele não ganha acesso à biblioteca, playlists privadas, navegação pelo Drive ou arquivos fora da Jam. Cada participante recebe uma transmissão do servidor, consumindo seu upload. Os convites mantêm os limites da Jam: 12 horas, até 12 participantes presentes e até 5 salas abertas por criador.

## Segundo plano no Samsung

O player usa um elemento de áudio persistente e a **Media Session API**, com título, artista, álbum, posição e comandos de reproduzir, pausar e trocar faixas. Em navegadores compatíveis, esses comandos aparecem na notificação, na tela bloqueada e nos controles dos fones. A reprodução normal usa os eventos do áudio para avançar de faixa.

Para testar no seu Galaxy:

1. Abra o domínio HTTPS no Chrome atualizado e instale o RWZ Drive pelo menu do navegador. Abra a versão instalada.
2. Inicie uma música com um toque, pressione Início e bloqueie a tela. Confira o áudio e a notificação de mídia.
3. Se o Samsung interromper a reprodução, abra **Configurações → Aplicativos → RWZ Drive → Bateria → Sem restrições**, quando essa entrada estiver disponível. Se o app estiver vinculado ao navegador, confira também a bateria do Chrome ou do navegador usado para instalar a PWA.
4. Retire o app e o navegador das listas de aplicativos suspensos ou em suspensão profunda. Os nomes dos menus variam conforme a versão da One UI.
5. Como o mesmo telefone hospeda o servidor, mantenha o Termux com as configurações de bateria e inicialização que você já usa para manter o Drive disponível.

A implementação prepara a PWA para tocar em segundo plano, mas o resultado precisa ser validado no aparelho. O Android pode suspender ou encerrar o navegador, principalmente com restrições de bateria. Fechar o app à força encerra a reprodução. As músicas continuam vindo do servidor e precisam de conexão.

A Jam também depende de manter a conexão com a sala. Se o sistema suspender seus eventos de rede, a sincronização e a próxima faixa podem atrasar; ao retornar, o player consulta a sala e corrige o ponto. Os controles e o áudio de uma PWA não têm a mesma garantia de execução de um serviço nativo do Android.

## Validação de desenvolvimento

Na pasta `drive-api`:

```bash
npm run build
node tests/music.integration.cjs
node tests/jam.integration.cjs
```

Os testes usam bancos e arquivos temporários e verificam migração, preservação das Jams antigas, privacidade, playlists, ordem, favoritos, capas, importação de pastas, conflitos, streaming, troca de faixa e Jam de áudio. A reprodução com a tela bloqueada requer teste físico no Samsung.

Referências técnicas:

- [Controles de mídia e tela bloqueada no navegador](https://web.dev/articles/media-session)
- [Samsung: áudio interrompido e ajustes de bateria](https://www.samsung.com/us/support/troubleshoot/TSG10001337/)

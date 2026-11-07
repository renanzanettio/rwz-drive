# Séries e filmes no RWZ Drive

Para assistir com amigos em uma sala sincronizada por convite, veja [o guia da Jam](JAM.md).

A opção **Séries e filmes** aparece no menu do Drive. O catálogo usa os arquivos enviados pela sua conta e guarda o histórico no mesmo banco usado pelo player das pastas.

## Aplicar a atualização

1. Extraia o ZIP na raiz do repositório, onde ficam as pastas `drive-api` e `drive-web`.
2. Faça um backup do seu banco SQLite antes de reiniciar a API com a atualização. O caminho está em `DATABASE_PATH` no `.env` da API. Se usa o caminho padrão, com a ferramenta `sqlite3` instalada no Termux, execute na raiz do projeto:

   ```bash
   sqlite3 data/rwz-drive.db ".backup 'data/rwz-drive-antes-da-midia-$(date +%Y%m%d-%H%M%S).db'"
   ```

3. Compile a API. As migrations `005_watch_completion.sql` e `006_media_library_tv.sql` entram no build e são aplicadas automaticamente na próxima inicialização:

   ```bash
   cd drive-api
   npm run build
   pm2 restart drive-api
   ```

4. No PC, dentro de `drive-web`, rode `npm run build`. Copie o novo conteúdo de `.next/standalone/` para `drive-web/.next/standalone/` no telefone. Copie também o conteúdo de `.next/static/` para `drive-web/.next/standalone/.next/static/`.
5. No Termux, rode `pm2 restart drive-web` e abra o Drive novamente.

A atualização inclui também os três arquivos da PWA entregues anteriormente. O pacote tem arquivos de código-fonte e o guia desta funcionalidade.

## Organizar a coleção

Na raiz do seu Drive, crie uma pasta **Séries** e uma pasta **Filmes**. A primeira abertura da coleção oferece um botão para criar as pastas que faltam. A grafia **Series**, sem acento, também é reconhecida.

Para uma série, use **Séries → Nome da série → Temporada 1 → 01 - Episódio.mp4**. Cada pasta dentro da série vira uma temporada. Vídeos que estejam diretamente na pasta da série aparecem em **Episódios avulsos**. Numere os arquivos para definir a ordem. Temporada 2 vem antes de Temporada 10.

Para um filme, use **Filmes → Nome do filme → Nome do filme.mp4**. Vídeos diretamente em Filmes também aparecem. A capa é uma imagem chamada `capa.jpg`, `capa.png` ou `capa.webp`, na pasta da série ou do filme. `poster` e `cover` também são reconhecidos.

Você pode usar **Abrir no Drive** para enviar, mover e organizar os arquivos com as ferramentas habituais. Depois, clique em **Atualizar coleção**. Mover ou renomear um arquivo existente pelo Drive conserva o histórico, pois ele está vinculado ao ID desse arquivo.

## Reprodução e histórico

- **Continue assistindo** reúne os vídeos em andamento, com o ponto salvo na sua conta.
- Cada episódio pode ser marcado ou desmarcado como **Assistido**.
- Ao chegar ao fim do vídeo, o player registra a conclusão. Ao abrir um vídeo concluído, a reprodução começa do início.
- A reprodução salva o progresso periodicamente, ao pausar e ao fechar ou sair da tela.
- O player das pastas e o player da coleção usam o mesmo histórico.
- Os botões anterior e próximo percorrem os episódios da série e também passam de uma temporada para a seguinte.
- Se outro player atualizar o mesmo vídeo enquanto você assiste, o app informa o conflito e permite reabrir o vídeo com o ponto mais recente.

Os pontos de retomada que já estavam no banco são aproveitados. Os vídeos concluídos antes desta atualização precisam ser marcados manualmente, porque a versão anterior apagava esses registros. O navegador precisa suportar os codecs dos vídeos enviados.


## Editar a coleção

Use **Adicionar pasta** para classificar uma pasta existente como uma série ou uma coleção de filmes. Na série, as subpastas continuam representando temporadas. Pastas adicionadas manualmente aparecem em **Como organizar minha coleção**, com a opção de remover a classificação.

Abra um título e use **Editar título e episódios**. Você pode alterar nome, descrição e capa, selecionar uma imagem já no Drive ou enviar outra. Os botões de subir e descer alteram a ordem dos episódios da temporada escolhida. Os nomes usados na coleção são gravados como metadados.

O botão **Quero assistir** adiciona o título à sua lista. Na coleção, o filtro Histórico oferece Todos, Não comecei, Em andamento, Concluídos e Quero assistir. Uma série está concluída quando todos os episódios estão marcados como assistidos.

## Controles e legendas

O player oferece voltar ou avançar dez segundos, velocidade, tela cheia e picture-in-picture quando o navegador disponibiliza essa função. Os atalhos funcionam com o player aberto, enquanto você estiver fora de campos de texto e botões.

| Tecla | Ação |
| --- | --- |
| Espaço | Reproduzir ou pausar |
| ← e → | Voltar ou avançar dez segundos na reprodução normal |
| F | Tela cheia |
| M | Ativar ou desativar o som |

Em **Legendas e aparência**, use **Carregar SRT/VTT** para enviar uma legenda de até 2 MB. Ela fica vinculada ao vídeo e disponível na sua conta em outros dispositivos. Escolha a legenda e ajuste tamanho, cor e atraso. Atraso positivo faz a legenda aparecer depois. Velocidade, tamanho e cor ficam lembrados nesse navegador.

Ao concluir um episódio, a reprodução automática oferece o seguinte após oito segundos. A contagem pode ser cancelada e a opção pode ser desativada. Os botões anterior e próximo continuam disponíveis.

## Modo TV

1. Abra **Modo TV** e escolha **Criar canal**.
2. Informe nome e número e marque as séries que vão passar nele.
3. Escolha episódios embaralhados ou em ordem.
4. Salve a programação. Na primeira preparação, o navegador lê a duração dos vídeos que ainda precisam dessa informação. A tela mostra o andamento e oferece cancelamento.
5. Selecione o canal para sintonizar e consulte o guia com o programa atual e os seguintes.

O canal alterna um episódio de cada série enquanto houver episódios na lista e repete o ciclo completo. Em modo embaralhado, a ordem dos episódios e das séries é sorteada ao gerar a programação. A ordem gerada e o horário inicial ficam no banco. O mesmo canal tem a mesma programação nas telas conectadas à sua conta.

A grade avança mesmo quando você sai. O servidor calcula o que está passando pelo horário, e o navegador abre o arquivo naquele ponto. Ao pausar, **Retomar ao vivo** volta ao ponto atual. A reprodução pelo modo TV tem seu próprio relógio e deixa o histórico pessoal de episódios para a reprodução normal.

As teclas ↑ e ↓ trocam de canal. A interface oferece tela cheia e foco visível nos botões. Depois de adicionar episódios ou editar seus nomes na coleção, use **Editar ou reprogramar canal** e salve para gerar uma grade com o acervo atualizado. Salvar um canal reinicia sua programação a partir daquele momento. Excluir um canal remove a grade.

Os vídeos precisam ter duração legível e codecs suportados pelo navegador que vai reproduzi-los. A preparação avisa qual arquivo não pôde ser lido. O limite é de 100 séries e 5.000 episódios por canal.

### Referências usadas

O desenho da programação tomou como referência os conceitos de grade em loop do Tunarr e alternância de coleções do ErsatzTV. A implementação usa o banco, a autenticação e a reprodução de arquivos do RWZ Drive.

- [Tunarr e programação em loop](https://tunarr.com/configure/scheduling/concepts/)
- [Tunarr e alternância de séries](https://tunarr.com/configure/scheduling/block-shuffle/)
- [ErsatzTV e itens de programação](https://ersatztv.org/docs/scheduling/classic/)

## Organização do Drive

No Meu Drive, escolha ordenação por nome, data de atualização ou maior tamanho. As pastas exibem o tamanho dos seus arquivos ativos, incluindo subpastas.

Use **Selecionar itens** para marcar vários arquivos e pastas. Você pode selecionar todos os itens visíveis, mover a seleção para outra pasta ou excluir em lote. Cada operação aceita até 1.000 itens. O servidor valida toda a seleção antes de confirmar a alteração.

A opção **Espaço por pasta** mostra a distribuição do acervo ativo, da maior pasta para a menor. Abra uma pasta nessa tela para detalhar suas subpastas ou use **Abrir no Drive** para gerenciar os arquivos.

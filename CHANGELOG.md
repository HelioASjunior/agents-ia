# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Guia de estudo em PDF, em português e inglês, para aprender como o sistema funciona e como usá-lo.

### Corrigido

- **Aprovar e iniciar** apagava as condições ("só se a revisão aprovar" ou "reprovar") e as tentativas das etapas de um workflow. Com isso, uma reprovação abria uma rodada de correção em vez de seguir pelo caminho desenhado.
- O tipo **Trabalho** escolhido para uma tarefa de quem testa ou revisa era trocado por revisão na aprovação, e ela falhava por não ter veredito.

## [0.1.2] - 2026-11-04

### Corrigido

- O tema, o projeto escolhido, o layout e a visão do escritório se perdiam a cada abertura do app instalado, porque ele usava uma porta nova a cada vez. Depois desta atualização, as preferências passam a ser mantidas. Como a porta muda uma última vez, elas voltam ao padrão uma vez.
- **Retomar** passava por cima de uma tarefa reprovada no limite de correções. Agora a missão para de novo e pede **Tentar de novo** ou **Pular**.
- Depois de salvar um workflow, a tela mostrava o desenho antigo até reabri-lo.
- Com agentes trabalhando, a tela de atualização só oferecia interromper. Agora há **Instalar quando terminar**, que também não instala no intervalo entre duas tarefas de uma missão.

## [0.1.1] - 2026-11-04

### Adicionado

- **Escritório em 3D**, com luz e sombra, personagens que andam, sentam e digitam, e a missão real no quadro da sala. A visão Compacta continua disponível, e é a indicada ao lado de programas pesados em 3D.
- Guia para outra IA verificar o XinoIA ou levar um projeto para ele, e `npm run verify`, uma verificação completa que não usa contas nem cota.
- Política de privacidade e preparação para a assinatura de código pela SignPath Foundation, que fica desligada. O pedido ainda não foi feito.

### Corrigido

- O Codex em um perfil separado não rodava nenhum comando no Windows ("blocked by policy"), porque o perfil não tinha a área protegida definida. Agora o XinoIA usa a opção que não pede administrador, a menos que a configuração do Codex já escolha outra.
- Os modelos do Codex agora aparecem para escolher, vindos do catálogo da versão instalada, com os níveis de esforço que cada um aceita. Um nome fora da lista ainda pode ser digitado em **Outro…**.
- `SHA256SUMS.txt` não lista mais um arquivo interno do empacotador, que não é publicado. O arquivo da versão 0.1.0 foi corrigido no próprio GitHub, e os outros arquivos dela não mudaram.
- Os testes de instalação se recusam a rodar em um computador com o XinoIA instalado ou aberto. Antes, podiam encerrar o programa e apagar o registro da instalação.

## [0.1.0] - 2026-11-04

Primeira versão de testes do XinoIA.

### Adicionado

- **Aplicativo desktop para Windows**, com instalador, versão portátil e assistente de primeira execução.
- **Escritório virtual em estilo de jogo**, com sete salas e estados vindos de eventos reais: quem recebe trabalho vai para a mesa, e quem está disponível fica na copa. É a tela inicial, tem placar e visão compacta, e uma telinha fica à vista nas outras telas.
- **Escolha da IA no assistente**, com instalação em um clique e login pelo navegador que fecha sozinho ao terminar.
- **Chave de API como opção**, por perfil, cifrada pelo Windows e cobrada por uso.
- **Orquestrador de missões**: plano aprovado por você, dependências, execução paralela, passagem automática de trabalho, revisão entre agentes com volta para correção, retentativas, pausa, retomada e relatório final.
- **Chat** com streaming, Markdown, anexos, busca, menções e conversa com a equipe inteira.
- **Terminal ao vivo**, unificado e por agente, com histórico preservado, e terminal interativo real.
- **Claude Code e Codex CLI**, testados com contas reais por assinatura. A chave de API foi testada com uma chave inválida, recusada pelo fornecedor. **Gemini CLI**, escrito pela documentação e ainda sem teste real. **Agentes locais personalizados**.
- **Perfis separados por conta**, com login no fluxo oficial de cada ferramenta.
- **Git**: worktree por tarefa em paralelo, conflito tratado como tarefa, revisão antes do merge, clonagem de repositórios.
- **Workflows** visuais com condições e tentativas, e 4 modelos prontos.
- **Memória por projeto** e registro de decisões técnicas.
- **Integrações** por agente: plugins, skills e MCP, incluindo Unreal Engine.
- **Modos de execução** supervisionado, semiautônomo e autônomo controlado, com regras de negação, interrupção de comandos destrutivos e limites de tempo.
- **Atualização automática** pelo GitHub Releases, com canais estável e beta e assinatura verificada antes de instalar.
- **Banco SQLite** em modo WAL, com migrações versionadas, cópia de segurança e recuperação de banco danificado.
- **Segurança da API local**: token por inicialização, verificação de host e origem, e mascaramento de segredos.

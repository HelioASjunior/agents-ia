# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

Primeira versão de testes do XinoIA.

### Adicionado

- **Aplicativo desktop para Windows**, com instalador, versão portátil e assistente de primeira execução.
- **Escritório virtual em estilo de jogo**, em pixel art, com sete salas e estados vindos de eventos reais: quem recebe trabalho vai para a mesa, e quem está disponível fica na copa. É a tela inicial, tem placar e visão compacta, e uma telinha fica à vista nas outras telas.
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

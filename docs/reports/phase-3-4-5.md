# Relatório das Fases 3, 4 e 5: interface, projetos, workflows e escritório

## Implementado

**Fase 3: chat, terminal e monitoramento**

- Interface React com barra lateral, painel direito redimensionável e recolhível, tema escuro e claro.
- Chat com streaming, Markdown, destaque de sintaxe, copiar código, anexos, busca, histórico persistente, interrupção, continuação de sessão, menções com autocompletar e "Equipe, ..." para ouvir todos, com o coordenador decidindo por último.
- Terminal unificado e por agente com xterm.js, filtros por agente e tarefa, busca, interrupção, e logs que voltam depois de reiniciar. Tudo vem de eventos reais.
- Terminal interativo real com PTY, para comandos do usuário e para o login oficial dentro do app.
- Painel com números reais, linha do tempo, agentes, ferramentas e uso de CPU e memória. Sem dados, mostra "—".

**Fase 4: projetos, workflows e Git**

- Pasta existente, pasta nova e clonagem de repositório, com protocolos restritos.
- Reconhecimento da estrutura do projeto antes de qualquer alteração.
- Worktree por tarefa quando há paralelismo. Sem Git, a missão roda uma tarefa por vez, para ninguém sobrescrever ninguém.
- Conflito vira uma tarefa de resolução, com as marcações no arquivo.
- Revisão antes do merge: a pasta do usuário só muda quando ele aprova.
- Memória por projeto e registro de decisões, repassados às próximas tarefas.
- Editor visual de workflows com condições, tentativas e 4 modelos prontos, que executam de verdade.

**Fase 5: escritório e identidade**

- Escritório isométrico original em canvas, com seis salas e cada agente na sala da função.
- Estados, balões, monitores e painéis de parede dirigidos por eventos reais. Agente disponível fica à mesa, sem andar à toa, e a caminhada só acontece em uma passagem de trabalho real.
- Clique em um agente abre detalhes, terminal, tarefa e histórico. Há também a visão compacta em tabela.
- Assistente de primeira execução com teste real de integração. Logotipo, favicon, tela de abertura e boas-vindas.

**Segurança**

- Modos supervisionado, semiautônomo e autônomo controlado.
- Regras de negação aplicadas pelo próprio Claude Code, detecção de comando destrutivo, limite de tempo e detecção de agente travado.

## Testes executados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Sem erros |
| `npm test` | 122 de 122 |
| Uso real no navegador | Assistente, equipe, chat com menção e missão completa com Claude e Codex |

Na validação pela interface: o assistente reconheceu as contas reais, a agente respondeu no teste de integração, o coordenador planejou, Codex implementou, Claude revisou e aprovou, e o relatório apareceu. Depois de reiniciar o servidor, missão, tarefas, histórico e terminal continuavam lá.

## Bugs encontrados usando de verdade

- Seletores criando arrays novos quebravam a tela com um laço de renderização. A compilação não pegava: agora há um teste que recusa esse padrão, e a interface tem uma proteção contra tela em branco.
- O terminal mostrava o histórico duas vezes.
- Tarefas antigas continuavam na tela depois de aprovar o plano.
- Quem falava por último em "Equipe, ..." não recebia o que os colegas disseram.
- Um arquivo do usuário fora do Git podia travar a integração com uma mensagem crua.
- Avisos irrelevantes de conectores da conta poluíam o terminal.

## Limitações

- O CLI em modo não interativo não consegue parar no meio de uma tarefa para pedir confirmação. A supervisão é por tarefa, e a detecção de comando destrutivo age assim que o comando aparece, podendo não impedir um comando já em curso.
- O Claude no nível "editar" não roda comandos de terminal. Quem precisa rodar testes usa Codex no nível "editar", ou Claude em "total" no modo autônomo.
- Um worktree não tem `node_modules`: o agente precisa instalar dependências para rodar os testes dentro dele.
- Reorganizar painéis se limita a redimensionar e recolher.
- Sem teste real ainda: chamadas de ferramenta com o Unreal Editor aberto, segunda conta real e Gemini CLI.

## Próxima etapa

Fase 6: empacotamento, instalador, atualização automática e publicação.

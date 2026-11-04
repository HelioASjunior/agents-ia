# Relatório da Fase 2: orquestrador

## Implementado

- **Missões persistentes:** planejamento, aprovação, execução, pausa, relatório, conclusão, falha e cancelamento.
- **Coordenador real:** examina o projeto em modo somente leitura e devolve um plano validado (responsável, dependências, ciclos). Plano com formato errado ganha uma segunda chance.
- **Tarefas** com ID, descrição, responsável, prioridade, dependências, estado, horários, histórico, arquivos alterados, resultado, handoff, tentativas e ligação com as execuções e os logs.
- **Execução:** sequencial quando há dependência e paralela quando não há, com limite configurável.
- **Handoff automático:** cada tarefa recebe o que os colegas entregaram, e a passagem fica registrada.
- **Revisão entre agentes:** reprovação cria correção para o autor e nova revisão; nada que depende dela segue antes. Revisão sem veredito nunca passa como aprovada.
- **Falhas:** erro comum é tentado de novo; limite, login e ferramenta ausente pausam com instrução clara. Há opção de passar a tarefa a um agente de outro provedor, desligada por padrão, e nunca para outra conta do mesmo provedor.
- **Comandos:** editar o plano, refazer com orientação, pausar, retomar, cancelar, tentar de novo, pular, reatribuir e enviar orientações durante a missão.
- **Modo sequência:** a ordem dos agentes é definida pelo usuário.
- **Relatório final:** texto do coordenador mais uma parte factual tirada dos registros.
- **Recuperação:** fechar no meio pausa a missão, e ela pode ser retomada.
- **Estados dos agentes** derivados só de eventos reais, base do escritório virtual.

## Testes executados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Sem erros |
| `npm test` | 84 de 84, cerca de 12 s |
| Missão real (`apps/server/test/real/real-mission.test.ts`) | Passou, cerca de 2 min |

Na missão real, Claude Code (haiku) planejou e revisou, e Codex CLI implementou. O teste executou `node --test` no código entregue, que passou, e conferiu handoff, revisão aprovada, relatório e que o planejamento não alterou nenhum arquivo.

## Bugs encontrados pelos testes

- A coluna de posição das tarefas não aceitava as tarefas de correção inseridas entre outras. Corrigido antes de publicar a migração.
- A posição das correções podia ultrapassar a tarefa seguinte depois de algumas rodadas. Agora usa ponto médio.

## Limitações

- Um revisor em "somente leitura" não consegue rodar testes, só ler. Quem deve rodar testes precisa do nível "editar" no Codex ou "total" no Claude.
- Paralelismo no mesmo diretório depende de o plano separar bem os arquivos. O isolamento por worktree entra na Fase 4; até lá, o padrão é uma tarefa por vez.
- A detecção de agente travado usa o tempo sem atividade da execução, 30 minutos por padrão.

## Próxima etapa

Fase 3: interface, chat, terminal e painel.

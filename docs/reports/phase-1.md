# Relatório da Fase 1: backend, persistência e integração real com CLIs

## Implementado

- **Detecção real:** versão e capacidades de cada CLI, lidas do próprio `--help`.
- **Perfis isolados** por provedor, com login no fluxo oficial, e distinção entre assinatura e API.
- **Execução real** com streaming, fila por agente, cancelamento que encerra a árvore de processos e continuação de sessão.
- **SQLite:** WAL, chaves estrangeiras, busy timeout, índices, transações, migrações versionadas, cópia antes de migrar, backup diário, recuperação de banco danificado, recusa de banco mais novo que o app.
- **Persistência desacoplada:** serviços usam interfaces assíncronas, e SQL só existe em `persistence/sqlite`.
- **WebSocket** com reenvio do que faltou ao reconectar.
- **Integrações por agente:** plugins, skills e MCP, com a predefinição Unreal Engine em modo exclusivo.
- **Segurança:** escuta só em `127.0.0.1`, token por inicialização, verificação de Host e Origin, validação com zod, mascaramento de segredos, prompt só por stdin, ambiente sem chaves de API.

## Testes executados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Sem erros |
| `npm test` (3 rodadas) | 56 de 56 em cada rodada, cerca de 6,5 s |
| `npm run test:real` (Claude Code 2.1.318, Codex 0.166.0) | 10 de 10, cerca de 97 s |

Os testes reais comprovam: login reconhecido como assinatura; perfil novo não enxerga o login padrão; Claude e Codex criando arquivos com acentos em uma pasta com espaço no nome; continuação de sessão; somente leitura impedindo alterações; cancelamento real; plugin e MCP do Unreal carregados no Claude; configuração do MCP aceita pelo Codex.

## Bugs reais encontrados pelos testes

- Conexão WebSocket recusada deixava o socket aberto, o que impedia o app de encerrar. Corrigido, com teste próprio.
- O Node descontinuou passar argumentos com `shell: true`. A linha de comando agora é montada de forma explícita.

## Limitações

- Login de uma **segunda conta real** não foi feito: exige você no navegador. O isolamento foi provado por um perfil vazio não enxergar o login padrão.
- **Gemini CLI** não está instalado aqui, então o adaptador segue sem teste real.
- **Unreal Editor** não estava aberto: chamadas reais de ferramenta MCP seguem sem teste.
- `node:sqlite` ainda é marcado como experimental pelo Node.
- O login abre uma janela de terminal externa. O terminal embutido com PTY entra na Fase 3.

## Próxima etapa

Fase 2: orquestrador, tarefas e colaboração entre agentes.

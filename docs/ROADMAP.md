# Roteiro do XinoIA

Uma fase só avança depois de testada. Um item só é marcado quando existe comprovação.

## Fase 1: estrutura, backend, persistência e integração real com CLIs

- [x] Detectar CLIs, versões e capacidades
- [x] Verificar autenticação e distinguir assinatura de API
- [x] Perfis isolados por fornecedor, com login oficial
- [x] SQLite com migrações versionadas, cópia de segurança e recuperação
- [x] Execução real com streaming, cancelamento e continuação de sessão
- [x] Eventos persistidos e transmitidos por WebSocket
- [x] Integrações por agente (plugins, skills e MCP, incluindo Unreal Engine)
- [x] Proteções da API local e mascaramento de segredos

**Critério de conclusão:** um teste real faz o Claude e o Codex alterarem arquivos em uma
pasta temporária, os eventos sobrevivem a um reinício, e o isolamento dos perfis é provado.

## Fase 2: orquestrador

Plano de execução, tarefas com ID, prioridade, dependências, estado, horários, histórico,
arquivos alterados, resultado e tentativas. Execução paralela quando as tarefas forem
independentes, revisão entre agentes, retentativa, detecção de agente travado, handoff
automático e relatório final.

**Critério:** um objetivo vira um plano, um agente implementa, outro revisa, e uma reprovação
volta para correção, tudo com CLIs reais.

## Fase 3: chat, terminal e monitoramento

Interface React. Chat com streaming, Markdown, destaque de sintaxe, anexos, busca e menções.
Terminal com xterm.js e PTY, filtros por agente e tarefa, histórico pesquisável e interrupção.
Painel com métricas reais e linha do tempo.

**Critério:** todas as ações disponíveis pela interface, testadas em navegador real.

## Fase 4: projetos, workflows e Git

Importar repositórios, memória por projeto, registro de decisões. Git worktrees para trabalho
paralelo, detecção de conflitos e revisão antes do merge. Editor visual de workflows com
condições, tentativas e modelos prontos.

**Critério:** dois agentes em paralelo não sobrescrevem um ao outro, e um workflow criado
visualmente executa de verdade.

## Fase 5: escritório virtual e identidade visual

Escritório isométrico original, com salas e avatares dirigidos por eventos reais, além de uma
visualização compacta. Identidade XinoIA: logotipo, ícone, splash, boas-vindas, modo claro e
escuro, onboarding.

**Critério:** cada estado visual corresponde a um evento verificável do backend.

## Fase 6: segurança, empacotamento, atualização e publicação

Modos supervisionado, semiautônomo e autônomo controlado. Confirmação de comandos destrutivos.
Casca Electron, instalador `XinoIA-Setup-vX.X.X.exe`, versão portátil, atualização automática
em Configurações > Sobre o XinoIA > Atualizações, canais estável e beta, GitHub Actions com
permissões mínimas, checksums, assinaturas, documentação pública.

**Critério:** em um ambiente limpo, instalar, abrir, usar, fechar, reabrir, atualizar para uma
nova versão e desinstalar, preservando os dados na atualização.

## Testes que exigem pessoa e conta real

Login oficial de uma segunda conta, ferramentas MCP com o Unreal Editor aberto, Gemini CLI com
conta real e alertas do SmartScreen. Esses itens ficam separados dos testes automatizados e
serão relatados como pendentes até serem feitos.

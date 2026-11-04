# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Backend local com API, WebSocket e proteção por token, host e origem.
- Banco SQLite em modo WAL, com migrações versionadas, cópia de segurança e recuperação de banco danificado.
- Adaptadores para Claude Code e Codex CLI, testados com contas reais, e para Gemini CLI e agentes personalizados.
- Perfis isolados por provedor, com login no fluxo oficial de cada CLI.
- Execução real com streaming, cancelamento, continuação de sessão e mascaramento de segredos.
- Integrações por agente: plugins, skills e MCP, incluindo Unreal Engine.
- Orquestrador de missões: plano, dependências, execução paralela, handoff automático, revisão com volta para correção, retentativas, pausa e retomada, e relatório final.
- Estados dos agentes derivados de eventos reais.

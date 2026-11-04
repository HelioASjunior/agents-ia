# Arquitetura do XinoIA

O XinoIA é um aplicativo desktop local-first que coordena agentes de IA executando os
**CLIs oficiais** de cada fornecedor, com o login que o próprio usuário fez em cada um.

## Estado encontrado

O repositório `HelioASjunior/agents-ia` estava vazio e privado quando o projeto começou,
então não havia código a preservar.

## Princípios

1. **O escritório representa eventos reais.** Todo estado visual vem de um evento emitido
   pelo backend, a partir da saída verdadeira de um processo.
2. **O XinoIA nunca toca em credenciais.** O login acontece no fluxo oficial de cada CLI. O
   app só define em qual pasta cada perfil guarda seus dados e nunca lê esses arquivos.
3. **Nada de cobrança por API sem querer.** Variáveis como `ANTHROPIC_API_KEY` são removidas
   do ambiente dos processos dos provedores conhecidos.
4. **Dados fora da pasta de instalação.** Atualizar ou desinstalar não apaga dados do usuário.
5. **Nada é inventado.** Consumo e limites só aparecem quando o CLI os informa.

## Decisões de stack

Cada decisão foi testada nesta máquina (Windows 11, Node 24.13, Electron 45.2.2).

| Decisão | Motivo | Alternativa descartada |
| --- | --- | --- |
| **Electron** | Traz o Node junto, então o usuário final não instala nada. `electron-updater` é o atualizador oficial do ecossistema. | **Tauri** exigiria empacotar um Node à parte como sidecar para rodar os mesmos processos, somando complexidade sem ganho aqui. |
| **`node:sqlite`** | Vem no runtime, sem compilação nativa. Testado dentro do Electron 45. | `better-sqlite3` exige módulo nativo reconstruído para cada versão do Electron. |
| **`node-pty`** | Traz binários prontos para Windows. Testado dentro do Electron 45. | Terminal falso baseado só em pipes não serve para fluxos interativos, como o login. |
| **Fastify + WebSocket** | API local validada e streaming bidirecional. | SSE não serve para a entrada do terminal interativo. |
| **TypeScript sem etapa de build no desenvolvimento** | O Node 24 executa TS direto. O empacotamento usa esbuild. | `ts-node` e similares são uma dependência a mais. |
| **React, Vite, Tailwind, xterm.js** (Fase 3) | Componentes e terminal real. | |

`node:sqlite` ainda é marcado como experimental pelo Node. O acesso fica concentrado em
`apps/server/src/db/`, de modo que trocar o driver afete só essa pasta.

## Estrutura

```text
apps/
  server/            Backend local (API, processos, orquestração)
    src/
      config.ts      Pastas de dados por sistema operacional
      db/            Conexão SQLite e migrações versionadas
      providers/     Um adaptador por CLI; nada fora daqui conhece flags
      process/       Criação de processos, ambiente limpo, execução com streaming
      services/      Regras de negócio (perfis, agentes, projetos, execuções...)
      security/      Proteção HTTP e mascaramento de segredos
      routes/        Endpoints REST
      ws/            Transmissão de eventos em tempo real
    test/            Testes unitários, de integração e com CLIs reais
  web/               Interface React (Fase 3)
  desktop/           Casca Electron, instalador e atualizador (Fase 6)
packages/
  shared/            Tipos e validações usados por backend e interface
docs/                Arquitetura, roteiro, provedores
```

## Fluxo de uma execução

```text
POST /api/runs
  └─ RunService: registra a execução e coloca na fila do agente (um trabalho por vez)
       └─ Adaptador: monta os argumentos; prompt sempre por stdin
            └─ spawnCli: CLI oficial, com ambiente limpo e pasta do perfil
                 └─ Parser: cada linha do CLI vira um evento normalizado
                      └─ Mascara segredos ─ grava no SQLite ─ transmite por WebSocket
```

O prompt nunca é passado como argumento, então nada digitado pelo usuário chega ao shell.
Os poucos argumentos variáveis passam por validação de formato.

## Segurança

- O servidor só escuta em `127.0.0.1`.
- Toda requisição precisa de um token gerado a cada inicialização, o que impede outro
  usuário ou programa do mesmo computador de comandar os agentes.
- `Host` e `Origin` são conferidos, bloqueando ataques vindos de páginas web e DNS rebinding.
- Toda entrada é validada com zod.
- Logs e eventos passam por mascaramento de segredos antes de serem gravados.

## Banco de dados

Migrações numeradas, cada uma dentro de uma transação. Antes de aplicar qualquer migração
em um banco existente, é feita uma cópia em `backups/`. Se uma migração falhar, ela é
desfeita, o banco fica na versão anterior e a inicialização mostra o erro.

Ao iniciar, execuções que estavam rodando quando o app fechou são marcadas como
`interrupted`, porque o processo delas não existe mais.

## Pastas de dados

| Sistema | Local |
| --- | --- |
| Windows | `%APPDATA%\XinoIA` |
| macOS | `~/Library/Application Support/XinoIA` |
| Linux | `$XDG_DATA_HOME/XinoIA` ou `~/.local/share/XinoIA` |

Cada perfil do sistema operacional tem seus próprios dados.

## Distribuição e atualização (Fase 6)

- **Instalador:** `electron-builder` com NSIS gera `XinoIA-Setup-vX.X.X.exe`, além de uma
  versão portátil.
- **Atualização:** `electron-updater` lê os metadados do GitHub Releases, com canais
  `latest` e `beta`. Nunca executa código de uma branch.
- **Autenticidade:** o hash em `latest.yml` só prova integridade, porque está no mesmo lugar
  que o arquivo. Autenticidade vem de assinatura:
  1. Assinatura Ed25519 do instalador. A chave privada fica em um segredo do GitHub, e a
     pública vai embutida no app, que recusa a atualização se a verificação falhar. Não
     depende de certificado pago.
  2. Assinatura de código Windows (Authenticode), preparada para quando houver certificado.
     Só ela ajuda com o SmartScreen, e mesmo assim depende de reputação.
- **Reinício:** com agentes em execução, a atualização espera o fim do trabalho ou uma
  autorização explícita.

# Como contribuir

Contribuições são bem-vindas. Para mudanças grandes, abra uma issue antes para combinar a abordagem.

## Ambiente

Você precisa de [Node.js 24+](https://nodejs.org) e [Git](https://git-scm.com).

```bash
git clone https://github.com/HelioASjunior/agents-ia.git
cd agents-ia
npm install
```

Para rodar com recarregamento, em dois terminais:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Use o endereço mostrado no primeiro terminal trocando a porta por `5173`, mantendo o `#token=...`. Os dados de desenvolvimento ficam em `.xinoia-dev`, separados de uma instalação normal.

Para testar o app desktop:

```bash
npm run start:desktop
```

## Testes

| Comando | O que faz |
| --- | --- |
| `npm run typecheck` | Verifica os tipos |
| `npm test` | Testes automatizados, com um CLI falso |
| `npm run test:real` | Usa os CLIs e as contas reais, e gasta cota do seu plano |
| `npm run test:dist` | Instala e testa o pacote de `release/` |

## Regras

As regras do projeto estão em [CLAUDE.md](CLAUDE.md). Em resumo:

- Não coloque IA como coautora em commits ou PRs.
- Mudança importante atualiza `README.md` e `README.pt-BR.md`.
- Nada de dados inventados: consumo, limites e estados vêm de eventos reais.
- O produto nunca lê, copia ou guarda credenciais dos CLIs, nem usa técnicas para contornar limites dos fornecedores.

## Onde mexer

Veja [a arquitetura](docs/ARCHITECTURE.md).

**Adicionar uma ferramenta de IA:** crie um adaptador em `apps/server/src/providers/`, registre em `registry.ts` e teste o parser com linhas capturadas de uma execução real. Ajuste `docs/PROVIDERS.md`, dizendo o que foi testado de verdade.

**Mudar o banco:** adicione uma migração nova em `persistence/sqlite/migrations.ts`. Nunca altere uma já publicada.

## Pull requests

- Descreva o problema, a solução e como testou.
- Inclua testes para o que mudou.
- Confira se `npm run typecheck` e `npm test` passam.

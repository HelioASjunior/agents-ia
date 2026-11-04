# Regras do repositório XinoIA

Valem para qualquer pessoa ou agente que trabalhe aqui.

## Commits e pull requests

- **Nunca** coloque Claude ou outra IA como colaborador. Sem `Co-Authored-By`, sem "Generated with" em commits, PRs ou releases.
- Nunca faça commit de credenciais, dados pessoais ou da pasta de dados do app.

## README

- `README.md` (inglês) e `README.pt-BR.md` (português) precisam estar sempre atualizados.
- Toda mudança importante que deva constar neles (recursos, instalação, requisitos, provedores suportados, downloads) atualiza **os dois** no mesmo commit.
- Nunca anuncie como disponível o que ainda não existe ou não foi testado.

## Código

- Antes de considerar algo pronto, rode `npm run typecheck` e `npm test`.
- `npm run test:real` usa os CLIs e as contas reais e gasta cota: rode só quando mexer em integração com provedores.
- Só o que estiver em `apps/server/src/providers/` conhece as opções de cada CLI.
- Só o que estiver em `apps/server/src/persistence/` conhece SQL. Serviços usam as interfaces de `persistence/types.ts`.
- Migrações publicadas nunca são alteradas; mudanças de esquema entram como migração nova.
- O prompt nunca é passado como argumento de linha de comando, só por stdin.
- O produto nunca lê, copia ou guarda credenciais dos CLIs, e não tem agentes simulados.
- Nada de dados inventados: consumo, limites e estados só aparecem quando vêm de um evento real.

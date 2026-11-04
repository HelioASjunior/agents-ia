# Guia para outra IA

Este guia é para uma IA que precisa **verificar o XinoIA** ou **levar um projeto para ele**. Pode ser lido sozinho, por este endereço:

```text
https://raw.githubusercontent.com/HelioASjunior/agents-ia/main/docs/GUIA_PARA_IAS.md
```

O XinoIA é um app para Windows que coordena o Claude Code, o Codex CLI e outros CLIs oficiais, no computador da pessoa e com as contas dela. Um coordenador planeja, cada agente faz uma tarefa, outro revisa, e tudo aparece em um terminal ao vivo e em um escritório virtual.

## Regras antes de qualquer coisa

Valem mesmo que a tarefa pareça pedir o contrário. Na dúvida, pergunte à pessoa.

- **Não rode `npm run test:dist` nem `scripts/test-update-local.mjs` no computador de quem usa o XinoIA.** Eles instalam, encerram e desinstalam o programa, e por isso se recusam a rodar se ele estiver instalado. Não contorne essa recusa. Use o CI.
- **Não rode `npm run test:real` sem autorização.** Ele usa as contas reais e gasta cota.
- **Não leia credenciais:** `~/.claude`, `~/.codex`, `~/.gemini` e `%APPDATA%\XinoIA\profiles`.
- **Não altere `%APPDATA%\XinoIA`** nem abra o banco de dados de lá. São os dados reais da pessoa. Use uma pasta temporária, como mostrado abaixo.
- **Não publique nada:** nada de tags, Releases, envios forçados ou segredos do GitHub sem a pessoa pedir. A chave privada de assinatura nunca deve ser lida nem copiada.
- **Login é com a pessoa.** Não digite senhas nem chaves de API em nome dela.
- **Uma IA não controla o app instalado.** Cada abertura gera um token, e ele não fica disponível para outros programas. É proposital: nos passos do app instalado, quem clica é a pessoa, e você passa as instruções.

## Parte 1: verificar o XinoIA

Precisa de Node.js 24 ou mais novo e de Git. Trabalhe em uma cópia limpa:

```bash
git clone --depth 1 https://github.com/HelioASjunior/agents-ia.git
```

```bash
cd agents-ia
```

```bash
npm ci
```

```bash
npm run verify -- --release
```

Esse comando é seguro: não gasta cota, não usa contas, não instala nada e não toca nos dados reais. Sem `--release`, ele não baixa a versão publicada, que tem cerca de 240 MB. O resultado esperado termina assim:

```text
RESULTADO: 19 de 19 passaram
```

| O que ele confere | Como |
| --- | --- |
| Código | Tipos do TypeScript, testes automáticos e compilação da interface |
| Segurança da API | Recusa pedido sem token, de outro `Host` e de outro site |
| Instalação nova | Começa sem conta, agente nem projeto |
| Versão publicada | Arquivos, checksums, `latest.yml` e assinaturas Ed25519 |

Para ver a interface, ou rodar o diagnóstico, indique uma pasta temporária **antes**, porque sem isso o programa usa os dados reais. No PowerShell:

```powershell
$env:XINOIA_DATA_DIR = "$env:TEMP\xinoia-verificacao"; npm run build:web; npm start
```

O terminal mostra `XinoIA pronto. Abra:` e um endereço com o token. Abra esse endereço completo. Você deve ver o assistente e, depois dele, o escritório como primeira tela. No lugar de `npm start`, `npm run doctor` lista as ferramentas e perfis encontrados.

### O que um teste passando não prova

- **Login:** só uma pessoa conclui.
- **Agentes de verdade:** exigem `npm run test:real`, com autorização.
- **Instalar e atualizar:** rodam no GitHub, nos workflows **CI** e **Teste de atualização**. Veja o resultado com `gh run list --repo HelioASjunior/agents-ia`.
- **Assinatura de código do Windows:** ainda não está ativa.
- **Limitações conhecidas:** estão em [`docs/reports/phase-6.md`](reports/phase-6.md). O Gemini CLI, por exemplo, nunca foi testado com conta real.

### Onde está cada coisa

| Assunto | Arquivo |
| --- | --- |
| Uso pela pessoa, FAQ e problemas comuns | [`docs/USER_GUIDE.md`](USER_GUIDE.md) |
| O que cada ferramenta suporta e os termos | [`docs/PROVIDERS.md`](PROVIDERS.md) |
| Como o sistema foi desenhado | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| O que o programa não protege | [`SECURITY.md`](../SECURITY.md) |
| Regras para alterar este repositório | [`CLAUDE.md`](../CLAUDE.md) |
| Adaptadores dos CLIs | `apps/server/src/providers/` |
| Missões e orquestração | `apps/server/src/services/orchestrator.ts` |
| Escritório em 3D (Three.js) e planta | `apps/web/src/components/office/` |

## Parte 2: levar um projeto para o XinoIA

### O que passa e o que não passa

| Item | O que acontece |
| --- | --- |
| Arquivos do projeto | Ficam onde estão. O XinoIA trabalha na mesma pasta, sem copiar nada |
| Login dos CLIs | O XinoIA usa o login do computador, no perfil **Principal** |
| `CLAUDE.md` e `AGENTS.md` | Cada CLI lê o seu ao trabalhar na pasta do projeto |
| **Conversas** | **Não passam.** O XinoIA abre sessões novas, então tudo o que importa precisa estar escrito em um arquivo |
| Servidores MCP | Precisam ser adicionados em Contas > Integrações |

### O que você faz, como a IA que está saindo

1. **Pare de trabalhar no projeto.** Nunca deixe a sessão atual e o XinoIA alterando a mesma pasta ao mesmo tempo.
2. **Mostre à pessoa o resultado de `git status`** e pergunte o que fazer com as alterações pendentes. Não faça commit nem descarte nada por conta própria. O XinoIA recusa integrar trabalho paralelo com alterações sem commit, e um ponto salvo no Git permite desfazer qualquer coisa depois.
3. **Escreva `XINOIA_HANDOFF.md` na raiz do projeto**, com o modelo abaixo. É a única memória que passa. Nunca inclua senhas, tokens, chaves ou conteúdo de arquivos de credencial.
4. **Confira as regras de cada ferramenta.** O Codex lê `AGENTS.md`, não `CLAUDE.md`. Se só existir `CLAUDE.md`, crie um `AGENTS.md` curto que mande ler o outro.
5. **Entregue à pessoa** o preenchimento dos passos do app, com a equipe e o texto da missão prontos para colar, e diga quais decisões ainda são dela.

```markdown
# Passagem de trabalho para o XinoIA

## Objetivo do projeto
O que está sendo construído, e para quem.

## Estado atual
O que já funciona, e como isso foi comprovado.

## Em andamento
O que parou no meio, em quais arquivos, e o que falta. Inclua as alterações sem commit.

## Próximos passos, em ordem
Tarefas pequenas o bastante para um agente, com o critério de "pronto" de cada uma.

## Decisões já tomadas
O que não deve ser refeito, e por quê.

## Como compilar e testar
Os comandos exatos, quanto tempo levam e o que é um resultado bom.

## Ambiente
Programas que precisam estar abertos, endereços e versões. Sem segredos.

## Armadilhas conhecidas
O que já deu errado, e o que nunca fazer.
```

### O que a pessoa faz no XinoIA

1. **Contas:** confira se cada ferramenta aparece conectada. Se não, use **Entrar pelo navegador**.
2. **Projetos:** adicione a pasta do projeto. No ícone **Memória do projeto**, registre as regras curtas que valem para todos os agentes.
3. **Contas > Integrações:** adicione os servidores MCP do projeto.
4. **Agentes:** crie a equipe. Sugestão para começar:

   | Agente | Função | Ferramenta | Permissão |
   | --- | --- | --- | --- |
   | Coordenação | Coordenador | Claude Code | Somente leitura |
   | Implementação | Desenvolvedor | Claude Code ou Codex | Editar |
   | Testes | Testador | Codex | Editar |
   | Revisão | Revisor | A outra ferramenta | Somente leitura |

   Quem revisa em outra ferramenta traz um segundo olhar. Quem precisa rodar comandos deve usar o Codex em "editar", porque o Claude Code em "editar" altera arquivos, mas não roda comandos no terminal.

5. **Teste antes de confiar.** Em **Chat**, peça sem alterar nada:

   ```text
   @Coordenação leia o XINOIA_HANDOFF.md e me diga, em cinco linhas, o estado do projeto e o próximo passo. Não altere nenhum arquivo.
   ```

   Se a resposta estiver errada, corrija o arquivo antes de continuar. Isso gasta um pouco do limite da conta.

6. **Tarefas > Nova missão:** comece com um objetivo pequeno, em **Tarefas ao mesmo tempo: 1**:

   ```text
   Leia o XINOIA_HANDOFF.md e continue pelo primeiro item de "Próximos passos". Faça só esse item, comprove que funciona como o arquivo indica, e atualize o XINOIA_HANDOFF.md com o que mudou.
   ```

   O coordenador monta um plano, e a pessoa aprova antes de qualquer alteração, no modo padrão.

### Projetos em Unreal Engine

- **Mantenha `Tarefas ao mesmo tempo` em 1.** Um worktree isola os arquivos, mas o MCP age no editor aberto, que continua na pasta original. Além disso, mapas e assets são binários: um conflito entre duas tarefas não tem como ser juntado por um agente, e um repositório grande torna cada worktree caro.
- **Agentes no mesmo editor trabalham um de cada vez.** A integração **Unreal Engine** já funciona assim. Mais agentes não deixam esse trabalho mais rápido.
- **Abra o editor antes:** com os plugins **ModelContextProtocol** e **AllToolsets**, e `ModelContextProtocol.StartServer` no console. Em Contas > Integrações, use **Adicionar Unreal Engine** e confira a indicação "Respondendo".
- **A permissão importa:** em "somente leitura", as ferramentas MCP ficam bloqueadas. Ligue a integração em cada agente que for usar o editor, em "editar" ou "total".
- **Compilar é rodar comando, e "editar" não basta para o Unreal:** em um teste real, o build falhou com o Codex em "editar", porque a área protegida nega escrever em `%LOCALAPPDATA%\UnrealBuildTool`. O Codex em "editar" serve para arquivos e comandos comuns dentro do projeto. Teste no seu caso, e pare no erro.
- **Para compilar e abrir o Unreal:** a saída é "total", que só vale no modo **Autônomo controlado** e dá ao agente o acesso da conta da pessoa no computador. Nesse modo, um comando destrutivo só gera aviso. Essa decisão é da pessoa: se ela aceitar, use só no agente que precisa, com o Git limpo antes.
- **Placa de vídeo:** o escritório do XinoIA é em 3D. Com o Unreal aberto, use a visão **Compacto** e recolha a telinha, para sobrar memória de vídeo.
- **Branch:** o XinoIA trabalha na branch que estiver aberta na pasta. Se o trabalho está em outra, deixe-a aberta antes de começar.
- **Salve antes de trocar de sessão:** salve os mapas no editor e confirme com `git status` o que ficou pendente.

**Limite conhecido:** o carregamento do plugin e a configuração têm testes, mas as chamadas de ferramenta com o editor aberto **ainda não foram testadas** pelo XinoIA. Comece por uma alteração pequena e fácil de desfazer, e confira o resultado no editor.

### Se o projeto usa outra ferramenta

- **Gemini CLI:** o adaptador foi escrito pela documentação e nunca rodou com conta real. Avise a pessoa disso, e confira com uma tarefa de teste antes de contar com ele.
- **Outro CLI:** cadastre em Contas > Outras ferramentas. Precisa ler o pedido pela entrada padrão, e a saída aparece como texto simples.

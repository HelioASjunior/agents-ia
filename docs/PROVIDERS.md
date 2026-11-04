# Provedores: o que funciona, como e com qual limitação

O XinoIA executa o CLI oficial de cada fornecedor, instalado pelo próprio usuário e sem modificações. O login é feito no fluxo oficial do CLI, e o XinoIA só define em qual pasta cada perfil fica.

## Situação de cada integração

| Ferramenta | Assinatura sem API | Vários perfis | Streaming e sessão | MCP | Situação |
| --- | --- | --- | --- | --- | --- |
| **Claude Code** | Sim (`claude.ai`) | `CLAUDE_CONFIG_DIR` | Sim | Sim, com plugins | Testado com conta real (v2.1.318) |
| **Codex CLI** | Sim (ChatGPT) | `CODEX_HOME` | Sim | Só HTTP; skills pelo prompt | Testado com conta real (v0.166.0) |
| **Gemini CLI** | Login Google | `GEMINI_CLI_HOME` | Sim, pela documentação | Configurar no perfil | **Não testado**: escrito pela documentação |
| **Agente personalizado** | Depende do CLI | Se o CLI tiver variável de pasta | Saída como texto | Não | Testado com CLI local de teste |

A documentação do Google informa que o Gemini CLI foi substituído pelo Antigravity CLI em junho de 2026. Quando houver como testar, ele deve ganhar um adaptador próprio; até lá, pode ser cadastrado como agente personalizado.

## Assinatura não é API

O XinoIA remove do ambiente dos processos variáveis como `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` e `GEMINI_API_KEY`, para que os CLIs conhecidos usem o login do perfil e não gerem cobrança por API sem querer. A tela de contas distingue os dois casos com base no que o próprio CLI informa, e uma execução por credencial de API gera um aviso.

Consumir a assinatura não é o mesmo que ter acesso ilimitado: os limites do plano continuam valendo. O XinoIA mostra uso e renovação somente quando o CLI informa. Hoje só o Claude Code expõe esses dados em cada execução, e o custo em dólar que ele calcula **não** é exibido, porque não é o que uma assinatura paga.

## Termos dos fornecedores

Este resumo não é aconselhamento jurídico. Quem distribui e quem usa o XinoIA deve ler os termos de cada fornecedor.

Pela [página de conformidade do Claude Code](https://code.claude.com/docs/en/legal-and-compliance), consultada em novembro de 2026:

- É permitido que a pessoa entre com a própria assinatura no binário oficial, sem modificações.
- Terceiros não podem oferecer login do Claude.ai dentro do próprio app, nem coletar ou intermediar credenciais e tokens, nem encaminhar pedidos pelas credenciais de assinatura em nome de usuários.
- Quem incorpora ou executa o Claude Code em um produto ou serviço deve aceitar os Termos Comerciais, não pode modificar o binário nem remover métodos de autenticação, e não pode pagar, revender ou intermediar o uso. Cada usuário autentica por conta própria.
- Dá para dizer, em texto simples, que um produto executa o Claude Code. Os nomes e logotipos não podem fazer parte do nome ou logotipo do produto, nem sugerir parceria.
- Os limites anunciados presumem uso comum e individual.

Pelo [artigo de suporte da Anthropic](https://support.claude.com/en/articles/15036540), `claude -p` continua usando os limites da assinatura; o artigo informa que a mudança anunciada para junho de 2026 foi pausada.

**Como o XinoIA respeita isso:** não inclui nenhum CLI no instalador, não modifica binários, não vê credenciais, e cada instalação usa só as contas de quem a instalou. O XinoIA não tem servidor próprio nem revende acesso.

### Várias contas

Perfis separados usam um recurso dos próprios CLIs. A documentação consultada não trata especificamente do uso de várias assinaturas pela mesma pessoa. Por cautela, o XinoIA **não troca de conta sozinho** quando um limite é atingido: revezar contas para contornar limites poderia violar os termos. Quando um limite é atingido, a tarefa para com uma mensagem clara, e a decisão de esperar ou trocar é sua.

## Unreal Engine (Epic Games)

O plugin oficial `unreal-engine-skills-for-claude-code` traz skills e usa o servidor MCP embutido no Unreal Editor.

Requisitos no editor: plugins **ModelContextProtocol** e **AllToolsets** habilitados, editor aberto e servidor iniciado com `ModelContextProtocol.StartServer`. O endereço padrão é `http://127.0.0.1:8000/mcp`.

| | Claude Code | Codex CLI |
| --- | --- | --- |
| Skills | Plugin carregado de verdade, mesmo em perfis isolados | Caminho dos `SKILL.md` indicado no prompt |
| Ferramentas do editor | `--mcp-config`, liberadas nos níveis "editar" e "total" | `-c mcp_servers.unreal-mcp.url=...` |

- O nível "somente leitura" não libera ferramentas MCP, porque não há como saber quais delas alteram o editor.
- A integração é **exclusiva**: agentes que a usam entram em fila, porque a própria skill alerta que alterações simultâneas no mesmo editor podem conflitar.
- Se o servidor não responder, a execução registra um aviso real em vez de presumir que funcionou.

**Testado:** carregamento do plugin e configuração do MCP com Claude Code real, e aceitação da configuração pelo Codex real. **Não testado:** chamadas reais de ferramenta com o Unreal Editor aberto, porque o editor não estava em execução nos testes. Esse teste está pendente e exige um projeto Unreal aberto.

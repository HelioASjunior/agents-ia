# Provedores: o que funciona, como e com qual limitação

O XinoIA executa o CLI oficial de cada fornecedor, instalado pelo próprio usuário e sem modificações. O login é feito no fluxo oficial do CLI, e o XinoIA só define em qual pasta cada perfil fica.

## Situação de cada integração

| Ferramenta | Assinatura pelo navegador | Chave de API | Vários perfis | Streaming e sessão | MCP | Situação |
| --- | --- | --- | --- | --- | --- | --- |
| **Claude Code** | Sim (`claude.ai`) | `ANTHROPIC_API_KEY` | `CLAUDE_CONFIG_DIR` | Sim | Sim, com plugins | Testado com conta real (v2.1.318) |
| **Codex CLI** | Sim (ChatGPT) | `CODEX_API_KEY` | `CODEX_HOME` | Sim | Só HTTP; skills pelo prompt | Testado com conta real (v0.166.0) |
| **Gemini CLI** | Login Google | `GEMINI_API_KEY` | `GEMINI_CLI_HOME` | Sim, pela documentação | Configurar no perfil | **Não testado**: escrito pela documentação |
| **Agente personalizado** | Depende do CLI | Não | Se o CLI tiver variável de pasta | Saída como texto | Não | Testado com CLI local de teste |

A documentação do Google informa que o Gemini CLI foi substituído pelo Antigravity CLI em junho de 2026. Quando houver como testar, ele deve ganhar um adaptador próprio; até lá, pode ser cadastrado como agente personalizado.

## Assinatura e chave de API

Cada perfil usa uma coisa só. O XinoIA remove do ambiente dos processos variáveis como `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` e `GEMINI_API_KEY` herdadas do computador, para que um perfil de assinatura use o login dele e não gere cobrança por API sem querer. A tela de contas distingue os dois casos, e uma execução por credencial de API gera um aviso.

Um perfil de **chave de API** tem pasta própria, e a chave é a única variável desse tipo que o processo recebe. Ela fica cifrada pelo Windows (DPAPI), presa ao usuário do sistema, e o banco e as cópias de segurança só têm o texto cifrado. A chave não é conferida ao ser guardada, porque isso custaria uma chamada paga: quem recusa uma chave ruim é a primeira execução.

**O que foi testado:** com uma chave inválida, o Claude Code e o Codex CLI reais recusaram a chave, sem cair na assinatura da mesma máquina e sem que ela aparecesse em eventos ou logs. Uma execução paga até o fim ainda não foi testada, e o Gemini CLI, em nenhuma forma.

Consumir a assinatura não é o mesmo que ter acesso ilimitado: os limites do plano continuam valendo. O XinoIA mostra uso e renovação somente quando o CLI informa. Hoje só o Claude Code expõe esses dados em cada execução, e o custo em dólar que ele calcula **não** é exibido, porque não é o que uma assinatura paga.

## Área protegida do Codex no Windows

Em "somente leitura" e "editar", o Codex precisa de uma área protegida no Windows. Sem nenhuma definida, ele rejeita todo comando com `blocked by policy`.

Se o `config.toml` do perfil tiver `[windows] sandbox`, vale essa escolha. O login do computador costuma ter uma, definida pelo app do Codex. Um perfil separado começa sem, e aí o XinoIA usa `unelevated`, que não pede administrador. A documentação da OpenAI indica `elevated` como preferida, por isolar melhor a rede, mas ela exige um pedido de administrador, que uma execução automática não teria como responder. Quem quiser pode definir `elevated` no `config.toml` do perfil.

O primeiro comando em um perfil novo pode demorar, enquanto o Codex prepara a área protegida.

## Termos dos fornecedores

Este resumo não é aconselhamento jurídico. Quem distribui e quem usa o XinoIA deve ler os termos de cada fornecedor.

Pela [página de conformidade do Claude Code](https://code.claude.com/docs/en/legal-and-compliance), consultada em novembro de 2026:

- É permitido que a pessoa entre com a própria assinatura no binário oficial, sem modificações.
- Terceiros não podem oferecer login do Claude.ai dentro do próprio app, nem coletar ou intermediar credenciais e tokens, nem encaminhar pedidos pelas credenciais de assinatura em nome de usuários.
- Quem incorpora ou executa o Claude Code em um produto ou serviço deve aceitar os Termos Comerciais, não pode modificar o binário nem remover métodos de autenticação, e não pode pagar, revender ou intermediar o uso. Cada usuário autentica por conta própria.
- Dá para dizer, em texto simples, que um produto executa o Claude Code. Os nomes e logotipos não podem fazer parte do nome ou logotipo do produto, nem sugerir parceria.
- Os limites anunciados presumem uso comum e individual.

Pelo [artigo de suporte da Anthropic](https://support.claude.com/en/articles/15036540), `claude -p` continua usando os limites da assinatura; o artigo informa que a mudança anunciada para junho de 2026 foi pausada.

**Como o XinoIA respeita isso:** não inclui nenhum CLI no instalador, não modifica binários, não vê credenciais de login, e cada instalação usa só as contas de quem a instalou. O XinoIA não tem servidor próprio nem revende acesso. O botão **Entrar pelo navegador** só executa `claude auth login` do binário oficial, e a entrada termina na página da própria Anthropic. A chave de API é a de cada pessoa, e o uso é cobrado dela.

**Ponto em aberto:** a mesma página diz que desenvolvedores de produtos devem usar chave de API e que terceiros não podem oferecer o login do Claude.ai nos próprios apps, mas também diz que isso não impede a pessoa de entrar no binário oficial com a própria assinatura. Entendemos que o XinoIA está no segundo caso, mas isso é uma interpretação, sem confirmação da Anthropic. Antes de divulgar amplamente, vale perguntar pelo [contato comercial](https://www.anthropic.com/contact-sales), indicado na página para esse tipo de dúvida.

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

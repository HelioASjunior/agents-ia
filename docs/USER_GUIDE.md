# Guia do XinoIA

## Instalar

1. Abra [Releases](https://github.com/HelioASjunior/agents-ia/releases) e baixe `XinoIA-Setup-vX.X.X.exe`.
2. Execute o instalador. Escolha a pasta e se quer um atalho na área de trabalho.
3. Abra o **XinoIA** pelo menu Iniciar.

Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e em **Executar assim mesmo**. Esse aviso aparece porque o instalador ainda não tem certificado de assinatura de código. Veja [Segurança](../SECURITY.md).

**Versão portátil:** baixe `XinoIA-Portable-vX.X.X.exe`, coloque em uma pasta e execute. Os dados ficam em `XinoIA-dados`, ao lado do programa. Ela não se atualiza sozinha.

## Primeira execução

O assistente confere as ferramentas de IA, conecta suas contas, escolhe uma pasta de projeto, cria uma equipe inicial e faz um teste real de integração.

## Ferramentas de IA

O XinoIA não inclui nenhuma delas. Instale as que quiser e entre com a sua própria conta.

Se ainda não tiver, instale o [Node.js](https://nodejs.org), que os comandos abaixo usam.

| Ferramenta | Instalar | Entrar |
| --- | --- | --- |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | Pelo XinoIA, em Contas > Login |
| Codex CLI | `npm install -g @openai/codex` | Pelo XinoIA, em Contas > Login |
| Gemini CLI (não testado) | `npm install -g @google/gemini-cli` | Pelo XinoIA, em Contas > Login |

Depois de instalar, clique em **Verificar tudo** em Contas.

### Várias contas

Em Contas, use **Adicionar conta** e **Criar um perfil separado**. Cada perfil guarda o login em uma pasta própria. No login, confira no navegador se a conta certa está aberta.

Use apenas contas suas e respeite os termos de cada fornecedor. O XinoIA nunca troca de conta sozinho para contornar um limite. Veja [Provedores](PROVIDERS.md).

## Agentes

Cada agente tem função, ferramenta, conta, modelo e nível de permissão.

| Permissão | Pode fazer |
| --- | --- |
| Somente leitura | Lê o projeto. Não altera arquivos, não roda comandos e não usa ferramentas MCP. |
| Editar | Altera arquivos do projeto. No Codex, roda comandos na área protegida. No Claude, comandos de terminal continuam bloqueados. |
| Total | Roda qualquer comando, com o acesso da sua conta no computador. Só vale no modo autônomo. |

**Dica:** quem revisa em "somente leitura" só lê o código. Para alguém rodar os testes, use um agente Codex em "editar".

## Missões

Em **Tarefas**, ou com **Missão** ligada no chat da equipe, descreva um objetivo:

1. O coordenador examina o projeto e monta um plano.
2. Você edita, aprova ou pede outro plano.
3. Cada agente faz sua parte e passa o resultado adiante.
4. Quem revisa aprova ou reprova. Uma reprovação volta para correção.
5. Sai um relatório final.

Dá para pausar, retomar, cancelar, tentar de novo, pular e reatribuir tarefas, e orientar a equipe durante a execução.

### Tarefas em paralelo

Com **Tarefas ao mesmo tempo** acima de 1, em um projeto Git com ao menos um commit, cada tarefa trabalha em um worktree próprio. Sua pasta só muda quando você aprovar a integração no fim. Se duas tarefas mexerem no mesmo ponto, uma tarefa nova resolve o conflito. Sem Git, a missão roda uma tarefa por vez.

Um worktree começa sem `node_modules`, então o agente precisa instalar dependências para rodar testes nele.

## Chat

- **Equipe:** sem menção, responde o coordenador.
- **@nome:** chama um agente.
- **Equipe, ...:** todos analisam em modo leitura, e o coordenador decide por último. Consome mais do seu limite.
- **Agente:** conversa direta, que continua de onde parou.

## Workflows

Desenhe etapas e ligações, escolha quem faz cada uma, e defina condições como "só se a revisão aprovar". Os modelos prontos podem ser copiados e alterados.

## Unreal Engine

1. No Unreal Editor, habilite os plugins **ModelContextProtocol** e **AllToolsets**, e rode `ModelContextProtocol.StartServer` no console.
2. No Claude Code, instale o plugin oficial: `/plugin install unreal-engine-skills-for-claude-code@claude-plugins-official`.
3. Em Contas > Integrações, clique em **Adicionar Unreal Engine**. A indicação "Respondendo" confirma que o editor está acessível.
4. Em Agentes, ligue a integração no agente, em nível "editar" ou "total". Em "somente leitura", as ferramentas MCP ficam bloqueadas.

Agentes no mesmo editor trabalham um de cada vez.

## Modos de execução

Em Configurações. Em execução automática as ferramentas não conseguem parar no meio para perguntar, então a proteção vem de limites definidos antes.

| Modo | Plano | Tarefas | Permissão total | Comando destrutivo |
| --- | --- | --- | --- | --- |
| Supervisionado | Você aprova | Você libera cada uma | Limitada a editar | Interrompe e pede decisão |
| Semiautônomo | Você aprova | Seguem sozinhas | Limitada a editar | Interrompe e pede decisão |
| Autônomo controlado | Pode ser automático | Seguem sozinhas | Permitida | Registra um aviso |

A detecção de comando destrutivo é uma rede de proteção, não uma garantia. Em projetos importantes, use Git.

## Atualizações

Em **Configurações > Atualizações**, veja a versão, verifique, atualize e escolha o canal (estável ou beta). O XinoIA verifica ao abrir e a cada 4 horas. Antes de instalar, confere a assinatura do pacote e faz uma cópia dos seus dados. Com agentes trabalhando, ele espera terminarem, a menos que você autorize interromper.

## Onde ficam os dados

Em `%APPDATA%\XinoIA`, fora da pasta do programa. Atualizar ou desinstalar não apaga nada. Para apagar tudo, remova essa pasta depois de desinstalar. Backups ficam em `backups`, e os logs, em `logs`.

Nada é enviado a um servidor do XinoIA, que não existe. Seus pedidos vão aos fornecedores das ferramentas que você usa, e o app só consulta o GitHub para saber de atualizações.

## Problemas comuns

**"A conta precisa de login"**: em Contas, clique em Login. O login oficial pode expirar.

**"A ferramenta não está instalada", mas está**: feche e abra o XinoIA, ou reinicie o Windows depois de instalar a ferramenta, para o `PATH` atualizar.

**"Limite de uso da conta"**: o limite do seu plano foi atingido. Espere renovar, troque a conta do agente ou reatribua a tarefa.

**"Permissão negada para: Bash"**: o agente tentou rodar um comando sem ter permissão. Veja a tabela de permissões.

**O agente diz que não consegue rodar testes**: use um agente com permissão para isso. Em worktrees, ele também precisa instalar as dependências.

**Integrar diz que há alterações sem commit**: faça commit ou guarde suas alterações, e tente de novo. Isso existe para nada do que é seu ser sobrescrito.

**O MCP do Unreal aparece "Sem resposta"**: abra o editor, inicie o servidor e confira o endereço, que por padrão é `http://127.0.0.1:8000/mcp`.

**O XinoIA diz que o banco é de uma versão mais nova**: você abriu dados de uma versão mais nova em uma mais antiga. Instale a versão mais recente.

**Banco danificado**: o XinoIA guarda o arquivo ao lado e restaura a cópia mais recente, e avisa em Configurações > Dados.

## Perguntas frequentes

**Preciso de chave de API?** Não, para Claude Code e Codex CLI com assinatura. Os limites do plano continuam valendo.

**O XinoIA vê minha senha?** Não. O login é feito no fluxo oficial de cada ferramenta, e o XinoIA não lê os arquivos em que ela guarda o acesso.

**Quanto custa?** O XinoIA é gratuito. O uso das ferramentas segue o seu plano com cada fornecedor.

**Funciona sem internet?** A interface sim, mas as ferramentas de IA precisam de internet.

**Funciona no macOS e no Linux?** O projeto está preparado para isso, mas só o Windows é testado e distribuído por enquanto.

**Agentes podem estragar meu projeto?** Podem, como qualquer pessoa com acesso aos arquivos. Use Git, comece em uma pasta de teste e mantenha permissões baixas. Em paralelo, o trabalho fica isolado até você aprovar.

**Isso é um produto oficial da Anthropic, OpenAI, Google ou Epic Games?** Não. É um projeto independente.

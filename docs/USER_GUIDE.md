# Guia do XinoIA

## Instalar

1. Abra [Releases](https://github.com/HelioASjunior/agents-ia/releases) e baixe `XinoIA-Setup-vX.X.X.exe`.
2. Execute o instalador. Escolha a pasta e se quer um atalho na área de trabalho.
3. Abra o **XinoIA** pelo menu Iniciar.

Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e em **Executar assim mesmo**. Esse aviso aparece porque o instalador ainda não tem certificado de assinatura de código. Veja [Segurança](../SECURITY.md).

**Versão portátil:** baixe `XinoIA-Portable-vX.X.X.exe`, coloque em uma pasta e execute. Os dados ficam em `XinoIA-dados`, ao lado do programa. Ela não se atualiza sozinha.

## Primeira execução

O assistente mostra as IAs, instala a que faltar, conecta sua conta, escolhe uma pasta de projeto, cria uma equipe inicial e faz um teste real de integração.

## Ferramentas de IA

O XinoIA não inclui nenhuma delas. No assistente, ou em Contas, clique em **Instalar** para rodar o instalador oficial à sua vista. Se preferir, rode em um terminal:

| Ferramenta | Instalar | Precisa de Node.js |
| --- | --- | --- |
| Claude Code | `irm https://claude.ai/install.ps1 \| iex` (PowerShell) | Não |
| Codex CLI | `npm install -g @openai/codex` | Sim |
| Gemini CLI (não testado) | `npm install -g @google/gemini-cli` | Sim |

Instalou por fora? Clique em **Verificar tudo** em Contas.

### Entrar pelo navegador

Clique em **Entrar pelo navegador**. A página oficial do fornecedor abre, e você entra como sempre, inclusive com o Google, se a sua conta usar. A janela do XinoIA fecha sozinha quando o login termina. Se o navegador não abrir, use **Abrir a página de novo**. Se a ferramenta perguntar algo, ou o navegador mostrar um código, clique em **Ver terminal** e responda lá.

### Usar uma chave de API

Clique em **Usar chave de API** e cole a chave. Ela fica em um perfil próprio, cifrada pelo Windows e presa ao seu usuário, e não volta para a tela. Só a ferramenta daquele perfil a recebe, ao executar. Para tirá-la daqui, remova o perfil, e para invalidá-la de vez, revogue-a no site do fornecedor.

Com chave de API, cada uso é cobrado pelo fornecedor, à parte da assinatura. Por enquanto, isso só funciona no Windows. Uma cópia de segurança restaurada em outro computador ou outro usuário do Windows não consegue ler a chave: informe-a de novo com **Trocar chave**.

### Várias contas

Em Contas, use **Adicionar conta** e **Entrar em outra conta pelo navegador**. Cada perfil guarda o login em uma pasta própria. No login, confira no navegador se a conta certa está aberta.

Use apenas contas suas e respeite os termos de cada fornecedor. O XinoIA nunca troca de conta sozinho para contornar um limite. Veja [Provedores](PROVIDERS.md).

## Agentes

Cada agente tem função, ferramenta, conta, modelo e nível de permissão. Os modelos do Codex vêm do catálogo da versão instalada. No Claude, a lista traz a versão fixa, como **Opus 5.5 (claude-opus-5-5)**, e os apelidos, como **opus**, que acompanham a versão mais recente. O card do agente mostra o modelo que a última execução informou ter usado. Nem toda conta tem acesso a todos: se a execução recusar, escolha outro modelo ou outra conta. Em **Outro…**, dá para digitar um nome fora da lista.

| Permissão | Pode fazer |
| --- | --- |
| Somente leitura | Lê o projeto. Não altera arquivos, não roda comandos e não usa ferramentas MCP. |
| Editar | Altera arquivos do projeto. No Codex, roda comandos na área protegida, que não grava fora da pasta do projeto: programas como o Unreal Engine precisam de "total" para compilar. No Claude, comandos de terminal continuam bloqueados. |
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

**Reserva da etapa:** em **Se a conta atingir o limite**, escolha quem assume aquela etapa. O padrão é **Pausar e esperar**, e a escolha vale só naquela etapa daquele workflow.

- A reserva precisa ser de outro provedor e ter permissão igual ou maior que a do responsável. Trocar de conta no mesmo provedor seria contornar o limite. A tela avisa ao configurar, e na hora da troca a missão pausa e diz por quê.
- A troca acontece uma vez por tarefa. Se a reserva também atingir o limite, a missão pausa.
- A troca aparece no card e no detalhe da tarefa, na linha do tempo e no relatório final. Quem assume é avisado de que o trabalho pode ter parado no meio.
- Quem dá a reserva decide o que ela faz: se a mesma reserva assumir o trabalho e o teste, ela testa o próprio trabalho. Para manter um olhar independente, deixe a revisão sem reserva.

## Fila de objetivos

Em **Fila**, dê uma lista de objetivos a um workflow. Cada objetivo vira uma missão, e o próximo começa quando ela termina.

| Opção | O que faz |
|---|---|
| **Workflow** | O processo usado em todos os objetivos. |
| **Se um objetivo falhar** | **Parar e esperar por mim** deixa a missão pausada para você resolver. **Registrar e seguir** cancela a missão, anota o motivo e passa para o próximo. |
| **Limite de gasto** | Soma de tokens de entrada e saída. É conferido entre um objetivo e outro: o que está em andamento termina. Se alguma execução não informar consumo, a fila para em vez de seguir sem saber o gasto. |

- Só o que ainda não começou pode ser editado, reordenado ou removido. Um objetivo que falhou pode voltar para a fila.
- **Git sujo:** com alterações sem commit, a fila não começa o objetivo e cita os arquivos. Termine o workflow com uma etapa que faça commit, ou faça você e clique em **Continuar**. Em um projeto sem Git, essa conferência não acontece.
- **Aprovação:** fora do modo autônomo controlado, cada objetivo espera a aprovação do plano. A fila nunca dispensa o que o modo exige.
- **Limite de uso e login:** a fila nunca pula esses problemas, mesmo em **Registrar e seguir**, porque o próximo objetivo pararia pelo mesmo motivo. Se a etapa do workflow tiver uma [reserva](#workflows), ela assume e a fila segue.
- **Uma tarefa de cada vez:** a fila roda na pasta do projeto, sem tarefas em paralelo.
- **Ao fechar o app:** nada novo começa sozinho ao reabrir. A missão interrompida continua esperando você, e nenhum objetivo roda duas vezes.

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

Em **Configurações > Atualizações**, veja a versão, verifique, atualize e escolha o canal (estável ou beta). O XinoIA verifica ao abrir e a cada 4 horas. Antes de instalar, confere a assinatura do pacote e faz uma cópia dos seus dados. Nada é instalado sem você pedir. Com trabalho em andamento, escolha **Instalar quando terminar**. Se escolher **Interromper e reiniciar**, a missão fica pausada: ao retomar, a tarefa interrompida recomeça do início, e o que ela já alterou nos arquivos continua lá.

## Onde ficam os dados

Em `%APPDATA%\XinoIA`, fora da pasta do programa. Atualizar ou desinstalar não apaga nada. Para apagar tudo, remova essa pasta depois de desinstalar. Backups ficam em `backups`, e os logs, em `logs`.

Nada é enviado a um servidor do XinoIA, que não existe. Seus pedidos vão aos fornecedores das ferramentas que você usa, e o app só consulta o GitHub para saber de atualizações.

## Problemas comuns

**"A conta precisa de login"**: em Contas, clique em **Entrar pelo navegador**. O login oficial pode expirar.

**"O provedor recusou a chave de API"**: a chave foi revogada, digitada errada ou está sem crédito. Em Contas, clique em **Trocar chave**.

**"A ferramenta não está instalada", mas está**: feche e abra o XinoIA, ou reinicie o Windows depois de instalar a ferramenta, para o `PATH` atualizar.

**"Limite de uso da conta"**: o limite do seu plano foi atingido. Espere renovar, troque a conta do agente ou reatribua a tarefa.

**"Permissão negada para: Bash"**: o agente tentou rodar um comando sem ter permissão. Veja a tabela de permissões.

**O agente diz que não consegue rodar testes**: use um agente com permissão para isso. Em worktrees, ele também precisa instalar as dependências.

**Integrar diz que há alterações sem commit**: faça commit ou guarde suas alterações, e tente de novo. Isso existe para nada do que é seu ser sobrescrito.

**O MCP do Unreal aparece "Sem resposta"**: abra o editor, inicie o servidor e confira o endereço, que por padrão é `http://127.0.0.1:8000/mcp`.

**O XinoIA diz que o banco é de uma versão mais nova**: você abriu dados de uma versão mais nova em uma mais antiga. Instale a versão mais recente.

**Banco danificado**: o XinoIA guarda o arquivo ao lado e restaura a cópia mais recente, e avisa em Configurações > Dados.

## Perguntas frequentes

**Preciso de chave de API?** Não, para Claude Code e Codex CLI com assinatura, em que os limites do plano continuam valendo. A chave é uma opção para quem prefere pagar por uso.

**O que é a "chave de assinatura" citada na publicação do XinoIA?** Nada que quem usa o app precise conhecer. Ela só comprova que uma atualização veio do projeto, e fica com quem publica. Não tem relação com o login nem com a chave de API das IAs.

**O XinoIA vê minha senha?** Não. O login é feito no fluxo oficial de cada ferramenta, e o XinoIA não lê os arquivos em que ela guarda o acesso. A única credencial que passa por ele é a chave de API, se você escolher usar uma.

**Onde vejo os agentes trabalhando?** No **Escritório**, a primeira tela, e na telinha **Escritório ao vivo**, acima do terminal, nas outras telas. Cada agente vai para a mesa quando recebe trabalho e volta para a copa quando termina.

**O escritório em 3D pesa no computador?** Ele usa a placa de vídeo, com no máximo 30 quadros por segundo, e para quando a janela fica oculta. Se você usa outro programa pesado em 3D, como o Unreal Editor, escolha **Compacto** no Escritório e recolha a telinha **Escritório ao vivo**: a cena deixa de ser desenhada, e as mesmas informações aparecem em uma tabela.

**Quanto custa?** O XinoIA é gratuito. O uso das ferramentas segue o seu plano com cada fornecedor.

**Funciona sem internet?** A interface sim, mas as ferramentas de IA precisam de internet.

**Funciona no macOS e no Linux?** O projeto está preparado para isso, mas só o Windows é testado e distribuído por enquanto.

**Agentes podem estragar meu projeto?** Podem, como qualquer pessoa com acesso aos arquivos. Use Git, comece em uma pasta de teste e mantenha permissões baixas. Em paralelo, o trabalho fica isolado até você aprovar.

**Isso é um produto oficial da Anthropic, OpenAI, Google ou Epic Games?** Não. É um projeto independente.

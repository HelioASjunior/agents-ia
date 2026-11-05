# XinoIA — Sua equipe de IA, no seu computador, em um só escritório

<p align="center">
  <a href="README.md">English</a> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <img src="docs/assets/banner.png" alt="XinoIA: uma equipe, todos os agentes, trabalho real.">
</p>

<p align="center">
  <a href="https://github.com/HelioASjunior/agents-ia/releases"><img src="https://img.shields.io/badge/Baixar%20para%20Windows-.exe-2DD4BF?style=for-the-badge&logo=windows11&logoColor=white" alt="Baixar para Windows"></a>
</p>

<p align="center">
  <a href="https://github.com/HelioASjunior/agents-ia/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/HelioASjunior/agents-ia/ci.yml?branch=main&style=flat-square&label=ci" alt="Situação do CI"></a>
  <a href="https://github.com/HelioASjunior/agents-ia/releases"><img src="https://img.shields.io/github/v/release/HelioASjunior/agents-ia?include_prereleases&style=flat-square&label=vers%C3%A3o&color=F5B544" alt="Versão mais recente"></a>
  <img src="https://img.shields.io/badge/plataforma-Windows%2010%2F11-2DD4BF?style=flat-square" alt="Plataforma: Windows 10 e 11">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-Apache--2.0-blue?style=flat-square" alt="Licença: Apache-2.0"></a>
</p>

O XinoIA coloca Claude Code, Codex CLI e outros agentes de programação para trabalhar como uma equipe no seu computador. Você passa um objetivo. Um coordenador planeja, cada agente assume uma tarefa e entrega o resultado para o próximo, e outro agente revisa. Você acompanha tudo em um terminal ao vivo, conversa com qualquer agente pelo chat e vê o trabalho acontecer em um escritório virtual em 3D, em estilo de jogo, onde cada animação vem de um evento real.

**Suas contas, sua máquina.** O XinoIA roda no seu computador e usa o CLI oficial de cada fornecedor. Você escolhe a IA e entra pelo navegador, com a sua assinatura, ou usa uma chave de API, se preferir. Ele nunca vê suas senhas ou tokens de login, e uma chave de API fica cifrada pelo Windows. Projetos, conversas e histórico ficam em um banco de dados local, e não existe servidor, cadastro nem telemetria do XinoIA. Ele só consulta o GitHub para saber de atualizações, e seus pedidos vão para as ferramentas de IA que você escolher.

[Baixar](https://github.com/HelioASjunior/agents-ia/releases) · [Guia de uso](docs/USER_GUIDE.md) · [Suporte a provedores](docs/PROVIDERS.md) · [Arquitetura](docs/ARCHITECTURE.md) · [Segurança](SECURITY.md) · [Novidades](CHANGELOG.md)

<p align="center">
  <img src="docs/assets/screens/escritorio.png" alt="O escritório virtual durante uma missão real, com o terminal ao vivo ao lado.">
</p>

## Instalação

### Windows 10 e 11

1. Abra [Releases](https://github.com/HelioASjunior/agents-ia/releases) e baixe o `XinoIA-Setup-vX.X.X.exe`.
2. Execute o instalador.
3. Abra o **XinoIA** pelo menu Iniciar. Um assistente rápido cuida do resto.

Você não precisa de Node.js nem de ferramentas de desenvolvimento para rodar o XinoIA. As atualizações chegam dentro do programa, e seus dados são preservados.

> [!NOTE]
> O instalador ainda não tem certificado de assinatura de código da Microsoft, então o Windows pode mostrar o aviso do SmartScreen. Clique em **Mais informações** e em **Executar assim mesmo**. [Por que isso acontece](SECURITY.md#instalador-e-smartscreen). O plano para a assinatura está na [Code signing policy](#code-signing-policy).

Prefere não instalar? Baixe o `XinoIA-Portable-vX.X.X.exe`, que guarda os dados em uma pasta ao lado dele.

### Suas ferramentas de IA

O XinoIA não as inclui, mas o assistente ajuda: escolha a IA, instale com um clique, se ainda não tiver, e conecte a sua conta.

- **Entrar pelo navegador:** abre a página oficial do fornecedor, onde você entra como sempre, inclusive com o Google, se a sua conta usar. A janela fecha sozinha quando o login termina.
- **Usar chave de API:** para quem prefere pagar por uso. A chave fica cifrada pelo Windows, presa ao seu usuário.

<p align="center">
  <img src="docs/assets/screens/sua-ia.png" alt="Escolha da IA no assistente: entrar pelo navegador ou usar uma chave de API." width="640">
</p>

O instalador do Claude Code não precisa de Node.js. Os do Codex CLI e do Gemini CLI precisam do [Node.js](https://nodejs.org).

## O que ele faz

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screens/plano.png" alt="Um plano real aguardando aprovação"></td>
    <td width="50%"><img src="docs/assets/screens/tarefas.png" alt="Quadro de tarefas durante uma missão"></td>
  </tr>
  <tr>
    <td><b>O coordenador planeja, você aprova.</b> Ele examina o projeto antes. Dá para editar o plano ou pedir outro.</td>
    <td><b>O trabalho passa de um agente para o outro sozinho.</b> Cada tarefa recebe o que os colegas entregaram, e uma reprovação volta para correção.</td>
  </tr>
  <tr>
    <td><img src="docs/assets/screens/chat.png" alt="Chat com um agente"></td>
    <td><img src="docs/assets/screens/workflows.png" alt="Editor visual de workflows"></td>
  </tr>
  <tr>
    <td><b>Fale com quem quiser.</b> Use <code>@nome</code>, ou comece com "Equipe, ..." para ouvir todos. As conversas continuam de onde pararam.</td>
    <td><b>Desenhe o seu processo.</b> Etapas e condições, ou comece de um modelo pronto.</td>
  </tr>
</table>

- **Escritório em 3D:** cada agente é um personagem com mesa na sala da função dele. Quem recebe trabalho sai da copa, vai a pé até a mesa e começa a digitar, o monitor acende e o balão mostra o que está fazendo. Uma telinha do escritório fica à vista nas outras telas. Precisa de WebGL, e a visão Compacta mostra as mesmas informações em uma tabela.
- **Terminal ao vivo:** a saída real de cada ferramenta, da equipe toda ou de um agente, com busca, e preservada entre reinícios. Há também um terminal interativo de verdade.
- **Trabalho paralelo isolado:** em um projeto Git, tarefas em paralelo rodam em worktrees separados. Sua pasta só muda depois que você revisa e aprova. Um conflito vira uma tarefa, e ninguém tem o trabalho sobrescrito.
- **Fila de objetivos:** dê a um workflow uma lista ordenada de objetivos, e cada um começa quando o anterior termina. Você escolhe se uma falha para a fila, é registrada e pulada, ou tem o trabalho guardado em uma branch local só dela antes de seguir, e pode definir um limite de tokens. Se uma conta atingir o limite de uso, a fila espera, a menos que aquela etapa do workflow tenha uma reserva escolhida por você. Ela não começa um objetivo com alterações sem commit e mostra por que parou. Fora do modo autônomo, cada plano continua esperando a sua aprovação. Até agora foi testada só com o CLI de teste, não com contas reais.
- **Modos de execução:** supervisionado, semiautônomo e autônomo controlado, com limites de permissão, regras de negação e interrupção de comandos destrutivos.
- **Números honestos:** uso e limites só aparecem quando a ferramenta informa. Nada é inventado.
- **Unreal Engine:** use as skills oficiais da Epic Games e as ferramentas do Unreal Editor por MCP.

## Como as partes se encaixam

- **Provedores** são adaptadores em volta de cada CLI oficial, sem modificações. Adicionar uma ferramenta não afeta o resto.
- **Perfis** mantêm cada conta em uma pasta própria, usando o isolamento que o próprio CLI oferece.
- **Agentes** combinam um papel, uma ferramenta, um perfil, um nível de permissão e integrações.
- **Missões** transformam um objetivo em tarefas, com dependências, revisões e um relatório final.
- **O escritório** mostra esses eventos, sem decidir nada: quem está disponível fica na copa, quem está trabalhando fica na mesa, e quem entrega uma tarefa leva o documento até o colega.
- **SQLite** guarda tudo localmente, em modo WAL, com migrações versionadas e cópias de segurança automáticas. Você não instala um servidor de banco de dados.

## Ferramentas suportadas

| Ferramenta | Assinatura pelo navegador | Chave de API | Vários perfis | MCP | Situação |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Sim | Sim | Sim | Sim, com plugins | Testado com conta real |
| Codex CLI | Sim | Sim | Sim | Só HTTP | Testado com conta real |
| Gemini CLI | Login Google | Sim | Sim | Configurar no perfil | Escrito pela documentação, **ainda não testado** |
| Agentes locais personalizados | Depende da ferramenta | Depende da ferramenta | Depende da ferramenta | Não | Testado com CLI local de teste |

A chave de API foi testada só com uma chave inválida, recusada pelo fornecedor nos dois CLIs reais: isso prova que é ela a credencial usada. Uma execução paga até o fim ainda não foi testada.

Assinatura não é acesso ilimitado: os limites do seu plano continuam valendo. Com chave de API, cada uso é cobrado pelo fornecedor, à parte da assinatura. O XinoIA nunca troca de conta sozinho para contornar um limite. Use apenas contas suas e respeite os termos de cada fornecedor. Veja [o suporte a provedores](docs/PROVIDERS.md) para detalhes e um resumo dos termos.

## Unreal Engine

Ative a integração Unreal Engine em qualquer agente para usar as skills oficiais da Epic Games e as ferramentas do Unreal Editor. O Claude Code carrega o plugin mesmo em um perfil separado, e o Codex CLI recebe o servidor MCP e os caminhos das skills. Agentes no mesmo editor trabalham um de cada vez. [Configuração](docs/USER_GUIDE.md#unreal-engine).

O carregamento do plugin e a configuração têm testes. As chamadas de ferramenta com o editor aberto ainda não foram testadas.

## Segurança

- O servidor local escuta só em `127.0.0.1` e exige um token gerado a cada inicialização, com verificação de `Host` e `Origin`.
- Os pedidos passam por stdin e nunca viram argumentos de linha de comando.
- Segredos e sua pasta pessoal são mascarados antes de qualquer coisa ser salva ou exibida.
- Atualizações só são instaladas depois de conferir uma assinatura Ed25519, com a chave pública embutida no programa. Checksum sozinho não prova de onde um arquivo veio.
- Agentes são poderosos: no nível mais alto de permissão, um deles pode fazer o que a sua conta de usuário pode. Use Git e comece com permissões baixas. [Contra o que o XinoIA não protege](SECURITY.md#o-que-o-xinoia-não-faz).

## Documentação

| Objetivo | Comece por |
| --- | --- |
| Instalar e usar, perguntas frequentes e problemas comuns | [Guia de uso](docs/USER_GUIDE.md) |
| Aprender como o sistema funciona e como usá-lo | [Guia de estudo (PDF)](docs/study/XinoIA-Guia-de-Estudo-pt-BR.pdf) |
| O que funciona por assinatura, e termos dos fornecedores | [Suporte a provedores](docs/PROVIDERS.md) |
| Entender o desenho | [Arquitetura](docs/ARCHITECTURE.md) · [Roteiro](docs/ROADMAP.md) |
| Publicar uma versão | [Publicação](docs/RELEASING.md) |
| Relatar uma vulnerabilidade | [Segurança](SECURITY.md) |
| Pedir a outra IA para verificar o XinoIA ou levar um projeto para ele | [Guia para outra IA](docs/GUIA_PARA_IAS.md) |

## Code signing policy

**A assinatura ainda não está ativa:** o projeto pretende pedir a assinatura gratuita da SignPath Foundation, mas o pedido ainda não foi feito, e os arquivos saem sem assinatura de código. Se for aprovado, vale o texto abaixo:

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- **Quem altera o código e revisa:** [HelioASjunior](https://github.com/HelioASjunior)
- **Quem aprova cada assinatura:** [HelioASjunior](https://github.com/HelioASjunior)
- **Privacidade:** este programa não transfere informações para outros sistemas em rede, a não ser quando pedido por quem o instala ou opera. Veja a [política de privacidade](PRIVACY.md) para cada caso, incluindo a verificação de atualizações, que pode ser desligada, e as ferramentas de IA que você escolher.

Cada versão é compilada automaticamente a partir deste repositório, e a assinatura de cada uma é aprovada à mão. As ferramentas de IA, que você instala à parte, não fazem parte dos arquivos assinados.

## Desenvolvimento

Você precisa do [Node.js 24+](https://nodejs.org) e do [Git](https://git-scm.com).

```bash
git clone https://github.com/HelioASjunior/agents-ia.git
cd agents-ia
npm install
npm run start:desktop
```

```bash
npm run typecheck
npm test
```

O `npm run verify` faz uma verificação completa e segura, sem contas nem cota. `npm run test:real` usa seus CLIs reais e contas logadas, e gasta um pouco da cota do seu plano. Por isso fica fora do CI. Para gerar o instalador, veja [Publicação](docs/RELEASING.md). Para contribuir, veja o [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[Apache License 2.0](LICENSE). A licença não concede direitos sobre o nome e o logotipo do XinoIA; veja o [NOTICE](NOTICE).

O XinoIA é um projeto independente, sem vínculo com Anthropic, OpenAI, Google ou Epic Games, e sem o endosso delas. Claude, Codex, Gemini e Unreal Engine são marcas de seus respectivos donos.

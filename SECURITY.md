# Segurança

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o [relato privado do GitHub](https://github.com/HelioASjunior/agents-ia/security/advisories/new), com os passos para reproduzir e o impacto.

Só a versão mais recente recebe correções.

## O que o XinoIA faz

- **Credenciais:** o login acontece no fluxo oficial de cada CLI. O XinoIA só define a pasta do perfil e não lê os arquivos de acesso. A única credencial que passa por ele é a chave de API que a pessoa escolher informar: ela fica cifrada pelo Windows (DPAPI), presa ao usuário do sistema, nunca volta para a interface, vai ao CLI só pelo ambiente e é mascarada em eventos e logs.
- **API local:** escuta só em `127.0.0.1`, exige um token novo a cada inicialização e confere `Host` e `Origin`, o que bloqueia páginas web e DNS rebinding.
- **Injeção de comandos:** o prompt nunca é argumento de linha de comando, e os valores variáveis passam por validação.
- **Interface:** saída de agente é tratada como não confiável. HTML cru não é renderizado, a Política de Segurança de Conteúdo só permite recursos do próprio app, e a página não tem acesso ao Node.
- **Arquivos:** o visualizador e o editor não saem da pasta do projeto, nem por atalhos.
- **Logs:** segredos conhecidos e a pasta pessoal são mascarados antes de serem gravados ou exibidos.
- **Atualizações:** só são instaladas depois de conferir uma assinatura Ed25519 com a chave pública embutida. O app nunca executa código de uma branch.
- **Publicação:** o workflow só publica se os testes e o teste de instalação passarem, e só o passo final tem permissão de escrita.

## O que o XinoIA não faz

Agentes são programas poderosos. Eles têm limites definidos por você, não uma caixa de areia completa.

- No nível "total", um agente roda comandos com o mesmo acesso da sua conta no computador.
- Em execução automática, o CLI não consegue parar no meio para perguntar. Os modos de execução usam limites prévios, regras de negação e detecção de comandos destrutivos. A detecção é uma rede de proteção: não cobre toda forma de escrever um comando, e pode agir só depois de ele começar.
- O isolamento por worktree separa o trabalho no Git. Não é uma caixa de areia do sistema: um agente com permissão total ainda alcança o resto do computador.
- O conteúdo que um agente lê, como arquivos e páginas, pode tentar enganá-lo (injeção de prompt). Tenha cuidado com projetos de origem desconhecida.
- Dados locais ficam protegidos pela sua conta do sistema operacional, sem criptografia própria.

**Recomendações:** use Git, comece com permissões baixas, e revise antes de integrar.

## Instalador e SmartScreen

O instalador ainda não tem assinatura de código da Microsoft, então o Windows pode mostrar o aviso do SmartScreen. Confira o download com `SHA256SUMS.txt`, publicado junto de cada versão. O checksum só prova que o arquivo chegou inteiro, por isso baixe apenas de [Releases](https://github.com/HelioASjunior/agents-ia/releases).

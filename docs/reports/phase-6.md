# Relatório da Fase 6: segurança, instalador, atualização e publicação

## Implementado

- **Aplicativo desktop:** Electron, com o backend em processo próprio e a página sem acesso ao Node. Tela de abertura, instância única, notificações do sistema e recuperação se o backend cair.
- **Instalador:** `XinoIA-Setup-vX.X.X.exe`, com assistente, escolha de pasta, menu Iniciar, atalho opcional na área de trabalho, ícone próprio e desinstalador que preserva os dados. Versão portátil, com os dados ao lado do programa.
- **Atualização automática:** em Configurações > Atualizações, com verificação ao abrir e a cada 4 horas, canais estável e beta, novidades, progresso real, "Atualizar agora" e "Lembrar depois". Com agentes trabalhando, espera terminarem ou pede autorização. Faz uma cópia dos dados antes de instalar.
- **Autenticidade:** assinatura Ed25519 de cada pacote, conferida com a chave pública embutida. Sem assinatura válida, nada é instalado.
- **Workflows:** CI com testes e empacotamento, e Release que testa, instala em máquina limpa, assina e só então publica. Só o último passo tem permissão de escrita.
- **Documentação pública:** README em inglês e português, guia de uso com FAQ e problemas comuns, provedores, publicação, `CONTRIBUTING.md`, `SECURITY.md`, modelos de issue, licença Apache-2.0.

## Testes executados

| Teste | Onde | Resultado |
| --- | --- | --- |
| `npm run typecheck` e `npm test` (126 testes) | Local e CI | Passaram |
| `npm run test:dist` | Local e **Windows limpo do GitHub** | Passou |
| Atualização real com servidor local (`scripts/test-update-local.mjs`) | Local | Passou |
| `npm run test:real` (13 testes) | Local, com contas reais | Passou |

**`test:dist` comprova:** instalação, primeira abertura com o assistente, nome nas propriedades do executável, backend, banco, terminal PTY, isolamento da página, fechar e reabrir com os dados, nenhum processo para trás, pacote sem dados nem chaves privadas, desinstalação preservando os dados, e versão portátil.

**`test:real` comprova, com Claude Code e Codex CLI de verdade:** login por assinatura, isolamento de perfis, arquivos criados, sessão continuada, somente leitura respeitado, cancelamento, regra de negação valendo com permissão total, plugin e MCP do Unreal carregados, missão completa com código que passa nos testes, e os dois agentes trabalhando ao mesmo tempo em worktrees, com a integração só depois de aprovar.

**A atualização comprova:** detectar a versão nova, baixar, conferir a assinatura, instalar, reabrir sozinho, manter os dados e a cópia de segurança, e **recusar um pacote com assinatura de outra chave**, sem alterar nada.

## Bugs encontrados pelos testes

- `publisherName` na configuração faria o atualizador recusar **todas** as atualizações, por exigir um certificado que não existe.
- A regra `*.pem` do `.gitignore` também ignorava a chave pública, e o CI não compilaria.
- O coordenador e os agentes recebiam a pasta original mesmo em um worktree, o que poderia furar o isolamento. Agora cada um recebe a pasta real de trabalho.
- A barra de progresso ficava vermelha ao chegar a 100%.
- Quem era chamado no chat da equipe não sabia o que tinha feito na última missão.

## O que depende do dono do repositório

1. **Enviar a chave de assinatura ao GitHub.** O ambiente bloqueou esta gravação, com razão:

   ```bash
   gh secret set XINOIA_SIGNING_KEY --repo HelioASjunior/agents-ia < ~/.xinoia-release/update-signing-key.pem
   ```

2. **Publicar a primeira versão.** Publicar uma Release pública também foi bloqueado para decisão humana. Depois do passo 1, siga [Como publicar](../RELEASING.md).
3. **Guardar a chave privada** em `%USERPROFILE%\.xinoia-release\` em um lugar seguro. Sem ela, os apps instalados não aceitam versões novas.
4. **Ler os Termos Comerciais da Anthropic.** A página de conformidade diz que executar o Claude Code em um produto exige aceitá-los. O XinoIA foi desenhado dentro das condições descritas ali, mas essa é uma decisão de quem publica.
5. **Certificado de assinatura de código** (opcional, pago). Sem ele, o Windows mostra o aviso do SmartScreen.

## Limitações e testes pendentes

- O workflow `Release` nunca rodou de ponta a ponta, porque depende dos itens 1 e 2. Os passos dele foram exercitados à parte: testes, empacotamento e teste de instalação no CI, e assinatura e atualização localmente, contra um servidor local em vez do GitHub. O primeiro download real do GitHub ainda precisa ser conferido.
- Exigem pessoa e conta real: login de uma segunda conta, ferramentas MCP com o Unreal Editor aberto, Gemini CLI e o aviso do SmartScreen ao baixar pelo navegador.
- O teste de instalação no CI roda em uma máquina limpa, mas o Windows de lá tem Node.js. Falta uma execução em um Windows sem ele.
- macOS e Linux estão configurados, mas sem testes nem publicação.
- A recuperação depois de uma atualização com falha é a do instalador e a da cópia de segurança. Não há volta automática para a versão anterior.

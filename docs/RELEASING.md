# Como publicar uma versão

## Antes da primeira publicação

1. Envie a chave de assinatura como segredo do repositório. Sem ela, o workflow para antes de publicar No PowerShell ou no Prompt de Comando, rode:

   ```bash
   cmd /c "gh secret set XINOIA_SIGNING_KEY --repo HelioASjunior/agents-ia < %USERPROFILE%\.xinoia-release\update-signing-key.pem"
   ```

## Publicar

```bash
npm run set-version -- 1.2.3
```

Atualize `CHANGELOG.md`, movendo o que está em "Não lançado" para uma seção `## [1.2.3]`. Depois:

```bash
git add -A
git commit -m "Versão 1.2.3"
git tag v1.2.3
git push origin main v1.2.3
```

O workflow `Release` testa, gera os pacotes, instala e testa em uma máquina limpa, assina e só então publica. Se algo falhar, nada é publicado.

- `v1.2.3` é estável, e chega a quem usa o canal estável.
- `v1.2.3-beta.1` é beta, e só chega a quem usa o canal beta.

## Gerar localmente

Para testar o pacote localmente, use um computador sem o XinoIA instalado (veja [Testes de instalação](#testes-de-instalação)).

```bash
npm run build:desktop
cd apps/desktop
npx electron-builder --config electron-builder.yml --publish never --win
cd ../..
npm run test:dist
```

Os arquivos saem em `release/`: `XinoIA-Setup-vX.X.X.exe`, `XinoIA-Portable-vX.X.X.exe` e `latest.yml` ou `beta.yml`.

## Assinatura das atualizações

O app só instala uma atualização depois de conferir uma assinatura Ed25519 do pacote, com a chave pública que vem dentro dele (`apps/desktop/build/update-public-key.pem`).

A chave privada fica no segredo `XINOIA_SIGNING_KEY` do GitHub, com uma cópia em `%USERPROFILE%\.xinoia-release\update-signing-key.pem`, no computador de quem a gerou. Ela nunca entra no repositório.

**Guarde essa cópia em um lugar seguro.** Sem a chave, nenhuma versão nova será aceita pelos apps já instalados, e as pessoas teriam de baixar o instalador à mão.

Se a chave vazar, gere outra, publique uma versão assinada ainda pela chave antiga com a nova chave pública, e avise em `SECURITY.md`.

## Assinatura de código do Windows

Sem assinatura, o Windows mostra o aviso do SmartScreen, e o Controle Inteligente de Aplicativos, no Windows 11, pode bloquear o programa. Com ela, o aviso ainda pode aparecer no começo, até o arquivo ganhar reputação. Só a Microsoft Store elimina o aviso de imediato.

O caminho escolhido é a [SignPath Foundation](https://signpath.org), gratuita para código aberto. O workflow já tem os passos, que ficam desligados até a variável `SIGNPATH_ORGANIZATION_ID` existir.

### Depois da aprovação

1. Na SignPath, crie o projeto com o nome `XinoIA` e ligue o sistema de compilação confiável **GitHub.com**.
2. Crie duas configurações de artefato, com os slugs `programa` e `instaladores`, copiando os arquivos de `.signpath/artifact-configurations/`.
3. Crie a política de assinatura de produção, com você como aprovador, e um usuário de CI com permissão de enviar pedidos.
4. No GitHub, em Settings > Secrets and variables > Actions, crie o segredo `SIGNPATH_API_TOKEN` e as variáveis `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` e `SIGNPATH_POLICY_SLUG`.
5. Tire dos dois READMEs o aviso de que a assinatura ainda não está ativa.
6. Publique uma versão de teste, como `v0.1.1-beta.1`, e confira o aviso no Windows.

### O que muda em cada versão

O workflow para duas vezes e espera a sua aprovação no site da SignPath, por até uma hora em cada:

1. **`programa`:** o `XinoIA.exe`, antes de empacotar. A SignPath não abre instaladores NSIS, então ele precisa ser assinado antes.
2. **`instaladores`:** o instalador e a versão portátil, depois de passarem pelo teste de instalação.

Depois disso, `scripts/refresh-update-info.mjs` refaz o hash, o tamanho e o blockmap, porque assinar muda o arquivo, e só então vem a assinatura Ed25519 das atualizações. Essa ordem importa: invertida, as atualizações seriam recusadas.

### Limitações

- O desinstalador, gerado dentro do instalador, e as bibliotecas de terceiros, como as do Electron e do `node-pty`, não recebem a assinatura. Os termos permitem incluí-las sem assinar.
- O publicador que aparece no Windows é a SignPath Foundation, não o seu nome.
- Só defina `win.signtoolOptions.publisherName` em `electron-builder.yml` depois de publicar ao menos uma versão assinada. Com essa opção, o app passa a recusar qualquer atualização sem o certificado.

Se a SignPath recusar o pedido, as alternativas estão nas [opções de assinatura da Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options). O workflow precisaria ser adaptado.

## Testes de instalação

`npm run test:dist` e `scripts/test-update-local.mjs` instalam, encerram e desinstalam o XinoIA, e por isso se recusam a rodar em um computador com o programa instalado ou aberto. Nesse caso, use o CI: o job `package` e o workflow **Teste de atualização**, que também pode ser disparado à mão.

## macOS e Linux

`electron-builder.yml` já descreve os pacotes. Para distribuir, é preciso adicionar as plataformas ao workflow, testar e, no macOS, ter uma conta Apple Developer para assinar e notarizar. O teste `test:dist` hoje é só para Windows.

## Testes manuais antes de uma versão estável

Exigem pessoa e conta real, por isso não estão no CI:

- [ ] Login oficial de uma conta nova, em um perfil separado
- [ ] Missão real com Claude e Codex (`npm run test:real`)
- [ ] Ferramentas MCP com o Unreal Editor aberto
- [ ] Instalar em um Windows sem Node.js e sem as ferramentas de IA
- [ ] Aviso do SmartScreen ao baixar pelo navegador

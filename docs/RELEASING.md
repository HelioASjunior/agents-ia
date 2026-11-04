# Como publicar uma versão

## Antes da primeira publicação

1. Envie a chave de assinatura como segredo do repositório. Sem ela, o workflow para antes de publicar:

   ```bash
   gh secret set XINOIA_SIGNING_KEY --repo HelioASjunior/agents-ia < ~/.xinoia-release/update-signing-key.pem
   ```

2. Remova dos dois READMEs o aviso de que a primeira versão ainda não foi publicada.

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

## Assinatura de código do Windows (opcional)

Sem certificado, o Windows mostra o aviso do SmartScreen. Nada neste projeto remove esse aviso sozinho.

| Opção | Custo aproximado | Observações |
| --- | --- | --- |
| Certificado OV | Da ordem de centenas de dólares por ano | A reputação se constrói com o tempo, e o aviso pode continuar no começo |
| Certificado EV | Mais caro que OV | Costuma ter reputação mais rápida, mas exige token de hardware ou serviço em nuvem |
| Azure Trusted Signing | Assinatura mensal | Exige requisitos de elegibilidade da Microsoft |

Confira preços e requisitos atuais com os fornecedores. Com um certificado em PFX, defina os segredos `WIN_CSC_LINK` (o arquivo em base64) e `WIN_CSC_KEY_PASSWORD`. O workflow já os usa.

Só defina `win.signtoolOptions.publisherName` em `electron-builder.yml` depois de publicar ao menos uma versão assinada. Com essa opção, o app passa a recusar qualquer atualização sem o certificado.

## macOS e Linux

`electron-builder.yml` já descreve os pacotes. Para distribuir, é preciso adicionar as plataformas ao workflow, testar e, no macOS, ter uma conta Apple Developer para assinar e notarizar. O teste `test:dist` hoje é só para Windows.

## Testes manuais antes de uma versão estável

Exigem pessoa e conta real, por isso não estão no CI:

- [ ] Login oficial de uma conta nova, em um perfil separado
- [ ] Missão real com Claude e Codex (`npm run test:real`)
- [ ] Ferramentas MCP com o Unreal Editor aberto
- [ ] Instalar em um Windows sem Node.js e sem as ferramentas de IA
- [ ] Aviso do SmartScreen ao baixar pelo navegador

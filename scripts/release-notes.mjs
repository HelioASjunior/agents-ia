// Monta as notas de uma versão a partir do CHANGELOG.md.
import fs from 'node:fs';

const tag = process.argv[2] ?? '';
const version = tag.replace(/^v/, '');
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

function section(name) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${name}]`));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

// Uma beta usa a própria seção, ou o que ainda não foi lançado.
const notes = section(version) ?? section('Não lançado') ?? 'Veja o CHANGELOG.md.';

process.stdout.write(`${notes}

## Como instalar

**Windows 10 e 11:** baixe \`XinoIA-Setup-v${version}.exe\` e execute. A versão portátil, \`XinoIA-Portable-v${version}.exe\`, não precisa de instalação.

O XinoIA não inclui as ferramentas de IA: instale as que quiser e entre com a sua própria conta. Veja o [guia de instalação](https://github.com/HelioASjunior/agents-ia/blob/main/docs/USER_GUIDE.md).

> O instalador ainda não tem assinatura de código da Microsoft, então o Windows pode mostrar o aviso do SmartScreen. Em **Mais informações**, escolha **Executar assim mesmo**.

## Como verificar o download

\`SHA256SUMS.txt\` confere se o arquivo chegou inteiro. Os arquivos \`.sig\` são assinaturas Ed25519, que o XinoIA confere antes de instalar qualquer atualização.
`);

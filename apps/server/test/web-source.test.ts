import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const webSrc = fileURLToPath(new URL('../../web/src', import.meta.url));

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// Um seletor que cria um array novo a cada leitura deixa a interface em laço infinito de
// renderização. Esse erro passou pela compilação e só apareceu abrindo a tela.
test('Interface: nenhum seletor do estado cria um array ou objeto novo a cada leitura', () => {
  const pattern = /useStore\(\(\w+\) => [^;]*?\.(filter|map|flatMap|slice|sort|concat)\(/;
  const offenders = sources(webSrc).flatMap((file) =>
    fs.readFileSync(file, 'utf8').split('\n')
      .filter((line) => pattern.test(line) && !line.includes('.find('))
      .map((line) => `${path.basename(file)}: ${line.trim()}`));
  assert.deepEqual(offenders, []);
});

test('Interface: nada de HTML cru vindo dos agentes', () => {
  for (const file of sources(webSrc)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('dangerouslySetInnerHTML'), file);
    assert.ok(!/\brehype-?raw\b/.test(text), file);
  }
});

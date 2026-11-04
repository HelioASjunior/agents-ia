// Os testes de instalação instalam, encerram e desinstalam o XinoIA, e o Windows só tem um
// registro por aplicativo. Em uma máquina com o programa instalado de verdade, isso derruba a
// cópia aberta e apaga o registro dela. Esses testes são para máquinas descartáveis, como o CI.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function refuseRealInstall() {
  if (process.platform !== 'win32') return;
  const problems = [];
  const installed = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'XinoIA', 'XinoIA.exe');
  if (fs.existsSync(installed)) problems.push(`instalado em ${installed}`);
  const tasks = execFileSync('tasklist', ['/FI', 'IMAGENAME eq XinoIA.exe', '/NH'], { encoding: 'utf8' });
  if (/XinoIA\.exe/i.test(tasks)) problems.push('aberto agora');
  if (!problems.length) return;
  process.stderr.write(`Este teste foi recusado: o XinoIA está ${problems.join(' e ')}.\nEle encerraria o programa e apagaria o registro da instalação. Rode no CI (workflow "Teste de atualização") ou em uma máquina sem o XinoIA.\n`);
  process.exit(2);
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { signFile, verifyFile } from '../../desktop/src/verify.ts';
import { removeDir, tempDir } from './support/harness.ts';

const pair = () => crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('Atualização: só aceita o pacote exato, assinado pela chave oficial', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'XinoIA-Setup.exe');
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024, 7));
  const official = pair();
  const signature = await signFile(file, official.privateKey);

  assert.equal(await verifyFile(file, signature, official.publicKey), true);

  // Pacote adulterado, mesmo que em um único byte.
  const bytes = fs.readFileSync(file);
  bytes[500_000] = 9;
  fs.writeFileSync(file, bytes);
  assert.equal(await verifyFile(file, signature, official.publicKey), false);

  // Atacante assinando com a chave dele.
  const attacker = pair();
  const forged = await signFile(file, attacker.privateKey);
  assert.equal(await verifyFile(file, forged, official.publicKey), false);

  // Assinatura ausente ou malformada.
  assert.equal(await verifyFile(file, '', official.publicKey), false);
  assert.equal(await verifyFile(file, 'isto-nao-e-assinatura', official.publicKey), false);
  assert.equal(await verifyFile(path.join(dir, 'nao-existe.exe'), signature, official.publicKey), false);
  removeDir(dir);
});

test('A chave pública embutida é válida, e nenhuma chave privada está no repositório', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const key = fs.readFileSync(path.join(root, 'apps/desktop/build/update-public-key.pem'), 'utf8');
  assert.equal(crypto.createPublicKey(key).asymmetricKeyType, 'ed25519');
  assert.doesNotMatch(key, /PRIVATE/);

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'release', '.xinoia-dev', 'assets'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (/\.(pem|key|pfx|p12)$/.test(entry.name)) {
        assert.doesNotMatch(fs.readFileSync(full, 'utf8'), /PRIVATE KEY-----/, full);
      }
    }
  };
  visit(root);
});

test('Publicação: os checksums só listam o que é publicado', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'XinoIA-Setup-v1.0.0.exe'), 'instalador');
  fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 1.0.0');
  fs.writeFileSync(path.join(dir, 'builder-debug.yml'), 'interno');
  fs.writeFileSync(path.join(dir, 'builder-effective-config.yaml'), 'interno');
  const script = fileURLToPath(new URL('../../../scripts/release-sign.mjs', import.meta.url));
  execFileSync(process.execPath, [script, dir], { env: { ...process.env, XINOIA_SIGNING_KEY: pair().privateKey }, stdio: 'pipe' });

  const listed = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').map((line) => line.split('  ')[1]);
  assert.deepEqual(listed, ['XinoIA-Setup-v1.0.0.exe', 'XinoIA-Setup-v1.0.0.exe.sig', 'latest.yml']);
  removeDir(dir);
});

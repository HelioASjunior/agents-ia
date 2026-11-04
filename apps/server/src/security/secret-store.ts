import { spawn } from 'node:child_process';
import path from 'node:path';
import { badRequest } from '../errors.ts';
import { registerSecret } from './redact.ts';

// Chaves de API ficam cifradas pelo Windows (DPAPI), presas ao usuário do sistema. O
// banco e as cópias de segurança só guardam o texto cifrado. O valor entra e sai pelo
// stdin do PowerShell, nunca por argumento, onde apareceria na lista de processos.

export interface SecretStore {
  protect(plain: string): Promise<string>;
  unprotect(cipher: string): Promise<string>;
}

const PROLOGUE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('xinoia')
$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
`;
const PROTECT = `${PROLOGUE}[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data, $entropy, 'CurrentUser')))`;
const UNPROTECT = `${PROLOGUE}[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, 'CurrentUser')))`;

function powershell(script: string, input: string): Promise<string> {
  // Caminho completo, para não executar um powershell.exe plantado na pasta do projeto.
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && stdout) resolve(stdout.trim());
      else reject(new Error('O sistema não conseguiu proteger ou ler a chave.'));
    });
    child.stdin.end(input);
  });
}

export const windowsSecretStore: SecretStore = {
  async protect(plain) {
    if (process.platform !== 'win32') throw badRequest('Guardar chave de API ainda só funciona no Windows.', 'no_secret_store');
    return powershell(PROTECT, Buffer.from(plain, 'utf8').toString('base64'));
  },
  async unprotect(cipher) {
    if (process.platform !== 'win32') throw badRequest('Ler chave de API ainda só funciona no Windows.', 'no_secret_store');
    try {
      const plain = Buffer.from(await powershell(UNPROTECT, cipher), 'base64').toString('utf8');
      registerSecret(plain);
      return plain;
    } catch {
      // Acontece ao restaurar uma cópia em outro computador ou outro usuário do Windows.
      throw badRequest('Esta chave de API foi guardada por outro usuário do Windows. Informe a chave de novo em Contas.', 'secret_unreadable');
    }
  },
};

import crypto from 'node:crypto';
import fs from 'node:fs';

// Autenticidade da atualização. O hash em latest.yml só prova que o arquivo chegou inteiro,
// porque está no mesmo lugar que ele: quem trocasse um trocaria o outro. Esta assinatura não
// tem esse problema: a chave pública vem dentro do app, e a privada nunca sai do GitHub.

export function fileDigest(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest()));
  });
}

export async function signFile(file: string, privateKeyPem: string): Promise<string> {
  return crypto.sign(null, await fileDigest(file), privateKeyPem).toString('base64');
}

/** Recusa assinatura ausente, malformada ou de outra chave. */
export async function verifyFile(file: string, signatureBase64: string, publicKeyPem: string): Promise<boolean> {
  const signature = Buffer.from(signatureBase64.trim(), 'base64');
  if (!signature.length) return false;
  try {
    return crypto.verify(null, await fileDigest(file), publicKeyPem, signature);
  } catch {
    return false;
  }
}

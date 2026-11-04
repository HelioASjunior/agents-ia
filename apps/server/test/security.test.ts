import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { buildEnv } from '../src/process/spawn.ts';
import { redact } from '../src/security/redact.ts';
import { windowsLoginArgs } from '../src/services/profiles.ts';
import { createHarness } from './support/harness.ts';

test('Segredos são mascarados', () => {
  const samples: Array<[string, RegExp]> = [
    ['chave sk-ant-api03-abcdefghijklmnop123 fim', /sk-ant-\*\*\*/],
    ['token gho_abcdefghijklmnop1234 fim', /gho_\*\*\*/],
    ['AIzaSyA1234567890abcdefghijklmnopqrstuv', /AIza\*\*\*/],
    ['Authorization: Bearer abcdefghijklmnop123456', /bearer \*\*\*/i],
    ['eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2Q', /jwt-\*\*\*/],
    ['password=minhasenha123', /password=\*\*\*/],
    ['API_KEY: "abcd1234efgh"', /API_KEY: "\*\*\*/],
    ['-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', /\*\*\*chave-privada\*\*\*/],
  ];
  for (const [input, expected] of samples) assert.match(redact(input), expected, input);
  assert.equal(redact('texto normal sem nada'), 'texto normal sem nada');
  assert.doesNotMatch(redact('chave sk-ant-api03-abcdefghijklmnop123'), /abcdefghijklmnop123/);
});

test('A pasta pessoal do usuário não aparece nos registros', () => {
  const home = os.homedir();
  assert.equal(redact(`abrindo ${home}${path.sep}projeto`), `abrindo ~${path.sep}projeto`);
  assert.equal(redact(`caminho ${home.replaceAll('\\', '/')}/a.txt`), 'caminho ~/a.txt');
  assert.equal(redact(JSON.stringify({ file: `${home}${path.sep}a` })).includes(path.basename(home)), false);
});

test('Ambiente: remove cobrança por API e herança de sessão, e aponta o perfil', () => {
  const source = {
    PATH: 'x',
    ANTHROPIC_API_KEY: 'a',
    ANTHROPIC_BASE_URL: 'b',
    CLAUDECODE: '1',
    CLAUDE_CODE_OAUTH_TOKEN: 'c',
    OPENAI_API_KEY: 'd',
    CODEX_API_KEY: 'e',
    GEMINI_API_KEY: 'f',
    GOOGLE_API_KEY: 'g',
    CODEX_HOME: 'C:\\padrao',
  };
  const adapter = { homeEnv: 'CLAUDE_CONFIG_DIR' };
  // O PATH ganha as pastas dos instaladores oficiais, depois do que já existia.
  const withoutPath = ({ PATH, ...rest }: Record<string, string>) => {
    assert.ok(PATH?.startsWith('x'), PATH);
    assert.match(PATH ?? '', /\.local[\\/]bin/);
    return rest;
  };
  const env = buildEnv(adapter, 'C:\\perfil', source);
  assert.deepEqual(withoutPath(env), { CLAUDE_CONFIG_DIR: 'C:\\perfil' });

  // Sem pasta própria, respeita onde o usuário escolheu guardar o login padrão.
  const standard = buildEnv({ homeEnv: 'CODEX_HOME' }, null, source);
  assert.deepEqual(withoutPath(standard), { CODEX_HOME: 'C:\\padrao' });

  // Agente personalizado pode depender dessas variáveis.
  assert.equal(buildEnv({ homeEnv: null, keepsApiEnv: true }, null, source).OPENAI_API_KEY, 'd');
});

test('Login: janela do Windows não permite injeção pelo nome do perfil', () => {
  const args = windowsLoginArgs('Login Claude - minha & conta "x" | y', 'claude auth login');
  assert.equal(args, '/c start "Login Claude - minha  conta x  y" cmd /k "claude auth login"');
});

test('API: exige token, host local e origem permitida', async () => {
  const h = await createHarness();
  const get = (headers: Record<string, string>, url = '/api/agents') => h.app.inject({ method: 'GET', url, headers });
  const host = { host: '127.0.0.1:4317' };

  assert.equal((await get(host, '/api/health')).statusCode, 200);
  assert.equal((await get(host)).statusCode, 401);
  assert.equal((await get({ ...host, authorization: 'Bearer errado' })).statusCode, 401);
  assert.equal((await get({ ...host, ...h.auth })).statusCode, 200);

  // DNS rebinding: site malicioso apontando seu domínio para 127.0.0.1.
  assert.equal((await get({ host: 'evil.example.com', ...h.auth })).statusCode, 403);
  // Página web de outro site chamando a API local.
  assert.equal((await get({ ...host, ...h.auth, origin: 'https://evil.example.com' })).statusCode, 403);
  assert.equal((await get({ ...host, ...h.auth, origin: 'null' })).statusCode, 403);
  assert.equal((await get({ ...host, ...h.auth, origin: 'http://127.0.0.1:4317' })).statusCode, 200);
  await h.cleanup();
});

test('API: entrada inválida responde 400 com mensagem clara', async () => {
  const h = await createHarness();
  const post = (url: string, payload: object) =>
    h.app.inject({ method: 'POST', url, payload, headers: { host: '127.0.0.1', ...h.auth } });

  const agent = await post('/api/agents', { name: 'x', provider: 'fake', model: 'haiku & calc' });
  assert.equal(agent.statusCode, 400);
  assert.match(agent.json().message, /model/);

  const custom = await post('/api/custom-providers', { name: 'x', command: 'cmd & calc' });
  assert.equal(custom.statusCode, 400);

  const customArgs = await post('/api/custom-providers', { name: 'x', command: 'meu-cli', args: '--a | calc' });
  assert.equal(customArgs.statusCode, 400);

  const project = await post('/api/projects', { path: 'relativo/pasta' });
  assert.equal(project.statusCode, 400);

  const toolkit = await post('/api/toolkits', { name: 'x', mcp: { name: 'a b', type: 'http', url: 'http://x' } });
  assert.equal(toolkit.statusCode, 400);
  await h.cleanup();
});

test('WebSocket sem token é recusado', async () => {
  const h = await createHarness();
  const address = await h.app.listen({ host: '127.0.0.1', port: 0 });
  const url = address.replace('http', 'ws');

  const refused = await new Promise<number>((resolve) => {
    const socket = new WebSocket(`${url}/ws`);
    socket.on('unexpected-response', (request, response) => {
      request.destroy();
      resolve(response.statusCode ?? 0);
    });
    socket.on('error', () => undefined);
    socket.on('open', () => resolve(101));
  });
  assert.equal(refused, 401);

  const hello = await new Promise<{ kind: string }>((resolve, reject) => {
    const socket = new WebSocket(`${url}/ws?token=${h.token}`);
    socket.on('message', (data) => {
      resolve(JSON.parse(String(data)));
      socket.close();
    });
    socket.on('error', reject);
  });
  assert.equal(hello.kind, 'hello');
  await h.cleanup();
});

test('Pedido de WebSocket recusado fecha a conexão e não impede o app de encerrar', async () => {
  const h = await createHarness();
  const address = await h.app.listen({ host: '127.0.0.1', port: 0 });
  const port = Number(new URL(address).port);

  const closedByServer = await new Promise<boolean>((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5000);
    socket.resume();
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.on('error', () => undefined);
  });
  assert.equal(closedByServer, true);
  await h.cleanup();
});

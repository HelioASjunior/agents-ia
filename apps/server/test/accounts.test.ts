import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildBlocked, findPath, LOUNGE_SPOTS, PLANTS, ROOM_OF_ROLE, ROOMS, SEATS } from '../../web/src/components/office/layout.ts';
import { redact } from '../src/security/redact.ts';
import { windowsSecretStore } from '../src/security/secret-store.ts';
import { claudeAdapter } from '../src/providers/claude.ts';
import { codexAdapter } from '../src/providers/codex.ts';
import { geminiAdapter } from '../src/providers/gemini.ts';
import { createHarness, fakeAdapter } from './support/harness.ts';

const KEY = 'chave-de-teste-xinoia-1234567890';

test('A chave de API fica cifrada no banco e não volta para a interface', { skip: process.platform !== 'win32' }, async () => {
  const h = await createHarness();
  const created = await h.ctx.profiles.create({ provider: 'fake', label: 'Paga', apiKey: KEY });
  assert.equal(created.credential, 'api_key');
  assert.ok(created.homeDir, 'a chave fica em um perfil separado, longe do login do computador');
  assert.doesNotMatch(JSON.stringify(created), new RegExp(KEY));

  const cipher = await h.db().profiles.getApiKeyCipher(created.id);
  assert.ok(cipher && !cipher.includes(KEY));
  assert.equal(await windowsSecretStore.unprotect(cipher), KEY, 'o Windows devolve a chave');

  // A API não entrega a chave nem o texto cifrado.
  const response = await h.app.inject({ method: 'GET', url: '/api/profiles', headers: h.auth });
  assert.equal(response.statusCode, 200);
  assert.ok(!response.body.includes(KEY));
  assert.ok(!response.body.includes(cipher));

  // Nem o arquivo do banco, nem o diário dele, têm a chave em texto puro.
  for (const file of fs.readdirSync(h.config.dataDir).filter((name) => /\.(db|sqlite|wal|shm)/.test(name))) {
    assert.ok(!fs.readFileSync(path.join(h.config.dataDir, file)).includes(KEY), `${file} tem a chave em texto puro`);
  }
  await h.cleanup();
});

test('A chave só chega à execução do perfil que a usa', { skip: process.platform !== 'win32' }, async () => {
  const h = await createHarness();
  h.ctx.providers.register(fakeAdapter({ id: 'pago', apiKeyEnv: 'CHAVE_DO_TESTE', homeEnv: 'HOME_DO_TESTE' }));
  const project = await h.ctx.projects.create({ path: h.projectDir, name: 'teste' });

  const paid = await h.ctx.profiles.create({ provider: 'pago', label: 'Paga', apiKey: KEY });
  const auth = await h.ctx.profiles.check(paid.id);
  assert.equal(auth.auth?.loggedIn, true);
  assert.equal(auth.auth?.subscription, false, 'aparece como cobrança por API, não como assinatura');
  const payer = await h.ctx.agents.create({ name: 'Paga', provider: 'pago', profileId: paid.id });
  const first = await h.ctx.runs.create({ agentId: payer.id, projectId: project.id, prompt: 'VER_AMBIENTE VER_ARGS' });
  await h.ctx.runs.waitFor(first.id);
  assert.equal((await h.db().runs.get(first.id))?.status, 'completed');
  const seen = JSON.parse(fs.readFileSync(path.join(h.projectDir, 'ambiente.json'), 'utf8')) as Record<string, string>;
  assert.equal(seen.CHAVE_DO_TESTE, KEY, 'o CLI recebe a chave pelo ambiente');
  assert.ok(!fs.readFileSync(path.join(h.projectDir, 'args.json'), 'utf8').includes(KEY), 'nunca por argumento');

  // Outro perfil, da mesma ferramenta, não herda a chave.
  const login = await h.ctx.profiles.create({ provider: 'pago', label: 'Assinatura' });
  assert.equal(login.credential, 'login');
  const subscriber = await h.ctx.agents.create({ name: 'Assina', provider: 'pago', profileId: login.id });
  const second = await h.ctx.runs.create({ agentId: subscriber.id, projectId: project.id, prompt: 'VER_AMBIENTE' });
  await h.ctx.runs.waitFor(second.id);
  const clean = JSON.parse(fs.readFileSync(path.join(h.projectDir, 'ambiente.json'), 'utf8')) as Record<string, string>;
  assert.equal(clean.CHAVE_DO_TESTE, undefined);

  // Se a chave aparecer na saída do agente, é mascarada mesmo sem seguir um formato conhecido.
  assert.equal(redact(`vazou ${KEY} aqui`), 'vazou *** aqui');
  await h.cleanup();
});

test('Trocar a chave vale só para quem usa chave; quem não aceita chave recusa', { skip: process.platform !== 'win32' }, async () => {
  const h = await createHarness();
  h.ctx.providers.register(fakeAdapter({ id: 'pago', apiKeyEnv: 'CHAVE_DO_TESTE' }));
  h.ctx.providers.register(fakeAdapter({ id: 'semchave', apiKeyEnv: null }));
  const paid = await h.ctx.profiles.create({ provider: 'pago', label: 'Paga', apiKey: KEY });
  const before = await h.db().profiles.getApiKeyCipher(paid.id);
  await h.ctx.profiles.setApiKey(paid.id, { apiKey: 'outra-chave-de-teste-98765' });
  const after = await h.db().profiles.getApiKeyCipher(paid.id);
  assert.notEqual(after, before);
  assert.equal(await windowsSecretStore.unprotect(after!), 'outra-chave-de-teste-98765');

  const login = await h.ctx.profiles.create({ provider: 'pago', label: 'Login' });
  await assert.rejects(h.ctx.profiles.setApiKey(login.id, { apiKey: KEY }), /usa login/);
  await assert.rejects(h.ctx.profiles.create({ provider: 'semchave', label: 'x', apiKey: KEY }), /não aceita chave/);
  await assert.rejects(h.ctx.profiles.logout(paid.id), /remova este perfil/);

  await h.ctx.profiles.remove(paid.id);
  assert.equal(await h.db().profiles.get(paid.id), null);
  await h.cleanup();
});

test('Chave recusada pelo provedor vira uma mensagem clara', { skip: process.platform !== 'win32' }, async () => {
  const h = await createHarness();
  h.ctx.providers.register(fakeAdapter({ id: 'pago', apiKeyEnv: 'CHAVE_DO_TESTE' }));
  const project = await h.ctx.projects.create({ path: h.projectDir, name: 'teste' });
  const paid = await h.ctx.profiles.create({ provider: 'pago', label: 'Paga', apiKey: KEY });
  const agent = await h.ctx.agents.create({ name: 'Paga', provider: 'pago', profileId: paid.id });
  const run = await h.ctx.runs.create({ agentId: agent.id, projectId: project.id, prompt: 'SEM_LOGIN' });
  await h.ctx.runs.waitFor(run.id);
  const done = await h.db().runs.get(run.id);
  assert.equal(done?.errorKind, 'auth');
  assert.match(done?.errorText ?? '', /recusou a chave de API/);
  await h.cleanup();
});

test('Os adaptadores oficiais indicam a variável e o site da chave', () => {
  assert.equal(claudeAdapter.apiKeyEnv, 'ANTHROPIC_API_KEY');
  assert.equal(codexAdapter.apiKeyEnv, 'CODEX_API_KEY');
  assert.equal(geminiAdapter.apiKeyEnv, 'GEMINI_API_KEY');
  for (const adapter of [claudeAdapter, codexAdapter, geminiAdapter]) assert.match(adapter.apiKeyUrl ?? '', /^https:\/\//);
});

test('O login mostra o endereço para abrir de novo; instalar só roda o comando do adaptador', { skip: process.platform !== 'win32' }, async () => {
  const h = await createHarness();
  const link = 'https://exemplo.test/entrar?codigo=abc123&volta=localhost';
  h.ctx.providers.register(fakeAdapter({ id: 'entra', loginCommand: `echo Abra ${link.replaceAll('&', '^&')}`, installCommand: 'echo instalador-oficial "com aspas"' }));
  const profile = await h.ctx.profiles.create({ provider: 'entra', label: 'Conta' });

  const login = await h.ctx.terminals.create({ kind: 'login', profileId: profile.id });
  const session = h.ctx.terminals.get(login.id);
  const ended = new Promise<void>((resolve) => session.subscribe((message) => { if (message.type === 'exit') resolve(); }));
  for (let i = 0; i < 100 && !h.ctx.terminals.loginLink(login.id); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(h.ctx.terminals.loginLink(login.id), link);
  await ended;

  const install = await h.ctx.terminals.create({ kind: 'install', provider: 'entra' });
  assert.equal(install.kind, 'install');
  const output = h.ctx.terminals.get(install.id);
  await new Promise<void>((resolve) => {
    output.subscribe((message) => { if (message.type === 'exit') resolve(); });
    setTimeout(resolve, 5000);
  });
  assert.match(output.scrollback(), /instalador-oficial "com aspas"/);
  await assert.rejects(h.ctx.terminals.create({ kind: 'install', provider: 'nao-existe' }), /não tem instalador/);
  await h.cleanup();
});

test('Planta do escritório: toda mesa e todo lugar da copa são alcançáveis a pé', () => {
  const blocked = buildBlocked();
  const [startX, startY] = LOUNGE_SPOTS[0]!;
  const places: Array<[number, number, string]> = [
    ...SEATS.map((seat): [number, number, string] => [seat.x, seat.y, `mesa ${seat.room} ${seat.x},${seat.y}`]),
    ...LOUNGE_SPOTS.map(([x, y]): [number, number, string] => [x, y, `copa ${x},${y}`]),
  ];
  for (const [x, y, name] of places) {
    assert.ok(!blocked.has(`${x},${y}`), `${name} está em um ladrilho ocupado`);
    if (x === startX && y === startY) continue;
    assert.ok(findPath(blocked, startX, startY, x, y).length > 0, `não dá para chegar em ${name}`);
  }
  assert.equal(new Set(LOUNGE_SPOTS.map((spot) => spot.join())).size, LOUNGE_SPOTS.length, 'lugares repetidos na copa');
  assert.equal(new Set(SEATS.map((seat) => `${seat.x},${seat.y}`)).size, SEATS.length, 'lugares repetidos no escritório');
  for (const [x, y] of PLANTS) assert.ok(blocked.has(`${x},${y}`));
});

test('Planta do escritório: cada função tem sala, e quem senta não fica atrás do monitor de outra fileira', () => {
  const rooms = new Set(ROOMS.map((room) => room.id));
  for (const room of Object.values(ROOM_OF_ROLE)) assert.ok(rooms.has(room), `sala que não existe: ${room}`);
  for (const seat of SEATS) {
    const inside = ROOMS.find((room) => room.id === seat.room)!;
    assert.ok(seat.x >= inside.x && seat.x < inside.x + inside.w && seat.y >= inside.y && seat.y < inside.y + inside.h, `lugar fora da sala: ${seat.room} ${seat.x},${seat.y}`);
    // A mesa da linha seguinte precisa estar a mais de uma linha, ou o monitor cobre a pessoa.
    const behind = SEATS.find((other) => other.kind === 'desk' && other.x === seat.x && other.y - 1 === seat.y + 1);
    assert.equal(behind, undefined, `monitor cobre quem senta em ${seat.x},${seat.y}`);
  }
});

test('Uma instalação nova começa sem nenhuma conta, agente, projeto ou histórico', async () => {
  const h = await createHarness();
  assert.deepEqual(await h.ctx.profiles.list(), []);
  assert.deepEqual(await h.ctx.agents.list(), []);
  assert.deepEqual(await h.ctx.projects.list(), []);
  assert.deepEqual(await h.db().runs.list(), []);
  await h.cleanup();
});

test('O repositório não guarda login, configuração nem dados locais de ninguém', () => {
  const root = new URL('../../../', import.meta.url);
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(files.length > 50, 'lista de arquivos do Git');
  const forbidden = /(^|\/)(\.claude|\.codex|\.gemini|\.xinoia|\.xinoia-dev|release)\/|(^|\/)\.env|\.credentials|(^|\/)auth\.json$|oauth_creds|settings\.local\.json|\.(db|sqlite|sqlite3|db-wal|db-shm)$/i;
  assert.deepEqual(files.filter((file) => forbidden.test(file)), []);
  // A única chave no repositório é a pública, que precisa ir junto com o app.
  assert.deepEqual(files.filter((file) => /\.(pem|key|pfx|p12)$/i.test(file)), ['apps/desktop/build/update-public-key.pem']);
  const key = fs.readFileSync(new URL('apps/desktop/build/update-public-key.pem', root), 'utf8');
  assert.match(key, /BEGIN PUBLIC KEY/);
  assert.doesNotMatch(key, /PRIVATE/);
});

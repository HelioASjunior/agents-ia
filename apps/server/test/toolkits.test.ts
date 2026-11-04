import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { codexAdapter } from '../src/providers/codex.ts';
import { createHarness, removeDir, tempDir } from './support/harness.ts';

function fakeHome(): string {
  const home = tempDir('xinoia-home-');
  const plugin = path.join(home, '.claude', 'plugins', 'cache', 'unreal');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'skills', 'unreal-mcp'), { recursive: true });
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'unreal-engine-skills-for-claude-code', description: 'Unreal' }));
  fs.writeFileSync(path.join(plugin, 'skills', 'unreal-mcp', 'SKILL.md'), '---\nname: unreal-mcp\ndescription: "Controla o editor"\n---\ncorpo\n');
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    plugins: { 'unreal-engine-skills-for-claude-code@oficial': [{ installPath: plugin, version: '3.1.1' }] },
  }));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'unreal-engine-skills-for-claude-code@oficial': true } }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      publico: { type: 'http', url: 'http://127.0.0.1:9/mcp' },
      comSegredo: { command: 'uvx', args: ['--token', 'valor-secreto-1'], env: { CHAVE: 'valor-secreto-2' } },
    },
  }));
  return home;
}

test('Descoberta encontra plugin e MCP, sem expor segredos', async () => {
  const home = fakeHome();
  const h = await createHarness({ homeDir: home });
  const found = await h.ctx.toolkits.discover();
  const plugin = found.find((f) => f.kind === 'plugin');
  assert.equal(plugin?.name, 'unreal-engine-skills-for-claude-code');
  assert.deepEqual(plugin?.skills, ['unreal-mcp']);
  assert.equal(found.find((f) => f.name === 'comSegredo')?.secret, true);
  assert.ok(!JSON.stringify(found).includes('valor-secreto'));

  await assert.rejects(h.ctx.toolkits.importDiscovered('mcp:user:comSegredo'), /segredos/);
  const imported = await h.ctx.toolkits.importDiscovered('mcp:user:publico');
  assert.equal(imported.mcp?.type, 'http');
  assert.equal((await h.ctx.toolkits.discover()).find((f) => f.name === 'publico')?.added, true);
  await h.cleanup();
  removeDir(home);
});

test('Unreal: importar o plugin liga as skills e o MCP do editor, de forma exclusiva', async () => {
  const home = fakeHome();
  const h = await createHarness({ homeDir: home });
  const kit = await h.ctx.toolkits.importDiscovered('plugin:unreal-engine-skills-for-claude-code@oficial');
  assert.equal(kit.preset, 'unreal');
  assert.equal(kit.exclusive, true);
  assert.equal(kit.enabledInDefaultAccount, true);
  assert.equal(kit.mcp?.name, 'unreal-mcp');
  assert.equal(kit.mcp?.type === 'http' && kit.mcp.url, 'http://127.0.0.1:8000/mcp');
  assert.equal(kit.skills[0]?.name, 'unreal-mcp');
  assert.equal((await h.ctx.toolkits.addUnreal()).id, kit.id, 'não duplica');
  await h.cleanup();
  removeDir(home);
});

test('Agente Claude em perfil isolado recebe o plugin e o MCP nos argumentos reais', async () => {
  const home = fakeHome();
  const h = await createHarness({ homeDir: home });
  const { projectId, agentId } = await h.setup();
  const kit = await h.ctx.toolkits.addUnreal();
  await h.ctx.agents.update(agentId, { toolkitIds: [kit.id] });

  const done = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'VER_ARGS' })).id);
  assert.equal(done.status, 'completed', done.errorText ?? '');
  const args = JSON.parse(fs.readFileSync(path.join(h.projectDir, 'args.json'), 'utf8')) as string[];
  assert.ok(args.includes('--plugin-dir'));
  assert.ok(args.includes('--mcp-config'));
  assert.ok(args.includes('mcp__unreal-mcp'));

  const config = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'mcp', 'unreal-mcp.json'), 'utf8')) as { mcpServers: Record<string, { url: string }> };
  assert.equal(config.mcpServers['unreal-mcp']?.url, 'http://127.0.0.1:8000/mcp');
  await h.cleanup();
  removeDir(home);
});

test('Editor fechado gera aviso real; editor aberto não', async () => {
  const home = fakeHome();
  const h = await createHarness({ homeDir: home });
  const { projectId, agentId } = await h.setup();

  const closed = await h.ctx.toolkits.create({ name: 'Fechado', mcp: { name: 'fechado', type: 'http', url: 'http://127.0.0.1:9/mcp' } });
  await h.ctx.agents.update(agentId, { toolkitIds: [closed.id] });
  let done = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'x' })).id);
  let warnings = (await h.ctx.runs.events(done.id)).flatMap((e) => (e.event.type === 'warning' ? [e.event.text] : []));
  assert.match(warnings[0] ?? '', /não está respondendo/);
  assert.equal((await h.ctx.toolkits.health())[closed.id], false);

  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const open = await h.ctx.toolkits.update(closed.id, { url: `http://127.0.0.1:${port}/mcp` });
  done = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'x' })).id);
  warnings = (await h.ctx.runs.events(done.id)).flatMap((e) => (e.event.type === 'warning' ? [e.event.text] : []));
  assert.deepEqual(warnings, []);
  assert.equal((await h.ctx.toolkits.health())[open.id], true);
  server.close();
  await h.cleanup();
  removeDir(home);
});

test('CLI sem plugins recebe o caminho das skills no prompt', async () => {
  const home = fakeHome();
  const h = await createHarness({ homeDir: home });
  const kit = await h.ctx.toolkits.addUnreal();
  const agent = { toolkitIds: [kit.id] } as never;
  const resolved = await h.ctx.toolkits.resolve(agent, codexAdapter, null, 'edit');
  assert.deepEqual(resolved.args, ['-c', 'mcp_servers.unreal-mcp.url=http://127.0.0.1:8000/mcp']);
  assert.match(resolved.promptNote, /SKILL\.md/);
  assert.match(resolved.promptNote, /unreal-mcp:/);
  await h.cleanup();
  removeDir(home);
});

test('Projeto: reconhece a estrutura antes de qualquer alteração', async () => {
  const h = await createHarness();
  const dir = tempDir('xinoia-unreal-');
  fs.writeFileSync(path.join(dir, 'Jogo.uproject'), '{}');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const project = await h.ctx.projects.create({ path: dir });
  assert.equal(project.name, path.basename(dir));
  assert.equal(project.info.isUnreal, true);
  assert.deepEqual(project.info.stack, ['Node.js', 'Unreal Engine']);
  assert.equal(project.info.isGit, false);
  await assert.rejects(h.ctx.projects.create({ path: dir }), /já está cadastrada/);
  await assert.rejects(h.ctx.projects.create({ path: path.join(dir, 'nao-existe') }), /não existe/);
  const created = await h.ctx.projects.create({ path: path.join(dir, 'nova'), create: true });
  assert.ok(fs.existsSync(created.path));

  // Remover o projeto não toca na pasta.
  await h.ctx.projects.remove(project.id);
  assert.ok(fs.existsSync(path.join(dir, 'Jogo.uproject')));
  await h.cleanup();
  removeDir(dir);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AgentEvent, Toolkit } from '@xinoia/shared';
import { claudeAdapter, createClaudeParser } from '../src/providers/claude.ts';
import { codexAdapter, createCodexParser, parseCodexModels } from '../src/providers/codex.ts';
import { classifyError, safeArg } from '../src/providers/common.ts';
import { createGeminiParser, geminiAdapter } from '../src/providers/gemini.ts';
import { customAdapter } from '../src/providers/registry.ts';

const feed = (parse: (line: string) => AgentEvent[], lines: unknown[]) =>
  lines.flatMap((line) => parse(JSON.stringify(line)));

// As linhas abaixo seguem exatamente a saída capturada do Claude Code 2.1.318.
test('Claude: sessão, texto, ferramenta, limite e resultado', () => {
  const events = feed(createClaudeParser(), [
    { type: 'system', subtype: 'hook_started', session_id: 's' },
    { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-haiku-5-5', apiKeySource: 'none', mcp_servers: [{ name: 'unreal-mcp', status: 'failed' }] },
    { type: 'stream_event', event: { type: 'message_start' }, session_id: 's1', parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: '', signature: 'x' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'C:\\p\\a.txt', content: 'oi' } }] }, parent_tool_use_id: null },
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 100, unifiedWindows: { five_hour: { utilization: 0.07, resetsAt: 100, status: 'allowed' } } } },
    { type: 'user', message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: 'File created' }] }, parent_tool_use_id: null },
    { type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } }, api_message_id: 'm2', parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'OK' }] }, parent_tool_use_id: null },
    { type: 'result', subtype: 'success', is_error: false, result: 'OK', usage: { input_tokens: 4, cache_read_input_tokens: 10, cache_creation_input_tokens: 6, output_tokens: 333 } },
  ]);

  assert.deepEqual(events[0], { type: 'session', sessionId: 's1', model: 'claude-haiku-5-5' });
  assert.deepEqual(events[1], { type: 'warning', text: 'MCP unreal-mcp: failed' });
  const tool = events.find((e) => e.type === 'tool_start');
  assert.equal(tool?.type === 'tool_start' && tool.summary, 'Criando a.txt');
  assert.deepEqual(tool?.type === 'tool_start' && tool.files, ['C:\\p\\a.txt']);
  const end = events.find((e) => e.type === 'tool_end');
  assert.equal(end?.type === 'tool_end' && end.ok, true);
  const limits = events.find((e) => e.type === 'limits');
  assert.equal(limits?.type === 'limits' && limits.windows?.five_hour?.utilization, 0.07);
  // O mesmo texto vem em delta e na mensagem completa; só pode contar uma vez.
  assert.equal(events.filter((e) => e.type === 'text').length, 1);
  const final = events.at(-1);
  assert.deepEqual(final, { type: 'final', ok: true, text: 'OK', error: null, inputTokens: 20, outputTokens: 333 });
});

test('Claude: credencial de API e permissão negada geram aviso', () => {
  const events = feed(createClaudeParser(), [
    { type: 'system', subtype: 'init', session_id: 's', apiKeySource: 'ANTHROPIC_API_KEY' },
    { type: 'result', subtype: 'success', is_error: false, result: 'x', permission_denials: [{ tool_name: 'Bash' }, { tool_name: 'Bash' }] },
  ]);
  const warnings = events.filter((e) => e.type === 'warning').map((e) => (e.type === 'warning' ? e.text : ''));
  assert.match(warnings[0]!, /credencial de API/);
  assert.match(warnings[1]!, /Permissão negada para: Bash\./);
});

test('Claude: texto de subagente não entra na resposta', () => {
  const events = feed(createClaudeParser(), [
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'interno' } }, parent_tool_use_id: 't9' },
  ]);
  assert.deepEqual(events, []);
});

// As linhas abaixo seguem exatamente a saída capturada do Codex CLI 0.166.0.
test('Codex: sessão, comando, mensagem e consumo', () => {
  const events = feed(createCodexParser(), [
    { type: 'thread.started', thread_id: 'th1' },
    { type: 'item.completed', item: { id: 'i0', type: 'error', message: 'Codex is ignoring 1 unrecognized configuration setting.' } },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Vou executar.' } },
    { type: 'item.started', item: { id: 'i2', type: 'command_execution', command: `"C:\\\\WINDOWS\\\\powershell.exe" -Command 'echo oi'`, status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'i2', type: 'command_execution', command: 'x', aggregated_output: 'oi\r\n', exit_code: 0, status: 'completed' } },
    { type: 'item.completed', item: { id: 'i3', type: 'file_change', changes: [{ path: 'C:\\p\\a.txt', kind: 'add' }], status: 'completed' } },
    { type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: 'OK' } },
    { type: 'turn.completed', usage: { input_tokens: 34936, output_tokens: 45 } },
  ]);
  assert.deepEqual(events[0], { type: 'session', sessionId: 'th1' });
  assert.equal(events[1]?.type, 'noise', 'configuração pessoal da conta não é aviso da tarefa');
  const command = events.find((e) => e.type === 'tool_start' && e.name === 'Shell');
  assert.equal(command?.type === 'tool_start' && command.command, 'echo oi');
  const texts = events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? e.text : ''));
  assert.deepEqual(texts, ['Vou executar.', '\n\nOK']);
  const files = events.find((e) => e.type === 'tool_start' && e.name === 'Arquivos');
  assert.deepEqual(files?.type === 'tool_start' && files.files, ['C:\\p\\a.txt']);
  assert.deepEqual(events.at(-1), { type: 'usage', inputTokens: 34936, outputTokens: 45 });
});

test('Codex: falha de turno vira erro', () => {
  const events = feed(createCodexParser(), [{ type: 'turn.failed', error: { message: 'usage limit reached' } }]);
  assert.deepEqual(events, [{ type: 'error', text: 'usage limit reached' }]);
});

test('Gemini: eventos documentados', () => {
  const events = feed(createGeminiParser(), [
    { type: 'init', session_id: 'g1', model: 'auto' },
    { type: 'message', role: 'user', content: 'oi' },
    { type: 'message', role: 'assistant', content: 'olá', delta: true },
    { type: 'tool_use', tool_name: 'write_file', tool_id: 't', parameters: { file_path: 'a.txt' } },
    { type: 'tool_result', tool_id: 't', status: 'success', output: 'ok' },
    { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 2 } },
  ]);
  assert.deepEqual(events[0], { type: 'session', sessionId: 'g1', model: 'auto' });
  assert.deepEqual(events[1], { type: 'text', text: 'olá' });
  assert.equal(events[2]?.type === 'tool_start' && events[2].summary, 'Editando a.txt');
  assert.deepEqual(events.at(-1), { type: 'final', ok: true, text: '', error: null, inputTokens: 1, outputTokens: 2 });
});

test('Linha que não é JSON vira saída bruta em vez de quebrar', () => {
  assert.deepEqual(createClaudeParser()('aviso qualquer'), [{ type: 'raw', text: 'aviso qualquer' }]);
  assert.deepEqual(createClaudeParser()('{quebrado'), [{ type: 'raw', text: '{quebrado' }]);
  assert.deepEqual(createCodexParser()('   '), []);
});

test('Argumentos do Claude por nível de permissão', () => {
  const read = claudeAdapter.buildArgs({ permission: 'read' });
  assert.ok(read.includes('dontAsk'));
  assert.ok(read.includes('--allowedTools'));
  assert.ok(!read.join(' ').includes('Edit'));
  assert.ok(claudeAdapter.buildArgs({ permission: 'edit' }).includes('acceptEdits'));
  assert.ok(claudeAdapter.buildArgs({ permission: 'full' }).includes('--dangerously-skip-permissions'));
  const args = claudeAdapter.buildArgs({ permission: 'edit', model: 'haiku', sessionId: 'abc-123', effort: 'low' });
  assert.deepEqual(args.slice(-6), ['--model', 'haiku', '--effort', 'low', '--resume', 'abc-123']);
});

test('Argumentos do Codex: opções vêm antes de resume, e o prompt vai por stdin', () => {
  const args = codexAdapter.buildArgs({ permission: 'read', sessionId: 'th1', extraArgs: ['-c', 'x=1'] });
  assert.equal(args.at(-1), '-');
  assert.ok(args.indexOf('resume') > args.indexOf('--sandbox'));
  assert.ok(args.indexOf('-c') < args.indexOf('resume'));
  assert.ok(args.includes('read-only'));
  assert.ok(codexAdapter.buildArgs({ permission: 'edit' }).includes('workspace-write'));
});

test('Injeção de comando por modelo ou sessão é recusada', () => {
  for (const evil of ['haiku & calc', 'x;rm -rf', 'a|b', '$(whoami)', '%PATH%', 'a b', '"x"']) {
    assert.throws(() => safeArg(evil, 'modelo'), /inválido/);
    assert.throws(() => claudeAdapter.buildArgs({ permission: 'edit', model: evil }));
    assert.throws(() => codexAdapter.buildArgs({ permission: 'edit', sessionId: evil }));
  }
  assert.equal(safeArg('claude-opus-5-5[1m]', 'modelo'), 'claude-opus-5-5[1m]');
  assert.equal(safeArg('', 'modelo'), null);
});

test('Classificação de erros', () => {
  assert.equal(classifyError("You've hit your usage limit"), 'limit');
  assert.equal(classifyError('Error 429 too many requests'), 'limit');
  assert.equal(classifyError('Not logged in · Please run /login'), 'auth');
  assert.equal(classifyError("'gemini' is not recognized as an internal or external command"), 'missing');
  assert.equal(classifyError('No conversation found with session ID'), 'session');
  assert.equal(classifyError('falha qualquer'), null);
});

const unreal: Toolkit = {
  id: 'k',
  name: 'Unreal Engine',
  description: '',
  pluginPath: 'C:\\plugins\\unreal',
  enabledInDefaultAccount: true,
  skills: [],
  mcp: { name: 'unreal-mcp', type: 'http', url: 'http://127.0.0.1:8000/mcp' },
  exclusive: true,
  preset: 'unreal',
  createdAt: 0,
};
const quotePath = (value: string) => `"${value}"`;

test('Integrações no Claude: plugin só onde falta, MCP liberado conforme a permissão', () => {
  const isolated = claudeAdapter.toolArgs!({
    toolkits: [unreal],
    profile: { homeDir: 'prof_1' } as never,
    permission: 'edit',
    mcpConfigFile: 'C:\\d\\mcp.json',
    quotePath,
  });
  assert.deepEqual(isolated.args, [
    '--plugin-dir', '"C:\\plugins\\unreal"',
    '--mcp-config', '"C:\\d\\mcp.json"',
    '--allowedTools', 'mcp__unreal-mcp',
  ]);

  // A conta padrão já tem o plugin ligado.
  const standard = claudeAdapter.toolArgs!({
    toolkits: [unreal],
    profile: { homeDir: null } as never,
    permission: 'edit',
    mcpConfigFile: 'm.json',
    quotePath,
  });
  assert.ok(!standard.args.includes('--plugin-dir'));

  const readOnly = claudeAdapter.toolArgs!({
    toolkits: [unreal],
    profile: { homeDir: 'prof_1' } as never,
    permission: 'read',
    mcpConfigFile: 'm.json',
    quotePath,
  });
  assert.ok(!readOnly.args.includes('--allowedTools'));
});

test('Integrações no Codex: MCP HTTP por configuração, skills pelo prompt', () => {
  const result = codexAdapter.toolArgs!({ toolkits: [unreal], profile: null, permission: 'edit', mcpConfigFile: null, quotePath });
  assert.deepEqual(result.args, ['-c', 'mcp_servers.unreal-mcp.url=http://127.0.0.1:8000/mcp']);
  assert.equal(result.loadsPlugins, false);
});

test('Status: distingue assinatura de chave de API', () => {
  const sub = claudeAdapter.parseStatus!(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'a@b.c' }), '');
  assert.equal(sub.subscription, true);
  assert.equal(sub.plan, 'max');
  assert.equal(claudeAdapter.parseStatus!(JSON.stringify({ loggedIn: true, authMethod: 'console' }), '').subscription, false);
  assert.equal(claudeAdapter.parseStatus!('não é json', '').loggedIn, false);

  assert.equal(codexAdapter.parseStatus!('Logged in using ChatGPT', '').subscription, true);
  assert.equal(codexAdapter.parseStatus!('Logged in using an API key', '').subscription, false);
  assert.equal(codexAdapter.parseStatus!('Not logged in', '').loggedIn, false);
  assert.equal(geminiAdapter.support, 'documented');
});

test('Agente personalizado: mantém variáveis e trata saída como texto', () => {
  const adapter = customAdapter({ id: 'x', name: 'Meu', command: 'meu-cli', args: '--modo rapido', homeEnv: null, loginCommand: null, createdAt: 0 });
  assert.equal(adapter.id, 'custom:x');
  assert.deepEqual(adapter.buildArgs({ permission: 'edit' }), ['--modo', 'rapido']);
  assert.deepEqual(adapter.createParser()('olá'), [{ type: 'text', text: 'olá\n' }]);
  assert.equal(adapter.requiresProfile, false);
});

test('Codex no Windows: perfil sem área protegida recebe uma, e a escolha da pessoa é respeitada', () => {
  const { sandboxArgs } = codexAdapter;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-codex-'));
  const write = (text: string) => fs.writeFileSync(path.join(dir, 'config.toml'), text);
  const unelevated = ['-c', 'windows.sandbox=unelevated'];

  // É o que o XinoIA escreve em um perfil novo: sem isto, todo comando era rejeitado.
  write('cli_auth_credentials_store = "file"\n');
  assert.deepEqual(sandboxArgs!(dir, 'edit', 'win32'), unelevated);
  assert.deepEqual(sandboxArgs!(dir, 'read', 'win32'), unelevated);
  fs.rmSync(path.join(dir, 'config.toml'));
  assert.deepEqual(sandboxArgs!(dir, 'edit', 'win32'), unelevated, 'sem arquivo');

  for (const chosen of ['[windows]\nsandbox = "elevated"\n', 'model = "x"\n\n[windows]\n# escolha\nsandbox = "unelevated"\n\n[features]\nx = true\n', 'windows.sandbox = "mxc"\n']) {
    write(chosen);
    assert.deepEqual(sandboxArgs!(dir, 'edit', 'win32'), [], chosen);
  }
  // Outra opção dentro de [windows], ou "sandbox" em outra seção, não é uma escolha.
  write('[windows]\noutra = 1\n\n[features]\nsandbox = true\n');
  assert.deepEqual(sandboxArgs!(dir, 'edit', 'win32'), unelevated);

  // Permissão total não usa área protegida, e fora do Windows a opção não existe.
  write('');
  assert.deepEqual(sandboxArgs!(dir, 'full', 'win32'), []);
  assert.deepEqual(sandboxArgs!(dir, 'edit', 'linux'), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Codex: modelos vêm do catálogo do CLI, sem os escondidos, e um formato novo não quebra', () => {
  const catalog = JSON.stringify({
    models: [
      { slug: 'modelo-a', display_name: 'Modelo A', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }] },
      { slug: 'modelo-oculto', display_name: 'Oculto', visibility: 'hide', supported_reasoning_levels: [] },
      { slug: 'modelo-b', visibility: 'list' },
    ],
  });
  assert.deepEqual(parseCodexModels(catalog), [
    { id: 'modelo-a', label: 'Modelo A', efforts: ['low', 'ultra'] },
    { id: 'modelo-b', label: 'modelo-b', efforts: [] },
  ]);
  assert.deepEqual(parseCodexModels('não é json'), []);
  assert.deepEqual(parseCodexModels('{"outra":1}'), []);
  assert.equal(codexAdapter.buildArgs({ permission: 'edit', model: 'gpt-6.1-sol', effort: 'ultra' }).join(' ').includes('--model gpt-6.1-sol'), true);
  assert.match(codexAdapter.buildArgs({ permission: 'edit', effort: 'ultra' }).join(' '), /model_reasoning_effort=ultra/);
});

// CLI falso, só para testes automatizados. Fala o mesmo formato de eventos do Claude
// Code (capturado de uma execução real) e obedece a comandos escritos no prompt.
import fs from 'node:fs';

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const resumeAt = args.indexOf('--resume');
const resumed = resumeAt >= 0 ? args[resumeAt + 1] : null;

let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;

const sessionId = resumed ?? `sessao-${process.pid}`;

if (prompt.includes('SESSAO_PERDIDA') && resumed) {
  process.stderr.write('No conversation found with session ID\n');
  process.exit(1);
}

out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'modelo-teste', apiKeySource: 'none', mcp_servers: [] });

fs.appendFileSync('ordem.txt', `inicio ${process.env.TESTE_NOME ?? ''} ${prompt.match(/NOME=(\S+)/)?.[1] ?? ''}\n`);

if (prompt.includes('VER_AMBIENTE')) {
  fs.writeFileSync('ambiente.json', JSON.stringify(process.env));
}
if (prompt.includes('VER_ARGS')) {
  fs.writeFileSync('args.json', JSON.stringify(args));
}
fs.writeFileSync('prompt-recebido.txt', prompt);

const write = prompt.match(/ESCREVER=(\S+)/)?.[1];
if (write) {
  out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: `${process.cwd()}/${write}`, content: 'oi' } }] }, parent_tool_use_id: null, session_id: sessionId });
  fs.writeFileSync(write, 'oi');
  out({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: 'Arquivo criado' }] }, parent_tool_use_id: null, session_id: sessionId });
}

if (prompt.includes('VAZAR_SEGREDO')) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A chave é sk-ant-api03-abcdefghijklmnopqrstuvwxyz e pronto.' } }, api_message_id: 'm2', parent_tool_use_id: null, session_id: sessionId });
}

if (prompt.includes('DORMIR')) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'dormindo' } }, api_message_id: 'm3', parent_tool_use_id: null, session_id: sessionId });
  await wait(60_000);
}
if (prompt.includes('ESPERAR_POUCO')) await wait(300);
// Só termina quando outro processo também estiver rodando, o que prova a concorrência.
if (prompt.includes('ENCONTRO')) {
  const deadline = Date.now() + 20_000;
  while (fs.readFileSync('ordem.txt', 'utf8').split('inicio').length - 1 < 2) {
    if (Date.now() > deadline) {
      process.stderr.write('o outro agente não começou\n');
      process.exit(9);
    }
    await wait(20);
  }
}

if (prompt.includes('LIMITE')) {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1793760600, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1793760600, status: 'rejected' } } }, session_id: sessionId });
  out({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your usage limit", session_id: sessionId });
  process.exit(1);
}
if (prompt.includes('SEM_LOGIN')) {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: sessionId });
  process.exit(1);
}
if (prompt.includes('QUEBRAR')) {
  process.stderr.write('algo deu errado\n');
  process.exit(3);
}

out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `feito${resumed ? ' (continuando)' : ''}` } }, api_message_id: 'm4', parent_tool_use_id: null, session_id: sessionId });
fs.appendFileSync('ordem.txt', `fim ${prompt.match(/NOME=(\S+)/)?.[1] ?? ''}\n`);
out({ type: 'result', subtype: 'success', is_error: false, result: `feito${resumed ? ' (continuando)' : ''}`, session_id: sessionId, usage: { input_tokens: 10, output_tokens: 5 } });

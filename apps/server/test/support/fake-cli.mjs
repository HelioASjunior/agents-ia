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
const isPlanning = prompt.includes('[PLANEJAMENTO]');
const isReport = prompt.includes('[RELATÓRIO]');
// Em uma missão o objetivo aparece em todos os prompts. Comandos de execução só
// valem no trabalho em si, não ao planejar ou relatar.
const command = isPlanning || isReport ? '' : prompt;

if (prompt.includes('SESSAO_PERDIDA') && resumed) {
  process.stderr.write('No conversation found with session ID\n');
  process.exit(1);
}

out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'modelo-teste', apiKeySource: 'none', mcp_servers: [] });

const name = command.match(/NOME=(\S+)/)?.[1] ?? '';
if (!isPlanning && !isReport) fs.appendFileSync('ordem.txt', `inicio ${name}\n`);

if (prompt.includes('VER_AMBIENTE')) fs.writeFileSync('ambiente.json', JSON.stringify(process.env));
if (prompt.includes('VER_ARGS')) fs.writeFileSync('args.json', JSON.stringify(args));
// Planejar e relatar são só leitura, como o CLI real nesse nível de permissão.
if (!isPlanning && !isReport) fs.writeFileSync('prompt-recebido.txt', prompt);

const write = command.match(/ESCREVER=(\S+)/)?.[1];
if (write) {
  out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: `${process.cwd()}/${write}`, content: 'oi' } }] }, parent_tool_use_id: null, session_id: sessionId });
  fs.writeFileSync(write, 'oi');
  out({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: 'Arquivo criado' }] }, parent_tool_use_id: null, session_id: sessionId });
}

const overwrite = command.match(/SOBRESCREVER=([^:\s]+):(\S+)/);
if (overwrite) {
  fs.writeFileSync(overwrite[1], `${overwrite[2]}\n`);
}

// Tarefa de resolver conflito: junta os dois lados, como um agente faria.
if (command.includes('[CORREÇÃO]') && command.includes('integração com conflitos')) {
  for (const file of fs.readdirSync('.')) {
    if (!fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('<<<<<<<')) {
      fs.writeFileSync(file, text.split('\n').filter((line) => !/^(<<<<<<<|=======|>>>>>>>)/.test(line)).join('\n'));
    }
  }
}

if (command.includes('COMANDO_PERIGOSO') && prompt.includes('[TAREFA]')) {
  out({ type: 'assistant', message: { id: 'm9', content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'rm -rf node_modules' } }] }, parent_tool_use_id: null, session_id: sessionId });
  await wait(1500);
  fs.writeFileSync('depois-do-perigo.txt', 'x');
  out({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 't9', type: 'tool_result', content: 'ok' }] }, parent_tool_use_id: null, session_id: sessionId });
}

if (command.includes('VAZAR_SEGREDO')) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A chave é sk-ant-api03-abcdefghijklmnopqrstuvwxyz e pronto.' } }, api_message_id: 'm2', parent_tool_use_id: null, session_id: sessionId });
}

if (command.includes('DORMIR')) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'dormindo' } }, api_message_id: 'm3', parent_tool_use_id: null, session_id: sessionId });
  await wait(60_000);
}
if (command.includes('ESPERAR_POUCO')) await wait(300);
// Só termina quando outro processo também estiver rodando, o que prova a concorrência.
if (command.includes('ENCONTRO NOME=')) {
  const deadline = Date.now() + 20_000;
  while (fs.readFileSync('ordem.txt', 'utf8').split('inicio').length - 1 < 2) {
    if (Date.now() > deadline) {
      process.stderr.write('o outro agente não começou\n');
      process.exit(9);
    }
    await wait(20);
  }
}

const meeting = command.match(/ENCONTRO_EM=(\S+)/)?.[1];
if (meeting) {
  fs.appendFileSync(meeting, `${process.cwd()}\n`);
  const deadline = Date.now() + 20_000;
  while (fs.readFileSync(meeting, 'utf8').trim().split('\n').length < 2) {
    if (Date.now() > deadline) {
      process.stderr.write('o outro agente não começou\n');
      process.exit(9);
    }
    await wait(20);
  }
}

if (command.includes('LIMITE')) {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1793760600, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1793760600, status: 'rejected' } } }, session_id: sessionId });
  out({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your usage limit", session_id: sessionId });
  process.exit(1);
}
if (command.includes('SEM_LOGIN')) {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: sessionId });
  process.exit(1);
}
if (command.includes('QUEBRAR')) {
  process.stderr.write('algo deu errado\n');
  process.exit(3);
}

const reply = (text) => out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId, usage: { input_tokens: 10, output_tokens: 5 } });
const parsedTeam = [...prompt.matchAll(/^- id: (\S+) \| nome: (\S+) \| papel: (.*)$/gm)].map((m) => ({ id: m[1], name: m[2], role: m[3] }));

if (isPlanning) {
  // Uma sessão retomada lembra da equipe; aqui a memória é este arquivo.
  if (parsedTeam.length) fs.writeFileSync('equipe.json', JSON.stringify(parsedTeam));
  const team = parsedTeam.length ? parsedTeam : JSON.parse(fs.readFileSync('equipe.json', 'utf8'));
  if (prompt.includes('PLANO_RUIM') && !resumed) {
    reply('não sei montar um plano');
    process.exit(0);
  }
  if (prompt.includes('PLANO_SEMPRE_RUIM') || (resumed && fs.existsSync('sempre-ruim.flag'))) {
    fs.writeFileSync('sempre-ruim.flag', '1');
    reply('continuo sem plano');
    process.exit(0);
  }
  if (prompt.includes('PLANO_FALHA')) {
    process.stderr.write('falha no planejamento\n');
    process.exit(2);
  }
  const dev = team.find((a) => /Desenvolv/i.test(a.role)) ?? team[0];
  const reviewer = team.find((a) => /Revisor/i.test(a.role));
  const tasks = prompt.includes('PLANO_PARALELO')
    ? [
        { id: 't1', title: 'Parte A', description: 'ENCONTRO NOME=A', assignee: team[0].id, dependsOn: [] },
        { id: 't2', title: 'Parte B', description: 'ENCONTRO NOME=B', assignee: team[1].id, dependsOn: [] },
        { id: 't3', title: 'Juntar', description: 'junta', assignee: team[0].name, dependsOn: ['t1', 't2'] },
      ]
    : [
        { id: 't1', title: 'Implementar', description: prompt.match(/ORDEM_DEV=(\S+)/)?.[1] ?? 'ESCREVER=entrega.txt', assignee: dev.id, dependsOn: [] },
        ...(reviewer ? [{ id: 't2', title: 'Revisar', description: 'revise', assignee: reviewer.id, type: 'review', dependsOn: ['t1'] }] : []),
        { id: 't3', title: 'Documentar', description: 'documente', assignee: dev.name, priority: 3, dependsOn: reviewer ? ['t2'] : ['t1'] },
      ];
  reply(`Plano pronto.\n\n\`\`\`json\n${JSON.stringify({ summary: 'Plano de teste', tasks })}\n\`\`\``);
  process.exit(0);
}
if (isReport) {
  if (prompt.includes('RELATORIO_FALHA')) {
    process.stderr.write('falha no relatório\n');
    process.exit(4);
  }
  reply('Relatório: tudo entregue conforme o registro.');
  process.exit(0);
}
if (prompt.includes('[REVISÃO]')) {
  if (prompt.includes('SEM_VEREDITO')) {
    reply('Revisei mas esqueci o veredito.');
    process.exit(0);
  }
  const rejectAlways = prompt.includes('REPROVAR_SEMPRE');
  const rejectOnce = prompt.includes('REPROVAR_UMA_VEZ') && !prompt.includes('Revisar de novo');
  const verdict = rejectAlways || rejectOnce ? 'REPROVADO' : 'APROVADO';
  reply(`<handoff>${verdict === 'REPROVADO' ? 'Faltou tratar lista vazia em entrega.txt.' : 'Sem pendências.'}</handoff>\n<verdict>${verdict}</verdict>`);
  process.exit(0);
}
if (prompt.includes('[TAREFA]')) {
  if (prompt.includes('FALHAR_UMA_VEZ') && !fs.existsSync('falhou.flag')) {
    fs.writeFileSync('falhou.flag', '1');
    process.stderr.write('erro passageiro\n');
    process.exit(5);
  }
  if (prompt.includes('FALHAR_SEMPRE')) {
    process.stderr.write('erro permanente\n');
    process.exit(6);
  }
  fs.appendFileSync('contexto.txt', `${prompt}\n=====\n`);
  const decision = prompt.includes('Sua tarefa: Implementar') && prompt.includes('DECIDIR') ? '<decisao>Banco será SQLite</decisao>\n' : '';
  reply(`Trabalho feito.\n${decision}<handoff>Entreguei ${prompt.match(/Sua tarefa: (.+)/)?.[1] ?? 'a tarefa'}.</handoff>`);
  process.exit(0);
}

out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `feito${resumed ? ' (continuando)' : ''}` } }, api_message_id: 'm4', parent_tool_use_id: null, session_id: sessionId });
fs.appendFileSync('ordem.txt', `fim ${name}\n`);
out({ type: 'result', subtype: 'success', is_error: false, result: `feito${resumed ? ' (continuando)' : ''}`, session_id: sessionId, usage: { input_tokens: 10, output_tokens: 5 } });

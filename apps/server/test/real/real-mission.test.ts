// Cenário de ponta a ponta com CLIs reais: um objetivo vira plano, um agente faz, outro
// revisa e o relatório sai no fim, sem copiar nada à mão. Gasta cota da assinatura.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createConfig } from '../../src/config.ts';
import { createContext } from '../../src/context.ts';

test('Missão real: Claude planeja e revisa, Codex implementa', { timeout: 600_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-missao-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-missao-projeto-'));
  const ctx = await createContext(createConfig({ dataDir }));
  try {
    await ctx.detection.refresh();
    const project = await ctx.projects.create({ path: projectDir });
    const claudeProfile = await ctx.profiles.create({ provider: 'claude', label: 'Padrão', useSystemDefault: true });
    const codexProfile = await ctx.profiles.create({ provider: 'codex', label: 'Padrão', useSystemDefault: true });

    const coordinator = await ctx.agents.create({ name: 'Ana', role: 'coordinator', provider: 'claude', profileId: claudeProfile.id, model: 'haiku', permission: 'read' });
    const developer = await ctx.agents.create({ name: 'Bruno', role: 'developer', provider: 'codex', profileId: codexProfile.id, effort: 'low', permission: 'edit' });
    const reviewer = await ctx.agents.create({ name: 'Carla', role: 'reviewer', provider: 'claude', profileId: claudeProfile.id, model: 'haiku', permission: 'read' });

    const mission = await ctx.orchestrator.start({
      projectId: project.id,
      goal: 'Crie o arquivo soma.js, em JavaScript com CommonJS, exportando a função soma(a, b) que devolve a soma de dois números, e o arquivo soma.test.js que testa essa função com node:test. É um projeto mínimo, sem dependências. Use uma tarefa de implementação e uma de revisão.',
      coordinatorId: coordinator.id,
      agentIds: [coordinator.id, developer.id, reviewer.id],
    });

    let state = await ctx.orchestrator.waitForIdle(mission.id);
    assert.equal(state.status, 'awaiting_approval', state.pauseReason ?? '');
    let tasks = await ctx.orchestrator.tasks(mission.id);
    assert.ok(tasks.length >= 2, 'plano com mais de uma tarefa');
    assert.ok(tasks.some((task) => task.type === 'review'), 'plano com revisão');
    assert.ok(tasks.some((task) => task.assigneeId === developer.id), 'Codex recebeu trabalho');
    assert.deepEqual(fs.readdirSync(projectDir), [], 'planejar não alterou nada');

    await ctx.orchestrator.approve(mission.id);
    state = await ctx.orchestrator.waitForIdle(mission.id);
    tasks = await ctx.orchestrator.tasks(mission.id);
    process.stdout.write(`${JSON.stringify(tasks.map((task) => ({ t: task.title, a: task.assigneeName, s: task.status, v: task.verdict, e: task.errorText, n: task.attempts })), null, 1)}\n`);
    assert.equal(state.status, 'completed', state.pauseReason ?? '');

    // O código produzido é real e funciona.
    assert.ok(fs.existsSync(path.join(projectDir, 'soma.js')));
    assert.ok(fs.existsSync(path.join(projectDir, 'soma.test.js')));
    const output = execFileSync(process.execPath, ['--test', 'soma.test.js'], { cwd: projectDir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    assert.match(output, /pass [1-9]/);

    const events = await ctx.orchestrator.events(mission.id);
    assert.ok(events.some((event) => event.data.type === 'handoff'), 'houve passagem de trabalho');
    assert.ok(events.some((event) => event.data.type === 'review'), 'houve revisão entre agentes');
    assert.ok(tasks.some((task) => task.type === 'review' && task.verdict === 'APROVADO' && task.status === 'done'));
    assert.ok(state.report && state.report.length > 40);
    assert.match(state.report, /soma\.js/);
    process.stdout.write(`--- relatório ---\n${state.report}\n`);
  } finally {
    await ctx.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

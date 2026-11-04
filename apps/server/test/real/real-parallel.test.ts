// Claude e Codex reais trabalhando ao mesmo tempo, cada um no seu worktree. A pasta do
// usuário só muda quando ele aprova a integração. Gasta cota da assinatura.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createConfig } from '../../src/config.ts';
import { createContext } from '../../src/context.ts';

test('Paralelo real: worktrees isolados e integração só depois de aprovar', { timeout: 600_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-paralelo-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-paralelo-projeto-'));
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  sh('init', '-q', '-b', 'main');
  sh('config', 'user.name', 'Teste');
  sh('config', 'user.email', 'teste@example.com');
  fs.writeFileSync(path.join(projectDir, 'LEIA.txt'), 'projeto de teste\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'inicial');

  const ctx = await createContext(createConfig({ dataDir }));
  try {
    await ctx.detection.refresh();
    const project = await ctx.projects.create({ path: projectDir });
    const claudeProfile = await ctx.profiles.create({ provider: 'claude', label: 'Padrão', useSystemDefault: true });
    const codexProfile = await ctx.profiles.create({ provider: 'codex', label: 'Padrão', useSystemDefault: true });
    const claude = await ctx.agents.create({ name: 'Ana', role: 'frontend', provider: 'claude', profileId: claudeProfile.id, model: 'haiku', permission: 'edit' });
    const codex = await ctx.agents.create({ name: 'Bruno', role: 'backend', provider: 'codex', profileId: codexProfile.id, effort: 'low', permission: 'edit' });

    const workflow = await ctx.workflows.create({
      name: 'Dois ao mesmo tempo',
      nodes: [
        { id: 'a', title: 'Criar interface', agentId: claude.id, role: 'frontend', description: 'Crie o arquivo interface.txt com o texto "interface pronta". Só isso.' },
        { id: 'b', title: 'Criar servidor', agentId: codex.id, role: 'backend', description: 'Crie o arquivo servidor.txt com o texto "servidor pronto". Só isso.' },
      ],
      edges: [],
    });
    const mission = await ctx.workflows.run(workflow.id, { projectId: project.id, goal: 'Teste de trabalho em paralelo', settings: { concurrency: 2 } });
    await ctx.orchestrator.waitForIdle(mission.id);
    await ctx.orchestrator.approve(mission.id);
    const state = await ctx.orchestrator.waitForIdle(mission.id);
    const tasks = await ctx.orchestrator.tasks(mission.id);
    process.stdout.write(`${JSON.stringify(tasks.map((task) => [task.title, task.status, task.startedAt, task.endedAt, task.errorText]))}\n`);

    assert.equal(state.status, 'completed', state.pauseReason ?? '');
    assert.equal(state.isolation, 'worktree');
    assert.equal(state.mergeStatus, 'pending');
    const [first, second] = tasks;
    assert.ok(first?.startedAt && second?.startedAt && first.endedAt && second.endedAt);
    assert.ok(first.startedAt < second.endedAt && second.startedAt < first.endedAt, 'as duas rodaram ao mesmo tempo');

    assert.ok(!fs.existsSync(path.join(projectDir, 'interface.txt')), 'a pasta do usuário continua intacta');
    assert.ok(!fs.existsSync(path.join(projectDir, 'servidor.txt')));

    const review = await ctx.orchestrator.reviewChanges(mission.id);
    assert.ok(review.files.includes('interface.txt') && review.files.includes('servidor.txt'), review.files.join(', '));

    await ctx.orchestrator.mergeResult(mission.id);
    assert.ok(fs.existsSync(path.join(projectDir, 'interface.txt')));
    assert.ok(fs.existsSync(path.join(projectDir, 'servidor.txt')));
    assert.doesNotMatch(sh('branch', '--list', 'xinoia/*'), /xinoia/);
  } finally {
    await ctx.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

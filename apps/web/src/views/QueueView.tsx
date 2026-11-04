import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, Info, ListOrdered, Pencil, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExecutionMode, GoalQueue, Mission, QueueItem, Workflow } from '@xinoia/shared';
import { api } from '../api.ts';
import { Button, Empty, Field, IconButton, PageHeader } from '../components/ui.tsx';
import { useStore } from '../store.ts';

const STATUS: Record<QueueItem['status'], { label: string; className: string }> = {
  pending: { label: 'Na fila', className: 'bg-hover text-soft' },
  running: { label: 'Em andamento', className: 'bg-accent-soft text-accent' },
  done: { label: 'Concluído', className: 'bg-hover text-ok' },
  failed: { label: 'Falhou', className: 'bg-danger-soft text-danger' },
};

const MODE_HINT: Record<ExecutionMode, string> = {
  supervised: 'No modo supervisionado, cada objetivo espera você aprovar o plano e liberar cada tarefa.',
  semi: 'No modo semiautônomo, cada objetivo espera você aprovar o plano. Só no autônomo controlado a fila segue sem aprovação.',
  autonomous: 'No modo autônomo controlado, cada objetivo começa sem esperar a aprovação do plano.',
};

const count = (value: number) => value.toLocaleString('pt-BR');

/** A mensagem do que a fila está esperando, se a missão atual depende da pessoa. */
function waitingFor(mission: Mission | undefined): string | null {
  if (mission?.status === 'awaiting_approval') return 'O plano deste objetivo está esperando a sua aprovação.';
  if (mission?.status === 'paused') return mission.pauseReason ?? 'A missão deste objetivo está pausada.';
  return null;
}

function Item({ queue, item, index, onMove }: { queue: GoalQueue; item: QueueItem; index: number; onMove: (delta: number) => void }) {
  const run = useStore((state) => state.run);
  const openMission = useStore((state) => state.openMission);
  const [draft, setDraft] = useState<string | null>(null);
  const base = `/api/projects/${queue.projectId}/queue/items/${item.id}`;
  const status = STATUS[item.status];
  const pending = queue.items.filter((entry) => entry.status === 'pending');
  const place = pending.findIndex((entry) => entry.id === item.id);
  const tokens = item.inputTokens + item.outputTokens;

  return (
    <li className="rounded-lg border border-line bg-panel p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 font-mono text-[11px] text-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          {draft === null ? (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">{item.goal}</p>
          ) : (
            <div className="space-y-2">
              <textarea aria-label="Editar objetivo" autoFocus rows={3} className="field" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  kind="primary"
                  disabled={!draft.trim()}
                  onClick={async () => {
                    if (await run(() => api.patch(base, { goal: draft }))) setDraft(null);
                  }}
                >
                  Salvar
                </Button>
                <Button size="sm" kind="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
              </div>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className={`rounded px-1.5 py-0.5 font-medium ${status.className}`}>{status.label}</span>
            {tokens > 0 && <span>{count(tokens)} tokens</span>}
            {item.runsWithoutUsage > 0 && <span className="text-amber">{item.runsWithoutUsage} execução(ões) sem consumo informado</span>}
          </div>
          {item.reason && <p className="mt-1.5 text-xs text-danger">{item.reason}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {item.status === 'pending' && draft === null && (
            <>
              <IconButton label="Subir" disabled={place === 0} onClick={() => onMove(-1)}><ArrowUp size={13} /></IconButton>
              <IconButton label="Descer" disabled={place === pending.length - 1} onClick={() => onMove(1)}><ArrowDown size={13} /></IconButton>
              <IconButton label="Editar objetivo" onClick={() => setDraft(item.goal)}><Pencil size={13} /></IconButton>
            </>
          )}
          {item.status === 'failed' && (
            <IconButton label="Colocar de novo na fila" onClick={() => void run(() => api.post(`${base}/requeue`))}><RotateCcw size={13} /></IconButton>
          )}
          {item.missionId && item.status !== 'pending' && (
            <IconButton label="Abrir a missão" onClick={() => openMission(item.missionId!)}><ExternalLink size={13} /></IconButton>
          )}
          {item.status !== 'running' && (
            <IconButton label="Remover objetivo" onClick={() => void run(() => api.delete(base))}><Trash2 size={13} /></IconButton>
          )}
        </div>
      </div>
    </li>
  );
}

export function QueueView() {
  const projectId = useStore((state) => state.projectId);
  const project = useStore((state) => state.projects.find((item) => item.id === state.projectId));
  const queue = useStore((state) => state.queue);
  const missions = useStore((state) => state.missions);
  const agents = useStore((state) => state.agents);
  const run = useStore((state) => state.run);
  const setView = useStore((state) => state.setView);
  const openMission = useStore((state) => state.openMission);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [mode, setMode] = useState<ExecutionMode | null>(null);
  const [goals, setGoals] = useState('');
  const [limit, setLimit] = useState('');

  useEffect(() => {
    void run(() => api.get<Workflow[]>('/api/workflows')).then((list) => list && setWorkflows(list));
    void run(() => api.get<{ executionMode: ExecutionMode }>('/api/settings')).then((settings) => settings && setMode(settings.executionMode));
  }, [run]);

  useEffect(() => {
    setLimit(queue?.tokenLimit ? String(queue.tokenLimit) : '');
  }, [queue?.tokenLimit]);

  if (!projectId) {
    return <Empty title="Nenhum projeto aberto" action={<Button kind="primary" onClick={() => setView('projects')}>Abrir um projeto</Button>} />;
  }
  if (!agents.length) {
    return <Empty title="Sua equipe ainda está vazia" action={<Button kind="primary" onClick={() => setView('agents')}>Criar agentes</Button>}>A fila precisa de ao menos um agente.</Empty>;
  }

  const url = `/api/projects/${projectId}/queue`;
  const settings = { workflowId: queue?.workflowId ?? workflows[0]?.id ?? '', onFailure: queue?.onFailure ?? 'stop', tokenLimit: queue?.tokenLimit ?? null };
  const save = (change: Partial<typeof settings>) => run(() => api.put<GoalQueue>(url, { ...settings, ...change }));
  const items = queue?.items ?? [];
  const pending = items.filter((item) => item.status === 'pending');
  const finished = items.filter((item) => item.status === 'done' || item.status === 'failed');
  const current = items.find((item) => item.status === 'running');
  const currentMission = missions.find((mission) => mission.id === current?.missionId);
  const waiting = queue?.running ? waitingFor(currentMission) : null;
  const spent = items.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);
  const unknown = items.reduce((sum, item) => sum + item.runsWithoutUsage, 0);
  const missingWorkflow = queue && workflows.length > 0 && !workflows.some((workflow) => workflow.id === queue.workflowId);

  const add = async () => {
    const list = goals.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!queue && !(await save({}))) return;
    if (await run(() => api.post(`${url}/items`, { goals: list }))) setGoals('');
  };

  const move = (itemId: string, delta: number) => {
    const order = pending.map((item) => item.id);
    const from = order.indexOf(itemId);
    order.splice(from, 1);
    order.splice(from + delta, 0, itemId);
    void run(() => api.post(`${url}/order`, { itemIds: order }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Fila"
        subtitle="Objetivos que a equipe faz em ordem, um de cada vez, com o workflow que você escolher"
        actions={(
          <>
            {finished.length > 0 && <Button kind="ghost" onClick={() => void run(() => api.post(`${url}/clear`))}>Limpar concluídos</Button>}
            {queue?.running
              ? <Button onClick={() => void run(() => api.post(`${url}/stop`), 'A fila não inicia mais nada. O objetivo em andamento termina normalmente.')}><Square size={13} /> Parar a fila</Button>
              : <Button kind="primary" disabled={!pending.length && !current} onClick={() => void run(() => api.post(`${url}/start`))}><Play size={13} /> {finished.length || queue?.stopReason || current ? 'Continuar' : 'Iniciar'}</Button>}
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {queue?.stopReason && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-amber-soft px-3 py-2 text-[13px] text-amber">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />{queue.stopReason}
            </p>
          )}
          {waiting && currentMission && (
            <div role="status" className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-amber-soft px-3 py-2 text-[13px] text-amber">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p>{waiting}</p>
                  <p className="text-xs opacity-90">A fila segue quando esta missão terminar.</p>
                </div>
              </div>
              <Button size="sm" onClick={() => openMission(currentMission.id)}>Abrir a missão</Button>
            </div>
          )}
          {queue && !queue.running && !queue.stopReason && !pending.length && !current && finished.length > 0 && (
            <p role="status" className="rounded-md bg-hover px-3 py-2 text-[13px] text-soft">A fila terminou todos os objetivos.</p>
          )}

          <section className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-3">
            <Field label="Workflow">
              <select className="field" value={settings.workflowId} onChange={(event) => void save({ workflowId: event.target.value })}>
                {missingWorkflow && <option value={queue.workflowId}>Workflow apagado</option>}
                {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
              </select>
            </Field>
            <Field label="Se um objetivo falhar">
              <select className="field" value={settings.onFailure} onChange={(event) => void save({ onFailure: event.target.value as GoalQueue['onFailure'] })}>
                <option value="stop">Parar e esperar por mim</option>
                <option value="skip">Registrar e seguir para o próximo</option>
              </select>
            </Field>
            <Field label="Limite de gasto, em tokens">
              <input
                type="number"
                min={1}
                className="field"
                placeholder="Sem limite"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                onBlur={() => {
                  const value = Number(limit) > 0 ? Math.floor(Number(limit)) : null;
                  if (value !== settings.tokenLimit) void save({ tokenLimit: value });
                }}
              />
            </Field>
            <p className="text-xs text-muted sm:col-span-3">
              Gasto até agora: <b className="font-medium text-soft">{count(spent)} tokens</b>{settings.tokenLimit ? ` de ${count(settings.tokenLimit)}` : ''}
              {unknown > 0 && <span className="text-amber">, sem contar {unknown} execução(ões) que não informaram consumo</span>}.
              {' '}O limite é conferido entre um objetivo e outro: o que está em andamento termina.
            </p>
          </section>

          <section className="rounded-xl border border-line bg-panel p-4">
            <Field label="Novos objetivos" hint="Um por linha. Seja específico, e diga como saber que terminou.">
              <textarea rows={3} className="field" value={goals} onChange={(event) => setGoals(event.target.value)} />
            </Field>
            <Button className="mt-2" disabled={!goals.trim() || !settings.workflowId} onClick={() => void add()}><Plus size={13} /> Adicionar à fila</Button>
          </section>

          {items.length ? (
            <ol className="space-y-2" aria-label="Objetivos da fila">
              {items.map((item, index) => <Item key={item.id} queue={queue!} item={item} index={index} onMove={(delta) => move(item.id, delta)} />)}
            </ol>
          ) : (
            <Empty title="A fila está vazia" icon={<ListOrdered size={28} />}>Adicione objetivos e clique em Iniciar. Quando um termina, o próximo começa.</Empty>
          )}

          <ul className="space-y-1.5 text-xs text-muted">
            {mode && <li className="flex items-start gap-2"><Info size={13} className="mt-0.5 shrink-0" />{MODE_HINT[mode]}</li>}
            <li className="flex items-start gap-2">
              <Info size={13} className="mt-0.5 shrink-0" />
              {project?.info.isGit
                ? 'Antes de cada objetivo, o projeto precisa estar sem alterações pendentes. Termine o workflow com uma etapa que faça commit, ou faça você mesmo e clique em Continuar.'
                : 'Este projeto não usa Git, então a fila não consegue conferir se há alterações pendentes antes de cada objetivo.'}
            </li>
            <li className="flex items-start gap-2"><Info size={13} className="mt-0.5 shrink-0" />A fila roda uma tarefa de cada vez, na pasta do projeto.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

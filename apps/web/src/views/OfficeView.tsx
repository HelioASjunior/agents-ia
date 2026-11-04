import { Building2, LayoutList, MessageSquare, Square, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Run } from '@xinoia/shared';
import { ROLES } from '@xinoia/shared';
import { api } from '../api.ts';
import { OfficeScene } from '../components/office/scene.ts';
import { ACTIVITY, Avatar, Button, Empty, formatDateTime, formatDuration, IconButton, StatusPill, useActivity } from '../components/ui.tsx';
import { activeMission, useStore } from '../store.ts';

function AgentDetails({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { state, activity } = useActivity(agent.id);
  const allRuns = useStore((store) => store.runs);
  const events = useStore((store) => store.events);
  const missions = useStore((store) => store.missions);
  const tasks = useStore((store) => store.tasks);
  const provider = useStore((store) => store.providers.find((item) => item.id === agent.provider));
  const profile = useStore((store) => store.profiles.find((item) => item.id === agent.profileId));
  const setChannel = useStore((store) => store.setChannel);
  const setView = useStore((store) => store.setView);
  const run = useStore((store) => store.run);
  const info = ACTIVITY[activity];

  const runs = useMemo(() => Object.values(allRuns).filter((item) => item.agentId === agent.id).sort((a, b) => b.queuedAt - a.queuedAt), [agent.id, allRuns]);
  const current = runs.find((item) => item.status === 'running');
  const runIds = useMemo(() => new Set(runs.slice(0, 5).map((item) => item.id)), [runs]);
  const lines = useMemo(() => events.filter((item) => runIds.has(item.runId)).flatMap((item) => {
    const { event } = item;
    if (event.type === 'tool_start') return [{ id: item.id, text: `▸ ${event.command ?? event.summary}`, tone: 'text-amber' }];
    if (event.type === 'error' || event.type === 'stderr') return [{ id: item.id, text: event.text, tone: 'text-danger' }];
    if (event.type === 'warning') return [{ id: item.id, text: event.text, tone: 'text-amber' }];
    if (event.type === 'text' && event.text.trim()) return [{ id: item.id, text: event.text.trim(), tone: 'text-soft' }];
    return [];
  }).slice(-40), [events, runIds]);
  const missionTasks = missions.flatMap((mission) => tasks[mission.id] ?? []);
  const task = state?.taskId ? missionTasks.find((item) => item.id === state.taskId) : missionTasks.find((item) => item.status === 'running' && item.assigneeId === agent.id);

  return (
    <aside className="rise absolute top-3 right-3 bottom-3 flex w-80 max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel" style={{ boxShadow: 'var(--shadow)' }} aria-label={`Detalhes de ${agent.name}`}>
      <header className="flex items-start gap-3 border-b border-line p-3.5">
        <Avatar agent={agent} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[15px] font-semibold leading-tight">{agent.name}</h2>
          <p className="truncate text-xs text-muted">{agent.roleTitle || ROLES[agent.role].title}</p>
          <p className="mt-1 text-xs font-medium" style={{ color: info.color }}>{info.label}</p>
        </div>
        <IconButton label="Fechar" onClick={onClose}><X size={15} /></IconButton>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5 text-[13px]">
        {state?.detail && activity !== 'available' && <p className="break-all rounded-md bg-bg px-2.5 py-1.5 font-mono text-xs">{state.detail}</p>}
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between gap-2"><dt className="text-muted">Ferramenta</dt><dd className="truncate">{provider?.label ?? agent.provider}{agent.model ? ` · ${agent.model}` : ''}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">Conta</dt><dd className="truncate">{profile?.label ?? 'Nenhuma'}</dd></div>
        </dl>
        <div>
          <h3 className="label mb-1">Tarefa atual</h3>
          {task ? <p className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{task.title}</span><StatusPill status={task.status} /></p> : <p className="text-xs text-muted">Nenhuma tarefa em andamento.</p>}
        </div>
        <div>
          <h3 className="label mb-1">Terminal</h3>
          <div className="max-h-44 overflow-y-auto rounded-md bg-bg p-2 font-mono text-[11px] leading-relaxed">
            {lines.length
              ? lines.map((line) => <p key={line.id} className={`whitespace-pre-wrap break-all ${line.tone}`}>{line.text.slice(0, 400)}</p>)
              : <p className="text-muted">Sem atividade ainda.</p>}
          </div>
        </div>
        <div>
          <h3 className="label mb-1">Histórico</h3>
          <ul className="space-y-1">
            {runs.slice(0, 6).map((item: Run) => (
              <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">{formatDateTime(item.queuedAt)}{item.startedAt && item.endedAt ? ` · ${formatDuration(item.endedAt - item.startedAt)}` : ''}</span>
                <StatusPill status={item.status} />
              </li>
            ))}
            {!runs.length && <li className="text-xs text-muted">Nenhuma execução neste projeto.</li>}
          </ul>
        </div>
      </div>
      <footer className="flex gap-2 border-t border-line p-2.5">
        <Button className="flex-1" kind="primary" size="sm" onClick={() => { setChannel(agent.id); setView('chat'); }}><MessageSquare size={13} /> Conversar</Button>
        {current && <Button size="sm" kind="danger" onClick={() => void run(() => api.post(`/api/runs/${current.id}/cancel`), 'Execução interrompida.')}><Square size={11} /> Interromper</Button>}
      </footer>
    </aside>
  );
}

function CompactView({ onSelect }: { onSelect: (id: string) => void }) {
  const agents = useStore((store) => store.agents);
  const states = useStore((store) => store.agentStates);
  const missions = useStore((store) => store.missions);
  const tasks = useStore((store) => store.tasks);
  const mission = activeMission(missions) ?? missions[0];
  const list = mission ? tasks[mission.id] ?? [] : [];
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-panel">
          <tr className="label border-b border-line">
            <th scope="col" className="px-4 py-2 font-normal">Agente</th>
            <th scope="col" className="px-3 py-2 font-normal">Estado</th>
            <th scope="col" className="px-3 py-2 font-normal">Fazendo agora</th>
            <th scope="col" className="px-3 py-2 font-normal">Tarefa</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {agents.map((agent) => {
            const state = states[agent.id];
            const info = ACTIVITY[state?.activity ?? 'available'];
            const task = list.find((item) => item.status === 'running' && item.assigneeId === agent.id);
            return (
              <tr key={agent.id} className="cursor-pointer hover:bg-hover" onClick={() => onSelect(agent.id)}>
                <td className="px-4 py-2">
                  <button type="button" className="flex items-center gap-2 font-medium" onClick={() => onSelect(agent.id)}>
                    <Avatar agent={agent} size={24} />{agent.name}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs font-medium" style={{ color: info.color }}>{info.label}</td>
                <td className="max-w-72 truncate px-3 py-2 font-mono text-xs text-muted">{state?.detail ?? '—'}</td>
                <td className="max-w-56 truncate px-3 py-2 text-xs">{task?.title ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MODE_KEY = 'xinoia.officeMode';

export function OfficeView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const seenEvents = useRef(new Set<number>());
  const agents = useStore((store) => store.agents);
  const states = useStore((store) => store.agentStates);
  const theme = useStore((store) => store.theme);
  const missions = useStore((store) => store.missions);
  const tasks = useStore((store) => store.tasks);
  const runs = useStore((store) => store.runs);
  const missionEvents = useStore((store) => store.missionEvents);
  const setView = useStore((store) => store.setView);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'office' | 'compact'>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'compact' ? 'compact' : 'office';
    } catch {
      return 'office';
    }
  });

  const changeMode = (next: 'office' | 'compact') => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Preferência visual: sem armazenamento, só não é lembrada.
    }
  };

  useEffect(() => {
    if (mode !== 'office' || !canvas.current) return undefined;
    const instance = new OfficeScene(canvas.current);
    instance.onSelect = setSelected;
    instance.start();
    scene.current = instance;
    return () => {
      instance.destroy();
      scene.current = null;
    };
  }, [mode]);

  useEffect(() => {
    scene.current?.setTheme(theme);
  }, [theme, mode]);

  useEffect(() => {
    scene.current?.setAgents(agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      color: agent.color,
      activity: states[agent.id]?.activity ?? 'available',
      detail: states[agent.id]?.detail ?? null,
    })));
  }, [agents, states, mode]);

  useEffect(() => {
    scene.current?.setSelected(selected);
  }, [selected, mode]);

  const mission = activeMission(missions) ?? missions[0];
  const missionTasks = mission ? tasks[mission.id] ?? [] : [];
  useEffect(() => {
    const list = Object.values(runs);
    scene.current?.setStats({
      running: list.filter((run) => run.status === 'running').length,
      done: list.filter((run) => run.status === 'completed').length,
      failed: list.filter((run) => run.status === 'failed').length,
      missionTitle: mission && activeMission(missions) ? mission.goal : null,
      missionStatus: mission?.status ?? null,
      tasksDone: missionTasks.filter((task) => task.status === 'done' || task.status === 'skipped').length,
      tasksTotal: missionTasks.length,
    });
  }, [mission, missionTasks, missions, runs, mode]);

  // Passagens de trabalho reais viram a caminhada até a mesa do colega.
  useEffect(() => {
    if (!mission) return;
    const list = missionEvents[mission.id] ?? [];
    const firstRun = seenEvents.current.size === 0;
    for (const event of list) {
      if (seenEvents.current.has(event.id)) continue;
      seenEvents.current.add(event.id);
      // O que já tinha acontecido ao abrir a tela não é reencenado.
      if (firstRun) continue;
      if (event.data.type === 'handoff' && event.data.fromAgentId && event.data.toAgentId) {
        scene.current?.playHandoff(event.data.fromAgentId, event.data.toAgentId, event.data.taskTitle);
      }
    }
  }, [mission, missionEvents]);

  const agent = agents.find((item) => item.id === selected);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-panel px-3 py-1.5">
        {agents.map((item) => {
          const state = states[item.id];
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => setSelected(selected === item.id ? null : item.id)}
              title={state?.detail ?? ACTIVITY[state?.activity ?? 'available'].label}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${selected === item.id ? 'bg-hover' : 'hover:bg-hover/60'}`}
            >
              <Avatar agent={item} size={20} />
              {item.name}
            </button>
          );
        })}
        <span className="flex-1" />
        <div className="flex shrink-0 rounded-md border border-line-strong p-0.5" role="group" aria-label="Forma de visualização">
          <button type="button" aria-pressed={mode === 'office'} onClick={() => changeMode('office')} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${mode === 'office' ? 'bg-hover text-ink' : 'text-muted'}`}><Building2 size={12} /> Escritório</button>
          <button type="button" aria-pressed={mode === 'compact'} onClick={() => changeMode('compact')} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${mode === 'compact' ? 'bg-hover text-ink' : 'text-muted'}`}><LayoutList size={12} /> Compacto</button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!agents.length ? (
          <Empty title="O escritório está vazio" icon={<Users size={28} />} action={<Button kind="primary" onClick={() => setView('agents')}>Contratar agentes</Button>}>
            Cada agente que você criar ganha uma mesa na sala da função dele.
          </Empty>
        ) : mode === 'compact' ? (
          <CompactView onSelect={setSelected} />
        ) : (
          <>
            <canvas ref={canvas} role="img" aria-label="Escritório virtual com os agentes. O modo compacto mostra as mesmas informações em uma tabela." className="block touch-none" />
            <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted">Clique em um agente. Arraste para mover, use a roda do mouse para aproximar, clique duas vezes para recentrar.</p>
          </>
        )}
        {agent && <AgentDetails agent={agent} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

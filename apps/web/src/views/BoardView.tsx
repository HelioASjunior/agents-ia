import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  GitMerge,
  GripVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  ShieldAlert,
  SkipForward,
  Trash2,
  UserRoundCog,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Mission, StoredMissionEvent, Task } from '@xinoia/shared';
import { api } from '../api.ts';
import { Markdown } from '../components/Markdown.tsx';
import { Avatar, Button, Dialog, Empty, Field, formatDateTime, formatDuration, formatTime, IconButton, Meter, PageHeader, StatusPill } from '../components/ui.tsx';
import { activeMission, useStore } from '../store.ts';

const COLUMNS: Array<{ id: string; title: string; statuses: Task['status'][] }> = [
  { id: 'pending', title: 'A fazer', statuses: ['pending'] },
  { id: 'running', title: 'Em execução', statuses: ['running'] },
  { id: 'done', title: 'Concluídas', statuses: ['done', 'skipped'] },
  { id: 'failed', title: 'Com problema', statuses: ['failed', 'cancelled'] },
];

function NewMission({ onClose }: { onClose: () => void }) {
  const projectId = useStore((state) => state.projectId);
  const agents = useStore((state) => state.agents);
  const run = useStore((state) => state.run);
  const loadMission = useStore((state) => state.loadMission);
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<'auto' | 'pipeline'>('auto');
  const [coordinatorId, setCoordinatorId] = useState(agents.find((agent) => agent.role === 'coordinator')?.id ?? agents[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>(agents.map((agent) => agent.id));
  const [concurrency, setConcurrency] = useState(1);
  const [autoApprove, setAutoApprove] = useState(false);
  const [maxReviewRounds, setMaxReviewRounds] = useState(2);
  const [fallback, setFallback] = useState(false);

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const submit = async () => {
    const mission = await run(() => api.post<Mission>('/api/missions', {
      projectId,
      goal,
      mode,
      coordinatorId,
      agentIds: selected,
      settings: { concurrency, autoApprove: mode === 'pipeline' ? true : autoApprove, maxReviewRounds, fallbackToOtherProvider: fallback },
    }));
    if (mission) {
      await loadMission(mission.id);
      onClose();
    }
  };

  return (
    <Dialog
      title="Nova missão"
      onClose={onClose}
      width={600}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>Cancelar</Button>
          <Button kind="primary" disabled={!goal.trim() || !selected.length} onClick={() => void submit()}><Rocket size={14} /> Iniciar missão</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Field label="Objetivo">
          <textarea autoFocus rows={4} className="field" value={goal} placeholder="Ex.: crie um sistema de gestão financeira com login, lançamentos e relatórios." onChange={(event) => setGoal(event.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-soft">Como dividir o trabalho</legend>
          <div className="grid grid-cols-2 gap-2">
            {([['auto', 'Coordenador decide', 'Monta um plano para você aprovar.'], ['pipeline', 'Sequência fixa', 'Cada agente, na ordem marcada abaixo.']] as const).map(([value, title, text]) => (
              <label key={value} className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${mode === value ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover'}`}>
                <input type="radio" className="sr-only" name="mode" checked={mode === value} onChange={() => setMode(value)} />
                <span className="block text-[13px] font-medium">{title}</span>
                <span className="block text-xs text-muted">{text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-soft">Quem participa</legend>
          <div className="flex flex-wrap gap-1.5">
            {agents.map((agent) => {
              const position = selected.indexOf(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-pressed={position >= 0}
                  onClick={() => toggle(agent.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px] transition-colors ${position >= 0 ? 'border-accent bg-accent-soft' : 'border-line-strong text-muted hover:bg-hover'}`}
                >
                  <Avatar agent={agent} size={20} showStatus={false} />
                  {agent.name}
                  {mode === 'pipeline' && position >= 0 && <span className="text-[11px] text-accent">{position + 1}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Coordenador">
            <select className="field" value={coordinatorId} onChange={(event) => setCoordinatorId(event.target.value)}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </Field>
          <Field label="Tarefas ao mesmo tempo" hint="Acima de 1, cada uma trabalha em um worktree próprio se o projeto usar Git.">
            <input type="number" min={1} max={8} className="field" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value) || 1)} />
          </Field>
          <Field label="Rodadas de correção após reprovação">
            <input type="number" min={0} max={10} className="field" value={maxReviewRounds} onChange={(event) => setMaxReviewRounds(Number(event.target.value) || 0)} />
          </Field>
        </div>
        <div className="space-y-1.5 text-[13px]">
          {mode === 'auto' && (
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={autoApprove} onChange={(event) => setAutoApprove(event.target.checked)} /> Começar sem esperar minha aprovação do plano</label>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={fallback} onChange={(event) => setFallback(event.target.checked)} />
            <span>Se uma conta atingir o limite, passar a tarefa a um agente de <b>outro provedor</b> com permissão igual ou maior e as mesmas ferramentas. Nunca troca para outra conta do mesmo provedor.</span>
          </label>
        </div>
      </div>
    </Dialog>
  );
}

interface DraftTask {
  id: string;
  title: string;
  description: string;
  assignee: string;
  type: 'work' | 'review';
  priority: number;
  dependsOn: string[];
}

function PlanEditor({ mission, tasks }: { mission: Mission; tasks: Task[] }) {
  const agents = useStore((state) => state.agents);
  const run = useStore((state) => state.run);
  const [drafts, setDrafts] = useState<DraftTask[]>(() => tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    assignee: task.assigneeId ?? '',
    type: task.type,
    priority: task.priority,
    dependsOn: task.dependsOn,
  })));
  const [feedback, setFeedback] = useState('');
  const [asking, setAsking] = useState(false);
  const team = agents.filter((agent) => mission.agentIds.includes(agent.id));

  const patch = (id: string, change: Partial<DraftTask>) => setDrafts((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  return (
    <section className="rise rounded-xl border border-amber/50 bg-amber-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-[15px] font-semibold">O plano está pronto para sua aprovação</h2>
          {mission.planSummary && <p className="text-[13px] text-soft">{mission.planSummary}</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAsking(true)}><RefreshCw size={13} /> Pedir outro plano</Button>
          <Button
            kind="primary"
            disabled={!drafts.length}
            onClick={() => void run(() => api.post(`/api/missions/${mission.id}/approve`, { tasks: drafts }), 'Missão em execução.')}
          >
            <CheckCircle2 size={14} /> Aprovar e iniciar
          </Button>
        </div>
      </div>
      <ol className="mt-3 space-y-2">
        {drafts.map((task, index) => (
          <li key={task.id} className="rounded-lg border border-line bg-panel p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <GripVertical size={13} className="text-muted" aria-hidden />
              <span className="font-mono text-[11px] text-muted">{index + 1}</span>
              <input aria-label="Título da tarefa" className="field !w-auto min-w-48 flex-1 !py-1" value={task.title} onChange={(event) => patch(task.id, { title: event.target.value })} />
              <select aria-label="Responsável" className="field !w-auto !py-1" value={task.assignee} onChange={(event) => patch(task.id, { assignee: event.target.value })}>
                {team.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <select aria-label="Tipo" className="field !w-auto !py-1" value={task.type} onChange={(event) => patch(task.id, { type: event.target.value as DraftTask['type'] })}>
                <option value="work">Trabalho</option>
                <option value="review">Revisão</option>
              </select>
              <select aria-label="Prioridade" className="field !w-auto !py-1" value={task.priority} onChange={(event) => patch(task.id, { priority: Number(event.target.value) })}>
                <option value={1}>Alta</option>
                <option value={2}>Média</option>
                <option value={3}>Baixa</option>
              </select>
              <IconButton
                label="Remover tarefa"
                onClick={() => setDrafts((list) => list.filter((item) => item.id !== task.id).map((item) => ({ ...item, dependsOn: item.dependsOn.filter((dep) => dep !== task.id) })))}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
            <textarea aria-label="Descrição da tarefa" rows={2} className="field mt-2 !text-xs" value={task.description} onChange={(event) => patch(task.id, { description: event.target.value })} />
            {index > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                <span>Depende de:</span>
                {drafts.slice(0, index).map((other) => {
                  const on = task.dependsOn.includes(other.id);
                  return (
                    <button
                      key={other.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch(task.id, { dependsOn: on ? task.dependsOn.filter((dep) => dep !== other.id) : [...task.dependsOn, other.id] })}
                      className={`rounded px-1.5 py-0.5 ${on ? 'bg-accent-soft text-accent' : 'bg-hover hover:text-ink'}`}
                    >
                      {other.title.slice(0, 28)}
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ol>
      <Button
        className="mt-2"
        size="sm"
        kind="ghost"
        onClick={() => setDrafts((list) => [...list, { id: `novo-${Date.now()}`, title: 'Nova tarefa', description: '', assignee: team[0]?.id ?? '', type: 'work', priority: 2, dependsOn: list.at(-1) ? [list.at(-1)!.id] : [] }])}
      >
        <Plus size={13} /> Adicionar tarefa
      </Button>
      {asking && (
        <Dialog
          title="Pedir outro plano"
          onClose={() => setAsking(false)}
          footer={(
            <Button
              kind="primary"
              disabled={!feedback.trim()}
              onClick={() => {
                void run(() => api.post(`/api/missions/${mission.id}/replan`, { feedback }));
                setAsking(false);
              }}
            >
              Enviar ao coordenador
            </Button>
          )}
        >
          <Field label="O que mudar">
            <textarea autoFocus rows={4} className="field" value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          </Field>
        </Dialog>
      )}
    </section>
  );
}

function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const runs = useStore((state) => state.runs);
  const agents = useStore((state) => state.agents);
  const run = useStore((state) => state.run);
  const taskRuns = Object.values(runs).filter((item) => item.taskId === task.id);
  const [agentId, setAgentId] = useState('');
  const canAct = task.status === 'failed' || task.status === 'pending' || (task.status === 'done' && task.verdict === 'REPROVADO');

  return (
    <Dialog title={task.title} onClose={onClose} width={640}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        <div><dt className="label">Estado</dt><dd className="mt-0.5"><StatusPill status={task.status} /></dd></div>
        <div><dt className="label">Responsável</dt><dd>{task.assigneeName}</dd></div>
        <div><dt className="label">Tentativas</dt><dd>{task.attempts}</dd></div>
        <div><dt className="label">Duração</dt><dd>{task.startedAt && task.endedAt ? formatDuration(task.endedAt - task.startedAt) : '—'}</dd></div>
        {task.verdict && <div><dt className="label">Veredito</dt><dd className={task.verdict === 'APROVADO' ? 'text-ok' : 'text-danger'}>{task.verdict}</dd></div>}
        <div><dt className="label">Início</dt><dd>{formatDateTime(task.startedAt) || '—'}</dd></div>
        <div><dt className="label">Fim</dt><dd>{formatDateTime(task.endedAt) || '—'}</dd></div>
      </dl>
      {task.description && <p className="mt-3 whitespace-pre-wrap text-[13px] text-soft">{task.description}</p>}
      {task.handovers.map((item) => (
        <p key={item.at} className="mt-3 rounded-md bg-amber-soft px-3 py-2 text-[13px] text-amber">
          {item.fromAgentName} ({item.fromProvider}) atingiu o limite de uso em {formatDateTime(item.at)}, e {item.toAgentName} ({item.toProvider}) assumiu a tarefa.
        </p>
      ))}
      {task.errorText && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{task.errorText}</p>}
      {task.filesChanged.length > 0 && (
        <div className="mt-3">
          <h3 className="label mb-1">Arquivos alterados</h3>
          <ul className="space-y-0.5 font-mono text-xs">{task.filesChanged.map((file) => <li key={file}>{file}</li>)}</ul>
        </div>
      )}
      {task.result && (
        <div className="mt-3">
          <h3 className="label mb-1">Resultado</h3>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-line p-3"><Markdown text={task.result} /></div>
        </div>
      )}
      {taskRuns.length > 0 && (
        <div className="mt-3">
          <h3 className="label mb-1">Execuções</h3>
          <ul className="space-y-1 text-xs">
            {taskRuns.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <StatusPill status={item.status} />
                <span className="text-muted">{formatDateTime(item.startedAt)}</span>
                <code className="truncate font-mono text-muted">{item.id}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {canAct && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button onClick={() => { void run(() => api.post(`/api/missions/${task.missionId}/tasks/${task.id}/retry`)); onClose(); }}><RefreshCw size={13} /> Tentar de novo</Button>
          <Button onClick={() => { void run(() => api.post(`/api/missions/${task.missionId}/tasks/${task.id}/skip`)); onClose(); }}><SkipForward size={13} /> Pular</Button>
          {task.status !== 'done' && (
            <>
              <select aria-label="Reatribuir para" className="field !w-auto" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">Reatribuir para…</option>
                {agents.filter((agent) => agent.id !== task.assigneeId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <Button disabled={!agentId} onClick={() => void run(() => api.post(`/api/missions/${task.missionId}/tasks/${task.id}/reassign`, { agentId }), 'Tarefa reatribuída.')}><UserRoundCog size={13} /> Reatribuir</Button>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const agent = useStore((state) => state.agents.find((item) => item.id === task.assigneeId));
  const detail = useStore((state) => (task.assigneeId && task.status === 'running' ? state.agentStates[task.assigneeId]?.detail : undefined));
  return (
    <button type="button" onClick={onOpen} className="rise block w-full rounded-lg border border-line bg-raised p-2.5 text-left transition-colors hover:border-line-strong">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{task.title}</span>
        {agent && <Avatar agent={agent} size={22} />}
      </div>
      {detail && <p className="mt-1 truncate font-mono text-[11px] text-accent">{detail}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <span>{task.assigneeName}</span>
        {task.type === 'review' && <span className="rounded bg-hover px-1 text-review">revisão</span>}
        {task.isFix && <span className="rounded bg-amber-soft px-1 text-amber">correção</span>}
        {task.handovers.length > 0 && <span className="rounded bg-amber-soft px-1 text-amber">era de {task.handovers[0]!.fromAgentName}</span>}
        {task.verdict && <span className={task.verdict === 'APROVADO' ? 'text-ok' : 'text-danger'}>{task.verdict}</span>}
        {task.attempts > 1 && <span>{task.attempts}ª tentativa</span>}
        {task.status === 'skipped' && <span>pulada</span>}
      </div>
    </button>
  );
}

function describeEvent({ data }: StoredMissionEvent): { icon: React.ReactNode; text: React.ReactNode } | null {
  switch (data.type) {
    case 'handoff':
      return { icon: <ArrowRight size={12} className="text-accent" />, text: <><b>{data.fromAgentName}</b> passou para <b>{data.toAgentName}</b>: {data.taskTitle}</> };
    case 'review':
      return {
        icon: data.verdict === 'APROVADO' ? <CheckCircle2 size={12} className="text-ok" /> : <XCircle size={12} className="text-danger" />,
        text: <><b>{data.reviewerName}</b> {data.verdict === 'APROVADO' ? 'aprovou' : 'reprovou'}: {data.taskTitle}</>,
      };
    case 'fix_requested':
      return { icon: <RefreshCw size={12} className="text-amber" />, text: <><b>{data.fromAgentName}</b> pediu correção a <b>{data.toAgentName}</b> (rodada {data.round})</> };
    case 'retry':
      return { icon: <RefreshCw size={12} className="text-amber" />, text: <>Nova tentativa ({data.attempt}ª) de {data.title}</> };
    case 'reassigned':
      return { icon: <UserRoundCog size={12} className="text-soft" />, text: <>{data.title}: de <b>{data.fromAgentName}</b> para <b>{data.toAgentName}</b> ({data.reason})</> };
    case 'task_status':
      if (data.status === 'running') return { icon: <Play size={12} className="text-accent" />, text: <><b>{data.agentName}</b> começou: {data.title}</> };
      if (data.status === 'done') return { icon: <CheckCircle2 size={12} className="text-ok" />, text: <><b>{data.agentName}</b> concluiu: {data.title}</> };
      if (data.status === 'failed') return { icon: <AlertTriangle size={12} className="text-danger" />, text: <><b>{data.agentName}</b> falhou em {data.title}{data.error ? `: ${data.error}` : ''}</> };
      return { icon: <ChevronRight size={12} />, text: <>{data.title}: {data.status}</> };
    case 'plan_ready':
      return { icon: <CheckCircle2 size={12} className="text-accent" />, text: <>Plano pronto, com {data.taskCount} tarefas</> };
    case 'note':
      return { icon: <ChevronRight size={12} />, text: <>Sua orientação: {data.text}</> };
    case 'conflict':
      return { icon: <AlertTriangle size={12} className="text-amber" />, text: <>Conflito em {data.files.join(', ')}. <b>{data.toAgentName}</b> vai resolver, sem sobrescrever ninguém.</> };
    case 'merged':
      return { icon: <GitMerge size={12} className="text-ok" />, text: <>Resultado integrado em {data.into} ({data.files} arquivos)</> };
    case 'dangerous_command':
      return { icon: <ShieldAlert size={12} className="text-danger" />, text: <><b>{data.agentName}</b> tentou {data.reason}: <code className="font-mono">{data.command.slice(0, 120)}</code> {data.blocked ? '(interrompido)' : '(registrado)'}</> };
    case 'task_skipped_by_condition':
      return { icon: <SkipForward size={12} className="text-muted" />, text: <>{data.title} foi pulada: {data.condition}</> };
    case 'mission_status':
      return data.status === 'paused' || data.status === 'failed' ? { icon: <AlertTriangle size={12} className="text-amber" />, text: data.reason } : null;
    default:
      return null;
  }
}

function Timeline({ events }: { events: StoredMissionEvent[] }) {
  const items = events.flatMap((event) => {
    const described = describeEvent(event);
    return described ? [{ event, ...described }] : [];
  }).reverse();
  if (!items.length) return <p className="px-3 py-4 text-xs text-muted">Os acontecimentos da missão aparecem aqui.</p>;
  return (
    <ol className="divide-y divide-line">
      {items.map(({ event, icon, text }) => (
        <li key={event.id} className="flex gap-2 px-3 py-1.5 text-xs">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span className="min-w-0 flex-1 text-soft [&_b]:font-semibold [&_b]:text-ink">{text}</span>
          <time className="shrink-0 text-[11px] text-muted">{formatTime(event.ts)}</time>
        </li>
      ))}
    </ol>
  );
}

/** O trabalho isolado só chega à pasta do usuário depois de revisado aqui. */
function MergeReview({ mission }: { mission: Mission }) {
  const run = useStore((state) => state.run);
  const [changes, setChanges] = useState<{ files: string[]; diff: string } | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    void run(() => api.get<{ files: string[]; diff: string }>(`/api/missions/${mission.id}/changes`)).then((value) => value && setChanges(value));
  }, [mission.id, run]);

  return (
    <section className="rise rounded-xl border border-accent/50 bg-accent-soft p-4">
      <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold"><GitMerge size={15} /> Revise antes de integrar</h2>
      <p className="mt-1 text-[13px] text-soft">
        Os agentes trabalharam em cópias isoladas. Sua pasta continua como estava, no ramo <code className="font-mono text-xs">{mission.baseBranch}</code>, até você decidir.
      </p>
      {changes && (
        <>
          <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-xs">{changes.files.map((file) => <li key={file}>{file}</li>)}</ul>
          <button type="button" onClick={() => setShowDiff(!showDiff)} className="mt-2 text-xs text-accent underline">{showDiff ? 'Esconder as alterações' : 'Ver as alterações'}</button>
          {showDiff && (
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-bg p-3 font-mono text-xs leading-relaxed">
              {changes.diff.split('\n').map((line, index) => (
                <div key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'text-ok' : line.startsWith('-') && !line.startsWith('---') ? 'text-danger' : line.startsWith('@@') ? 'text-think' : 'text-soft'}>{line || ' '}</div>
              ))}
            </pre>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button kind="primary" onClick={() => void run(() => api.post(`/api/missions/${mission.id}/merge`), 'Resultado integrado ao projeto.')}><GitMerge size={13} /> Integrar ao projeto</Button>
        <Button kind="danger" onClick={() => void run(() => api.post(`/api/missions/${mission.id}/discard`), 'Resultado descartado.')}><Trash2 size={13} /> Descartar</Button>
      </div>
    </section>
  );
}

function MissionPanel({ mission }: { mission: Mission }) {
  const tasks = useStore((state) => state.tasks[mission.id]) ?? [];
  const events = useStore((state) => state.missionEvents[mission.id]) ?? [];
  const loadMission = useStore((state) => state.loadMission);
  const run = useStore((state) => state.run);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const task = tasks.find((item) => item.id === openTask);
  const finished = tasks.filter((item) => ['done', 'skipped'].includes(item.status)).length;
  const isActive = ['planning', 'awaiting_approval', 'running', 'paused', 'reporting'].includes(mission.status);

  useEffect(() => {
    void loadMission(mission.id);
  }, [mission.id, loadMission]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={mission.status} />
              <span className="text-xs text-muted">{formatDateTime(mission.createdAt)}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[14px] font-medium leading-snug">{mission.goal}</p>
          </div>
          {isActive && (
            <div className="flex flex-wrap gap-2">
              {mission.status === 'running' && <Button onClick={() => void run(() => api.post(`/api/missions/${mission.id}/pause`), 'A missão para depois do que está rodando.')}><Pause size={13} /> Pausar</Button>}
              {mission.status === 'paused' && <Button kind="primary" onClick={() => void run(() => api.post(`/api/missions/${mission.id}/resume`))}><Play size={13} /> Retomar</Button>}
              <Button kind="danger" onClick={() => void run(() => api.post(`/api/missions/${mission.id}/cancel`), 'Missão cancelada.')}><XCircle size={13} /> Cancelar</Button>
            </div>
          )}
        </div>
        {tasks.length > 0 && mission.status !== 'awaiting_approval' && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1"><Meter value={finished / tasks.length} label="Progresso da missão" /></div>
            <span className="text-xs text-muted">{finished} de {tasks.length}</span>
          </div>
        )}
        {mission.pauseReason && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-soft px-3 py-2 text-[13px] text-amber">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />{mission.pauseReason}
          </p>
        )}
        {mission.status === 'planning' && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-muted"><span className="pulse h-1.5 w-1.5 rounded-full bg-accent" /> O coordenador está examinando o projeto e montando o plano.</p>
        )}
      </section>

      {mission.status === 'awaiting_approval' && tasks.length > 0 && <PlanEditor key={tasks.map((item) => item.id).join()} mission={mission} tasks={tasks} />}

      {mission.status !== 'awaiting_approval' && tasks.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const items = tasks.filter((item) => column.statuses.includes(item.status));
            return (
              <section key={column.id} className="min-h-24 rounded-xl border border-line bg-panel p-2" aria-label={column.title}>
                <h2 className="label mb-2 flex items-center justify-between px-1">{column.title}<span>{items.length}</span></h2>
                <div className="space-y-2">{items.map((item) => <TaskCard key={item.id} task={item} onOpen={() => setOpenTask(item.id)} />)}</div>
              </section>
            );
          })}
        </div>
      )}

      {mission.mergeStatus === 'pending' && <MergeReview mission={mission} />}
      {mission.mergeStatus === 'merged' && <p className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-ok"><GitMerge size={14} /> Resultado integrado ao ramo {mission.baseBranch}.</p>}
      {mission.mergeStatus === 'discarded' && <p className="rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-muted">O resultado isolado foi descartado. O projeto continuou como estava.</p>}

      {mission.report && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <h2 className="mb-2 font-display text-[15px] font-semibold">Relatório final</h2>
          <Markdown text={mission.report} />
        </section>
      )}

      {isActive && mission.status !== 'planning' && (
        <section className="flex gap-2 rounded-xl border border-line bg-panel p-3">
          <input
            className="field"
            aria-label="Orientação para a equipe"
            placeholder="Orientar a equipe durante a missão. Vale para as próximas tarefas."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && note.trim()) {
                void run(() => api.post(`/api/missions/${mission.id}/notes`, { text: note }), 'Orientação registrada.');
                setNote('');
              }
            }}
          />
          <Button disabled={!note.trim()} onClick={() => { void run(() => api.post(`/api/missions/${mission.id}/notes`, { text: note }), 'Orientação registrada.'); setNote(''); }}>Enviar</Button>
        </section>
      )}

      <section className="rounded-xl border border-line bg-panel">
        <h2 className="label border-b border-line px-3 py-2">Linha do tempo</h2>
        <div className="max-h-80 overflow-y-auto"><Timeline events={events} /></div>
      </section>

      {task && <TaskDetail task={task} onClose={() => setOpenTask(null)} />}
    </div>
  );
}

export function BoardView() {
  const missions = useStore((state) => state.missions);
  const agents = useStore((state) => state.agents);
  const projectId = useStore((state) => state.projectId);
  const setView = useStore((state) => state.setView);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => useStore.getState().boardMissionId);
  const active = activeMission(missions);
  const mission = missions.find((item) => item.id === selectedId) ?? active ?? missions[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Tarefas"
        subtitle="Planos, execução e revisão das missões deste projeto"
        actions={(
          <>
            {missions.length > 1 && (
              <select aria-label="Escolher missão" className="field !w-auto !max-w-64" value={mission?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
                {missions.map((item) => <option key={item.id} value={item.id}>{item.goal.slice(0, 48)}</option>)}
              </select>
            )}
            <Button kind="primary" disabled={Boolean(active) || !projectId || !agents.length} title={active ? 'Conclua ou cancele a missão atual' : undefined} onClick={() => setCreating(true)}>
              <Rocket size={14} /> Nova missão
            </Button>
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!projectId ? (
          <Empty title="Nenhum projeto aberto" action={<Button kind="primary" onClick={() => setView('projects')}>Abrir um projeto</Button>} />
        ) : !agents.length ? (
          <Empty title="Sua equipe ainda está vazia" action={<Button kind="primary" onClick={() => setView('agents')}>Criar agentes</Button>}>Uma missão precisa de ao menos um agente.</Empty>
        ) : mission ? (
          <MissionPanel key={mission.id} mission={mission} />
        ) : (
          <Empty title="Nenhuma missão ainda" icon={<Rocket size={28} />} action={<Button kind="primary" onClick={() => setCreating(true)}>Criar a primeira missão</Button>}>
            Descreva um objetivo. O coordenador divide o trabalho, cada agente faz sua parte e os outros revisam.
          </Empty>
        )}
      </div>
      {creating && <NewMission onClose={() => setCreating(false)} />}
    </div>
  );
}

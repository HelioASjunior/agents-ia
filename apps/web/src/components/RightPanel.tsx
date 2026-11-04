import { ChevronDown, ChevronRight, FileDiff, Gamepad2, Plus, SquareTerminal, TerminalSquare, Timer, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TerminalInfo } from '@xinoia/shared';
import { api } from '../api.ts';
import { useStore } from '../store.ts';
import { OfficeCanvas } from './office/OfficeCanvas.tsx';
import { PtyTerminal } from './PtyTerminal.tsx';
import { RunLog } from './RunLog.tsx';
import { ACTIVITY, Avatar, Empty, formatDuration, formatNumber, formatTime, IconButton, StatusPill } from './ui.tsx';

type Tab = 'log' | 'commands' | 'files' | 'activity' | 'shell';

const TABS: Array<{ id: Tab; label: string; icon: typeof TerminalSquare }> = [
  { id: 'log', label: 'Terminal', icon: TerminalSquare },
  { id: 'commands', label: 'Comandos', icon: Wrench },
  { id: 'files', label: 'Arquivos', icon: FileDiff },
  { id: 'activity', label: 'Agentes', icon: Timer },
  { id: 'shell', label: 'Shell', icon: SquareTerminal },
];

function CommandsTab() {
  const events = useStore((state) => state.events);
  const runs = useStore((state) => state.runs);
  const items = useMemo(() => {
    const ended = new Map<string, boolean>();
    for (const { runId, event } of events) {
      if (event.type === 'tool_end') ended.set(`${runId}:${event.toolId}`, event.ok);
    }
    return events
      .flatMap((stored) => (stored.event.type === 'tool_start' && stored.event.command
        ? [{ id: stored.id, ts: stored.ts, runId: stored.runId, command: stored.event.command, ok: ended.get(`${stored.runId}:${stored.event.toolId}`) }]
        : []))
      .reverse()
      .slice(0, 300);
  }, [events]);
  if (!items.length) return <Empty title="Nenhum comando ainda">Os comandos que os agentes executarem aparecem aqui.</Empty>;
  return (
    <ul className="h-full divide-y divide-line overflow-y-auto">
      {items.map((item) => (
        <li key={item.id} className="px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span>{runs[item.runId]?.agentName}</span>
            <span>{formatTime(item.ts)}</span>
            {item.ok === false && <span className="text-danger">falhou</span>}
            {item.ok === undefined && <span className="pulse text-accent">rodando</span>}
          </div>
          <code className="mt-0.5 block break-all font-mono text-xs text-soft">{item.command}</code>
        </li>
      ))}
    </ul>
  );
}

function FilesTab() {
  const runs = useStore((state) => state.runs);
  const files = useMemo(() => {
    const map = new Map<string, { path: string; agents: Set<string>; ts: number }>();
    for (const run of Object.values(runs)) {
      for (const file of run.filesChanged) {
        const entry = map.get(file) ?? { path: file, agents: new Set(), ts: 0 };
        entry.agents.add(run.agentName);
        entry.ts = Math.max(entry.ts, run.endedAt ?? run.startedAt ?? 0);
        map.set(file, entry);
      }
    }
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }, [runs]);
  if (!files.length) return <Empty title="Nenhum arquivo alterado">Os arquivos alterados pelos agentes aparecem aqui.</Empty>;
  return (
    <ul className="h-full divide-y divide-line overflow-y-auto">
      {files.map((file) => (
        <li key={file.path} className="px-3 py-2">
          <code className="block break-all font-mono text-xs text-ink">{file.path}</code>
          <span className="text-[11px] text-muted">{[...file.agents].join(', ')}</span>
        </li>
      ))}
    </ul>
  );
}

function ActivityTab() {
  const agents = useStore((state) => state.agents);
  const states = useStore((state) => state.agentStates);
  const runs = useStore((state) => state.runs);
  const selectAgent = useStore((state) => state.selectAgent);
  const setView = useStore((state) => state.setView);
  const setChannel = useStore((state) => state.setChannel);
  const stats = useMemo(() => {
    let running = 0;
    let done = 0;
    let failed = 0;
    let input = 0;
    let output = 0;
    let withData = 0;
    for (const run of Object.values(runs)) {
      if (run.status === 'running') running += 1;
      if (run.status === 'completed') done += 1;
      if (run.status === 'failed') failed += 1;
      if (run.usage) {
        input += run.usage.inputTokens;
        output += run.usage.outputTokens;
        withData += 1;
      }
    }
    return { running, done, failed, input, output, withData };
  }, [runs]);
  return (
    <div className="h-full overflow-y-auto">
      <dl className="grid grid-cols-3 gap-px border-b border-line bg-line text-center">
        {[['Rodando', stats.running], ['Concluídas', stats.done], ['Falharam', stats.failed]].map(([label, value]) => (
          <div key={label} className="bg-panel py-2">
            <dd className="font-display text-base font-semibold">{value}</dd>
            <dt className="text-[11px] text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      <p className="border-b border-line px-3 py-2 text-[11px] text-muted">
        {stats.withData
          ? `Tokens informados pelos CLIs em ${stats.withData} execuções: ${formatNumber(stats.input)} de entrada, ${formatNumber(stats.output)} de saída.`
          : 'Nenhum consumo informado pelos CLIs neste projeto ainda.'}
      </p>
      <ul className="divide-y divide-line">
        {agents.map((agent) => {
          const state = states[agent.id];
          const info = ACTIVITY[state?.activity ?? 'available'];
          return (
            <li key={agent.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover"
                onClick={() => {
                  selectAgent(agent.id);
                  setChannel(agent.id);
                  setView('chat');
                }}
              >
                <Avatar agent={agent} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{agent.name}</span>
                  <span className="block truncate text-[11px] text-muted">{state?.detail ?? info.label}</span>
                </span>
                <span className="text-[11px] font-medium" style={{ color: info.color }}>{info.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShellTab() {
  const projectId = useStore((state) => state.projectId);
  const run = useStore((state) => state.run);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const open = async () => {
    if (!projectId) return;
    const created = await run(() => api.post<TerminalInfo>('/api/terminals', { kind: 'shell', projectId }));
    if (created) {
      setTerminals((list) => [...list, created]);
      setCurrent(created.id);
    }
  };
  const close = (id: string) => {
    void run(() => api.delete(`/api/terminals/${id}`));
    setTerminals((list) => list.filter((item) => item.id !== id));
    setCurrent((value) => (value === id ? null : value));
  };

  if (!terminals.length) {
    return (
      <Empty
        title="Terminal do projeto"
        action={<button type="button" disabled={!projectId} onClick={() => void open()} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover disabled:opacity-40">Abrir terminal</button>}
      >
        Um terminal de verdade, aberto na pasta do projeto, para seus próprios comandos.
      </Empty>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        {terminals.map((item, index) => (
          <span key={item.id} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${current === item.id ? 'bg-hover text-ink' : 'text-muted'}`}>
            <button type="button" onClick={() => setCurrent(item.id)}>Terminal {index + 1}</button>
            <button type="button" aria-label="Encerrar terminal" onClick={() => close(item.id)}><X size={11} /></button>
          </span>
        ))}
        <IconButton label="Novo terminal" onClick={() => void open()}><Plus size={13} /></IconButton>
      </div>
      <div className="min-h-0 flex-1 bg-bg">
        {terminals.map((item) => (
          <div key={item.id} className={current === item.id ? 'h-full' : 'hidden'}>
            <PtyTerminal terminalId={item.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

const MINI_KEY = 'xinoia.miniOffice';

/** A telinha do escritório: acompanha o trabalho a partir de qualquer outra tela. */
function MiniOffice() {
  const setView = useStore((state) => state.setView);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(MINI_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(MINI_KEY, open ? 'closed' : 'open');
    } catch {
      // Preferência visual: sem armazenamento, só não é lembrada.
    }
  };
  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex items-center gap-1 px-1.5 py-1 text-xs text-muted">
        <button type="button" aria-expanded={open} onClick={toggle} className="flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:text-ink">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Gamepad2 size={13} /> Escritório ao vivo
        </button>
        <button type="button" onClick={() => setView('office')} className="rounded px-1.5 py-0.5 hover:text-ink">Abrir</button>
      </div>
      {open && (
        <button type="button" aria-label="Abrir o escritório em tela cheia" onClick={() => setView('office')} className="relative block h-[clamp(150px,22vh,240px)] w-full overflow-hidden">
          <OfficeCanvas compact />
        </button>
      )}
    </div>
  );
}

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('log');
  const view = useStore((state) => state.view);
  const runs = useStore((state) => state.runs);
  const running = Object.values(runs).filter((run) => run.status === 'running');
  return (
    <section className="flex h-full min-h-0 flex-col bg-panel" aria-label="Painel de acompanhamento">
      {view !== 'office' && <MiniOffice />}
      <nav className="flex items-center gap-0.5 border-b border-line px-1.5 py-1" aria-label="Abas do painel">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id}
            title={label}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${tab === id ? 'bg-hover text-ink' : 'text-muted hover:text-ink'}`}
          >
            <Icon size={13} />
            <span className="hidden min-[1500px]:inline">{label}</span>
          </button>
        ))}
        <div className="ml-auto flex min-w-0 items-center gap-1.5 pr-1">
          {running.length > 0 && (
            <>
              <span className="pulse h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="truncate text-[11px] text-muted">
                {running.length === 1
                  ? `${running[0]?.agentName} há ${formatDuration(Date.now() - (running[0]?.startedAt ?? Date.now()))}`
                  : `${running.length} em execução`}
              </span>
            </>
          )}
        </div>
      </nav>
      {/* O terminal fica montado para não perder a posição nem o que já foi desenhado. */}
      <div className={`min-h-0 flex-1 ${tab === 'log' ? '' : 'hidden'}`}><RunLog /></div>
      <div className={`min-h-0 flex-1 ${tab === 'shell' ? '' : 'hidden'}`}><ShellTab /></div>
      {tab === 'commands' && <div className="min-h-0 flex-1"><CommandsTab /></div>}
      {tab === 'files' && <div className="min-h-0 flex-1"><FilesTab /></div>}
      {tab === 'activity' && <div className="min-h-0 flex-1"><ActivityTab /></div>}
    </section>
  );
}

export { StatusPill };

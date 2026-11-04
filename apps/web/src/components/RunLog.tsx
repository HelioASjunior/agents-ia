import { ArrowDown, ArrowUp, Eraser, Search, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, StoredRunEvent } from '@xinoia/shared';
import { api } from '../api.ts';
import { activeMission, useStore } from '../store.ts';
import { agentPrefix, formatEvent, runFooter, runHeader } from './terminal-format.ts';
import { IconButton } from './ui.tsx';
import { Xterm, type XtermHandle } from './Xterm.tsx';

const NEUTRAL = '#7f8b9a';

/**
 * Terminal unificado da equipe e de cada agente. Tudo aqui vem dos eventos reais das
 * execuções, os mesmos que ficam salvos e voltam depois de reiniciar.
 */
export function RunLog() {
  const term = useRef<XtermHandle>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showNoise, setShowNoise] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const lastWritten = useRef(0);
  const printedHeaders = useRef(new Set<string>());
  const printedFooters = useRef(new Set<string>());
  const atLineStart = useRef(true);
  const lastRun = useRef<string | null>(null);

  const agents = useStore((state) => state.agents);
  const missions = useStore((state) => state.missions);
  const tasks = useStore((state) => state.tasks);
  const runs = useStore((state) => state.runs);
  const projects = useStore((state) => state.projects);
  const projectId = useStore((state) => state.projectId);
  const events = useStore((state) => state.events);

  const mission = activeMission(missions) ?? missions[0];
  const missionTasks = mission ? tasks[mission.id] ?? [] : [];
  const projectPath = projects.find((project) => project.id === projectId)?.path ?? '';
  const agentById = useMemo(() => new Map<string, Agent>(agents.map((agent) => [agent.id, agent])), [agents]);

  const prefixFor = useCallback((runId: string) => {
    const run = runs[runId];
    const agent = run?.agentId ? agentById.get(run.agentId) : undefined;
    return agentPrefix(run?.agentName ?? '?', agent?.color ?? NEUTRAL);
  }, [agentById, runs]);

  const matches = useCallback((runId: string) => {
    const run = runs[runId];
    if (!run) return false;
    if (agentFilter && run.agentId !== agentFilter) return false;
    if (taskFilter && run.taskId !== taskFilter) return false;
    return true;
  }, [agentFilter, runs, taskFilter]);

  const writeLines = useCallback((runId: string, lines: string[]) => {
    const handle = term.current;
    if (!handle) return;
    if (!atLineStart.current) {
      handle.write('\r\n');
      atLineStart.current = true;
    }
    for (const line of lines) handle.write(`${prefixFor(runId)}${line}\r\n`);
    lastRun.current = runId;
  }, [prefixFor]);

  const writeEvent = useCallback((stored: StoredRunEvent) => {
    const handle = term.current;
    if (!handle) return;
    const { runId, event } = stored;
    const run = runs[runId];
    if (run && !printedHeaders.current.has(runId)) {
      printedHeaders.current.add(runId);
      writeLines(runId, runHeader(run, projectPath));
    }
    if (event.type === 'text') {
      // O texto chega em pedaços: o prefixo só entra em começo de linha.
      if (lastRun.current !== runId && !atLineStart.current) {
        handle.write('\r\n');
        atLineStart.current = true;
      }
      lastRun.current = runId;
      const parts = event.text.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) {
          handle.write('\r\n');
          atLineStart.current = true;
        }
        if (part) {
          if (atLineStart.current) handle.write(prefixFor(runId));
          handle.write(part);
          atLineStart.current = false;
        }
      });
      return;
    }
    const lines = formatEvent(event, showNoise);
    if (lines.length) writeLines(runId, lines);
  }, [prefixFor, projectPath, runs, showNoise, writeLines]);

  const writeFooter = useCallback((runId: string) => {
    const run = runs[runId];
    if (!run || printedFooters.current.has(runId)) return;
    const footer = runFooter(run);
    if (footer.length) {
      printedFooters.current.add(runId);
      writeLines(runId, footer);
    }
  }, [runs, writeLines]);

  // Refaz tudo quando muda o filtro, e o projeto.
  const redraw = useCallback(() => {
    const handle = term.current;
    if (!handle) return;
    handle.clear();
    printedHeaders.current.clear();
    printedFooters.current.clear();
    atLineStart.current = true;
    lastRun.current = null;
    const current = useStore.getState().events;
    let previous: string | null = null;
    for (const stored of current) {
      if (stored.ts < clearedAt || !matches(stored.runId)) continue;
      if (previous && previous !== stored.runId) writeFooter(previous);
      writeEvent(stored);
      previous = stored.runId;
    }
    if (previous) writeFooter(previous);
    lastWritten.current = current.at(-1)?.id ?? 0;
  }, [clearedAt, matches, writeEvent, writeFooter]);

  useEffect(() => {
    redraw();
    // Refazer só quando muda o que é mostrado, não a cada evento novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, taskFilter, showNoise, clearedAt, projectId]);

  // Escreve o que chegou de novo.
  useEffect(() => {
    for (const stored of events) {
      if (stored.id <= lastWritten.current) continue;
      if (matches(stored.runId)) writeEvent(stored);
      lastWritten.current = stored.id;
    }
  }, [events, matches, writeEvent]);

  // Execução que terminou ganha o rodapé na hora.
  useEffect(() => {
    for (const run of Object.values(runs)) {
      if (printedHeaders.current.has(run.id) && matches(run.id)) writeFooter(run.id);
    }
  }, [matches, runs, writeFooter]);

  const runningRuns = Object.values(runs).filter((run) =>
    run.status === 'running' && (!agentFilter || run.agentId === agentFilter));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        <select aria-label="Filtrar por agente" className="field !w-auto !py-1 !text-xs" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
          <option value="">Toda a equipe</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <select aria-label="Filtrar por tarefa" className="field !w-auto !max-w-40 !py-1 !text-xs" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}>
          <option value="">Todas as tarefas</option>
          {missionTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select>
        <div className="relative min-w-24 flex-1">
          <Search size={12} className="pointer-events-none absolute top-2 left-2 text-muted" />
          <input
            aria-label="Buscar no terminal"
            className="field !py-1 !pl-6 !text-xs"
            placeholder="Buscar"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query) term.current?.find(query, event.shiftKey);
            }}
          />
        </div>
        <IconButton label="Resultado anterior" disabled={!query} onClick={() => term.current?.find(query, true)}><ArrowUp size={13} /></IconButton>
        <IconButton label="Próximo resultado" disabled={!query} onClick={() => term.current?.find(query)}><ArrowDown size={13} /></IconButton>
        <label className="flex items-center gap-1 text-[11px] text-muted" title="Mostra também as mensagens internas dos CLIs">
          <input type="checkbox" checked={showNoise} onChange={(event) => setShowNoise(event.target.checked)} />
          detalhes
        </label>
        <IconButton label="Limpar a tela (o histórico continua salvo)" onClick={() => setClearedAt(Date.now())}><Eraser size={13} /></IconButton>
        <IconButton
          label={runningRuns.length ? `Interromper ${runningRuns.length === 1 ? runningRuns[0]?.agentName : 'tudo que está rodando'}` : 'Nada em execução'}
          disabled={!runningRuns.length}
          className="hover:!text-danger"
          onClick={() => {
            for (const run of runningRuns) {
              void useStore.getState().run(() => api.post(`/api/runs/${run.id}/cancel`));
            }
          }}
        >
          <Square size={12} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 bg-bg">
        <Xterm ref={term} readOnly />
      </div>
    </div>
  );
}

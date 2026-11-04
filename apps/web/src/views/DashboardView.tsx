import { useEffect, useState } from 'react';
import type { Metrics, TimelineItem } from '@xinoia/shared';
import { api } from '../api.ts';
import { ACTIVITY, Avatar, Empty, formatBytes, formatDateTime, formatDuration, formatNumber, Meter, PageHeader, StatusPill } from '../components/ui.tsx';
import { useStore } from '../store.ts';

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5">
      <p className="label">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold leading-none tabular-nums">{value}</p>
      {note && <p className="mt-1.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function DashboardView() {
  const projectId = useStore((state) => state.projectId);
  const agents = useStore((state) => state.agents);
  const states = useStore((state) => state.agentStates);
  const providers = useStore((state) => state.providers);
  const profiles = useStore((state) => state.profiles);
  const lastEventId = useStore((state) => state.lastEventId);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const query = projectId ? `?projectId=${projectId}` : '';
      const [data, items] = await Promise.all([
        api.get<Metrics>(`/api/metrics${query}`),
        api.get<TimelineItem[]>(`/api/timeline${query}`),
      ]).catch(() => [null, []] as const);
      if (live && data) {
        setMetrics(data);
        setTimeline([...items]);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [projectId, lastEventId]);

  if (!metrics) return <Empty title="Carregando…" />;
  const finished = metrics.runs.completed + metrics.runs.failed;
  const memoryUsed = 1 - metrics.system.memoryFree / metrics.system.memoryTotal;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Painel" subtitle="Números reais deste projeto e deste computador" />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Agentes ativos" value={`${metrics.agents.active} / ${metrics.agents.total}`} />
          <Stat label="Em execução" value={metrics.runs.running} note={metrics.runs.queued ? `${metrics.runs.queued} na fila` : 'Fila vazia'} />
          <Stat label="Execuções concluídas" value={metrics.runs.completed} note={finished ? `${Math.round((metrics.runs.completed / finished) * 100)}% de sucesso` : 'Sem dados ainda'} />
          <Stat label="Execuções com falha" value={metrics.runs.failed} />
          <Stat label="Tarefas" value={`${metrics.tasks.done} / ${metrics.tasks.total}`} note={`${metrics.tasks.running} rodando, ${metrics.tasks.failed} com falha`} />
          <Stat label="Missões" value={metrics.missions.total} note={`${metrics.missions.active} ativas, ${metrics.missions.completed} concluídas`} />
          <Stat label="Tempo médio" value={metrics.averageRunMs === null ? '—' : formatDuration(metrics.averageRunMs)} note="Por execução" />
          <Stat
            label="Tokens informados"
            value={metrics.tokens.runsWithData ? formatNumber(metrics.tokens.input + metrics.tokens.output) : '—'}
            note={metrics.tokens.runsWithData ? `Em ${metrics.tokens.runsWithData} execuções` : 'Só o que as ferramentas informam'}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <section className="rounded-xl border border-line bg-panel xl:col-span-2">
            <h2 className="label border-b border-line px-4 py-2.5">Atividade recente</h2>
            {timeline.length ? (
              <ol className="max-h-96 divide-y divide-line overflow-y-auto">
                {timeline.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <time className="w-24 shrink-0 text-xs text-muted">{formatDateTime(item.ts)}</time>
                    <span className="w-20 shrink-0 truncate font-medium">{item.title}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{item.detail?.split('\n').at(-1)}</span>
                    <StatusPill status={item.status} />
                  </li>
                ))}
              </ol>
            ) : <p className="px-4 py-6 text-[13px] text-muted">Nenhuma atividade ainda.</p>}
          </section>

          <div className="space-y-4">
            <section className="rounded-xl border border-line bg-panel">
              <h2 className="label border-b border-line px-4 py-2.5">Agentes agora</h2>
              <ul className="divide-y divide-line">
                {agents.map((agent) => {
                  const state = states[agent.id];
                  const info = ACTIVITY[state?.activity ?? 'available'];
                  return (
                    <li key={agent.id} className="flex items-center gap-2.5 px-4 py-2">
                      <Avatar agent={agent} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{agent.name}</span>
                        {state?.detail && <span className="block truncate font-mono text-[11px] text-muted">{state.detail}</span>}
                      </span>
                      <span className="text-[11px]" style={{ color: info.color }}>{info.label}</span>
                    </li>
                  );
                })}
                {!agents.length && <li className="px-4 py-3 text-[13px] text-muted">Nenhum agente.</li>}
              </ul>
            </section>

            <section className="rounded-xl border border-line bg-panel">
              <h2 className="label border-b border-line px-4 py-2.5">Ferramentas</h2>
              <ul className="divide-y divide-line text-[13px]">
                {providers.map((provider) => {
                  const connected = profiles.filter((profile) => profile.provider === provider.id && profile.auth?.loggedIn).length;
                  return (
                    <li key={provider.id} className="flex items-center gap-2 px-4 py-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${provider.installed ? 'bg-ok' : 'bg-line-strong'}`} />
                      <span className="flex-1 truncate">{provider.label}</span>
                      <span className="text-xs text-muted">{provider.installed ? `${connected} ${connected === 1 ? 'conta' : 'contas'}` : 'não instalado'}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
              <h2 className="label">Este computador</h2>
              <div>
                <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Processador ({metrics.system.cpuCount} núcleos)</span><span>{metrics.system.cpuUsage === null ? '—' : `${Math.round(metrics.system.cpuUsage * 100)}%`}</span></div>
                <Meter usage value={metrics.system.cpuUsage ?? 0} label="Uso do processador" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Memória</span><span>{formatBytes(metrics.system.memoryTotal - metrics.system.memoryFree)} de {formatBytes(metrics.system.memoryTotal)}</span></div>
                <Meter usage value={memoryUsed} label="Uso de memória" />
              </div>
              <p className="text-xs text-muted">XinoIA usando {formatBytes(metrics.system.processMemory)} · no ar há {formatDuration(metrics.system.uptimeSeconds * 1000)}</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

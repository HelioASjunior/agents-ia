import { History as HistoryIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Run } from '@xinoia/shared';
import { Markdown } from '../components/Markdown.tsx';
import { Dialog, Empty, formatDateTime, formatDuration, formatNumber, PageHeader, StatusPill } from '../components/ui.tsx';
import { useStore } from '../store.ts';

function RunDetail({ run, onClose }: { run: Run; onClose: () => void }) {
  return (
    <Dialog title={`Execução de ${run.agentName}`} onClose={onClose} width={720}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        <div><dt className="label">Estado</dt><dd className="mt-0.5"><StatusPill status={run.status} /></dd></div>
        <div><dt className="label">Ferramenta</dt><dd>{run.provider}</dd></div>
        <div><dt className="label">Modelo</dt><dd>{run.model ?? '—'}</dd></div>
        <div><dt className="label">Duração</dt><dd>{run.startedAt && run.endedAt ? formatDuration(run.endedAt - run.startedAt) : '—'}</dd></div>
      </dl>
      <h3 className="label mt-4 mb-1">Comando</h3>
      <code className="block break-all rounded-md bg-bg p-2 font-mono text-xs">{run.command ?? '—'}</code>
      <h3 className="label mt-4 mb-1">Pedido</h3>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-bg p-2 text-xs text-soft">{run.prompt}</p>
      {run.errorText && (
        <>
          <h3 className="label mt-4 mb-1">Erro</h3>
          <p className="whitespace-pre-wrap rounded-md bg-danger-soft p-2 text-xs text-danger">{run.errorText}</p>
        </>
      )}
      {run.filesChanged.length > 0 && (
        <>
          <h3 className="label mt-4 mb-1">Arquivos alterados</h3>
          <ul className="font-mono text-xs">{run.filesChanged.map((file) => <li key={file}>{file}</li>)}</ul>
        </>
      )}
      {run.finalText && (
        <>
          <h3 className="label mt-4 mb-1">Resposta</h3>
          <div className="max-h-96 overflow-y-auto rounded-md border border-line p-3"><Markdown text={run.finalText} /></div>
        </>
      )}
      {run.logPath && <p className="mt-4 break-all text-[11px] text-muted">Saída bruta: {run.logPath}</p>}
    </Dialog>
  );
}

export function HistoryView() {
  const runs = useStore((state) => state.runs);
  const agents = useStore((state) => state.agents);
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<Run | null>(null);
  const list = useMemo(() => Object.values(runs)
    .filter((run) => (!agentId || run.agentId === agentId) && (!status || run.status === status))
    .sort((a, b) => b.queuedAt - a.queuedAt), [agentId, runs, status]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Histórico"
        subtitle="Todas as execuções deste projeto, preservadas entre reinícios"
        actions={(
          <>
            <select aria-label="Filtrar por agente" className="field !w-auto" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value="">Todos os agentes</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select aria-label="Filtrar por estado" className="field !w-auto" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos os estados</option>
              <option value="running">Em execução</option>
              <option value="completed">Concluídas</option>
              <option value="failed">Falharam</option>
              <option value="cancelled">Canceladas</option>
              <option value="interrupted">Interrompidas</option>
            </select>
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {list.length ? (
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="label border-b border-line">
                <th scope="col" className="px-5 py-2 font-normal">Quando</th>
                <th scope="col" className="px-3 py-2 font-normal">Agente</th>
                <th scope="col" className="px-3 py-2 font-normal">Estado</th>
                <th scope="col" className="px-3 py-2 font-normal">Duração</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Tokens informados</th>
                <th scope="col" className="px-3 py-2 font-normal">Pedido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((run) => (
                <tr key={run.id} className="cursor-pointer hover:bg-hover" onClick={() => setOpen(run)}>
                  <td className="whitespace-nowrap px-5 py-2 text-muted">{formatDateTime(run.queuedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(run)}>{run.agentName}</button>
                  </td>
                  <td className="px-3 py-2"><StatusPill status={run.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{run.startedAt && run.endedAt ? formatDuration(run.endedAt - run.startedAt) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{run.usage ? formatNumber(run.usage.inputTokens + run.usage.outputTokens) : '—'}</td>
                  <td className="max-w-md truncate px-3 py-2 text-soft">{run.prompt.split('\n').at(-1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="Nada por aqui ainda" icon={<HistoryIcon size={26} />}>Cada execução de agente fica registrada, com comando, resposta e arquivos alterados.</Empty>
        )}
      </div>
      {open && <RunDetail run={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

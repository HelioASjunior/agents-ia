import { Database, Download, ExternalLink, Info, Moon, Palette, RefreshCw, RotateCcw, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ExecutionMode } from '@xinoia/shared';
import { EXECUTION_MODES } from '@xinoia/shared';
import { api } from '../api.ts';
import { Button, Field, formatBytes, Meter, PageHeader } from '../components/ui.tsx';
import { useStore } from '../store.ts';

interface SystemInfo {
  product: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  dataDir: string;
  schemaVersion: number;
  recoveredFrom: string | null;
  interruptedOnStart: number;
  activeRuns: number;
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 font-display text-[15px] font-semibold">{icon}{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

function UpdatesSection() {
  const bridge = window.xinoia?.updates;
  const toast = useStore((state) => state.toast);
  const [state, setState] = useState<UpdateState | null>(null);
  const [auto, setAuto] = useState(true);
  const [channel, setChannel] = useState<'latest' | 'beta'>('latest');
  const [activeRuns, setActiveRuns] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const ready = state?.status === 'ready';

  // Com a atualização pronta, a decisão depende de quem está trabalhando agora.
  useEffect(() => {
    if (!ready) return undefined;
    const read = () => void api.get<SystemInfo>('/api/system').then((info) => setActiveRuns(info.activeRuns)).catch(() => undefined);
    read();
    const timer = setInterval(read, 5000);
    return () => clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    if (!bridge) return undefined;
    void bridge.getState().then((initial) => {
      setState(initial);
      setAuto(initial.autoCheck);
      setChannel(initial.channel);
    });
    return bridge.onChange(setState);
  }, [bridge]);

  if (!bridge) {
    return <p className="text-[13px] text-muted">As atualizações automáticas funcionam no aplicativo instalado. Rodando pelo código-fonte, atualize com <code className="font-mono">git pull</code>.</p>;
  }
  if (!state) return <p className="text-[13px] text-muted">Carregando…</p>;

  return (
    <div className="space-y-3 text-[13px]">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><dt className="label">Versão instalada</dt><dd>{state.currentVersion}</dd></div>
        {state.available && <div><dt className="label">Disponível</dt><dd className="font-medium text-accent">{state.available.version}</dd></div>}
        {state.lastCheckedAt && <div><dt className="label">Última verificação</dt><dd>{new Date(state.lastCheckedAt).toLocaleString('pt-BR')}</dd></div>}
      </dl>

      {state.status === 'error' && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{state.error}</p>}
      {state.status === 'none' && <p className="text-ok">Você já está na versão mais recente.</p>}
      {state.status === 'checking' && <p className="text-muted">Verificando…</p>}

      {state.status === 'downloading' && state.progress && (
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted">Baixando {formatBytes(state.progress.transferred)} de {formatBytes(state.progress.total)}</span>
            <span>{Math.round(state.progress.percent)}%</span>
          </div>
          <Meter value={state.progress.percent / 100} label="Progresso do download" />
        </div>
      )}

      {state.available?.notes && (
        <div>
          <h3 className="label mb-1">Novidades</h3>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-bg p-2.5 text-xs text-soft">{state.available.notes}</div>
        </div>
      )}

      {state.status === 'ready' && activeRuns > 0 && (
        <p className="rounded-md bg-amber-soft px-3 py-2 text-amber">
          {activeRuns === 1 ? 'Há trabalho em andamento.' : `Há ${activeRuns} trabalhos em andamento.`} {waiting ? 'A atualização será instalada quando terminar.' : 'Escolha instalar quando terminar, ou interrompa agora: a tarefa em andamento recomeça do início ao retomar.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button disabled={state.status === 'checking' || state.status === 'downloading'} onClick={() => void bridge.check()}><RefreshCw size={13} /> Verificar atualizações</Button>
        {state.status === 'available' && <Button kind="primary" onClick={() => void bridge.download()}><Download size={13} /> Atualizar agora</Button>}
        {state.status === 'available' && <Button kind="ghost" onClick={() => { void bridge.dismiss(); toast('info', 'Lembraremos mais tarde.'); }}>Lembrar depois</Button>}
        {state.status === 'ready' && activeRuns === 0 && (
          <Button kind="primary" onClick={() => void bridge.install(false)}><RotateCcw size={13} /> Reiniciar e instalar</Button>
        )}
        {state.status === 'ready' && activeRuns > 0 && (
          <>
            <Button kind="primary" disabled={waiting} onClick={() => { setWaiting(true); void bridge.install(false); }}><RotateCcw size={13} /> Instalar quando terminar</Button>
            <Button kind="danger" onClick={() => void bridge.install(true)}>Interromper e reiniciar</Button>
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={auto} onChange={(event) => { setAuto(event.target.checked); void bridge.setAutoCheck(event.target.checked); }} />
          Verificar automaticamente
        </label>
        <div className="max-w-xs">
          <Field label="Canal" hint="Beta recebe novidades antes, com mais chance de problemas.">
            <select className="field" value={channel} onChange={(event) => { const next = event.target.value as 'latest' | 'beta'; setChannel(next); void bridge.setChannel(next); }}>
              <option value="latest">Estável</option>
              <option value="beta">Beta</option>
            </select>
          </Field>
        </div>
      </div>
    </div>
  );
}

export function SettingsView() {
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const run = useStore((state) => state.run);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [mode, setMode] = useState<ExecutionMode>('semi');
  const [limits, setLimits] = useState({ stallMinutes: 30, maxRunMinutes: 180 });

  useEffect(() => {
    void run(() => api.get<SystemInfo>('/api/system')).then((info) => info && setSystem(info));
    void run(() => api.get<{ executionMode: ExecutionMode; stallMinutes: number; maxRunMinutes: number }>('/api/settings')).then((settings) => {
      if (settings) {
        setMode(settings.executionMode);
        setLimits({ stallMinutes: settings.stallMinutes, maxRunMinutes: settings.maxRunMinutes });
      }
    });
  }, [run]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Configurações" />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <Section title="Aparência" icon={<Palette size={15} />}>
            <div className="flex gap-2">
              <Button kind={theme === 'dark' ? 'primary' : 'outline'} onClick={() => setTheme('dark')}><Moon size={13} /> Escuro</Button>
              <Button kind={theme === 'light' ? 'primary' : 'outline'} onClick={() => setTheme('light')}><Sun size={13} /> Claro</Button>
            </div>
          </Section>

          <Section title="Modo de execução" icon={<ShieldCheck size={15} />}>
            <div className="space-y-2">
              {EXECUTION_MODES.map((item) => (
                <label key={item.id} className={`block cursor-pointer rounded-lg border p-3 transition-colors ${mode === item.id ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover'}`}>
                  <input
                    type="radio"
                    className="sr-only"
                    name="execution-mode"
                    checked={mode === item.id}
                    onChange={() => {
                      setMode(item.id);
                      void run(() => api.patch('/api/settings', { executionMode: item.id }), 'Modo de execução salvo.');
                    }}
                  />
                  <span className="block text-[13px] font-medium">{item.label}</span>
                  <span className="block text-xs text-muted">{item.description}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Agente travado depois de (minutos sem saída)">
                <input type="number" min={1} max={240} className="field" value={limits.stallMinutes} onChange={(event) => setLimits({ ...limits, stallMinutes: Number(event.target.value) || 1 })} onBlur={() => void run(() => api.patch('/api/settings', limits))} />
              </Field>
              <Field label="Tempo máximo de uma execução (minutos)">
                <input type="number" min={1} max={1440} className="field" value={limits.maxRunMinutes} onChange={(event) => setLimits({ ...limits, maxRunMinutes: Number(event.target.value) || 1 })} onBlur={() => void run(() => api.patch('/api/settings', limits))} />
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted">
              Em execução automática, as ferramentas não conseguem parar no meio para perguntar. Por isso, a proteção vem da aprovação antes de cada tarefa, do limite de permissão, das regras de negação e da interrupção ao detectar um comando destrutivo. Essa detecção é uma rede de proteção, não uma garantia: em projetos importantes, use Git.
            </p>
          </Section>

          <Section title="Sobre o XinoIA" icon={<Info size={15} />}>
            <div className="flex items-center gap-3">
              <img src="./logo.svg" alt="" className="h-12 w-12" />
              <div>
                <p className="font-display text-lg font-bold leading-tight">Xino<span className="text-accent">IA</span></p>
                <p className="text-xs text-muted">Sua equipe de agentes de IA, no seu computador.</p>
              </div>
            </div>
            <a className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent underline" href="https://github.com/HelioASjunior/agents-ia" target="_blank" rel="noreferrer noopener">
              Projeto no GitHub <ExternalLink size={12} />
            </a>
          </Section>

          <Section title="Atualizações" icon={<Download size={15} />}>
            <UpdatesSection />
          </Section>

          <Section title="Dados" icon={<Database size={15} />}>
            {system && (
              <dl className="space-y-2 text-[13px]">
                <div><dt className="label">Pasta de dados</dt><dd className="break-all font-mono text-xs">{system.dataDir}</dd></div>
                <div className="flex flex-wrap gap-6">
                  <div><dt className="label">Versão do banco</dt><dd>v{system.schemaVersion}</dd></div>
                  <div><dt className="label">Plataforma</dt><dd>{system.platform} {system.arch}</dd></div>
                  <div><dt className="label">Node</dt><dd>{system.nodeVersion}</dd></div>
                </div>
                {system.recoveredFrom && <p className="rounded-md bg-amber-soft px-3 py-2 text-amber">O banco estava danificado e foi restaurado de uma cópia de segurança.</p>}
              </dl>
            )}
            <Button className="mt-3" onClick={async () => {
              const result = await run(() => api.post<{ file: string }>('/api/system/backup'));
              if (result) useStore.getState().toast('ok', `Cópia criada em ${result.file}`);
            }}
            >
              <Database size={13} /> Criar cópia de segurança agora
            </Button>
            <p className="mt-2 text-xs text-muted">O XinoIA também faz uma cópia por dia e antes de cada atualização do banco. Seus dados ficam só neste computador.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

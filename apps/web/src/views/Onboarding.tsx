import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Copy, ExternalLink, LogIn, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Agent, Profile, Project, ProviderInfo, Run } from '@xinoia/shared';
import { api } from '../api.ts';
import { Button, Field, IconButton } from '../components/ui.tsx';
import { useStore } from '../store.ts';
import { PtyTerminal } from '../components/PtyTerminal.tsx';

const DONE_KEY = 'xinoia.onboarded';

export function shouldShowOnboarding(state: { projects: Project[]; agents: Agent[] }): boolean {
  try {
    if (localStorage.getItem(DONE_KEY)) return false;
  } catch {
    // Sem armazenamento, decide só pelo que já existe.
  }
  return !state.projects.length || !state.agents.length;
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // Só significa que o assistente pode aparecer de novo.
  }
}

const STEPS = ['Boas-vindas', 'Ferramentas', 'Contas', 'Projeto', 'Equipe', 'Teste'];

function Welcome() {
  return (
    <div className="text-center">
      <img src="./logo.svg" alt="" className="mx-auto h-24 w-24" />
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight">Bem-vindo ao Xino<span className="text-accent">IA</span></h2>
      <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-soft">
        Monte uma equipe de agentes de IA que trabalha junta nos seus projetos, neste computador. Cada agente tem uma função, e você acompanha tudo em um escritório virtual e em um terminal ao vivo.
      </p>
      <ul className="mx-auto mt-6 grid max-w-xl gap-3 text-left text-[13px] sm:grid-cols-3">
        <li className="rounded-lg border border-line bg-raised p-3"><b className="block font-semibold">Suas contas</b><span className="text-muted">Usa o login que você faz em cada ferramenta. Sem chaves de API.</span></li>
        <li className="rounded-lg border border-line bg-raised p-3"><b className="block font-semibold">Seu computador</b><span className="text-muted">Projetos, conversas e histórico ficam aqui. Sem cadastro.</span></li>
        <li className="rounded-lg border border-line bg-raised p-3"><b className="block font-semibold">Trabalho real</b><span className="text-muted">Agentes executam de verdade, e um revisa o que o outro fez.</span></li>
      </ul>
    </div>
  );
}

function ToolsStep() {
  const providers = useStore((state) => state.providers);
  const toast = useStore((state) => state.toast);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [checking, setChecking] = useState(false);
  const visible = providers.filter((provider) => provider.support !== 'custom');

  const refresh = async () => {
    setChecking(true);
    await run(() => api.post('/api/providers/refresh'));
    await loadCatalog();
    setChecking(false);
  };

  const Row = ({ provider }: { provider: ProviderInfo }) => (
    <li className="rounded-lg border border-line bg-raised p-3">
      <div className="flex items-center gap-2">
        {provider.installed ? <CheckCircle2 size={16} className="text-ok" /> : <CircleAlert size={16} className="text-amber" />}
        <span className="flex-1 text-[13px] font-semibold">{provider.label}</span>
        <span className="text-xs text-muted">{provider.installed ? provider.version : 'não instalado'}</span>
      </div>
      {!provider.installed && provider.installCommand && (
        <div className="mt-2">
          <div className="flex items-center gap-2 rounded-md bg-bg px-2.5 py-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{provider.installCommand}</code>
            <IconButton label="Copiar comando" onClick={() => { void navigator.clipboard.writeText(provider.installCommand!); toast('ok', 'Comando copiado.'); }}><Copy size={13} /></IconButton>
          </div>
          {provider.installUrl && <a className="mt-1 inline-flex items-center gap-1 text-xs text-accent underline" href={provider.installUrl} target="_blank" rel="noreferrer noopener">Instruções oficiais <ExternalLink size={11} /></a>}
        </div>
      )}
      {provider.note && <p className="mt-1.5 text-xs text-muted">{provider.note}</p>}
    </li>
  );

  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Ferramentas de IA neste computador</h2>
      <p className="mt-1 text-[13px] text-muted">O XinoIA não inclui essas ferramentas: ele conduz as que você instalar. Você precisa de ao menos uma. As que usam Node.js pedem o <a className="text-accent underline" href="https://nodejs.org" target="_blank" rel="noreferrer noopener">Node.js instalado</a>.</p>
      <ul className="mt-4 space-y-2">{visible.map((provider) => <Row key={provider.id} provider={provider} />)}</ul>
      <Button className="mt-3" disabled={checking} onClick={() => void refresh()}><RefreshCw size={13} className={checking ? 'animate-spin' : ''} /> Verificar de novo</Button>
    </div>
  );
}

function AccountsStep() {
  const allProviders = useStore((state) => state.providers);
  const providers = allProviders.filter((provider) => provider.installed && provider.support !== 'custom');
  const profiles = useStore((state) => state.profiles);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [terminal, setTerminal] = useState<string | null>(null);

  // Cadastra o login do computador de cada ferramenta instalada: quase sempre é o que se quer.
  useEffect(() => {
    void (async () => {
      for (const provider of providers) {
        if (!profiles.some((profile) => profile.provider === provider.id && !profile.homeDir)) {
          const created = await run(() => api.post<Profile>('/api/profiles', { provider: provider.id, label: 'Principal', useSystemDefault: true }));
          if (created) await run(() => api.post(`/api/profiles/${created.id}/check`));
        }
      }
      await loadCatalog();
    })();
    // Roda uma vez ao abrir este passo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (profile: Profile) => {
    const created = await run(() => api.post<{ id: string }>('/api/terminals', { kind: 'login', profileId: profile.id }));
    if (created) setTerminal(created.id);
  };

  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Conecte suas contas</h2>
      <p className="mt-1 text-[13px] text-muted">O login é o oficial de cada ferramenta e abre no navegador. Sua senha e seus tokens nunca passam pelo XinoIA.</p>
      <ul className="mt-4 space-y-2">
        {providers.flatMap((provider) => profiles.filter((profile) => profile.provider === provider.id).map((profile) => (
          <li key={profile.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-raised p-3 text-[13px]">
            {profile.auth?.loggedIn ? <CheckCircle2 size={16} className="text-ok" /> : <CircleAlert size={16} className="text-amber" />}
            <span className="flex-1 font-semibold">{provider.label}</span>
            {profile.auth?.loggedIn
              ? <span className="text-xs text-muted">{profile.auth.subscription === false ? 'Chave de API: gera cobrança por uso' : profile.auth.plan ? `Conectado, plano ${profile.auth.plan}` : 'Conectado'}</span>
              : <Button size="sm" kind="primary" onClick={() => void login(profile)}><LogIn size={13} /> Fazer login</Button>}
            <IconButton label="Verificar de novo" onClick={() => void run(() => api.post(`/api/profiles/${profile.id}/check`))}><RefreshCw size={13} /></IconButton>
          </li>
        )))}
        {!providers.length && <li className="rounded-lg border border-line bg-raised p-3 text-[13px] text-muted">Nenhuma ferramenta instalada ainda. Volte ao passo anterior.</li>}
      </ul>
      {terminal && (
        <div className="mt-3 h-56 overflow-hidden rounded-lg border border-line bg-bg">
          <PtyTerminal terminalId={terminal} onExit={() => { void run(() => api.post('/api/profiles/check')); }} />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Assinatura não é acesso ilimitado: os limites do seu plano continuam valendo.</p>
    </div>
  );
}

function ProjectStep() {
  const projects = useStore((state) => state.projects);
  const projectId = useStore((state) => state.projectId);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const setProject = useStore((state) => state.setProject);
  const [path, setPath] = useState('');
  const [create, setCreate] = useState(true);
  const current = projects.find((project) => project.id === projectId);

  const add = async () => {
    const created = await run(() => api.post<Project>('/api/projects', { path, create }));
    if (created) {
      await loadCatalog();
      await setProject(created.id);
      setPath('');
    }
  };

  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Escolha um projeto</h2>
      <p className="mt-1 text-[13px] text-muted">Os agentes trabalham nos arquivos desta pasta. Para testar, comece com uma pasta vazia. Em projetos reais, use Git para poder desfazer qualquer alteração.</p>
      {current && <p className="mt-3 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok"><Check size={14} /> {current.name}: <code className="truncate font-mono text-xs">{current.path}</code></p>}
      <div className="mt-4">
        <Field label="Caminho da pasta">
          <div className="flex gap-2">
            <input className="field" placeholder="D:\projetos\meu-app" value={path} onChange={(event) => setPath(event.target.value)} />
            {window.xinoia?.pickFolder && <Button onClick={async () => { const chosen = await window.xinoia?.pickFolder?.(); if (chosen) setPath(chosen); }}>Escolher</Button>}
          </div>
        </Field>
        <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={create} onChange={(event) => setCreate(event.target.checked)} /> Criar a pasta se não existir</label>
        <Button className="mt-3" kind="primary" disabled={!path.trim()} onClick={() => void add()}>Usar esta pasta</Button>
      </div>
    </div>
  );
}

const STARTER = [
  { name: 'Ana', role: 'coordinator', color: '#2DD4BF', permission: 'read', title: 'Coordena e planeja' },
  { name: 'Bruno', role: 'developer', color: '#F5B544', permission: 'edit', title: 'Implementa' },
  { name: 'Carla', role: 'reviewer', color: '#BDA6FF', permission: 'read', title: 'Revisa o trabalho' },
] as const;

function TeamStep() {
  const agents = useStore((state) => state.agents);
  const profiles = useStore((state) => state.profiles);
  const providers = useStore((state) => state.providers);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const connected = profiles.filter((profile) => profile.auth?.loggedIn);
  // Se houver mais de uma ferramenta, quem revisa usa outra: dois olhares são mais úteis.
  const devProfile = connected.find((profile) => profile.provider === 'codex') ?? connected[0];
  const leadProfile = connected.find((profile) => profile.provider === 'claude') ?? connected[0];

  const create = async () => {
    for (const member of STARTER) {
      const profile = member.role === 'developer' ? devProfile : leadProfile;
      if (!profile) continue;
      await run(() => api.post('/api/agents', { name: member.name, role: member.role, color: member.color, permission: member.permission, provider: profile.provider, profileId: profile.id }));
    }
    await loadCatalog();
  };

  const label = (provider: string | undefined) => providers.find((item) => item.id === provider)?.label ?? provider;

  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Monte a equipe</h2>
      {agents.length > 0 ? (
        <>
          <p className="mt-1 text-[13px] text-muted">Sua equipe está pronta. Você pode ajustar cada agente depois, em Agentes.</p>
          <ul className="mt-4 space-y-2">
            {agents.map((agent) => <li key={agent.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised p-3 text-[13px]"><CheckCircle2 size={16} className="text-ok" /><b className="font-semibold">{agent.name}</b><span className="text-muted">{label(agent.provider)}</span></li>)}
          </ul>
        </>
      ) : !connected.length ? (
        <p className="mt-3 rounded-lg bg-amber-soft px-3 py-2 text-[13px] text-amber">Conecte ao menos uma conta no passo anterior para criar a equipe.</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-muted">Sugestão para começar. Quem planeja e revisa só lê os arquivos, e quem implementa pode editar.</p>
          <ul className="mt-4 space-y-2">
            {STARTER.map((member) => (
              <li key={member.name} className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3 text-[13px]">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg font-display font-bold text-[#06121a]" style={{ background: member.color }}>{member.name[0]}</span>
                <span className="flex-1"><b className="block font-semibold">{member.name}</b><span className="text-xs text-muted">{member.title}</span></span>
                <span className="text-xs text-muted">{label(member.role === 'developer' ? devProfile?.provider : leadProfile?.provider)}</span>
              </li>
            ))}
          </ul>
          <Button className="mt-3" kind="primary" onClick={() => void create()}>Criar esta equipe</Button>
        </>
      )}
    </div>
  );
}

function TestStep() {
  const agents = useStore((state) => state.agents);
  const projectId = useStore((state) => state.projectId);
  const run = useStore((state) => state.run);
  const liveRuns = useStore((state) => state.runs);
  const runText = useStore((state) => state.runText);
  const [runId, setRunId] = useState<string | null>(null);
  const current: Run | undefined = runId ? liveRuns[runId] : undefined;
  const agent = agents[0];

  const test = async () => {
    if (!agent || !projectId) return;
    const created = await run(() => api.post<Run>('/api/runs', {
      agentId: agent.id,
      projectId,
      prompt: 'Teste de integração do XinoIA. Responda em uma frase curta, se apresentando. Não altere nenhum arquivo.',
      permission: 'read',
    }));
    if (created) {
      useStore.setState((state) => ({ runs: { ...state.runs, [created.id]: created } }));
      setRunId(created.id);
    }
  };

  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Teste de verdade</h2>
      <p className="mt-1 text-[13px] text-muted">Vamos pedir uma resposta curta a um agente, para confirmar que tudo funciona. Isso usa uma pequena parte do limite da sua conta. Nenhum arquivo é alterado.</p>
      {!agent || !projectId ? (
        <p className="mt-3 rounded-lg bg-amber-soft px-3 py-2 text-[13px] text-amber">Falta {!projectId ? 'escolher um projeto' : 'criar a equipe'}. Você pode voltar, ou testar mais tarde pelo chat.</p>
      ) : (
        <Button className="mt-3" kind="primary" disabled={current?.status === 'running' || current?.status === 'queued'} onClick={() => void test()}><Sparkles size={13} /> Testar {agent.name}</Button>
      )}
      {current && (
        <div className="mt-3 rounded-lg border border-line bg-raised p-3 text-[13px]">
          {(current.status === 'queued' || current.status === 'running') && <p className="flex items-center gap-2 text-muted"><span className="pulse h-1.5 w-1.5 rounded-full bg-accent" /> {agent?.name} está respondendo…</p>}
          {runText[current.id] && <p className="mt-1 whitespace-pre-wrap">{runText[current.id]}</p>}
          {current.status === 'completed' && <p className="mt-2 flex items-center gap-1.5 font-medium text-ok"><CheckCircle2 size={14} /> Funcionou. Sua equipe está pronta.</p>}
          {current.status === 'failed' && <p className="mt-1 text-danger">{current.errorText}</p>}
        </div>
      )}
    </div>
  );
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const setView = useStore((state) => state.setView);
  const finish = () => {
    markDone();
    onClose();
    setView('office');
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/95 p-4" role="dialog" aria-modal="true" aria-label="Configuração inicial do XinoIA">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel" style={{ boxShadow: 'var(--shadow)' }}>
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          <ol className="flex flex-1 flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {STEPS.map((name, index) => (
              <li key={name} className={`flex items-center gap-1 ${index === step ? 'font-semibold text-accent' : index < step ? 'text-soft' : ''}`}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${index === step ? 'bg-accent text-accent-ink' : index < step ? 'bg-ok-soft text-ok' : 'bg-hover'}`}>{index < step ? <Check size={10} /> : index + 1}</span>
                <span className="max-sm:hidden">{name}</span>
              </li>
            ))}
          </ol>
          <IconButton label="Pular a configuração" onClick={() => { markDone(); onClose(); }}><X size={15} /></IconButton>
        </header>
        <div className="min-h-[360px] flex-1 overflow-y-auto px-6 py-6">
          {step === 0 && <Welcome />}
          {step === 1 && <ToolsStep />}
          {step === 2 && <AccountsStep />}
          {step === 3 && <ProjectStep />}
          {step === 4 && <TeamStep />}
          {step === 5 && <TestStep />}
        </div>
        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <Button kind="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={13} /> Voltar</Button>
          {step < STEPS.length - 1
            ? <Button kind="primary" onClick={() => setStep(step + 1)}>{step === 0 ? 'Começar' : 'Continuar'} <ArrowRight size={13} /></Button>
            : <Button kind="primary" onClick={finish}>Abrir o escritório <ArrowRight size={13} /></Button>}
        </footer>
      </div>
    </div>
  );
}

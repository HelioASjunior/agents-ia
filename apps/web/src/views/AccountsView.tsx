import { AlertTriangle, CheckCircle2, CircleSlash, Copy, ExternalLink, Gamepad2, KeyRound, LogIn, LogOut, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CustomProvider, DiscoveredToolkit, Profile, ProviderInfo, TerminalInfo, Toolkit } from '@xinoia/shared';
import { api } from '../api.ts';
import { PtyTerminal } from '../components/PtyTerminal.tsx';
import { Button, Dialog, Field, formatDateTime, formatNumber, IconButton, Meter, PageHeader } from '../components/ui.tsx';
import { useStore } from '../store.ts';

const WINDOW_NAMES: Record<string, string> = { five_hour: 'Janela de 5 horas', seven_day: 'Janela de 7 dias' };

function LoginDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const run = useStore((state) => state.run);
  const [terminal, setTerminal] = useState<TerminalInfo | null>(null);
  const [external, setExternal] = useState<{ opened: boolean; command: string } | null>(null);

  useEffect(() => {
    let live = true;
    void run(() => api.post<TerminalInfo>('/api/terminals', { kind: 'login', profileId: profile.id })).then((created) => {
      if (live && created) setTerminal(created);
      else if (created) void api.delete(`/api/terminals/${created.id}`).catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [profile.id, run]);

  const finish = async () => {
    if (terminal) await api.delete(`/api/terminals/${terminal.id}`).catch(() => undefined);
    await run(() => api.post(`/api/profiles/${profile.id}/check`));
    onClose();
  };

  return (
    <Dialog
      title={`Login: ${profile.label}`}
      onClose={() => void finish()}
      width={760}
      footer={(
        <>
          <Button
            kind="ghost"
            onClick={async () => {
              const result = await run(() => api.post<{ opened: boolean; command: string }>(`/api/profiles/${profile.id}/login`));
              if (result) setExternal(result);
            }}
          >
            <ExternalLink size={13} /> Abrir em janela separada
          </Button>
          <Button kind="primary" onClick={() => void finish()}>Terminei</Button>
        </>
      )}
    >
      <p className="mb-2 text-[13px] text-soft">
        Este é o login oficial da própria ferramenta. O navegador pode abrir para você entrar. Sua senha e seus tokens nunca passam pelo XinoIA.
      </p>
      <p className="mb-3 text-xs text-muted">Se o navegador já estiver em outra conta, troque de conta nele antes de confirmar.</p>
      {external && !external.opened && <p className="mb-2 rounded bg-hover px-2 py-1 font-mono text-xs">{external.command}</p>}
      <div className="h-72 overflow-hidden rounded-lg border border-line bg-bg">
        {terminal ? <PtyTerminal terminalId={terminal.id} /> : <p className="p-3 text-xs text-muted">Abrindo…</p>}
      </div>
    </Dialog>
  );
}

function AddProfile({ provider, onClose }: { provider: ProviderInfo; onClose: () => void }) {
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const profiles = useStore((state) => state.profiles);
  const hasDefault = profiles.some((profile) => profile.provider === provider.id && !profile.homeDir);
  const [label, setLabel] = useState('');
  const [useDefault, setUseDefault] = useState(!hasDefault);

  return (
    <Dialog
      title={`Adicionar conta de ${provider.label}`}
      onClose={onClose}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            kind="primary"
            disabled={!label.trim()}
            onClick={async () => {
              const created = await run(() => api.post<Profile>('/api/profiles', { provider: provider.id, label, useSystemDefault: useDefault }));
              if (created) {
                await run(() => api.post(`/api/profiles/${created.id}/check`));
                await loadCatalog();
                onClose();
              }
            }}
          >
            Adicionar
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="Nome da conta" hint="Só para você reconhecer, como Pessoal ou Trabalho.">
          <input autoFocus className="field" value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <fieldset className="space-y-1.5 text-[13px]">
          <label className={`block rounded-lg border p-2.5 ${useDefault ? 'border-accent bg-accent-soft' : 'border-line-strong'} ${hasDefault ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="radio" className="sr-only" name="kind" disabled={hasDefault} checked={useDefault} onChange={() => setUseDefault(true)} />
            <span className="block font-medium">Usar o login já feito neste computador</span>
            <span className="block text-xs text-muted">{hasDefault ? 'Já cadastrado.' : 'O mesmo usado quando você roda a ferramenta no terminal.'}</span>
          </label>
          <label className={`block rounded-lg border p-2.5 ${!useDefault ? 'border-accent bg-accent-soft' : 'border-line-strong'} ${provider.isolatesProfiles ? 'cursor-pointer' : 'opacity-50'}`}>
            <input type="radio" className="sr-only" name="kind" disabled={!provider.isolatesProfiles} checked={!useDefault} onChange={() => setUseDefault(false)} />
            <span className="block font-medium">Criar um perfil separado</span>
            <span className="block text-xs text-muted">Pasta própria, com login próprio, para outra conta sua.</span>
          </label>
        </fieldset>
      </div>
    </Dialog>
  );
}

function ProfileRow({ profile }: { profile: Profile }) {
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const provider = useStore((state) => state.providers.find((item) => item.id === profile.provider));
  const [loggingIn, setLoggingIn] = useState(false);
  const [removing, setRemoving] = useState(false);
  const auth = profile.auth;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
            {profile.label}
            <span className="rounded bg-hover px-1.5 text-[11px] font-normal text-muted">{profile.homeDir ? 'perfil separado' : 'login do computador'}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            {!auth ? (
              <span className="text-muted">Ainda não verificado</span>
            ) : !auth.loggedIn ? (
              <span className="flex items-center gap-1 text-amber"><CircleSlash size={12} /> {auth.error ?? 'Sem login'}</span>
            ) : auth.subscription === false ? (
              <span className="flex items-center gap-1 text-amber"><AlertTriangle size={12} /> Login por chave de API. Usar isto gera cobrança por API, não pela assinatura.</span>
            ) : (
              <span className="flex items-center gap-1 text-ok"><CheckCircle2 size={12} /> {auth.subscription ? 'Assinatura conectada' : 'Conectado'}</span>
            )}
            {auth?.plan && <span className="text-muted">Plano {auth.plan}</span>}
            {auth?.email && <span className="text-muted">{auth.email}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {provider?.canLogin && (
            <Button size="sm" kind={auth?.loggedIn ? 'ghost' : 'primary'} onClick={() => setLoggingIn(true)}><LogIn size={13} /> Login</Button>
          )}
          <IconButton label="Verificar agora" onClick={() => void run(() => api.post(`/api/profiles/${profile.id}/check`))}><RefreshCw size={13} /></IconButton>
          {provider?.canLogin && auth?.loggedIn && profile.homeDir && (
            <IconButton label="Sair desta conta" onClick={() => void run(() => api.post(`/api/profiles/${profile.id}/logout`), 'Conta desconectada.')}><LogOut size={13} /></IconButton>
          )}
          <IconButton label="Remover" onClick={() => setRemoving(true)}><Trash2 size={13} /></IconButton>
        </div>
      </div>

      {profile.usage?.windows && Object.keys(profile.usage.windows).length > 0 && (
        <div className="mt-2.5 grid max-w-lg gap-2 sm:grid-cols-2">
          {Object.entries(profile.usage.windows).map(([name, window]) => (
            <div key={name}>
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>{WINDOW_NAMES[name] ?? name}</span>
                <span>{window.utilization === null ? '—' : `${Math.round(window.utilization * 100)}%`}</span>
              </div>
              <Meter usage value={window.utilization ?? 0} label={WINDOW_NAMES[name] ?? name} />
              {window.resetsAt && <p className="mt-0.5 text-[11px] text-muted">Renova {formatDateTime(window.resetsAt * 1000)}</p>}
            </div>
          ))}
        </div>
      )}
      {profile.totals.runs > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          {formatNumber(profile.totals.runs)} execuções pelo XinoIA
          {profile.totals.outputTokens > 0 && ` · ${formatNumber(profile.totals.inputTokens)} tokens de entrada e ${formatNumber(profile.totals.outputTokens)} de saída informados pela ferramenta`}
        </p>
      )}

      {loggingIn && <LoginDialog profile={profile} onClose={() => setLoggingIn(false)} />}
      {removing && (
        <Dialog
          title={`Remover ${profile.label}?`}
          onClose={() => setRemoving(false)}
          footer={(
            <>
              <Button kind="ghost" onClick={() => setRemoving(false)}>Manter</Button>
              <Button
                kind="danger"
                onClick={async () => {
                  await run(() => api.delete(`/api/profiles/${profile.id}`), 'Conta removida.');
                  await loadCatalog();
                  setRemoving(false);
                }}
              >
                Remover
              </Button>
            </>
          )}
        >
          <p className="text-[13px] text-soft">
            {profile.homeDir
              ? 'A pasta deste perfil será apagada, junto com o login guardado nela.'
              : 'Sai só do XinoIA. O login do computador continua funcionando no terminal.'}
          </p>
        </Dialog>
      )}
    </li>
  );
}

function ProviderSection({ provider }: { provider: ProviderInfo }) {
  const allProfiles = useStore((state) => state.profiles);
  const profiles = allProfiles.filter((profile) => profile.provider === provider.id);
  const toast = useStore((state) => state.toast);
  const [adding, setAdding] = useState(false);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-display text-[15px] font-semibold">
            {provider.label}
            {provider.installed
              ? <span className="rounded bg-ok-soft px-1.5 text-[11px] font-normal text-ok">{provider.version}</span>
              : <span className="rounded bg-amber-soft px-1.5 text-[11px] font-normal text-amber">não instalado</span>}
            {provider.support === 'documented' && <span className="rounded bg-hover px-1.5 text-[11px] font-normal text-muted">ainda não testado</span>}
          </h2>
          {provider.note && <p className="mt-0.5 text-xs text-muted">{provider.note}</p>}
        </div>
        {provider.installed && <Button size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Adicionar conta</Button>}
      </header>
      {!provider.installed && provider.installCommand && (
        <div className="px-4 py-3 text-[13px]">
          <p className="text-soft">Instale em um terminal, depois atualize esta tela:</p>
          <div className="mt-1.5 flex items-center gap-2 rounded-md bg-bg px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{provider.installCommand}</code>
            <IconButton
              label="Copiar comando"
              onClick={() => {
                void navigator.clipboard.writeText(provider.installCommand!);
                toast('ok', 'Comando copiado.');
              }}
            >
              <Copy size={13} />
            </IconButton>
          </div>
          {provider.installUrl && <a className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent underline" href={provider.installUrl} target="_blank" rel="noreferrer noopener">Documentação oficial <ExternalLink size={11} /></a>}
        </div>
      )}
      {provider.installed && !profiles.length && <p className="px-4 py-3 text-[13px] text-muted">Nenhuma conta cadastrada.</p>}
      {profiles.length > 0 && <ul className="divide-y divide-line">{profiles.map((profile) => <ProfileRow key={profile.id} profile={profile} />)}</ul>}
      {adding && <AddProfile provider={provider} onClose={() => setAdding(false)} />}
    </section>
  );
}

function ToolkitRow({ kit }: { kit: Toolkit }) {
  const health = useStore((state) => state.health[kit.id]);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [url, setUrl] = useState(kit.mcp?.type === 'http' ? kit.mcp.url : '');
  const httpUrl = kit.mcp?.type === 'http' ? kit.mcp.url : null;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium">{kit.name}</p>
        {health === true && <span className="rounded bg-ok-soft px-1.5 text-[11px] text-ok">Respondendo</span>}
        {health === false && <span className="rounded bg-amber-soft px-1.5 text-[11px] text-amber">Sem resposta</span>}
        {kit.exclusive && <span className="rounded bg-hover px-1.5 text-[11px] text-muted" title="Agentes que usam esta integração entram em fila">um agente por vez</span>}
        <IconButton label={`Remover ${kit.name}`} onClick={async () => { await run(() => api.delete(`/api/toolkits/${kit.id}`), 'Integração removida.'); await loadCatalog(); }}><Trash2 size={13} /></IconButton>
      </div>
      {kit.description && <p className="mt-0.5 text-xs text-muted">{kit.description}</p>}
      {kit.skills.length > 0 && <p className="mt-1 text-xs text-muted">Skills: {kit.skills.map((skill) => skill.name).join(', ')}</p>}
      {kit.preset === 'unreal' && !kit.pluginPath && (
        <p className="mt-1 text-xs text-amber">O plugin de skills não foi encontrado. As ferramentas do editor funcionam; para as skills, instale o plugin oficial no Claude Code.</p>
      )}
      {kit.preset === 'unreal' && health === false && (
        <p className="mt-1 text-xs text-muted">Abra o Unreal Editor com os plugins ModelContextProtocol e AllToolsets, e rode <code className="font-mono">ModelContextProtocol.StartServer</code> no console.</p>
      )}
      {httpUrl && (
        <div className="mt-2 flex max-w-lg gap-2">
          <input aria-label={`Endereço de ${kit.name}`} className="field !py-1 !text-xs" value={url} onChange={(event) => setUrl(event.target.value)} />
          <Button size="sm" disabled={url === httpUrl} onClick={async () => { await run(() => api.patch(`/api/toolkits/${kit.id}`, { url }), 'Endereço salvo.'); await loadCatalog(); }}>Salvar</Button>
        </div>
      )}
    </li>
  );
}

function ToolkitsSection() {
  const toolkits = useStore((state) => state.toolkits);
  const projectId = useStore((state) => state.projectId);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [found, setFound] = useState<DiscoveredToolkit[] | null>(null);
  const hasUnreal = toolkits.some((kit) => kit.preset === 'unreal');

  const discover = async () => {
    const list = await run(() => api.get<DiscoveredToolkit[]>(`/api/toolkits/discover${projectId ? `?projectId=${projectId}` : ''}`));
    setFound(list ?? []);
  };
  useEffect(() => {
    void discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, toolkits.length]);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold"><Plug size={15} /> Integrações</h2>
          <p className="text-xs text-muted">Skills, plugins e servidores MCP. Depois de adicionar, ligue em cada agente.</p>
        </div>
        {!hasUnreal && (
          <Button size="sm" onClick={async () => { await run(() => api.post('/api/toolkits/unreal'), 'Integração adicionada.'); await loadCatalog(); }}>
            <Gamepad2 size={13} /> Adicionar Unreal Engine
          </Button>
        )}
      </header>
      {toolkits.length > 0 && <ul className="divide-y divide-line">{toolkits.map((kit) => <ToolkitRow key={kit.id} kit={kit} />)}</ul>}
      {found && found.filter((item) => !item.added).length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="label mb-2">Encontrado neste computador</p>
          <ul className="space-y-1.5">
            {found.filter((item) => !item.added).map((item) => (
              <li key={item.key} className="flex items-center gap-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{item.name}</span>
                  <span className="ml-2 text-[11px] text-muted">{item.kind === 'plugin' ? 'plugin' : 'MCP'}{item.skills.length ? ` · ${item.skills.length} skills` : ''}</span>
                </span>
                {item.secret ? (
                  <span className="text-[11px] text-muted" title="A configuração tem segredos, que o XinoIA não copia. Continua disponível para o login do computador.">usa segredos</span>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await run(() => api.post('/api/toolkits/import', { key: item.key, projectId }), 'Integração adicionada.');
                      await loadCatalog();
                    }}
                  >
                    Adicionar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CustomProviders() {
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [list, setList] = useState<CustomProvider[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', command: '', args: '', homeEnv: '', loginCommand: '' });
  const reload = async () => setList((await run(() => api.get<CustomProvider[]>('/api/custom-providers'))) ?? []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold">Outras ferramentas</h2>
          <p className="text-xs text-muted">Qualquer agente de linha de comando que leia o pedido pela entrada padrão.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={13} /> Adicionar</Button>
      </header>
      {list.length > 0 && (
        <ul className="divide-y divide-line">
          {list.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate"><b className="font-medium">{item.name}</b> <code className="ml-2 font-mono text-xs text-muted">{item.command} {item.args}</code></span>
              <IconButton label={`Remover ${item.name}`} onClick={async () => { await run(() => api.delete(`/api/custom-providers/${item.id}`)); await reload(); await loadCatalog(); }}><Trash2 size={13} /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Dialog
          title="Adicionar ferramenta"
          onClose={() => setOpen(false)}
          footer={(
            <Button
              kind="primary"
              disabled={!form.name.trim() || !form.command.trim()}
              onClick={async () => {
                const created = await run(() => api.post('/api/custom-providers', form), 'Ferramenta adicionada.');
                if (created) {
                  await reload();
                  await loadCatalog();
                  setOpen(false);
                }
              }}
            >
              Adicionar
            </Button>
          )}
        >
          <div className="space-y-3">
            <Field label="Nome"><input autoFocus className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Comando"><input className="field" placeholder="meu-agente" value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} /></Field>
            <Field label="Argumentos"><input className="field" placeholder="--modo texto" value={form.args} onChange={(event) => setForm({ ...form, args: event.target.value })} /></Field>
            <Field label="Variável da pasta de dados" hint="Se a ferramenta tiver, permite perfis separados."><input className="field" value={form.homeEnv} onChange={(event) => setForm({ ...form, homeEnv: event.target.value })} /></Field>
            <Field label="Comando de login"><input className="field" value={form.loginCommand} onChange={(event) => setForm({ ...form, loginCommand: event.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function AccountsView() {
  const providers = useStore((state) => state.providers);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Contas e ferramentas"
        subtitle="Cada ferramenta usa o login oficial dela. Sua senha nunca passa pelo XinoIA."
        actions={(
          <Button
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await run(async () => {
                await api.post('/api/providers/refresh');
                await api.post('/api/profiles/check');
              });
              await loadCatalog();
              setRefreshing(false);
            }}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Verificar tudo
          </Button>
        )}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <p className="flex max-w-3xl items-start gap-2 text-xs text-muted">
          <KeyRound size={13} className="mt-0.5 shrink-0" />
          Assinatura não é acesso ilimitado: os limites do seu plano continuam valendo. O XinoIA mostra o uso apenas quando a ferramenta informa, e nunca troca de conta sozinho para contornar um limite.
        </p>
        {providers.filter((provider) => provider.support !== 'custom').map((provider) => <ProviderSection key={provider.id} provider={provider} />)}
        {providers.filter((provider) => provider.support === 'custom').map((provider) => <ProviderSection key={provider.id} provider={provider} />)}
        <ToolkitsSection />
        <CustomProviders />
      </div>
    </div>
  );
}

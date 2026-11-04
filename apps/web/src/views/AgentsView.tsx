import { AlertTriangle, MessageSquare, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import type { Agent, PermissionLevel, RoleId } from '@xinoia/shared';
import { ROLES } from '@xinoia/shared';
import { api } from '../api.ts';
import { ACTIVITY, Avatar, Button, Dialog, Empty, Field, IconButton, PageHeader, useActivity } from '../components/ui.tsx';
import { useStore } from '../store.ts';

const COLORS = ['#2DD4BF', '#F5B544', '#7FB2FF', '#FF8FA3', '#BDA6FF', '#5EE08F', '#FF9E64', '#67E8F9', '#E5E7EB'];

export const PERMISSIONS: Array<{ id: PermissionLevel; label: string; text: string }> = [
  { id: 'read', label: 'Somente leitura', text: 'Lê o projeto. Não altera arquivos nem roda comandos, e não usa ferramentas MCP.' },
  { id: 'edit', label: 'Editar', text: 'Altera arquivos do projeto. No Codex, roda comandos dentro da área protegida. No Claude, comandos de terminal continuam bloqueados.' },
  { id: 'full', label: 'Total', text: 'Roda qualquer comando sem pedir confirmação, com o acesso da sua conta no computador. Use só em projetos versionados com Git.' },
];

interface Draft {
  name: string;
  role: RoleId;
  roleTitle: string;
  instructions: string;
  provider: string;
  profileId: string;
  model: string;
  effort: string;
  permission: PermissionLevel;
  color: string;
  toolkitIds: string[];
}

const OTHER_MODEL = '__outro';

/** O modelo que a execução mais recente do agente neste projeto usou, de acordo com a ferramenta. */
function useLastModel(agentId: string | undefined): string | null {
  return useStore((state) => {
    let latest: { model: string; queuedAt: number } | null = null;
    for (const run of Object.values(state.runs)) {
      if (run.agentId === agentId && run.model && (!latest || run.queuedAt > latest.queuedAt)) latest = { model: run.model, queuedAt: run.queuedAt };
    }
    return latest?.model ?? null;
  });
}

function AgentForm({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const providers = useStore((state) => state.providers);
  const profiles = useStore((state) => state.profiles);
  const toolkits = useStore((state) => state.toolkits);
  const agents = useStore((state) => state.agents);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const setView = useStore((state) => state.setView);
  const firstProvider = providers.find((provider) => provider.installed)?.id ?? providers[0]?.id ?? 'claude';
  const [draft, setDraft] = useState<Draft>(() => ({
    name: agent?.name ?? '',
    role: agent?.role ?? 'developer',
    roleTitle: agent?.roleTitle ?? '',
    instructions: agent?.instructions ?? '',
    provider: agent?.provider ?? firstProvider,
    profileId: agent?.profileId ?? profiles.find((profile) => profile.provider === firstProvider)?.id ?? '',
    model: agent?.model ?? '',
    effort: agent?.effort ?? '',
    permission: agent?.permission ?? 'edit',
    color: agent?.color ?? COLORS[agents.length % COLORS.length]!,
    toolkitIds: agent?.toolkitIds ?? [],
  }));
  const provider = providers.find((item) => item.id === draft.provider);
  const options = profiles.filter((profile) => profile.provider === draft.provider);
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const permission = PERMISSIONS.find((item) => item.id === draft.permission);
  const modelOptions = provider?.modelOptions ?? [];
  const chosenModel = modelOptions.find((item) => item.id === draft.model);
  // Um nome fora da lista continua valendo: o catálogo pode estar atrasado, ou faltar.
  const [typingModel, setTypingModel] = useState(() => Boolean(agent?.model) && !chosenModel);
  const efforts = chosenModel?.efforts.length ? chosenModel.efforts : provider?.efforts ?? [];
  const lastModel = useLastModel(agent?.id);
  const modelHint = typingModel
    ? 'Será usado exatamente este nome. Se a ferramenta não o reconhecer, a execução falha e mostra o motivo.'
    : `Vazio usa o padrão da ferramenta.${lastModel ? ` Na última execução, este agente usou ${lastModel}.` : ''}`;

  const submit = async () => {
    const body = { ...draft, profileId: draft.profileId || null };
    const saved = await run(() => (agent ? api.patch(`/api/agents/${agent.id}`, body) : api.post('/api/agents', body)), agent ? 'Agente atualizado.' : 'Agente criado.');
    if (saved) {
      await loadCatalog();
      onClose();
    }
  };

  return (
    <Dialog
      title={agent ? `Editar ${agent.name}` : 'Novo agente'}
      onClose={onClose}
      width={600}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>Cancelar</Button>
          <Button kind="primary" disabled={!draft.name.trim()} onClick={() => void submit()}>{agent ? 'Salvar' : 'Criar agente'}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <input autoFocus className="field" maxLength={40} value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="Ana" />
          </Field>
          <Field label="Função">
            <select className="field" value={draft.role} onChange={(event) => set({ role: event.target.value as RoleId })}>
              {Object.entries(ROLES).map(([id, role]) => <option key={id} value={id}>{role.label}</option>)}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-soft">Cor</legend>
          <div className="flex gap-1.5">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Cor ${color}`}
                aria-pressed={draft.color === color}
                onClick={() => set({ color })}
                className={`h-6 w-6 rounded-md transition-transform ${draft.color === color ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-panel' : ''}`}
                style={{ background: color }}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ferramenta de IA">
            <select
              className="field"
              value={draft.provider}
              onChange={(event) => {
                setTypingModel(false);
                set({
                  provider: event.target.value,
                  profileId: profiles.find((profile) => profile.provider === event.target.value)?.id ?? '',
                  model: '',
                  effort: '',
                });
              }}
            >
              {providers.map((item) => <option key={item.id} value={item.id}>{item.label}{item.installed ? '' : ' (não instalado)'}</option>)}
            </select>
          </Field>
          <Field label="Conta">
            <select className="field" value={draft.profileId} onChange={(event) => set({ profileId: event.target.value })}>
              <option value="">Escolha uma conta</option>
              {options.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}{profile.auth?.loggedIn ? '' : ' (sem login)'}</option>)}
            </select>
          </Field>
          <Field label="Modelo" hint={modelHint}>
            {modelOptions.length > 0 && (
              <select
                aria-label="Modelo"
                className="field"
                value={typingModel ? OTHER_MODEL : draft.model}
                onChange={(event) => {
                  const typed = event.target.value === OTHER_MODEL;
                  setTypingModel(typed);
                  if (typed) {
                    // Começa vazio: o nome escolhido na lista não é o começo do nome a digitar.
                    if (chosenModel) set({ model: '' });
                    return;
                  }
                  const next = modelOptions.find((item) => item.id === event.target.value);
                  // Um esforço que o novo modelo não aceita faria a execução falhar.
                  set({ model: event.target.value, effort: next?.efforts.length && !next.efforts.includes(draft.effort) ? '' : draft.effort });
                }}
              >
                <option value="">Padrão</option>
                {modelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                <option value={OTHER_MODEL}>Outro…</option>
              </select>
            )}
            {(typingModel || !modelOptions.length) && (
              <input aria-label="Nome do modelo" autoComplete="off" spellCheck={false} className={`field ${modelOptions.length ? 'mt-1.5' : ''}`} value={draft.model} onChange={(event) => set({ model: event.target.value.trim() })} placeholder="Nome exato do modelo" />
            )}
          </Field>
          <Field label="Esforço">
            <select className="field" disabled={!efforts.length} value={draft.effort} onChange={(event) => set({ effort: event.target.value })}>
              <option value="">Padrão</option>
              {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </Field>
        </div>
        {!options.length && (
          <p className="flex items-center gap-2 rounded-md bg-amber-soft px-3 py-2 text-[13px] text-amber">
            <AlertTriangle size={14} />
            Nenhuma conta de {provider?.label}.
            <button type="button" className="underline" onClick={() => { onClose(); setView('accounts'); }}>Adicionar conta</button>
          </p>
        )}
        <Field label="Permissão" hint={permission?.text}>
          <select className="field" value={draft.permission} onChange={(event) => set({ permission: event.target.value as PermissionLevel })}>
            {PERMISSIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>
        {toolkits.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-soft">Integrações</legend>
            <div className="space-y-1">
              {toolkits.map((kit) => (
                <label key={kit.id} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.toolkitIds.includes(kit.id)}
                    onChange={(event) => set({ toolkitIds: event.target.checked ? [...draft.toolkitIds, kit.id] : draft.toolkitIds.filter((id) => id !== kit.id) })}
                  />
                  <span>{kit.name}{kit.skills.length ? <span className="text-muted"> · {kit.skills.length} skills</span> : null}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Instruções extras" hint="Regras só deste agente, somadas às da função.">
          <textarea rows={3} className="field" value={draft.instructions} onChange={(event) => set({ instructions: event.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function AgentCard({ agent, onEdit }: { agent: Agent; onEdit: () => void }) {
  const profile = useStore((state) => state.profiles.find((item) => item.id === agent.profileId));
  const provider = useStore((state) => state.providers.find((item) => item.id === agent.provider));
  const allToolkits = useStore((state) => state.toolkits);
  const toolkits = allToolkits.filter((kit) => agent.toolkitIds.includes(kit.id));
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const setChannel = useStore((state) => state.setChannel);
  const setView = useStore((state) => state.setView);
  const { state, activity } = useActivity(agent.id);
  const [confirming, setConfirming] = useState(false);
  const info = ACTIVITY[activity];
  const permission = PERMISSIONS.find((item) => item.id === agent.permission);
  const problem = !profile ? 'Sem conta conectada' : profile.auth && !profile.auth.loggedIn ? 'A conta precisa de login' : !provider?.installed ? 'Ferramenta não instalada' : null;
  const modelLabel = provider?.modelOptions.find((item) => item.id === agent.model)?.label ?? agent.model ?? 'Padrão da ferramenta';
  const lastModel = useLastModel(agent.id);

  return (
    <article className="rise flex flex-col rounded-xl border border-line bg-panel p-3.5">
      <div className="flex items-start gap-3">
        <Avatar agent={agent} size={38} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[15px] font-semibold leading-tight">{agent.name}</h2>
          <p className="truncate text-xs text-muted">{agent.roleTitle || ROLES[agent.role].title}</p>
        </div>
        <span className="text-[11px] font-medium" style={{ color: info.color }}>{info.label}</span>
      </div>
      {state?.detail && activity !== 'available' && <p className="mt-2 truncate font-mono text-[11px] text-accent">{state.detail}</p>}
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-2"><dt className="text-muted">Ferramenta</dt><dd className="truncate">{provider?.label ?? agent.provider}</dd></div>
        <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted">Modelo</dt><dd className="truncate" title={modelLabel}>{modelLabel}</dd></div>
        {lastModel && lastModel !== agent.model && <div className="flex justify-between gap-2"><dt className="shrink-0 text-muted">Usou por último</dt><dd className="truncate" title={lastModel}>{lastModel}</dd></div>}
        <div className="flex justify-between gap-2"><dt className="text-muted">Conta</dt><dd className="truncate">{profile?.label ?? '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted">Permissão</dt><dd>{permission?.label}</dd></div>
        {toolkits.length > 0 && <div className="flex justify-between gap-2"><dt className="text-muted">Integrações</dt><dd className="truncate">{toolkits.map((kit) => kit.name).join(', ')}</dd></div>}
      </dl>
      {problem && <p className="mt-2 flex items-center gap-1.5 rounded bg-amber-soft px-2 py-1 text-xs text-amber"><AlertTriangle size={12} />{problem}</p>}
      <div className="mt-3 flex items-center gap-1 border-t border-line pt-2.5">
        <Button size="sm" kind="ghost" onClick={() => { setChannel(agent.id); setView('chat'); }}><MessageSquare size={13} /> Conversar</Button>
        <span className="flex-1" />
        <IconButton label={`Editar ${agent.name}`} onClick={onEdit}><Pencil size={13} /></IconButton>
        <IconButton label={`Remover ${agent.name}`} onClick={() => setConfirming(true)}><Trash2 size={13} /></IconButton>
      </div>
      {confirming && (
        <Dialog
          title={`Remover ${agent.name}?`}
          onClose={() => setConfirming(false)}
          footer={(
            <>
              <Button kind="ghost" onClick={() => setConfirming(false)}>Manter</Button>
              <Button
                kind="danger"
                onClick={async () => {
                  await run(() => api.delete(`/api/agents/${agent.id}`), 'Agente removido.');
                  await loadCatalog();
                  setConfirming(false);
                }}
              >
                Remover
              </Button>
            </>
          )}
        >
          <p className="text-[13px] text-soft">O histórico de execuções continua guardado, com o nome do agente.</p>
        </Dialog>
      )}
    </article>
  );
}

export function AgentsView() {
  const agents = useStore((state) => state.agents);
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Agentes"
        subtitle="Cada agente tem uma função, uma ferramenta de IA, uma conta e um nível de permissão"
        actions={<Button kind="primary" onClick={() => setEditing('new')}><Plus size={14} /> Novo agente</Button>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {agents.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3">
            {agents.map((agent) => <AgentCard key={agent.id} agent={agent} onEdit={() => setEditing(agent)} />)}
          </div>
        ) : (
          <Empty title="Monte sua equipe" icon={<Users size={28} />} action={<Button kind="primary" onClick={() => setEditing('new')}>Criar o primeiro agente</Button>}>
            Um bom começo: um coordenador, um desenvolvedor e um revisor, se possível em ferramentas diferentes.
          </Empty>
        )}
      </div>
      {editing && <AgentForm agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

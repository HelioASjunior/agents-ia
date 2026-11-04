import { AlertTriangle, ChevronDown, Paperclip, Rocket, Search, Send, Square, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Attachment, ChatMessage } from '@xinoia/shared';
import { ROLES, TEAM_CHANNEL } from '@xinoia/shared';
import { api } from '../api.ts';
import { Markdown } from '../components/Markdown.tsx';
import { ACTIVITY, Avatar, Button, Empty, formatBytes, formatTime, IconButton, useActivity } from '../components/ui.tsx';
import { useStore } from '../store.ts';

function Channel({ id, title, subtitle, agent }: { id: string; title: string; subtitle?: string; agent?: Agent }) {
  const channel = useStore((state) => state.channel);
  const setChannel = useStore((state) => state.setChannel);
  const selected = channel === id;
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={() => setChannel(id)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${selected ? 'bg-hover' : 'hover:bg-hover/60'}`}
    >
      {agent ? (
        <Avatar agent={agent} size={28} />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Users size={14} /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        {subtitle && <span className="block truncate text-[11px] text-muted">{subtitle}</span>}
      </span>
    </button>
  );
}

function AgentChannel({ agent }: { agent: Agent }) {
  const { state, activity } = useActivity(agent.id);
  const subtitle = activity === 'available' ? agent.roleTitle || ROLES[agent.role].title : state?.detail ?? ACTIVITY[activity].label;
  return <Channel id={agent.id} title={agent.name} subtitle={subtitle} agent={agent} />;
}

function Steps({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ChevronDown size={12} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        {steps.length === 1 ? '1 ação' : `${steps.length} ações`}
      </button>
      {open && (
        <ul className="mt-1 ml-1 space-y-0.5 border-l border-line pl-3 font-mono text-xs text-muted">
          {steps.map((step, index) => <li key={index} className="break-all">{step}</li>)}
        </ul>
      )}
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const agent = useStore((state) => state.agents.find((item) => item.id === message.agentId));
  const liveText = useStore((state) => (message.runId ? state.runText[message.runId] : undefined));
  const steps = useStore((state) => (message.runId ? state.runSteps[message.runId] : undefined)) ?? [];
  const run = useStore((state) => state.run);
  const detail = useStore((state) => (message.agentId ? state.agentStates[message.agentId]?.detail : undefined));

  if (message.role === 'system') {
    return <p className="rise mx-auto max-w-xl py-1 text-center text-xs text-muted">{message.text}</p>;
  }
  if (message.role === 'user') {
    return (
      <div className="rise flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-br-sm bg-raised px-3.5 py-2">
          <p className="whitespace-pre-wrap break-words text-[13.5px]">{message.text}</p>
          {message.attachments.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {message.attachments.map((file) => (
                <li key={file.path} className="flex items-center gap-1 text-xs text-muted"><Paperclip size={11} />{file.name} ({formatBytes(file.size)})</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const streaming = message.status === 'streaming';
  const text = streaming ? liveText ?? '' : message.text || liveText || '';
  return (
    <div className="rise flex gap-3">
      {agent ? <Avatar agent={agent} size={30} showStatus={false} /> : <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-hover font-bold text-muted">{message.agentName?.[0] ?? '?'}</span>}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold">{message.agentName}</span>
          <span className="text-[11px] text-muted">{formatTime(message.createdAt)}</span>
        </div>
        <Steps steps={steps} />
        {text && <Markdown text={text} />}
        {streaming && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span className="pulse h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="truncate">{detail ?? 'Começando'}</span>
            <button
              type="button"
              disabled={!message.runId}
              onClick={() => void run(() => api.post(`/api/chat/messages/${message.id}/cancel`))}
              className="ml-1 inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 text-[11px] hover:bg-hover disabled:opacity-40"
            >
              <Square size={9} /> Interromper
            </button>
          </div>
        )}
        {message.status === 'cancelled' && <p className="mt-1 text-xs text-muted">{message.error ?? 'Resposta interrompida.'}</p>}
        {message.status === 'error' && (
          <p className="mt-1 flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-[13px] text-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {message.error}
          </p>
        )}
      </div>
    </div>
  );
}

function Composer() {
  const channel = useStore((state) => state.channel);
  const projectId = useStore((state) => state.projectId);
  const agents = useStore((state) => state.agents);
  const run = useStore((state) => state.run);
  const toast = useStore((state) => state.toast);
  const [text, setText] = useState('');
  const [missionMode, setMissionMode] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isTeam = channel === TEAM_CHANNEL;

  const options = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return [...agents.map((agent) => agent.name), 'equipe'].filter((name) => name.toLowerCase().startsWith(query)).slice(0, 6);
  }, [agents, mention]);

  const onChange = (value: string) => {
    setText(value);
    const position = area.current?.selectionStart ?? value.length;
    const match = /(^|\s)@([\p{L}\d_-]*)$/u.exec(value.slice(0, position));
    setMention(isTeam && match ? { query: match[2] ?? '', start: position - (match[2]?.length ?? 0) - 1 } : null);
  };

  const pickMention = (name: string) => {
    if (!mention) return;
    const position = area.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, mention.start)}@${name} ${text.slice(position)}`);
    setMention(null);
    area.current?.focus();
  };

  const upload = async (files: FileList | null) => {
    if (!files || !projectId) return;
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        toast('error', `${file.name} passa do limite de 25 MB.`);
        continue;
      }
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
      });
      const saved = await run(() => api.post<Attachment>(`/api/projects/${projectId}/attachments`, { name: file.name, content }));
      if (saved) setAttachments((list) => [...list, saved]);
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const send = async () => {
    const clean = text.trim();
    if (!clean || !projectId || sending) return;
    setSending(true);
    const body = isTeam && missionMode ? `/missão ${clean}` : clean;
    const sent = await run(() => api.post('/api/chat/messages', { projectId, channel, text: body, attachments }));
    setSending(false);
    if (sent) {
      setText('');
      setAttachments([]);
      if (missionMode) {
        setMissionMode(false);
        useStore.getState().setView('board');
      }
    }
  };

  return (
    <div className="border-t border-line bg-panel px-4 py-3">
      <div className="relative mx-auto max-w-3xl">
        {options.length > 0 && (
          <ul className="absolute bottom-full left-0 mb-1 w-56 overflow-hidden rounded-lg border border-line-strong bg-raised py-1" style={{ boxShadow: 'var(--shadow)' }}>
            {options.map((name) => (
              <li key={name}>
                <button type="button" className="w-full px-3 py-1 text-left text-[13px] hover:bg-hover" onClick={() => pickMention(name)}>@{name}</button>
              </li>
            ))}
          </ul>
        )}
        {attachments.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file) => (
              <li key={file.path} className="flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-xs">
                <Paperclip size={11} />{file.name}
                <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setAttachments((list) => list.filter((item) => item.path !== file.path))}><X size={11} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className={`rounded-xl border bg-bg transition-colors focus-within:border-accent ${missionMode ? 'border-amber' : 'border-line-strong'}`}>
          <textarea
            ref={area}
            value={text}
            rows={Math.min(8, Math.max(2, text.split('\n').length))}
            disabled={!projectId}
            placeholder={!projectId
              ? 'Abra um projeto para começar'
              : missionMode
                ? 'Descreva o objetivo. O coordenador monta um plano para você aprovar.'
                : isTeam
                  ? 'Fale com a equipe. Use @nome para chamar alguém, ou "Equipe, ..." para ouvir todos.'
                  : 'Mensagem'}
            aria-label="Mensagem"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (options[0] && mention) pickMention(options[0]);
                else void send();
              }
            }}
            className="block w-full resize-none bg-transparent px-3.5 pt-2.5 text-[13.5px] outline-none placeholder:text-muted"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => void upload(event.target.files)} />
            <IconButton label="Anexar arquivos" disabled={!projectId} onClick={() => fileInput.current?.click()}><Paperclip size={15} /></IconButton>
            {isTeam && (
              <button
                type="button"
                aria-pressed={missionMode}
                onClick={() => setMissionMode(!missionMode)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${missionMode ? 'bg-amber-soft font-medium text-amber' : 'text-muted hover:bg-hover hover:text-ink'}`}
              >
                <Rocket size={13} /> Missão
              </button>
            )}
            <span className="ml-auto hidden text-[11px] text-muted sm:inline">Enter envia, Shift+Enter quebra a linha</span>
            <Button kind="primary" size="sm" disabled={!text.trim() || !projectId || sending} onClick={() => void send()}>
              <Send size={13} /> {missionMode ? 'Iniciar' : 'Enviar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchBox() {
  const projectId = useStore((state) => state.projectId);
  const setChannel = useStore((state) => state.setChannel);
  const run = useStore((state) => state.run);
  const agents = useStore((state) => state.agents);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[] | null>(null);

  const search = async () => {
    if (!projectId || !query.trim()) {
      setResults(null);
      return;
    }
    const found = await run(() => api.get<ChatMessage[]>(`/api/chat/search?projectId=${projectId}&q=${encodeURIComponent(query.trim())}`));
    setResults(found ?? []);
  };

  return (
    <div className="p-2">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute top-2 left-2.5 text-muted" />
        <input
          aria-label="Buscar nas conversas"
          className="field !py-1 !pl-7 !text-xs"
          placeholder="Buscar nas conversas"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value) setResults(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void search();
          }}
        />
      </div>
      {results && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {results.length === 0 && <li className="px-1 text-xs text-muted">Nada encontrado.</li>}
          {results.map((message) => (
            <li key={message.id}>
              <button type="button" onClick={() => setChannel(message.channel)} className="w-full rounded-md bg-raised px-2 py-1 text-left hover:bg-hover">
                <span className="block text-[11px] text-muted">
                  {message.channel === TEAM_CHANNEL ? 'Equipe' : agents.find((agent) => agent.id === message.channel)?.name ?? 'Agente'}
                  {' · '}{message.role === 'user' ? 'Você' : message.agentName}
                </span>
                <span className="line-clamp-2 text-xs">{message.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChatView() {
  const agents = useStore((state) => state.agents);
  const channel = useStore((state) => state.channel);
  const projectId = useStore((state) => state.projectId);
  const messages = useStore((state) => state.messages[channel]);
  const events = useStore((state) => state.lastEventId);
  const setView = useStore((state) => state.setView);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const agent = agents.find((item) => item.id === channel);

  useEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, events, channel]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line max-md:hidden" aria-label="Conversas">
        <SearchBox />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <Channel id={TEAM_CHANNEL} title="Equipe" subtitle="Coordenador e todos" />
          <p className="label mt-3 mb-1 px-2">Agentes</p>
          <div className="space-y-0.5">
            {agents.map((item) => <AgentChannel key={item.id} agent={item} />)}
          </div>
          {!agents.length && <p className="px-2 text-xs text-muted">Nenhum agente ainda.</p>}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
          {agent ? <Avatar agent={agent} size={26} /> : <Users size={16} className="text-accent" />}
          <div className="min-w-0">
            <h1 className="truncate font-display text-sm font-semibold leading-tight">{agent?.name ?? 'Equipe'}</h1>
            <p className="truncate text-[11px] leading-tight text-muted">{agent ? agent.roleTitle || ROLES[agent.role].title : 'Mensagens sem @ vão para o coordenador'}</p>
          </div>
        </header>
        <div
          ref={list}
          onScroll={(event) => {
            const el = event.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          {!projectId ? (
            <Empty title="Nenhum projeto aberto" action={<Button kind="primary" onClick={() => setView('projects')}>Abrir um projeto</Button>}>
              Cada conversa pertence a um projeto, e os agentes trabalham na pasta dele.
            </Empty>
          ) : !agents.length ? (
            <Empty title="Sua equipe ainda está vazia" action={<Button kind="primary" onClick={() => setView('agents')}>Criar agentes</Button>}>
              Crie agentes e escolha a ferramenta de IA e a conta de cada um.
            </Empty>
          ) : !messages?.length ? (
            <Empty title={agent ? `Converse com ${agent.name}` : 'Fale com a equipe'}>
              {agent ? 'A conversa continua de onde parou, inclusive depois de reiniciar.' : 'Peça uma análise, chame alguém com @nome ou ligue Missão para o trabalho orquestrado.'}
            </Empty>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message) => <Message key={message.id} message={message} />)}
            </div>
          )}
        </div>
        <Composer />
      </div>
    </div>
  );
}

import { create } from 'zustand';
import type {
  Agent,
  AgentLiveState,
  ChatMessage,
  Mission,
  Profile,
  Project,
  ProviderInfo,
  Run,
  ServerMessage,
  StoredMissionEvent,
  StoredRunEvent,
  Task,
  Toolkit,
} from '@xinoia/shared';
import { api, wsUrl } from './api.ts';

export type ViewId =
  | 'chat'
  | 'office'
  | 'board'
  | 'workflows'
  | 'agents'
  | 'accounts'
  | 'projects'
  | 'files'
  | 'history'
  | 'dashboard'
  | 'settings';

export interface Toast {
  id: number;
  kind: 'error' | 'ok' | 'info';
  text: string;
}

const MAX_EVENTS = 20_000;
const PROJECT_KEY = 'xinoia.project';
const THEME_KEY = 'xinoia.theme';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferência visual: sem armazenamento, só não é lembrada.
  }
}

interface State {
  ready: boolean;
  connected: boolean;
  view: ViewId;
  theme: 'dark' | 'light';
  projectId: string | null;
  channel: string;
  selectedAgentId: string | null;
  providers: ProviderInfo[];
  profiles: Profile[];
  agents: Agent[];
  projects: Project[];
  toolkits: Toolkit[];
  health: Record<string, boolean | null>;
  missions: Mission[];
  tasks: Record<string, Task[]>;
  missionEvents: Record<string, StoredMissionEvent[]>;
  runs: Record<string, Run>;
  events: StoredRunEvent[];
  /** Texto já recebido de cada execução, para o chat em tempo real. */
  runText: Record<string, string>;
  runSteps: Record<string, string[]>;
  agentStates: Record<string, AgentLiveState>;
  messages: Record<string, ChatMessage[]>;
  toasts: Toast[];
  /** Sobe a cada mudança no terminal; o componente desenha só o que chegou. */
  lastEventId: number;

  setView(view: ViewId): void;
  setTheme(theme: 'dark' | 'light'): void;
  setChannel(channel: string): void;
  selectAgent(id: string | null): void;
  setProject(id: string | null): Promise<void>;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  load(): Promise<void>;
  loadCatalog(): Promise<void>;
  loadProjectData(projectId: string): Promise<void>;
  loadMission(id: string): Promise<void>;
  loadChannel(channel: string): Promise<void>;
  connect(): void;
  run<T>(work: () => Promise<T>, success?: string): Promise<T | undefined>;
}

let toastId = 0;
let socket: WebSocket | null = null;

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

function applyEvent(state: State, stored: StoredRunEvent): Partial<State> {
  if (state.events.at(-1)?.id === stored.id) return {};
  const events = state.events.length >= MAX_EVENTS ? state.events.slice(-MAX_EVENTS + 1) : state.events.slice();
  events.push(stored);
  const patch: Partial<State> = { events, lastEventId: stored.id };
  const { event, runId } = stored;
  if (event.type === 'text') {
    patch.runText = { ...state.runText, [runId]: (state.runText[runId] ?? '') + event.text };
  } else if (event.type === 'tool_start' && !event.nested) {
    patch.runSteps = { ...state.runSteps, [runId]: [...(state.runSteps[runId] ?? []), event.summary] };
  }
  return patch;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  connected: false,
  view: 'office',
  theme: stored(THEME_KEY) === 'light' ? 'light' : 'dark',
  projectId: stored(PROJECT_KEY),
  channel: 'team',
  selectedAgentId: null,
  providers: [],
  profiles: [],
  agents: [],
  projects: [],
  toolkits: [],
  health: {},
  missions: [],
  tasks: {},
  missionEvents: {},
  runs: {},
  events: [],
  runText: {},
  runSteps: {},
  agentStates: {},
  messages: {},
  toasts: [],
  lastEventId: 0,

  setView: (view) => set({ view }),

  setTheme(theme) {
    persist(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },

  setChannel(channel) {
    set({ channel });
    void get().loadChannel(channel);
  },

  selectAgent: (selectedAgentId) => set({ selectedAgentId }),

  async setProject(id) {
    persist(PROJECT_KEY, id ?? '');
    set({ projectId: id, messages: {}, events: [], runs: {}, runText: {}, runSteps: {}, missions: [], tasks: {}, missionEvents: {}, channel: 'team' });
    if (id) await get().loadProjectData(id);
  },

  toast(kind, text) {
    const id = (toastId += 1);
    set((state) => ({ toasts: [...state.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  /** Executa uma ação e mostra o erro em linguagem clara, sem quebrar a tela. */
  async run(work, success) {
    try {
      const result = await work();
      if (success) get().toast('ok', success);
      return result;
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  },

  async loadCatalog() {
    const [providers, profiles, agents, projects, toolkits, health, states] = await Promise.all([
      api.get<ProviderInfo[]>('/api/providers'),
      api.get<Profile[]>('/api/profiles'),
      api.get<Agent[]>('/api/agents'),
      api.get<Project[]>('/api/projects'),
      api.get<Toolkit[]>('/api/toolkits'),
      api.get<Record<string, boolean | null>>('/api/toolkits/health'),
      api.get<AgentLiveState[]>('/api/agents-state'),
    ]);
    set({
      providers,
      profiles,
      agents,
      projects,
      toolkits,
      health,
      agentStates: Object.fromEntries(states.map((state) => [state.agentId, state])),
    });
  },

  async load() {
    await get().loadCatalog();
    let { projectId } = get();
    const { projects } = get();
    if (!projects.some((project) => project.id === projectId)) {
      projectId = projects[0]?.id ?? null;
      persist(PROJECT_KEY, projectId ?? '');
      set({ projectId });
    }
    if (projectId) await get().loadProjectData(projectId);
    set({ ready: true });
    get().connect();
  },

  async loadProjectData(projectId) {
    const [runs, events, missions] = await Promise.all([
      api.get<Run[]>(`/api/runs?projectId=${projectId}&limit=200`),
      api.get<StoredRunEvent[]>(`/api/projects/${projectId}/terminal`),
      api.get<Mission[]>(`/api/missions?projectId=${projectId}`),
    ]);
    const runText: Record<string, string> = {};
    const runSteps: Record<string, string[]> = {};
    for (const { runId, event } of events) {
      if (event.type === 'text') runText[runId] = (runText[runId] ?? '') + event.text;
      else if (event.type === 'tool_start' && !event.nested) (runSteps[runId] ??= []).push(event.summary);
    }
    set({
      runs: Object.fromEntries(runs.map((run) => [run.id, run])),
      events,
      runText,
      runSteps,
      missions,
      lastEventId: events.at(-1)?.id ?? get().lastEventId,
    });
    await Promise.all([
      get().loadChannel(get().channel),
      ...missions.slice(0, 1).map((mission) => get().loadMission(mission.id)),
    ]);
  },

  async loadMission(id) {
    const [tasks, events] = await Promise.all([
      api.get<Task[]>(`/api/missions/${id}/tasks`),
      api.get<StoredMissionEvent[]>(`/api/missions/${id}/events`),
    ]);
    set((state) => ({ tasks: { ...state.tasks, [id]: tasks }, missionEvents: { ...state.missionEvents, [id]: events } }));
  },

  async loadChannel(channel) {
    const { projectId } = get();
    if (!projectId) return;
    const list = await api.get<ChatMessage[]>(`/api/chat/messages?projectId=${projectId}&channel=${channel}`);
    set((state) => ({ messages: { ...state.messages, [channel]: list } }));
  },

  connect() {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    const after = get().lastEventId;
    socket = new WebSocket(wsUrl('/ws', { after }));
    socket.onopen = () => set({ connected: true });
    socket.onclose = () => {
      set({ connected: false });
      setTimeout(() => get().connect(), 1500);
    };
    socket.onmessage = (raw) => {
      const message = JSON.parse(String(raw.data)) as ServerMessage;
      set((state) => reduce(state, message));
    };
  },
}));

function reduce(state: State, message: ServerMessage): Partial<State> {
  switch (message.kind) {
    case 'hello':
      return {};
    case 'run_event':
      return state.runs[message.data.runId] ? applyEvent(state, message.data) : {};
    case 'run_updated':
      if (message.data.projectId !== state.projectId) return {};
      return { runs: { ...state.runs, [message.data.id]: message.data } };
    case 'profile_updated':
      return { profiles: upsert(state.profiles, message.data) };
    case 'mission_updated':
      if (message.data.projectId !== state.projectId) return {};
      return {
        missions: state.missions.some((mission) => mission.id === message.data.id)
          ? state.missions.map((mission) => (mission.id === message.data.id ? message.data : mission))
          : [message.data, ...state.missions],
      };
    case 'task_updated': {
      const list = state.tasks[message.data.missionId] ?? [];
      return {
        tasks: {
          ...state.tasks,
          [message.data.missionId]: upsert(list, message.data).sort((a, b) => a.position - b.position),
        },
      };
    }
    case 'tasks_replaced':
      return { tasks: { ...state.tasks, [message.missionId]: message.data } };
    case 'mission_event': {
      const list = state.missionEvents[message.data.missionId] ?? [];
      return { missionEvents: { ...state.missionEvents, [message.data.missionId]: [...list, message.data] } };
    }
    case 'agent_state':
      return { agentStates: { ...state.agentStates, [message.data.agentId]: message.data } };
    case 'chat_message': {
      if (message.data.projectId !== state.projectId) return {};
      const list = state.messages[message.data.channel] ?? [];
      return { messages: { ...state.messages, [message.data.channel]: upsert(list, message.data) } };
    }
    default:
      return {};
  }
}

export const activeMission = (missions: Mission[]): Mission | undefined =>
  missions.find((mission) => ['planning', 'awaiting_approval', 'running', 'paused', 'reporting'].includes(mission.status));

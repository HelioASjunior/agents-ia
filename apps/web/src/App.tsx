import { AlertTriangle, CheckCircle2, ChevronDown, Download, FolderGit2, Info, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api.ts';
import { RightPanel } from './components/RightPanel.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { IconButton, StatusPill } from './components/ui.tsx';
import { Onboarding, shouldShowOnboarding } from './views/Onboarding.tsx';
import { AccountsView } from './views/AccountsView.tsx';
import { AgentsView } from './views/AgentsView.tsx';
import { BoardView } from './views/BoardView.tsx';
import { ChatView } from './views/ChatView.tsx';
import { DashboardView } from './views/DashboardView.tsx';
import { FilesView } from './views/FilesView.tsx';
import { HistoryView } from './views/HistoryView.tsx';
import { OfficeView } from './views/OfficeView.tsx';
import { ProjectsView } from './views/ProjectsView.tsx';
import { QueueView } from './views/QueueView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { activeMission, useStore, type ViewId } from './store.ts';

// O editor de fluxos carrega uma biblioteca grande: só entra quando é aberto.
const WorkflowsView = lazy(() => import('./views/WorkflowsView.tsx').then((module) => ({ default: module.WorkflowsView })));

const VIEWS: Record<ViewId, () => ReactNode> = {
  chat: () => <ChatView />,
  office: () => <OfficeView />,
  board: () => <BoardView />,
  workflows: () => <WorkflowsView />,
  queue: () => <QueueView />,
  agents: () => <AgentsView />,
  accounts: () => <AccountsView />,
  projects: () => <ProjectsView />,
  files: () => <FilesView />,
  history: () => <HistoryView />,
  dashboard: () => <DashboardView />,
  settings: () => <SettingsView />,
};

const LAYOUT_KEY = 'xinoia.layout';

function readLayout(): { sidebar: boolean; panel: boolean; width: number } {
  try {
    return { sidebar: false, panel: true, width: 460, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
  } catch {
    return { sidebar: false, panel: true, width: 460 };
  }
}

function ProjectSwitcher() {
  const projects = useStore((state) => state.projects);
  const projectId = useStore((state) => state.projectId);
  const setProject = useStore((state) => state.setProject);
  const setView = useStore((state) => state.setView);
  const [open, setOpen] = useState(false);
  const current = projects.find((project) => project.id === projectId);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-hover"
      >
        <FolderGit2 size={14} className="shrink-0 text-muted" />
        <span className="truncate font-medium">{current?.name ?? 'Nenhum projeto'}</span>
        <ChevronDown size={12} className="shrink-0 text-muted" />
      </button>
      {open && (
        <ul role="menu" className="absolute top-full left-0 z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-line-strong bg-raised py-1" style={{ boxShadow: 'var(--shadow)' }}>
          {projects.map((project) => (
            <li key={project.id}>
              <button type="button" role="menuitem" onClick={() => void setProject(project.id)} className={`block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-hover ${project.id === projectId ? 'text-accent' : ''}`}>{project.name}</button>
            </li>
          ))}
          <li className={projects.length ? 'mt-1 border-t border-line pt-1' : ''}>
            <button type="button" role="menuitem" onClick={() => setView('projects')} className="block w-full px-3 py-1.5 text-left text-[13px] text-soft hover:bg-hover">Gerenciar projetos…</button>
          </li>
        </ul>
      )}
    </div>
  );
}

function MissionStatus() {
  const missions = useStore((state) => state.missions);
  const tasks = useStore((state) => state.tasks);
  const setView = useStore((state) => state.setView);
  const mission = activeMission(missions);
  if (!mission) return null;
  const list = tasks[mission.id] ?? [];
  const done = list.filter((task) => ['done', 'skipped'].includes(task.status)).length;
  return (
    <button type="button" onClick={() => setView('board')} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-hover">
      <StatusPill status={mission.status} />
      {list.length > 0 && <span className="whitespace-nowrap text-muted">{done} de {list.length}</span>}
      <span className="hidden min-w-0 truncate text-muted lg:inline">{mission.goal}</span>
    </button>
  );
}

/** Aviso discreto: não interrompe nada, e leva para Configurações. */
function UpdateNotice() {
  const setView = useStore((state) => state.setView);
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const bridge = window.xinoia?.updates;
    if (!bridge) return undefined;
    void bridge.getState().then(setState);
    return bridge.onChange(setState);
  }, []);
  if (!state || !['available', 'downloading', 'ready'].includes(state.status) || !state.available) return null;
  const text = state.status === 'ready'
    ? `Versão ${state.available.version} pronta para instalar`
    : state.status === 'downloading'
      ? `Baixando a versão ${state.available.version}`
      : `Versão ${state.available.version} disponível`;
  return (
    <button type="button" onClick={() => setView('settings')} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-xs font-medium text-accent hover:brightness-110">
      <Download size={12} /> {text}
    </button>
  );
}

function Toasts() {
  const toasts = useStore((state) => state.toasts);
  const dismiss = useStore((state) => state.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="rise pointer-events-auto flex items-start gap-2 rounded-lg border border-line-strong bg-raised px-3 py-2 text-[13px]" style={{ boxShadow: 'var(--shadow)' }}>
          {toast.kind === 'error' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" /> : toast.kind === 'ok' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" /> : <Info size={15} className="mt-0.5 shrink-0 text-accent" />}
          <span className="min-w-0 flex-1 break-words">{toast.text}</span>
          <button type="button" aria-label="Dispensar" onClick={() => dismiss(toast.id)} className="text-muted hover:text-ink"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function Splash({ error }: { error?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg">
      <img src="./logo.svg" alt="" className={`h-20 w-20 ${error ? '' : 'pulse'}`} />
      <p className="font-display text-2xl font-bold tracking-tight">Xino<span className="text-accent">IA</span></p>
      {error
        ? <p className="max-w-md text-center text-[13px] text-danger">{error}</p>
        : <p className="text-[13px] text-muted">Preparando o escritório…</p>}
    </div>
  );
}

export function App() {
  const ready = useStore((state) => state.ready);
  const load = useStore((state) => state.load);
  const view = useStore((state) => state.view);
  const missions = useStore((state) => state.missions);
  const [error, setError] = useState<string | undefined>();
  const [onboarding, setOnboarding] = useState(false);
  const [layout, setLayout] = useState(readLayout);
  const dragging = useRef(false);
  const notified = useRef(new Map<string, string>());

  const updateLayout = useCallback((change: Partial<typeof layout>) => {
    setLayout((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {
        // Preferência visual: sem armazenamento, só não é lembrada.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void load()
      .then(() => setOnboarding(shouldShowOnboarding(useStore.getState())))
      .catch((failure: unknown) => {
        const unauthorized = failure instanceof ApiError && failure.status === 401;
        setError(unauthorized ? 'Esta janela não tem acesso ao XinoIA. Abra pelo endereço completo mostrado ao iniciar, ou pelo aplicativo.' : failure instanceof Error ? failure.message : String(failure));
      });
  }, [load]);

  // Avisa no sistema quando a missão pede atenção, mesmo com a janela em segundo plano.
  useEffect(() => {
    for (const mission of missions) {
      const previous = notified.current.get(mission.id);
      notified.current.set(mission.id, mission.status);
      if (!previous || previous === mission.status || document.hasFocus()) continue;
      const messages: Record<string, string> = {
        awaiting_approval: 'O plano está pronto para sua aprovação.',
        paused: mission.pauseReason ?? 'A missão parou e precisa de você.',
        completed: 'A missão foi concluída.',
        failed: mission.pauseReason ?? 'A missão falhou.',
      };
      const body = messages[mission.status];
      if (body) window.xinoia?.notify?.('XinoIA', body);
    }
  }, [missions]);

  const onDrag = useCallback((event: PointerEvent) => {
    if (!dragging.current) return;
    updateLayout({ width: Math.max(320, Math.min(window.innerWidth - 520, window.innerWidth - event.clientX)) });
  }, [updateLayout]);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointerup', stop);
    };
  }, [onDrag]);

  if (error) return <Splash error={error} />;
  if (!ready) return <Splash />;

  return (
    <div className="flex h-full min-h-0">
      <aside className={`shrink-0 border-r border-line transition-[width] duration-150 ${layout.sidebar ? 'w-[52px]' : 'w-[188px]'}`}>
        <Sidebar collapsed={layout.sidebar} onToggle={() => updateLayout({ sidebar: !layout.sidebar })} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
          <ProjectSwitcher />
          <span className="h-4 w-px shrink-0 bg-line" />
          <MissionStatus />
          <span className="flex-1" />
          <UpdateNotice />
          <IconButton label={layout.panel ? 'Recolher painel' : 'Mostrar painel'} onClick={() => updateLayout({ panel: !layout.panel })}>
            {layout.panel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </IconButton>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 bg-bg">
            <Suspense fallback={<Splash />}>{VIEWS[view]()}</Suspense>
          </main>
          {layout.panel && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionar painel"
                tabIndex={0}
                onPointerDown={() => {
                  dragging.current = true;
                  document.body.style.userSelect = 'none';
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') updateLayout({ width: layout.width + 24 });
                  if (event.key === 'ArrowRight') updateLayout({ width: Math.max(320, layout.width - 24) });
                }}
                className="w-1 shrink-0 cursor-col-resize border-l border-line bg-transparent transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 max-lg:hidden"
              />
              <aside className="shrink-0 max-lg:hidden" style={{ width: layout.width }}>
                <RightPanel />
              </aside>
            </>
          )}
        </div>
      </div>
      <Toasts />
      {onboarding && <Onboarding onClose={() => setOnboarding(false)} />}
    </div>
  );
}

import {
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FolderGit2,
  FolderOpen,
  Gauge,
  History,
  KanbanSquare,
  KeyRound,
  MessageSquare,
  Moon,
  Settings,
  Sun,
  Users,
  Workflow,
} from 'lucide-react';
import { useStore, type ViewId } from '../store.ts';

const GROUPS: Array<Array<{ id: ViewId; label: string; icon: typeof MessageSquare }>> = [
  [
    { id: 'office', label: 'Escritório', icon: Building2 },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'board', label: 'Tarefas', icon: KanbanSquare },
    { id: 'workflows', label: 'Workflows', icon: Workflow },
  ],
  [
    { id: 'files', label: 'Arquivos', icon: FolderOpen },
    { id: 'history', label: 'Histórico', icon: History },
    { id: 'dashboard', label: 'Painel', icon: Gauge },
  ],
  [
    { id: 'projects', label: 'Projetos', icon: FolderGit2 },
    { id: 'agents', label: 'Agentes', icon: Users },
    { id: 'accounts', label: 'Contas', icon: KeyRound },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ],
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const view = useStore((state) => state.view);
  const setView = useStore((state) => state.setView);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const connected = useStore((state) => state.connected);

  return (
    <nav className="flex h-full flex-col bg-panel" aria-label="Navegação principal">
      <div className={`flex h-12 items-center gap-2 border-b border-line ${collapsed ? 'justify-center' : 'px-3'}`}>
        <img src="./logo.svg" alt="" className="h-7 w-7" />
        {!collapsed && (
          <span className="font-display text-[15px] font-bold tracking-tight">
            Xino<span className="text-accent">IA</span>
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {GROUPS.map((group, index) => (
          <ul key={index} className={`space-y-0.5 px-2 ${index ? 'mt-2 border-t border-line pt-2' : ''}`}>
            {group.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={view === id ? 'page' : undefined}
                  title={collapsed ? label : undefined}
                  onClick={() => setView(id)}
                  className={`relative flex h-8 w-full items-center gap-2.5 rounded-md text-[13px] transition-colors ${collapsed ? 'justify-center' : 'px-2'} ${view === id ? 'bg-accent-soft font-medium text-accent' : 'text-soft hover:bg-hover hover:text-ink'}`}
                >
                  <Icon size={16} strokeWidth={view === id ? 2.2 : 1.8} />
                  {!collapsed && label}
                </button>
              </li>
            ))}
          </ul>
        ))}
      </div>
      <div className={`flex items-center border-t border-line py-2 ${collapsed ? 'flex-col gap-1' : 'gap-1 px-2'}`}>
        {!collapsed && (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-[11px] text-muted" role="status">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? 'bg-ok' : 'pulse bg-danger'}`} />
            <span className="truncate">{connected ? 'Conectado' : 'Reconectando…'}</span>
          </span>
        )}
        <button
          type="button"
          aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>
    </nav>
  );
}

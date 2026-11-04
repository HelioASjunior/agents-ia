import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AgentActivity, Agent } from '@xinoia/shared';
import { useStore } from '../store.ts';

type ButtonKind = 'primary' | 'ghost' | 'outline' | 'danger';

const BUTTON: Record<ButtonKind, string> = {
  primary: 'bg-accent text-accent-ink font-semibold hover:brightness-110',
  outline: 'border border-line-strong text-ink hover:bg-hover',
  ghost: 'text-soft hover:bg-hover hover:text-ink',
  danger: 'border border-danger/40 text-danger hover:bg-danger-soft',
};

export function Button({
  kind = 'outline',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors duration-100 disabled:opacity-40 ${size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]'} ${BUTTON[kind]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  width = 520,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      style={{ width: `min(${width}px, calc(100vw - 32px))`, boxShadow: 'var(--shadow)' }}
      className="m-auto max-h-[calc(100vh-48px)] rounded-xl border border-line-strong bg-panel p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex max-h-[calc(100vh-50px)] flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={() => ref.current?.close()}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-display text-[15px] font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-md text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
      <div className="min-w-0">
        <h1 className="font-display text-lg font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export const ACTIVITY: Record<AgentActivity, { label: string; color: string; live: boolean }> = {
  available: { label: 'Disponível', color: 'var(--muted)', live: false },
  thinking: { label: 'Pensando', color: 'var(--think)', live: true },
  executing: { label: 'Executando', color: 'var(--accent)', live: true },
  waiting: { label: 'Aguardando', color: 'var(--amber)', live: false },
  reviewing: { label: 'Revisando', color: 'var(--review)', live: true },
  error: { label: 'Com erro', color: 'var(--danger)', live: false },
  finished: { label: 'Finalizado', color: 'var(--ok)', live: false },
};

export function useActivity(agentId: string | null | undefined) {
  const state = useStore((store) => (agentId ? store.agentStates[agentId] : undefined));
  return { state, activity: state?.activity ?? 'available' as AgentActivity };
}

export function Avatar({ agent, size = 28, showStatus = true }: { agent: Pick<Agent, 'id' | 'name' | 'color'>; size?: number; showStatus?: boolean }) {
  const { activity } = useActivity(agent.id);
  const info = ACTIVITY[activity];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-lg font-display font-bold"
        style={{ background: agent.color, color: '#06121a', fontSize: size * 0.44 }}
        aria-hidden
      >
        {agent.name.slice(0, 1).toUpperCase()}
      </span>
      {showStatus && (
        <span
          title={info.label}
          className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel ${info.live ? 'pulse' : ''}`}
          style={{ background: info.color }}
        />
      )}
    </span>
  );
}

const STATUS_TONES: Record<string, string> = {
  completed: 'bg-ok-soft text-ok',
  done: 'bg-ok-soft text-ok',
  running: 'bg-accent-soft text-accent',
  planning: 'bg-accent-soft text-accent',
  reporting: 'bg-accent-soft text-accent',
  queued: 'bg-amber-soft text-amber',
  pending: 'bg-hover text-soft',
  awaiting_approval: 'bg-amber-soft text-amber',
  paused: 'bg-amber-soft text-amber',
  failed: 'bg-danger-soft text-danger',
  error: 'bg-danger-soft text-danger',
  cancelled: 'bg-hover text-muted',
  skipped: 'bg-hover text-muted',
  interrupted: 'bg-amber-soft text-amber',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'Concluída',
  done: 'Concluída',
  running: 'Em execução',
  planning: 'Planejando',
  reporting: 'Gerando relatório',
  queued: 'Na fila',
  pending: 'Pendente',
  awaiting_approval: 'Aguardando aprovação',
  paused: 'Pausada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  skipped: 'Pulada',
  interrupted: 'Interrompida',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONES[status] ?? 'bg-hover text-soft'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** `usage`: quanto mais cheio, pior, como limites e memória. Progresso nunca fica vermelho. */
export function Meter({ value, tone = 'var(--accent)', label, usage = false }: { value: number; tone?: string; label?: string; usage?: boolean }) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return (
    <div role="meter" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-1.5 overflow-hidden rounded-full bg-hover">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${percent}%`, background: usage && percent > 85 ? 'var(--danger)' : tone }} />
      </div>
    </div>
  );
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}min ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

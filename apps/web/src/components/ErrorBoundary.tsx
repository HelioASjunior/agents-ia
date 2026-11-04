import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Um erro na interface mostra o que fazer, em vez de deixar a janela em branco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
        <img src="./logo.svg" alt="" className="h-16 w-16" />
        <h1 className="font-display text-xl font-semibold">Algo deu errado nesta tela</h1>
        <p className="max-w-md text-[13px] text-muted">Seus dados estão salvos, e os agentes continuam rodando. Recarregue para voltar.</p>
        <code className="max-w-xl break-all rounded-md bg-raised px-3 py-1.5 font-mono text-xs text-danger">{error.message}</code>
        <button type="button" onClick={() => window.location.reload()} className="mt-1 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink">Recarregar</button>
      </div>
    );
  }
}

/// <reference types="vite/client" />

interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  channel: 'latest' | 'beta';
  autoCheck: boolean;
  available: { version: string; notes: string | null } | null;
  progress: { percent: number; transferred: number; total: number } | null;
  error: string | null;
  lastCheckedAt: number | null;
}

/** Ponte com a casca desktop. Não existe quando a interface roda no navegador. */
interface XinoiaBridge {
  pickFolder?: () => Promise<string | null>;
  notify?: (title: string, body: string) => void;
  updates?: {
    getState(): Promise<UpdateState>;
    check(): Promise<void>;
    download(): Promise<void>;
    dismiss(): Promise<void>;
    install(force: boolean): Promise<void>;
    setAutoCheck(value: boolean): Promise<void>;
    setChannel(value: 'latest' | 'beta'): Promise<void>;
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}

interface Window {
  xinoia?: XinoiaBridge;
}

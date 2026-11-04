import { ChevronRight, File, Folder, FolderOpen, GitCommitHorizontal, RefreshCw, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FileContent, FileEntry, GitStatus } from '@xinoia/shared';
import { api } from '../api.ts';
import { Button, Empty, formatBytes, IconButton, PageHeader } from '../components/ui.tsx';
import { useStore } from '../store.ts';

function TreeNode({ entry, depth, selected, onSelect, projectId }: { entry: FileEntry; depth: number; selected: string | null; onSelect: (path: string) => void; projectId: string }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const run = useStore((state) => state.run);

  const toggle = async () => {
    if (!entry.isDirectory) {
      onSelect(entry.path);
      return;
    }
    if (!children) {
      const list = await run(() => api.get<FileEntry[]>(`/api/projects/${projectId}/files?path=${encodeURIComponent(entry.path)}`));
      setChildren(list ?? []);
    }
    setOpen(!open);
  };

  return (
    <li>
      <button
        type="button"
        aria-expanded={entry.isDirectory ? open : undefined}
        aria-current={selected === entry.path}
        onClick={() => void toggle()}
        className={`flex h-6 w-full items-center gap-1 rounded text-left text-[13px] hover:bg-hover ${selected === entry.path ? 'bg-accent-soft text-accent' : 'text-soft'}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {entry.isDirectory
          ? <><ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />{open ? <FolderOpen size={13} className="shrink-0" /> : <Folder size={13} className="shrink-0" />}</>
          : <><span className="w-3 shrink-0" /><File size={13} className="shrink-0 text-muted" /></>}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && children && (
        <ul>{children.map((child) => <TreeNode key={child.path} entry={child} depth={depth + 1} selected={selected} onSelect={onSelect} projectId={projectId} />)}</ul>
      )}
    </li>
  );
}

const GIT_LABEL: Record<string, string> = { M: 'alterado', A: 'novo', D: 'apagado', R: 'renomeado', '?': 'novo' };

export function FilesView() {
  const projectId = useStore((state) => state.projectId);
  const run = useStore((state) => state.run);
  const setView = useStore((state) => state.setView);
  const [root, setRoot] = useState<FileEntry[]>([]);
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState('');
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [mode, setMode] = useState<'file' | 'diff'>('file');
  const dirty = file?.content !== null && file !== null && draft !== file.content;

  const reload = useCallback(async () => {
    if (!projectId) return;
    const [entries, status] = await Promise.all([
      run(() => api.get<FileEntry[]>(`/api/projects/${projectId}/files`)),
      run(() => api.get<GitStatus>(`/api/projects/${projectId}/git/status`)),
    ]);
    setRoot(entries ?? []);
    setGit(status ?? null);
  }, [projectId, run]);

  useEffect(() => {
    setFile(null);
    setDiff(null);
    void reload();
  }, [reload]);

  const open = async (path: string) => {
    if (dirty && !window.confirm('Descartar as alterações não salvas?')) return;
    const content = await run(() => api.get<FileContent>(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`));
    if (content) {
      setFile(content);
      setDraft(content.content ?? '');
      setMode('file');
    }
  };

  const openDiff = async (path: string) => {
    const result = await run(() => api.get<{ diff: string }>(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}`));
    if (result) {
      setDiff(result.diff);
      setFile({ path, size: 0, content: null, reason: null });
      setMode('diff');
    }
  };

  if (!projectId) {
    return <Empty title="Nenhum projeto aberto" action={<Button kind="primary" onClick={() => setView('projects')}>Abrir um projeto</Button>} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Arquivos" subtitle="Veja e edite os arquivos do projeto, e o que mudou desde o último commit" actions={<Button onClick={() => void reload()}><RefreshCw size={13} /> Atualizar</Button>} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line p-2" aria-label="Arquivos do projeto">
          {git?.isRepo && git.changes.length > 0 && (
            <div className="mb-3">
              <p className="label mb-1 flex items-center gap-1 px-1"><GitCommitHorizontal size={12} /> Alterações ({git.changes.length})</p>
              <ul>
                {git.changes.map((change) => (
                  <li key={change.path}>
                    <button type="button" onClick={() => void openDiff(change.path)} className="flex h-6 w-full items-center gap-1.5 rounded px-1 text-left text-xs hover:bg-hover" title={GIT_LABEL[change.status] ?? change.status}>
                      <span className={`w-3 shrink-0 text-center font-mono text-[11px] ${change.status === 'D' ? 'text-danger' : change.status === 'M' ? 'text-amber' : 'text-ok'}`}>{change.status === '?' ? 'A' : change.status}</span>
                      <span className="truncate">{change.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="label mb-1 px-1">Pastas</p>
          <ul>{root.map((entry) => <TreeNode key={entry.path} entry={entry} depth={0} selected={file?.path ?? null} onSelect={(path) => void open(path)} projectId={projectId} />)}</ul>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {!file ? (
            <Empty title="Escolha um arquivo" icon={<File size={26} />}>Os arquivos alterados pelos agentes aparecem no topo da lista.</Empty>
          ) : (
            <>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</code>
                {mode === 'file' && file.size > 0 && <span className="text-[11px] text-muted">{formatBytes(file.size)}</span>}
                {mode === 'diff' && <IconButton label="Abrir o arquivo" onClick={() => void open(file.path)}><File size={13} /></IconButton>}
                {mode === 'file' && file.content !== null && (
                  <Button
                    size="sm"
                    kind={dirty ? 'primary' : 'outline'}
                    disabled={!dirty}
                    onClick={async () => {
                      await run(() => api.put(`/api/projects/${projectId}/file`, { path: file.path, content: draft }), 'Arquivo salvo.');
                      setFile({ ...file, content: draft });
                      void reload();
                    }}
                  >
                    <Save size={13} /> Salvar
                  </Button>
                )}
              </div>
              {mode === 'diff' ? (
                <pre className="min-h-0 flex-1 overflow-auto bg-bg p-3 font-mono text-xs leading-relaxed">
                  {(diff ?? '').split('\n').map((line, index) => (
                    <div key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'text-ok' : line.startsWith('-') && !line.startsWith('---') ? 'text-danger' : line.startsWith('@@') ? 'text-think' : 'text-soft'}>{line || ' '}</div>
                  ))}
                  {!diff && <span className="text-muted">Arquivo novo, ainda sem histórico no Git.</span>}
                </pre>
              ) : file.content === null ? (
                <Empty title={file.reason ?? 'Não é possível abrir'} />
              ) : (
                <textarea
                  aria-label={`Conteúdo de ${file.path}`}
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-0 flex-1 resize-none bg-bg p-3 font-mono text-[12.5px] leading-relaxed outline-none"
                  style={{ tabSize: 2, whiteSpace: 'pre', overflowWrap: 'normal' }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

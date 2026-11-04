import { BookOpen, Download, FolderGit2, FolderOpen, GitBranch, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { MemoryItem, Project } from '@xinoia/shared';
import { api } from '../api.ts';
import { Button, Dialog, Empty, Field, IconButton, PageHeader } from '../components/ui.tsx';
import { useStore } from '../store.ts';

function AddProject({ onClose }: { onClose: () => void }) {
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const setProject = useStore((state) => state.setProject);
  const [mode, setMode] = useState<'folder' | 'new' | 'clone'>('folder');
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const chosen = await window.xinoia?.pickFolder?.();
    if (chosen) setPath(chosen);
  };

  const submit = async () => {
    setBusy(true);
    const created = await run(() => (mode === 'clone'
      ? api.post<Project>('/api/projects/clone', { url, path, name: name || undefined })
      : api.post<Project>('/api/projects', { path, name: name || undefined, create: mode === 'new' })));
    setBusy(false);
    if (created) {
      await loadCatalog();
      await setProject(created.id);
      onClose();
    }
  };

  return (
    <Dialog
      title="Adicionar projeto"
      onClose={onClose}
      width={560}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>Cancelar</Button>
          <Button kind="primary" disabled={busy || !path.trim() || (mode === 'clone' && !url.trim())} onClick={() => void submit()}>
            {busy ? 'Aguarde…' : mode === 'clone' ? 'Clonar' : mode === 'new' ? 'Criar' : 'Adicionar'}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {([['folder', FolderOpen, 'Pasta existente'], ['new', Plus, 'Pasta nova'], ['clone', Download, 'Clonar do Git']] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-[13px] transition-colors ${mode === value ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover'}`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        {mode === 'clone' && (
          <Field label="Endereço do repositório">
            <input autoFocus className="field" placeholder="https://github.com/usuario/projeto.git" value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>
        )}
        <Field label={mode === 'clone' ? 'Clonar para a pasta' : 'Caminho da pasta'} hint="Caminho completo, como D:\projetos\meu-app.">
          <div className="flex gap-2">
            <input autoFocus={mode !== 'clone'} className="field" value={path} onChange={(event) => setPath(event.target.value)} />
            {window.xinoia?.pickFolder && <Button onClick={() => void pick()}><FolderOpen size={13} /> Escolher</Button>}
          </div>
        </Field>
        <Field label="Nome (opcional)">
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function MemoryDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const run = useStore((state) => state.run);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryItem['kind']>('note');
  const reload = useCallback(async () => {
    setItems((await run(() => api.get<MemoryItem[]>(`/api/projects/${project.id}/memory`))) ?? []);
  }, [project.id, run]);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Dialog title={`Memória de ${project.name}`} onClose={onClose} width={620}>
      <p className="text-[13px] text-muted">Tudo aqui é passado aos agentes neste projeto. Decisões marcadas por eles entram sozinhas.</p>
      <div className="mt-3 flex gap-2">
        <select aria-label="Tipo" className="field !w-auto" value={kind} onChange={(event) => setKind(event.target.value as MemoryItem['kind'])}>
          <option value="note">Nota</option>
          <option value="decision">Decisão</option>
        </select>
        <input aria-label="Texto" className="field" value={text} placeholder="Ex.: todo texto da interface fica em português" onChange={(event) => setText(event.target.value)} />
        <Button
          disabled={!text.trim()}
          onClick={async () => {
            await run(() => api.post(`/api/projects/${project.id}/memory`, { kind, text }));
            setText('');
            await reload();
          }}
        >
          Adicionar
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 py-2 text-[13px]">
            <span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] ${item.kind === 'decision' ? 'bg-accent-soft text-accent' : 'bg-hover text-muted'}`}>{item.kind === 'decision' ? 'decisão' : 'nota'}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}{item.source && <span className="text-xs text-muted"> ({item.source})</span>}</span>
            <IconButton label="Remover" onClick={async () => { await run(() => api.delete(`/api/memory/${item.id}`)); await reload(); }}><Trash2 size={13} /></IconButton>
          </li>
        ))}
        {!items.length && <li className="py-4 text-center text-[13px] text-muted">Nada registrado ainda.</li>}
      </ul>
    </Dialog>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const projectId = useStore((state) => state.projectId);
  const setProject = useStore((state) => state.setProject);
  const setView = useStore((state) => state.setView);
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [removing, setRemoving] = useState(false);
  const [memory, setMemory] = useState(false);
  const current = projectId === project.id;
  return (
    <article className={`rise rounded-xl border bg-panel p-3.5 ${current ? 'border-accent' : 'border-line'}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[15px] font-semibold">{project.name}</h2>
          <p className="truncate font-mono text-[11px] text-muted" title={project.path}>{project.path}</p>
        </div>
        <IconButton label="Memória do projeto" onClick={() => setMemory(true)}><BookOpen size={13} /></IconButton>
        <IconButton label="Examinar de novo" onClick={async () => { await run(() => api.post(`/api/projects/${project.id}/refresh`)); await loadCatalog(); }}><RefreshCw size={13} /></IconButton>
        <IconButton label={`Remover ${project.name}`} onClick={() => setRemoving(true)}><Trash2 size={13} /></IconButton>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
        {project.info.isGit
          ? <span className="flex items-center gap-1 rounded bg-hover px-1.5 py-0.5"><GitBranch size={11} />{project.info.branch ?? 'sem commits'}</span>
          : <span className="rounded bg-amber-soft px-1.5 py-0.5 text-amber" title="Sem Git, não há como desfazer o que os agentes alterarem">Sem Git</span>}
        {project.info.stack.map((item) => <span key={item} className="rounded bg-hover px-1.5 py-0.5 text-soft">{item}</span>)}
      </div>
      <div className="mt-3 border-t border-line pt-2.5">
        {current
          ? <span className="text-xs font-medium text-accent">Projeto aberto</span>
          : <Button size="sm" onClick={async () => { await setProject(project.id); setView('chat'); }}>Abrir</Button>}
      </div>
      {memory && <MemoryDialog project={project} onClose={() => setMemory(false)} />}
      {removing && (
        <Dialog
          title={`Remover ${project.name}?`}
          onClose={() => setRemoving(false)}
          footer={(
            <>
              <Button kind="ghost" onClick={() => setRemoving(false)}>Manter</Button>
              <Button
                kind="danger"
                onClick={async () => {
                  await run(() => api.delete(`/api/projects/${project.id}`), 'Projeto removido do XinoIA.');
                  if (current) await setProject(null);
                  await loadCatalog();
                  setRemoving(false);
                }}
              >
                Remover do XinoIA
              </Button>
            </>
          )}
        >
          <p className="text-[13px] text-soft">Apaga conversas, tarefas e histórico deste projeto no XinoIA. A pasta e os arquivos não são tocados.</p>
        </Dialog>
      )}
    </article>
  );
}

export function ProjectsView() {
  const projects = useStore((state) => state.projects);
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Projetos"
        subtitle="Cada projeto tem suas próprias conversas, tarefas, histórico e memória"
        actions={<Button kind="primary" onClick={() => setAdding(true)}><Plus size={14} /> Adicionar projeto</Button>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {projects.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3">
            {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        ) : (
          <Empty title="Nenhum projeto ainda" icon={<FolderGit2 size={28} />} action={<Button kind="primary" onClick={() => setAdding(true)}>Adicionar o primeiro projeto</Button>}>
            Aponte para uma pasta, crie uma nova ou clone um repositório. Os agentes trabalham nos arquivos dela.
          </Empty>
        )}
      </div>
      {adding && <AddProject onClose={() => setAdding(false)} />}
    </div>
  );
}

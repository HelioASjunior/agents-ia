import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Play, Plus, Save, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mission, RoleId, Workflow, WorkflowNode } from '@xinoia/shared';
import { ROLES } from '@xinoia/shared';
import { api } from '../api.ts';
import { Button, Dialog, Empty, Field, PageHeader } from '../components/ui.tsx';
import { useStore } from '../store.ts';

type StepData = WorkflowNode & Record<string, unknown>;
type StepNode = Node<StepData, 'step'>;

const RUN_IF_LABEL: Record<WorkflowNode['runIf'], string> = {
  always: 'Sempre',
  approved: 'Só se a revisão aprovar',
  rejected: 'Só se a revisão reprovar',
};

function StepView({ data, selected }: NodeProps<StepNode>) {
  const agent = useStore((state) => state.agents.find((item) => item.id === data.agentId));
  return (
    <div className={`w-52 rounded-lg border bg-raised px-3 py-2 text-ink transition-colors ${selected ? 'border-accent' : 'border-line-strong'}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-line-strong !bg-accent" />
      <p className="truncate text-[13px] font-semibold">{data.title}</p>
      <p className="truncate text-[11px] text-muted">{agent ? agent.name : ROLES[data.role].label}</p>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
        {data.type === 'review' && <span className="rounded bg-hover px-1 text-review">revisão</span>}
        {data.runIf !== 'always' && <span className="rounded bg-amber-soft px-1 text-amber">{data.runIf === 'approved' ? 'se aprovado' : 'se reprovado'}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-line-strong !bg-accent" />
    </div>
  );
}

const nodeTypes = { step: StepView };

const toNodes = (workflow: Workflow): StepNode[] => workflow.nodes.map((node) => ({
  id: node.id,
  type: 'step',
  position: { x: node.x, y: node.y },
  data: node as StepData,
}));

const toEdges = (workflow: Workflow): Edge[] => workflow.edges.map((edge) => ({
  id: `${edge.source}-${edge.target}`,
  source: edge.source,
  target: edge.target,
  markerEnd: { type: MarkerType.ArrowClosed },
}));

function RunDialog({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const projectId = useStore((state) => state.projectId);
  const run = useStore((state) => state.run);
  const setView = useStore((state) => state.setView);
  const loadMission = useStore((state) => state.loadMission);
  const [goal, setGoal] = useState('');
  const [concurrency, setConcurrency] = useState(1);
  return (
    <Dialog
      title={`Executar: ${workflow.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            kind="primary"
            disabled={!goal.trim() || !projectId}
            onClick={async () => {
              const mission = await run(() => api.post<Mission>(`/api/workflows/${workflow.id}/run`, { projectId, goal, settings: { concurrency } }));
              if (mission) {
                await loadMission(mission.id);
                onClose();
                setView('board');
              }
            }}
          >
            <Play size={13} /> Executar
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="Objetivo">
          <textarea autoFocus rows={4} className="field" value={goal} onChange={(event) => setGoal(event.target.value)} />
        </Field>
        <Field label="Tarefas ao mesmo tempo" hint="Acima de 1, cada tarefa trabalha em um worktree próprio se o projeto usar Git.">
          <input type="number" min={1} max={8} className="field" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value) || 1)} />
        </Field>
        {!projectId && <p className="text-[13px] text-amber">Abra um projeto antes de executar.</p>}
      </div>
    </Dialog>
  );
}

function Inspector({ node, onChange, onRemove, readOnly }: { node: StepNode; onChange: (change: Partial<WorkflowNode>) => void; onRemove: () => void; readOnly: boolean }) {
  const agents = useStore((state) => state.agents);
  const { data } = node;
  return (
    <aside className="w-72 shrink-0 space-y-3 overflow-y-auto border-l border-line bg-panel p-4" aria-label="Detalhes da etapa">
      <h2 className="label">Etapa</h2>
      <fieldset disabled={readOnly} className="space-y-3">
        <Field label="Título"><input className="field" value={data.title} onChange={(event) => onChange({ title: event.target.value })} /></Field>
        <Field label="O que fazer"><textarea rows={5} className="field" value={data.description} onChange={(event) => onChange({ description: event.target.value })} /></Field>
        <Field label="Função" hint="Quem executa é o primeiro agente da equipe com esta função.">
          <select className="field" value={data.role} onChange={(event) => onChange({ role: event.target.value as RoleId })}>
            {Object.entries(ROLES).map(([id, role]) => <option key={id} value={id}>{role.label}</option>)}
          </select>
        </Field>
        <Field label="Agente específico">
          <select className="field" value={data.agentId ?? ''} onChange={(event) => onChange({ agentId: event.target.value || null })}>
            <option value="">Escolher pela função</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo">
          <select className="field" value={data.type} onChange={(event) => onChange({ type: event.target.value as WorkflowNode['type'] })}>
            <option value="work">Trabalho</option>
            <option value="review">Revisão (aprova ou reprova)</option>
          </select>
        </Field>
        <Field label="Condição">
          <select className="field" value={data.runIf} onChange={(event) => onChange({ runIf: event.target.value as WorkflowNode['runIf'] })}>
            {Object.entries(RUN_IF_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <Field label="Tentativas em caso de falha">
          <input type="number" min={1} max={5} className="field" value={data.maxAttempts} onChange={(event) => onChange({ maxAttempts: Number(event.target.value) || 1 })} />
        </Field>
        <Button kind="danger" size="sm" onClick={onRemove}><Trash2 size={13} /> Remover etapa</Button>
      </fieldset>
    </aside>
  );
}

function Editor({ workflow, onSaved }: { workflow: Workflow; onSaved: (saved: Workflow) => void }) {
  const run = useStore((state) => state.run);
  const theme = useStore((state) => state.theme);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(toNodes(workflow));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(workflow));
  const [name, setName] = useState(workflow.name);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const selected = nodes.find((node) => node.id === selectedId);
  const readOnly = workflow.builtin;
  const flow = useRef<ReactFlowInstance<StepNode, Edge> | null>(null);
  const area = useRef<HTMLDivElement>(null);

  // Mostra o fluxo inteiro também quando os painéis ao lado mudam de tamanho.
  useEffect(() => {
    if (!area.current) return undefined;
    const observer = new ResizeObserver(() => {
      void flow.current?.fitView({ padding: 0.2, maxZoom: 1 });
    });
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((list) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, list));
  }, [setEdges]);

  const addStep = () => {
    const id = `etapa-${Date.now()}`;
    const last = nodes.at(-1);
    setNodes((list) => [...list, {
      id,
      type: 'step',
      position: { x: (last?.position.x ?? -280) + 280, y: last?.position.y ?? 0 },
      data: { id, title: 'Nova etapa', description: '', role: 'developer', type: 'work', runIf: 'always', maxAttempts: 2, x: 0, y: 0, agentId: null } as StepData,
    }]);
    setSelectedId(id);
  };

  const serialize = (title: string) => ({
    name: title,
    description: workflow.description,
    nodes: nodes.map((node) => ({ ...node.data, id: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) })),
    edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
  });

  const save = async () => {
    const saved = workflow.builtin
      ? await run(() => api.post<Workflow>('/api/workflows', serialize(`${name} (cópia)`)), 'Cópia salva. Agora você pode editar.')
      : await run(() => api.put<Workflow>(`/api/workflows/${workflow.id}`, serialize(name)), 'Workflow salvo.');
    if (saved) onSaved(saved);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <input aria-label="Nome do workflow" disabled={readOnly} className="field !w-64 !py-1" value={name} onChange={(event) => setName(event.target.value)} />
        {readOnly && <span className="text-xs text-muted">Modelo pronto: salve uma cópia para alterar.</span>}
        <span className="flex-1" />
        {!readOnly && <Button size="sm" onClick={addStep}><Plus size={13} /> Etapa</Button>}
        <Button size="sm" onClick={() => void save()}>{readOnly ? <><Copy size={13} /> Salvar cópia</> : <><Save size={13} /> Salvar</>}</Button>
        <Button size="sm" kind="primary" onClick={() => setRunning(true)}><Play size={13} /> Executar</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={area} className="min-w-0 flex-1">
          <ReactFlow
            onInit={(instance) => { flow.current = instance; }}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesConnectable={!readOnly}
            colorMode={theme}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          >
            <Background gap={24} color="var(--line)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {selected && (
          <Inspector
            node={selected}
            readOnly={readOnly}
            onChange={(change) => setNodes((list) => list.map((node) => (node.id === selected.id ? { ...node, data: { ...node.data, ...change } } : node)))}
            onRemove={() => {
              setNodes((list) => list.filter((node) => node.id !== selected.id));
              setEdges((list) => list.filter((edge) => edge.source !== selected.id && edge.target !== selected.id));
              setSelectedId(null);
            }}
          />
        )}
      </div>
      {running && <RunDialog workflow={workflow} onClose={() => setRunning(false)} />}
    </div>
  );
}

export function WorkflowsView() {
  const run = useStore((state) => state.run);
  const [list, setList] = useState<Workflow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    const workflows = await run(() => api.get<Workflow[]>('/api/workflows'));
    if (workflows) {
      setList(workflows);
      setCurrentId((id) => id ?? workflows[0]?.id ?? null);
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = useMemo(() => list.find((item) => item.id === currentId), [currentId, list]);

  const createNew = async () => {
    const created = await run(() => api.post<Workflow>('/api/workflows', {
      name: 'Novo workflow',
      nodes: [{ id: 'inicio', title: 'Primeira etapa', role: 'developer' }],
      edges: [],
    }));
    if (created) {
      await reload();
      setCurrentId(created.id);
      setVersion((value) => value + 1);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Workflows" subtitle="Desenhe como a equipe trabalha, e execute quantas vezes quiser" actions={<Button kind="primary" onClick={() => void createNew()}><Plus size={14} /> Novo workflow</Button>} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-line p-2" aria-label="Lista de workflows">
          {[['Modelos prontos', list.filter((item) => item.builtin)], ['Meus workflows', list.filter((item) => !item.builtin)]].map(([title, items]) => (
            <div key={title as string} className="mb-3">
              <p className="label mb-1 px-2">{title as string}</p>
              <ul className="space-y-0.5">
                {(items as Workflow[]).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === currentId}
                      onClick={() => { setCurrentId(item.id); setVersion((value) => value + 1); }}
                      className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${item.id === currentId ? 'bg-hover' : 'hover:bg-hover/60'}`}
                    >
                      <span className="block truncate text-[13px] font-medium">{item.name}</span>
                      <span className="line-clamp-2 block text-[11px] text-muted">{item.description || `${item.nodes.length} etapas`}</span>
                    </button>
                  </li>
                ))}
                {!(items as Workflow[]).length && <li className="px-2 text-xs text-muted">Nenhum ainda.</li>}
              </ul>
            </div>
          ))}
          {current && !current.builtin && (
            <Button
              size="sm"
              kind="ghost"
              className="w-full"
              onClick={async () => {
                await run(() => api.delete(`/api/workflows/${current.id}`), 'Workflow apagado.');
                setCurrentId(null);
                await reload();
              }}
            >
              <Trash2 size={13} /> Apagar este workflow
            </Button>
          )}
        </aside>
        {current
          ? <Editor key={`${current.id}-${version}`} workflow={current} onSaved={(saved) => { void reload(); setCurrentId(saved.id); setVersion((value) => value + 1); }} />
          : <Empty title="Escolha um workflow" icon={<WorkflowIcon size={26} />} />}
      </div>
    </div>
  );
}

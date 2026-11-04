import { useEffect, useRef, useState } from 'react';
import { activeMission, useStore } from '../../store.ts';
import { OfficeScene } from './scene.ts';

/** A cena viva do escritório, ligada ao estado real. Serve à tela cheia e à telinha. */
export function OfficeCanvas({ compact = false, selected = null, onSelect }: { compact?: boolean; selected?: string | null; onSelect?: (id: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const scene = useRef<OfficeScene | null>(null);
  const seenEvents = useRef(new Set<number>());
  const agents = useStore((store) => store.agents);
  const states = useStore((store) => store.agentStates);
  const providers = useStore((store) => store.providers);
  const theme = useStore((store) => store.theme);
  const missions = useStore((store) => store.missions);
  const tasks = useStore((store) => store.tasks);
  const missionEvents = useStore((store) => store.missionEvents);

  useEffect(() => {
    if (!host.current) return undefined;
    let instance: OfficeScene;
    try {
      instance = new OfficeScene(host.current, { compact });
    } catch {
      // Sem WebGL, o resto do app continua funcionando.
      setFailed(true);
      return undefined;
    }
    instance.onSelect = (id) => onSelect?.(id);
    instance.setTheme(useStore.getState().theme);
    instance.start();
    scene.current = instance;
    return () => {
      instance.destroy();
      scene.current = null;
    };
    // A cena é criada uma vez; o que muda chega pelos efeitos abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  useEffect(() => {
    scene.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    scene.current?.setAgents(agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      color: agent.color,
      tool: providers.find((provider) => provider.id === agent.provider)?.label.split(' ')[0] ?? agent.provider,
      activity: states[agent.id]?.activity ?? 'available',
      detail: states[agent.id]?.detail ?? null,
    })));
  }, [agents, states, providers]);

  useEffect(() => {
    scene.current?.setSelected(selected);
  }, [selected]);

  const mission = activeMission(missions);
  const list = mission ? tasks[mission.id] ?? [] : [];
  useEffect(() => {
    scene.current?.setMission(mission?.goal ?? null, list.map((task) => task.status));
    // `list` é refeita a cada render; as tarefas da missão já são a dependência real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission?.goal, mission?.id, mission && tasks[mission.id]]);

  // Passagens de trabalho reais viram a caminhada até a mesa do colega.
  useEffect(() => {
    const current = mission ?? missions[0];
    if (!current) return;
    const events = missionEvents[current.id] ?? [];
    const firstRun = seenEvents.current.size === 0;
    for (const event of events) {
      if (seenEvents.current.has(event.id)) continue;
      seenEvents.current.add(event.id);
      // O que já tinha acontecido ao abrir a tela não é reencenado.
      if (firstRun) continue;
      if (event.data.type === 'handoff' && event.data.fromAgentId && event.data.toAgentId) {
        scene.current?.playHandoff(event.data.fromAgentId, event.data.toAgentId, event.data.taskTitle);
      }
    }
  }, [mission, missions, missionEvents]);

  return (
    <div ref={host} role="img" aria-label="Escritório virtual com os agentes. O modo compacto mostra as mesmas informações em uma tabela." className="absolute inset-0 overflow-hidden">
      {failed && (
        <p className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
          Este computador não conseguiu abrir o escritório em 3D. A visão Compacta mostra as mesmas informações.
        </p>
      )}
    </div>
  );
}

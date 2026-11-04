import type { AgentActivity, RoleId, TaskStatus } from '@xinoia/shared';
import {
  buildBlocked,
  COFFEE_BAR,
  COLS,
  findPath,
  HALL,
  LOUNGE_SPOTS,
  MEETING_TABLE,
  PLANTS,
  RACKS,
  ROOM_OF_ROLE,
  ROOMS,
  ROWS,
  RUG,
  SEATS,
  SOFA,
  TILE,
  WALL_BANDS,
  WALL_COLUMNS,
  type Seat,
} from './layout.ts';

// Escritório em pixel art, desenhado em canvas, sem imagens externas. Nada aqui decide
// o que um agente faz: a cena só representa o estado recebido de fora, que vem dos
// eventos reais do backend. Quem está trabalhando vai para a mesa; quem está disponível
// fica na copa. A tela do monitor, os balões e a caminhada seguem esse estado.

const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;
const WALK_SPEED = 3.4;
// Pixel art não precisa de 60 quadros, e o app roda ao lado de agentes que usam a CPU.
const FRAME_MS = 1000 / 24;
const COMPACT_FRAME_MS = 1000 / 12;
const FONT = "'Cascadia Mono','Consolas',ui-monospace,monospace";

export interface SceneAgent {
  id: string;
  name: string;
  role: RoleId;
  color: string;
  /** Nome curto da ferramenta que este agente usa. */
  tool: string;
  activity: AgentActivity;
  detail: string | null;
}

const STATE_COLORS: Record<AgentActivity, string> = {
  available: '#9aa6b4',
  thinking: '#7fb2ff',
  executing: '#2dd4bf',
  waiting: '#f5b544',
  reviewing: '#bda6ff',
  error: '#ff6b6b',
  finished: '#5ee08f',
};

const SKINS = ['#f2c9a5', '#e0a97f', '#c58a5f', '#9c6644', '#7a4f36', '#f6d7bc'];
const HAIRS = ['#2b2118', '#4a2f1b', '#7a4b24', '#d6a94a', '#1d1d24', '#a8432f', '#c4c7cd'];
const PANTS = ['#2f3a57', '#3b3347', '#2d4a4a', '#4a3b2d'];

function hash(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function shade(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * factor)));
  return `rgb(${clamp((value >> 16) & 255)},${clamp((value >> 8) & 255)},${clamp(value & 255)})`;
}

type Facing = 'down' | 'up' | 'left' | 'right';

interface Step {
  kind: 'walk' | 'wait';
  x?: number;
  y?: number;
  seconds?: number;
  carrying?: boolean;
  bubble?: string;
}

interface Actor extends SceneAgent {
  /** Em ladrilhos: o centro do ladrilho x fica em x + 0,5. */
  x: number;
  y: number;
  facing: Facing;
  seat: Seat | null;
  spot: [number, number] | null;
  path: Array<{ x: number; y: number }>;
  goal: string | null;
  script: Step[];
  waited: number;
  carrying: boolean;
  scriptBubble: string | null;
  walkPhase: number;
  hop: number;
  wanderIn: number;
  skin: string;
  hair: string;
  pants: string;
  hairStyle: number;
}

interface Floors {
  base: string;
  alt: string;
  line: string;
}

const FLOORS: Record<string, Floors> = {
  planning: { base: '#5f7fa8', alt: '#587799', line: '#4e6c8e' },
  architecture: { base: '#8a78b5', alt: '#8170ab', line: '#74649c' },
  monitoring: { base: '#55636f', alt: '#4d5b66', line: '#434f59' },
  development: { base: '#b98d5e', alt: '#ad8255', line: '#9a724a' },
  tests: { base: '#6fa77f', alt: '#669c76', line: '#5a8c69' },
  review: { base: '#a97aa0', alt: '#9e7196', line: '#8e6487' },
  lounge: { base: '#d8b98a', alt: '#cdae7f', line: '#bd9e70' },
};
const HALL_FLOOR: Floors = { base: '#a6adb4', alt: '#9ca3aa', line: '#8e959c' };

const C = {
  wallFace: '#d9d3c4',
  wallFaceLow: '#c4bdac',
  wallCap: '#3f4a57',
  wallCapLight: '#566373',
  deskTop: '#a9744a',
  deskFront: '#7f5535',
  deskLeg: '#5a3d27',
  monitor: '#20262e',
  screenOff: '#10151b',
  chair: '#37404c',
  chairLight: '#4a5563',
  metal: '#6f7b88',
  metalDark: '#47515c',
  leaf: '#3f9d5d',
  leafLight: '#5cc27a',
  pot: '#a86a45',
  potDark: '#85523a',
  sofa: '#c7564f',
  sofaDark: '#a2433d',
  rug: '#3d8c88',
  rugLight: '#4aa39f',
  paper: '#f4f1e6',
  ink: '#1c2530',
};

export class OfficeScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly world = document.createElement('canvas');
  private readonly wctx: CanvasRenderingContext2D;
  private readonly staticLayer = document.createElement('canvas');
  private readonly upscaled = document.createElement('canvas');
  private readonly actors = new Map<string, Actor>();
  private readonly owners = new Map<Seat, string>();
  private readonly blocked = buildBlocked();
  private readonly compact: boolean;
  private mode: 'dark' | 'light' = 'dark';
  private staticDirty = true;
  private missionTitle: string | null = null;
  private taskStatuses: TaskStatus[] = [];
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private userMoved = false;
  private width = 0;
  private height = 0;
  private frame = 0;
  private lastFrame = 0;
  private running = false;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private dragging: { x: number; y: number; moved: boolean } | null = null;
  private readonly observer: ResizeObserver;
  onSelect: ((id: string | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options: { compact?: boolean } = {}) {
    this.canvas = canvas;
    this.compact = Boolean(options.compact);
    this.ctx = canvas.getContext('2d')!;
    this.world.width = WORLD_W;
    this.world.height = WORLD_H;
    this.wctx = this.world.getContext('2d')!;
    this.staticLayer.width = WORLD_W;
    this.staticLayer.height = WORLD_H;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.resize();
    if (!this.compact) {
      canvas.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
      canvas.addEventListener('dblclick', this.resetView);
    }
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.resetView);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const interval = this.compact ? COMPACT_FRAME_MS : FRAME_MS;
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      if (now - this.lastFrame < interval) return;
      const dt = Math.min(0.2, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.tick(dt);
      this.render(now);
    };
    this.frame = requestAnimationFrame(loop);
  }

  setTheme(mode: 'dark' | 'light'): void {
    if (mode !== this.mode) this.staticDirty = true;
    this.mode = mode;
  }

  setMission(title: string | null, statuses: TaskStatus[]): void {
    this.missionTitle = title;
    this.taskStatuses = statuses;
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  /** Atualiza a equipe e o estado real de cada agente. */
  setAgents(agents: SceneAgent[]): void {
    const seen = new Set<string>();
    for (const agent of agents) {
      seen.add(agent.id);
      let actor = this.actors.get(agent.id);
      if (!actor) {
        const h = hash(agent.id);
        actor = {
          ...agent,
          x: 0,
          y: 0,
          facing: 'down',
          seat: this.claimSeat(agent),
          spot: null,
          path: [],
          goal: null,
          script: [],
          waited: 0,
          carrying: false,
          scriptBubble: null,
          walkPhase: 0,
          hop: 0,
          wanderIn: 4 + (h % 8),
          skin: SKINS[h % SKINS.length]!,
          hair: HAIRS[(h >> 3) % HAIRS.length]!,
          pants: PANTS[(h >> 5) % PANTS.length]!,
          hairStyle: (h >> 7) % 4,
        };
        this.actors.set(agent.id, actor);
        // Quem já estava ali ao abrir a tela aparece no lugar, sem atravessar a sala.
        const [x, y] = this.desiredTile(actor);
        actor.x = x;
        actor.y = y;
        actor.facing = this.isWorking(actor) ? 'up' : 'down';
      } else {
        if (actor.seat && actor.seat.room !== ROOM_OF_ROLE[agent.role]) {
          this.owners.delete(actor.seat);
          actor.seat = this.claimSeat(agent);
        }
        if (agent.activity === 'finished' && actor.activity !== 'finished') actor.hop = 1;
        Object.assign(actor, agent);
      }
    }
    for (const [id, actor] of this.actors) {
      if (seen.has(id)) continue;
      if (actor.seat) this.owners.delete(actor.seat);
      this.actors.delete(id);
    }
  }

  private claimSeat(agent: SceneAgent): Seat | null {
    const free = (seat: Seat) => !this.owners.has(seat);
    const room = ROOM_OF_ROLE[agent.role];
    const seat = SEATS.find((item) => item.room === room && free(item))
      ?? SEATS.find((item) => item.room === 'development' && free(item))
      ?? SEATS.find(free)
      ?? null;
    if (seat) this.owners.set(seat, agent.id);
    return seat;
  }

  private isWorking(actor: Actor): boolean {
    return actor.activity !== 'available' && Boolean(actor.seat);
  }

  private claimSpot(actor: Actor): [number, number] {
    if (actor.spot) return actor.spot;
    const taken = new Set([...this.actors.values()].filter((other) => other !== actor && other.spot).map((other) => other.spot!.join()));
    const free = LOUNGE_SPOTS.filter((spot) => !taken.has(spot.join()));
    actor.spot = free[hash(actor.id) % Math.max(1, free.length)] ?? LOUNGE_SPOTS[0]!;
    return actor.spot;
  }

  private desiredTile(actor: Actor): [number, number] {
    if (this.isWorking(actor)) {
      actor.spot = null;
      return [actor.seat!.x, actor.seat!.y];
    }
    return this.claimSpot(actor);
  }

  /** Passagem de trabalho real: quem entregou leva o documento até quem recebe. */
  playHandoff(fromId: string, toId: string, title: string): void {
    const from = this.actors.get(fromId);
    const to = this.actors.get(toId);
    if (!from || !to || fromId === toId || this.reducedMotion || !to.seat) return;
    const target = this.freeTileNear(to.seat.x, to.seat.y);
    if (!target) return;
    from.script.push(
      { kind: 'walk', x: target.x, y: target.y, carrying: true, bubble: `Entregando: ${title}` },
      { kind: 'wait', seconds: 1.6, carrying: true, bubble: `Para ${to.name}: ${title}` },
    );
  }

  private freeTileNear(x: number, y: number): { x: number; y: number } | null {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [-2, 0]] as Array<[number, number]>) {
      if (!this.blocked.has(`${x + dx},${y + dy}`) && y + dy < ROWS - 1) return { x: x + dx, y: y + dy };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Movimento
  // -------------------------------------------------------------------------

  private walkTo(actor: Actor, x: number, y: number): void {
    actor.goal = `${x},${y}`;
    if (this.reducedMotion) {
      actor.x = x;
      actor.y = y;
      actor.path = [];
      return;
    }
    actor.path = findPath(this.blocked, Math.round(actor.x), Math.round(actor.y), x, y);
  }

  private tick(dt: number): void {
    for (const actor of this.actors.values()) {
      if (actor.hop > 0) actor.hop = Math.max(0, actor.hop - dt * 1.4);

      if (!actor.path.length && actor.script.length) {
        const step = actor.script[0]!;
        actor.carrying = Boolean(step.carrying);
        actor.scriptBubble = step.bubble ?? null;
        if (step.kind === 'walk') {
          actor.script.shift();
          this.walkTo(actor, step.x!, step.y!);
        } else {
          actor.waited += dt;
          if (actor.waited >= (step.seconds ?? 0)) {
            actor.waited = 0;
            actor.script.shift();
            actor.goal = null;
          }
        }
      } else if (!actor.script.length) {
        actor.carrying = false;
        actor.scriptBubble = null;
        const [x, y] = this.desiredTile(actor);
        if (actor.goal !== `${x},${y}`) this.walkTo(actor, x, y);
        if (!actor.path.length) {
          actor.facing = this.isWorking(actor) ? 'up' : actor.facing;
          this.wander(actor, dt);
        }
      }

      const next = actor.path[0];
      if (next) {
        const dx = next.x - actor.x;
        const dy = next.y - actor.y;
        const distance = Math.hypot(dx, dy);
        const move = WALK_SPEED * dt;
        if (distance <= move) {
          actor.x = next.x;
          actor.y = next.y;
          actor.path.shift();
        } else {
          actor.x += (dx / distance) * move;
          actor.y += (dy / distance) * move;
        }
        actor.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        actor.walkPhase += dt * 10;
      }
    }
  }

  /** Disponível é disponível: troca de lugar na copa de vez em quando, sem sair de lá. */
  private wander(actor: Actor, dt: number): void {
    if (this.isWorking(actor) || this.reducedMotion) return;
    actor.wanderIn -= dt;
    if (actor.wanderIn > 0) return;
    actor.wanderIn = 6 + Math.random() * 10;
    const taken = new Set([...this.actors.values()].filter((other) => other.spot).map((other) => other.spot!.join()));
    const free = LOUNGE_SPOTS.filter((spot) => !taken.has(spot.join()));
    if (free.length) actor.spot = free[Math.floor(Math.random() * free.length)]!;
    else actor.facing = (['down', 'left', 'right'] as Facing[])[Math.floor(Math.random() * 3)]!;
  }

  private isSeated(actor: Actor): boolean {
    return this.isWorking(actor) && !actor.path.length && !actor.script.length
      && Math.abs(actor.x - actor.seat!.x) < 0.05 && Math.abs(actor.y - actor.seat!.y) < 0.05;
  }

  // -------------------------------------------------------------------------
  // Desenho: cenário fixo
  // -------------------------------------------------------------------------

  private floor(ctx: CanvasRenderingContext2D, area: { x: number; y: number; w: number; h: number }, colors: Floors, planks: boolean): void {
    for (let i = 0; i < area.w; i += 1) {
      for (let j = 0; j < area.h; j += 1) {
        const px = (area.x + i) * TILE;
        const py = (area.y + j) * TILE;
        ctx.fillStyle = (i + j) % 2 ? colors.alt : colors.base;
        if (planks) ctx.fillStyle = j % 2 ? colors.alt : colors.base;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = colors.line;
        if (planks) {
          ctx.fillRect(px, py + TILE - 1, TILE, 1);
          if ((i + j * 3) % 3 === 0) ctx.fillRect(px, py, 1, TILE);
        } else {
          ctx.fillRect(px, py, TILE, 1);
          ctx.fillRect(px, py, 1, TILE);
        }
      }
    }
  }

  private drawStatic(): void {
    const ctx = this.staticLayer.getContext('2d')!;
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = C.wallCap;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    this.floor(ctx, HALL, HALL_FLOOR, false);
    for (const room of ROOMS) this.floor(ctx, room, FLOORS[room.id]!, room.id === 'development' || room.id === 'lounge');

    // Portas: o chão continua pela abertura da parede.
    for (const band of WALL_BANDS) {
      for (const x of band.doors) this.floor(ctx, { x, y: band.y, w: 1, h: 2 }, HALL_FLOOR, false);
    }

    // Faixas de parede: topo escuro e face clara, com rodapé.
    for (const band of WALL_BANDS) {
      for (let x = 0; x < COLS; x += 1) {
        if (band.doors.includes(x)) continue;
        const px = x * TILE;
        ctx.fillStyle = C.wallCap;
        ctx.fillRect(px, band.y * TILE, TILE, TILE);
        ctx.fillStyle = C.wallCapLight;
        ctx.fillRect(px, band.y * TILE + TILE - 2, TILE, 2);
        ctx.fillStyle = C.wallFace;
        ctx.fillRect(px, (band.y + 1) * TILE, TILE, TILE);
        ctx.fillStyle = C.wallFaceLow;
        ctx.fillRect(px, (band.y + 1) * TILE + TILE - 3, TILE, 3);
      }
    }
    for (const column of WALL_COLUMNS) {
      ctx.fillStyle = C.wallCap;
      ctx.fillRect(column.x * TILE, column.from * TILE, TILE, (column.to - column.from + 1) * TILE);
      ctx.fillStyle = C.wallCapLight;
      ctx.fillRect(column.x * TILE + 7, column.from * TILE, 2, (column.to - column.from + 1) * TILE);
    }
    ctx.fillStyle = C.wallCap;
    ctx.fillRect(0, (ROWS - 1) * TILE, WORLD_W, TILE);

    // Janelas na parede do fundo, com o céu da hora de verdade.
    const hour = new Date().getHours();
    const sky = hour < 6 || hour >= 19 ? '#1c2a4a' : hour < 8 || hour >= 17 ? '#e0a070' : '#8fcdee';
    for (const x of [11.5, 14, 16, 20, 22]) {
      const px = x * TILE;
      ctx.fillStyle = C.metalDark;
      ctx.fillRect(px, 18, 24, 12);
      ctx.fillStyle = sky;
      ctx.fillRect(px + 1, 19, 22, 10);
      ctx.fillStyle = C.metalDark;
      ctx.fillRect(px + 11, 19, 2, 10);
    }

    // Tapete da copa.
    ctx.fillStyle = C.rug;
    ctx.fillRect(RUG.x * TILE, RUG.y * TILE, RUG.w * TILE, RUG.h * TILE);
    ctx.fillStyle = C.rugLight;
    ctx.fillRect(RUG.x * TILE + 4, RUG.y * TILE + 4, RUG.w * TILE - 8, RUG.h * TILE - 8);

    // Passadeira do corredor.
    ctx.fillStyle = '#8a4b4b';
    ctx.fillRect(HALL.x * TILE, HALL.y * TILE + 8, HALL.w * TILE, 2 * TILE - 16);
    ctx.fillStyle = '#a05a5a';
    ctx.fillRect(HALL.x * TILE, HALL.y * TILE + 10, HALL.w * TILE, 2 * TILE - 20);

    // Quadro branco da sala de planejamento.
    ctx.fillStyle = C.metalDark;
    ctx.fillRect(2 * TILE - 1, 17, 7 * TILE + 2, 14);
    ctx.fillStyle = C.paper;
    ctx.fillRect(2 * TILE, 18, 7 * TILE, 12);

    // A noite é uma camada por cima: as pessoas e as telas ficam acima dela e se destacam.
    if (this.mode === 'dark') {
      ctx.fillStyle = 'rgba(14,20,48,0.38)';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
    this.staticDirty = false;
  }

  // -------------------------------------------------------------------------
  // Desenho: mobília e pessoas, ordenadas pela base
  // -------------------------------------------------------------------------

  private r(x: number, y: number, w: number, h: number, color: string): void {
    this.wctx.fillStyle = color;
    this.wctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private drawDesk(seat: Seat, now: number): void {
    const cx = seat.x * TILE + 8;
    const top = (seat.y - 1) * TILE;
    const ownerId = this.owners.get(seat);
    const owner = ownerId ? this.actors.get(ownerId) : undefined;
    // Pés e tampo da mesa.
    this.r(cx - 22, top + 13, 2, 3, C.deskLeg);
    this.r(cx + 20, top + 13, 2, 3, C.deskLeg);
    this.r(cx - 23, top + 3, 46, 8, C.deskTop);
    this.r(cx - 23, top + 3, 46, 1, shade(C.deskTop, 1.15));
    this.r(cx - 23, top + 11, 46, 3, C.deskFront);
    // Monitor.
    this.r(cx - 2, top, 4, 5, C.metalDark);
    this.r(cx - 11, top - 11, 22, 13, C.monitor);
    this.drawScreen(cx - 10, top - 10, 20, 11, owner, now);
    // Teclado, xícara e papéis.
    this.r(cx - 7, top + 6, 14, 3, C.metalDark);
    this.r(cx - 6, top + 7, 12, 1, C.metal);
    this.r(cx + 12, top + 5, 3, 3, C.paper);
    this.r(cx + 13, top + 4, 1, 1, '#b9a07a');
    this.r(cx - 19, top + 5, 7, 5, C.paper);
    this.r(cx - 18, top + 6, 5, 1, '#c9c4b5');
    this.r(cx - 18, top + 8, 4, 1, '#c9c4b5');
  }

  /** O monitor só mostra atividade quando o agente está trabalhando de verdade. */
  private drawScreen(x: number, y: number, w: number, h: number, owner: Actor | undefined, now: number): void {
    const activity = owner && this.isSeated(owner) ? owner.activity : 'available';
    if (activity === 'available') {
      this.r(x, y, w, h, C.screenOff);
      return;
    }
    const tones: Partial<Record<AgentActivity, string>> = { error: '#3a1216', finished: '#0f2a1b', waiting: '#2a220f', thinking: '#111f33' };
    this.r(x, y, w, h, tones[activity] ?? '#0c1f26');
    const accent = STATE_COLORS[activity];
    if (activity === 'error') {
      if (Math.floor(now / 400) % 2 === 0) {
        this.r(x + w / 2 - 1, y + 2, 2, 5, accent);
        this.r(x + w / 2 - 1, y + 8, 2, 2, accent);
      }
      return;
    }
    if (activity === 'finished') {
      this.r(x + 6, y + 6, 2, 2, accent);
      this.r(x + 8, y + 8, 2, 2, accent);
      this.r(x + 10, y + 6, 2, 2, accent);
      this.r(x + 12, y + 4, 2, 2, accent);
      return;
    }
    if (activity === 'waiting' || activity === 'thinking') {
      const dots = Math.floor(now / 350) % 4;
      for (let i = 0; i < dots; i += 1) this.r(x + 5 + i * 4, y + 5, 2, 2, accent);
      return;
    }
    // Linhas rolando. O texto é só desenho: o conteúdo real está no terminal ao lado.
    const scroll = this.reducedMotion ? 0 : Math.floor(now / 200);
    const seed = hash(owner!.id);
    for (let i = 0; i < 4; i += 1) {
      const n = (seed + (scroll + i) * 7) % 13;
      this.r(x + 1 + (n % 3) * 2, y + 1 + i * 2.5, 4 + (n % 11), 1, i % 2 ? accent : shade(accent, 0.7));
    }
  }

  private drawChair(x: number, y: number): void {
    this.r(x - 5, y + 8, 10, 4, C.chair);
    this.r(x - 1, y + 12, 2, 3, C.metalDark);
    this.r(x - 4, y + 15, 8, 1, C.metalDark);
  }

  private drawCharacter(actor: Actor, now: number): void {
    const cx = (actor.x + 0.5) * TILE;
    const feet = (actor.y + 1) * TILE - 2;
    const seated = this.isSeated(actor);
    const walking = actor.path.length > 0;
    const hopY = actor.hop > 0 ? Math.round(Math.sin(actor.hop * Math.PI * 3) ** 2 * 6) : 0;
    const shirt = actor.color;
    const shirtDark = shade(shirt, 0.78);

    // Sombra e seleção.
    if (actor.id === this.selectedId || actor.id === this.hoverId) {
      this.wctx.strokeStyle = actor.id === this.selectedId ? '#ffffff' : 'rgba(255,255,255,0.55)';
      this.wctx.lineWidth = 1;
      this.wctx.strokeRect(Math.round(cx) - 8.5, feet - 3.5, 17, 7);
    }
    this.r(cx - 5, feet - 1, 10, 2, 'rgba(0,0,0,0.3)');

    if (seated) {
      // De costas, sentado de frente para o monitor.
      const typing = actor.activity === 'executing' && !this.reducedMotion;
      const reading = actor.activity === 'reviewing' && !this.reducedMotion;
      const arm = typing ? Math.floor(now / 110 + hash(actor.id)) % 2 : 0;
      const nod = reading ? Math.floor(now / 900) % 2 : 0;
      const top = feet - 18;
      this.drawChair(cx, top + 2);
      this.r(cx - 5, top + 8, 10, 8, shirt);
      this.r(cx - 7, top + 9 - arm, 2, 5, shirtDark);
      this.r(cx + 5, top + 9 - (1 - arm) * (typing ? 1 : 0), 2, 5, shirtDark);
      this.drawHead(actor, cx, top + nod, 'up');
      this.r(cx - 6, top + 14, 12, 3, C.chairLight);
      return;
    }

    const legA = walking ? (Math.sin(actor.walkPhase) > 0 ? 1 : 0) : 0;
    const legB = walking ? 1 - legA : 0;
    const base = feet - hopY;
    const bob = walking ? Math.abs(Math.sin(actor.walkPhase)) > 0.7 ? 1 : 0 : 0;
    this.r(cx - 4, base - 5, 3, 5 - legA, actor.pants);
    this.r(cx + 1, base - 5, 3, 5 - legB, actor.pants);
    this.r(cx - 4, base - legA - 1, 3, 1, '#20242c');
    this.r(cx + 1, base - legB - 1, 3, 1, '#20242c');
    const bodyTop = base - 12 - bob;
    this.r(cx - 5, bodyTop, 10, 8, shirt);
    if (actor.facing === 'left' || actor.facing === 'right') {
      this.r(cx - 1, bodyTop + 1, 3, 6, shirtDark);
    } else {
      this.r(cx - 7, bodyTop + 1, 2, 6, shirtDark);
      this.r(cx + 5, bodyTop + 1, 2, 6, shirtDark);
      if (actor.facing === 'down') this.drawRoleMark(actor, cx, bodyTop);
    }
    if (actor.carrying) {
      this.r(cx - 4, bodyTop + 2, 8, 6, C.paper);
      this.r(cx - 3, bodyTop + 3, 6, 1, '#9aa3ad');
      this.r(cx - 3, bodyTop + 5, 4, 1, '#9aa3ad');
    }
    this.drawHead(actor, cx, bodyTop - 8, actor.facing);
  }

  /** Um detalhe na roupa conforme a função, para reconhecer quem é quem de relance. */
  private drawRoleMark(actor: Actor, cx: number, y: number): void {
    if (actor.role === 'coordinator') {
      this.r(cx, y, 1, 5, '#b83a3a');
    } else if (actor.role === 'tester') {
      this.r(cx - 3, y + 2, 6, 1, '#f4f1e6');
    } else if (actor.role === 'reviewer') {
      this.r(cx - 3, y + 1, 2, 2, '#f4f1e6');
    } else if (actor.role === 'architect') {
      this.r(cx - 3, y + 4, 6, 1, 'rgba(255,255,255,0.65)');
    }
  }

  private drawHead(actor: Actor, cx: number, y: number, facing: Facing): void {
    const { skin, hair, hairStyle } = actor;
    this.r(cx - 4, y, 8, 8, skin);
    if (facing === 'up') {
      this.r(cx - 5, y - 1, 10, 7, hair);
      if (hairStyle === 1) this.r(cx - 5, y + 6, 10, 3, hair);
      if (hairStyle === 2) this.r(cx - 1, y - 3, 2, 2, hair);
      return;
    }
    this.r(cx - 5, y - 1, 10, 3, hair);
    if (hairStyle === 1) {
      this.r(cx - 5, y + 2, 2, 7, hair);
      this.r(cx + 3, y + 2, 2, 7, hair);
    } else if (hairStyle === 2) {
      this.r(cx - 1, y - 3, 2, 2, hair);
      this.r(cx - 4, y - 2, 2, 1, hair);
      this.r(cx + 2, y - 2, 2, 1, hair);
    } else if (hairStyle === 3) {
      this.r(cx - 5, y + 2, 1, 2, hair);
      this.r(cx + 4, y + 2, 1, 2, hair);
    }
    const eye = '#1a1a1a';
    if (facing === 'down') {
      this.r(cx - 3, y + 4, 2, 2, eye);
      this.r(cx + 1, y + 4, 2, 2, eye);
      if (actor.role === 'reviewer') this.r(cx - 4, y + 3, 8, 1, '#6b4b2a');
      this.r(cx - 1, y + 6, 2, 1, shade(skin, 0.8));
    } else if (facing === 'left') {
      this.r(cx - 4, y + 4, 2, 2, eye);
      this.r(cx + 2, y + 2, 2, 5, hair);
    } else {
      this.r(cx + 2, y + 4, 2, 2, eye);
      this.r(cx - 4, y + 2, 2, 5, hair);
    }
  }

  private drawPlant(x: number, y: number): void {
    const px = x * TILE;
    const py = y * TILE;
    this.r(px + 4, py + 9, 8, 6, C.pot);
    this.r(px + 4, py + 13, 8, 2, C.potDark);
    this.r(px + 2, py + 1, 12, 9, C.leaf);
    this.r(px + 4, py - 2, 8, 4, C.leaf);
    this.r(px + 5, py + 1, 3, 3, C.leafLight);
    this.r(px + 9, py + 4, 3, 3, C.leafLight);
  }

  private drawMeetingTable(): void {
    const { x, y, w, h } = MEETING_TABLE;
    const px = x * TILE + 2;
    const py = y * TILE;
    const width = w * TILE - 4;
    const height = h * TILE - 5;
    this.r(px, py, width, height, C.deskTop);
    this.r(px, py, width, 1, shade(C.deskTop, 1.15));
    this.r(px, py + height, width, 4, C.deskFront);
    // Papéis e notebooks em cima da mesa.
    for (const seat of SEATS.filter((item) => item.kind === 'table')) {
      const cx = seat.x * TILE + 8;
      this.r(cx - 6, py + height - 11, 12, 8, C.monitor);
      this.r(cx - 5, py + height - 10, 10, 6, C.screenOff);
      this.r(cx - 6, py + height - 3, 12, 2, C.metal);
    }
    this.r(px + 8, py + 4, 8, 6, C.paper);
    this.r(px + width - 18, py + 4, 8, 6, C.paper);
  }

  private drawLaptopScreen(seat: Seat, now: number): void {
    const ownerId = this.owners.get(seat);
    const owner = ownerId ? this.actors.get(ownerId) : undefined;
    if (!owner || !this.isSeated(owner)) return;
    const py = MEETING_TABLE.y * TILE;
    const height = MEETING_TABLE.h * TILE - 5;
    this.drawScreen(seat.x * TILE + 3, py + height - 10, 10, 6, owner, now);
  }

  private drawRacks(now: number, running: number): void {
    const { x, y, w } = RACKS;
    for (let i = 0; i < w; i += 1) {
      const px = (x + i) * TILE + 1;
      const py = y * TILE - 12;
      this.r(px, py, 14, 27, C.metalDark);
      this.r(px, py, 14, 2, C.metal);
      for (let row = 0; row < 5; row += 1) {
        this.r(px + 2, py + 4 + row * 4, 10, 3, '#222a33');
        // As luzes acompanham o que está rodando: sem trabalho, ficam apagadas.
        const lit = running > 0 && row + i < running + 2 && (this.reducedMotion || Math.sin(now / 200 + row * 1.7 + i) > -0.2);
        this.r(px + 3, py + 5 + row * 4, 2, 1, lit ? '#2dd4bf' : '#3a4652');
        this.r(px + 7, py + 5 + row * 4, 2, 1, lit && (row + i) % 2 ? '#f5b544' : '#3a4652');
      }
    }
  }

  private drawCoffeeBar(now: number): void {
    const { x, y, w } = COFFEE_BAR;
    const px = x * TILE;
    const py = y * TILE;
    this.r(px, py + 2, w * TILE, 10, '#8c6a4c');
    this.r(px, py + 2, w * TILE, 1, '#a78260');
    this.r(px, py + 12, w * TILE, 4, '#6d5139');
    // Cafeteira.
    this.r(px + 6, py - 8, 12, 12, C.metalDark);
    this.r(px + 8, py - 6, 8, 4, C.screenOff);
    this.r(px + 9, py - 5, 2, 1, '#ff6b6b');
    if (!this.reducedMotion && Math.floor(now / 600) % 2 === 0) this.r(px + 11, py - 11, 1, 2, 'rgba(255,255,255,0.5)');
    // Xícaras e frutas.
    this.r(px + 22, py + 4, 3, 3, C.paper);
    this.r(px + 27, py + 4, 3, 3, C.paper);
    this.r(px + 35, py + 3, 10, 5, '#b0523b');
    this.r(px + 37, py + 1, 3, 3, '#e0b040');
    this.r(px + 41, py + 1, 3, 3, '#7fb24a');
  }

  private drawSofa(): void {
    const { x, y, w } = SOFA;
    const px = x * TILE;
    const py = y * TILE;
    this.r(px, py - 4, w * TILE, 8, C.sofaDark);
    this.r(px, py + 3, w * TILE, 9, C.sofa);
    this.r(px - 2, py, 4, 13, C.sofaDark);
    this.r(px + w * TILE - 2, py, 4, 13, C.sofaDark);
    for (let i = 1; i < w; i += 1) this.r(px + i * TILE, py + 3, 1, 9, C.sofaDark);
  }

  private drawWhiteboardProgress(): void {
    // Uma casa por tarefa real da missão ativa.
    const statuses = this.taskStatuses;
    const left = 2 * TILE + 4;
    statuses.slice(0, 16).forEach((status, index) => {
      const done = status === 'done' || status === 'skipped';
      const color = done ? '#3aa368' : status === 'running' ? '#e0a020' : status === 'failed' ? '#d04848' : '#c2bdae';
      this.r(left + index * 6, 25, 5, 3, color);
    });
  }

  private drawWorld(now: number): void {
    const ctx = this.wctx;
    if (this.staticDirty) this.drawStatic();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.staticLayer, 0, 0);
    this.drawWhiteboardProgress();

    const running = [...this.actors.values()].filter((actor) => ['executing', 'thinking', 'reviewing'].includes(actor.activity)).length;
    const items: Array<{ base: number; draw: () => void }> = [];
    for (const [x, y] of PLANTS) items.push({ base: (y + 1) * TILE, draw: () => this.drawPlant(x, y) });
    for (const seat of SEATS) {
      if (seat.kind === 'desk') items.push({ base: seat.y * TILE, draw: () => this.drawDesk(seat, now) });
      const owner = this.owners.get(seat);
      const occupant = owner ? this.actors.get(owner) : undefined;
      if (!occupant || !this.isSeated(occupant)) {
        items.push({ base: seat.y * TILE + 1, draw: () => this.drawChair(seat.x * TILE + 8, seat.y * TILE - 2) });
      }
    }
    items.push({
      base: (MEETING_TABLE.y + MEETING_TABLE.h) * TILE,
      draw: () => {
        this.drawMeetingTable();
        for (const seat of SEATS) if (seat.kind === 'table') this.drawLaptopScreen(seat, now);
      },
    });
    items.push({ base: (RACKS.y + RACKS.h) * TILE, draw: () => this.drawRacks(now, running) });
    items.push({ base: (COFFEE_BAR.y + 1) * TILE, draw: () => this.drawCoffeeBar(now) });
    items.push({ base: (SOFA.y + 1) * TILE, draw: () => this.drawSofa() });
    for (const actor of this.actors.values()) {
      items.push({ base: (actor.y + 1) * TILE, draw: () => this.drawCharacter(actor, now) });
    }
    items.sort((a, b) => a.base - b.base);
    for (const item of items) item.draw();
  }

  // -------------------------------------------------------------------------
  // Textos, em resolução de tela para continuarem legíveis
  // -------------------------------------------------------------------------

  private toScreen(worldX: number, worldY: number): [number, number] {
    return [this.offsetX + worldX * this.scale, this.offsetY + worldY * this.scale];
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private plate(x: number, y: number, w: number, h: number, fill: string, border: string): void {
    const { ctx } = this;
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2);
  }

  private drawSigns(): void {
    const { ctx } = this;
    if (this.scale < 1.1) return;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(9, Math.round(4.6 * this.scale))}px ${FONT}`;
    const sign = (text: string, wx: number, wy: number) => {
      const [sx, sy] = this.toScreen(wx, wy);
      const width = ctx.measureText(text).width + 10;
      const height = Math.round(7.5 * this.scale);
      ctx.fillStyle = '#26303b';
      ctx.fillRect(Math.round(sx - width / 2), Math.round(sy - height / 2), Math.round(width), height);
      ctx.fillStyle = '#f2efe4';
      ctx.fillText(text, sx, sy + 0.5);
    };
    // A placa de cada sala fica no topo da parede, onde não cobre janela nem quadro.
    for (const room of ROOMS) sign(room.title, (room.x + room.w / 2) * TILE, (room.y - 2) * TILE + 8);
    sign('XinoIA', 10.5 * TILE, 10 * TILE + 7);

    // A missão no quadro branco é real: é o objetivo em andamento.
    const [bx, by] = this.toScreen(2 * TILE + 4, 21);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1c2530';
    ctx.font = `600 ${Math.max(9, Math.round(4 * this.scale))}px ${FONT}`;
    const chars = Math.floor((7 * TILE - 8) * this.scale / ctx.measureText('m').width);
    ctx.fillText(this.truncate(this.missionTitle ?? 'Nenhuma missão ativa', chars), bx, by);
  }

  /** Procura a primeira posição livre, afastando na direção indicada até não sobrepor. */
  private place(placed: Array<{ x: number; y: number; w: number; h: number }>, x: number, y: number, w: number, h: number, step: number): number {
    let current = y;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const hit = placed.some((box) => x < box.x + box.w && x + w > box.x && current < box.y + box.h && current + h > box.y);
      if (!hit) break;
      current += step;
    }
    placed.push({ x, y: current, w, h });
    return current;
  }

  private drawLabels(now: number): void {
    const { ctx } = this;
    const ordered = [...this.actors.values()].sort((a, b) => b.y - a.y);
    const size = this.compact ? 10 : Math.max(10, Math.min(13, Math.round(5.6 * this.scale)));
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const clampX = (x: number, w: number) => Math.max(2, Math.min(this.width - w - 2, x));

    for (const actor of ordered) {
      const state = STATE_COLORS[actor.activity];
      const [sx, feetY] = this.toScreen((actor.x + 0.5) * TILE, (actor.y + 1) * TILE);
      const seated = this.isSeated(actor);
      const headY = feetY - (seated ? 20 : 22) * this.scale;

      // Plaquinha com o nome e a ferramenta. Na telinha, só de quem está trabalhando.
      if (!this.compact || actor.activity !== 'available') {
        ctx.font = `700 ${size}px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const label = this.compact ? actor.name : `${actor.name} · ${actor.tool}`;
        const width = ctx.measureText(label).width + size + 8;
        const height = size + 5;
        const x = clampX(sx - width / 2, width);
        const y = this.place(placed, x, feetY + 1, width, height, height + 1);
        ctx.fillStyle = 'rgba(18,23,30,0.9)';
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), height);
        ctx.fillStyle = state;
        ctx.fillRect(Math.round(x) + 3, Math.round(y + height / 2 - 3), 6, 6);
        ctx.fillStyle = '#f2f4f7';
        ctx.fillText(label, x + size + 2, y + height / 2 + 0.5);
      }

      // Balão: a atividade real, ou o ícone do estado.
      const icon = actor.activity === 'error' ? '!' : actor.activity === 'finished' ? '✓' : actor.activity === 'waiting' ? '?' : null;
      const bubble = actor.scriptBubble ?? (actor.activity !== 'available' && actor.detail ? actor.detail : null);
      let top = headY;
      if (bubble && !this.compact) {
        ctx.font = `${size}px ${FONT}`;
        ctx.textAlign = 'left';
        const text = this.truncate(bubble, 30);
        const w = ctx.measureText(text).width + 12;
        const h = size + 8;
        const bx = clampX(sx - w / 2, w);
        const by = this.place(placed, bx, headY - h - 6, w, h, -(h + 2));
        this.plate(bx, by, w, h, '#fbfaf5', state);
        ctx.fillStyle = state;
        ctx.fillRect(Math.round(sx) - 3, Math.round(by + h), 6, 4);
        ctx.fillStyle = '#1c2530';
        ctx.fillText(text, bx + 6, by + h / 2 + 0.5);
        top = by;
      } else if (actor.activity === 'thinking') {
        const dots = this.reducedMotion ? 3 : (Math.floor(now / 350) % 3) + 1;
        const w = this.compact ? 16 : 24;
        const h = this.compact ? 9 : 14;
        this.plate(sx - w / 2, headY - h - 3, w, h, '#fbfaf5', state);
        ctx.fillStyle = state;
        const gap = this.compact ? 4 : 6;
        for (let i = 0; i < dots; i += 1) ctx.fillRect(Math.round(sx - gap - 1 + i * gap), Math.round(headY - h / 2 - 4), 2, 2);
      }
      if (icon) {
        const iconSize = this.compact ? 12 : 17;
        const iy = top - iconSize - 3;
        this.plate(sx - iconSize / 2, iy, iconSize, iconSize, state, '#12171e');
        ctx.fillStyle = '#12171e';
        ctx.textAlign = 'center';
        ctx.font = `700 ${iconSize - 5}px ${FONT}`;
        ctx.fillText(icon, sx, iy + iconSize / 2 + 0.5);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Quadro
  // -------------------------------------------------------------------------

  private fit(): void {
    const scale = Math.min(this.width / WORLD_W, this.height / WORLD_H);
    this.scale = Math.max(0.25, Math.min(4, scale));
    this.offsetX = (this.width - WORLD_W * this.scale) / 2;
    this.offsetY = (this.height - WORLD_H * this.scale) / 2;
  }

  private readonly resetView = () => {
    this.userMoved = false;
    this.fit();
  };

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const ratio = window.devicePixelRatio || 1;
    this.width = parent.clientWidth;
    this.height = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(this.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(this.height * ratio));
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (!this.userMoved) this.fit();
  }

  private render(now: number): void {
    const { ctx } = this;
    if (!this.width || !this.height) return;
    this.drawWorld(now);

    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = this.mode === 'dark' ? '#0b0f14' : '#e9ebe6';
    ctx.fillRect(0, 0, this.width, this.height);

    // Amplia primeiro por um múltiplo inteiro, sem suavizar, e só depois ajusta ao
    // tamanho final: os pixels ficam nítidos e iguais em qualquer tamanho de janela.
    const factor = Math.max(1, Math.ceil(this.scale * ratio));
    if (this.upscaled.width !== WORLD_W * factor) {
      this.upscaled.width = WORLD_W * factor;
      this.upscaled.height = WORLD_H * factor;
    }
    const up = this.upscaled.getContext('2d')!;
    up.imageSmoothingEnabled = false;
    up.drawImage(this.world, 0, 0, this.upscaled.width, this.upscaled.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.upscaled, this.offsetX, this.offsetY, WORLD_W * this.scale, WORLD_H * this.scale);

    this.drawSigns();
    this.drawLabels(now);
  }

  // -------------------------------------------------------------------------
  // Interação
  // -------------------------------------------------------------------------

  private actorAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.offsetX) / this.scale;
    const wy = (clientY - rect.top - this.offsetY) / this.scale;
    let best: { id: string; depth: number } | null = null;
    for (const actor of this.actors.values()) {
      const cx = (actor.x + 0.5) * TILE;
      const feet = (actor.y + 1) * TILE;
      const onBody = wx > cx - 10 && wx < cx + 10 && wy > feet - 26 && wy < feet + 8;
      if (onBody && (!best || actor.y > best.depth)) best = { id: actor.id, depth: actor.y };
    }
    return best?.id ?? null;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragging = { x: event.clientX, y: event.clientY, moved: false };
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.dragging) {
      const dx = event.clientX - this.dragging.x;
      const dy = event.clientY - this.dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        this.dragging.moved = true;
        this.userMoved = true;
      }
      if (this.dragging.moved) {
        this.offsetX += dx;
        this.offsetY += dy;
        this.dragging.x = event.clientX;
        this.dragging.y = event.clientY;
      }
      return;
    }
    if (event.target !== this.canvas) {
      this.hoverId = null;
      return;
    }
    this.hoverId = this.actorAt(event.clientX, event.clientY);
    this.canvas.style.cursor = this.hoverId ? 'pointer' : 'grab';
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const drag = this.dragging;
    this.dragging = null;
    if (drag && !drag.moved && event.target === this.canvas) {
      this.onSelect?.(this.actorAt(event.clientX, event.clientY));
    }
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const next = Math.max(0.5, Math.min(6, this.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
    this.offsetX = mx - ((mx - this.offsetX) * next) / this.scale;
    this.offsetY = my - ((my - this.offsetY) * next) / this.scale;
    this.scale = next;
    this.userMoved = true;
  };
}

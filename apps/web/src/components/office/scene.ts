import type { AgentActivity, RoleId } from '@xinoia/shared';

// Escritório isométrico desenhado em canvas, sem imagens externas. Nada aqui decide o
// que um agente faz: a cena só representa o estado recebido de fora, que vem dos
// eventos reais do backend. Um agente disponível fica à mesa, sem andar à toa.

const TW = 72;
const TH = 36;
const ZH = 36;
const GRID_W = 22;
const GRID_H = 14;
const WALK_SPEED = 2.6;

export interface SceneAgent {
  id: string;
  name: string;
  role: RoleId;
  color: string;
  activity: AgentActivity;
  detail: string | null;
}

export interface SceneStats {
  running: number;
  done: number;
  failed: number;
  missionTitle: string | null;
  missionStatus: string | null;
  tasksDone: number;
  tasksTotal: number;
}

interface Palette {
  backdrop: string;
  wall: string;
  wallTop: string;
  label: string;
  tagBg: string;
  tagText: string;
  zones: Record<string, string>;
  grid: string;
  desk: string;
  chair: string;
  metal: string;
  plant: string;
  pot: string;
}

const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    backdrop: '#0b0f14',
    wall: '#232c37',
    wallTop: '#36424f',
    label: 'rgba(233,237,242,0.5)',
    tagBg: 'rgba(11,15,20,0.88)',
    tagText: '#e9edf2',
    zones: { planning: '#3c4a5c', architecture: '#454560', monitoring: '#33424f', development: '#55504a', tests: '#3f5247', review: '#51455f', hall: '#2b333d' },
    grid: 'rgba(255,255,255,0.05)',
    desk: '#8a6f55',
    chair: '#262e38',
    metal: '#5a6776',
    plant: '#3f9d6d',
    pot: '#7a5a44',
  },
  light: {
    backdrop: '#f3f4f2',
    wall: '#cfd4cc',
    wallTop: '#e4e7e0',
    label: 'rgba(23,28,34,0.36)',
    tagBg: 'rgba(255,255,255,0.94)',
    tagText: '#171c22',
    zones: { planning: '#dfe6ea', architecture: '#e3e2ee', monitoring: '#dde3e4', development: '#ece6db', tests: '#dfe9df', review: '#e9e2ec', hall: '#f0f0ea' },
    grid: 'rgba(0,0,0,0.04)',
    desk: '#b08d68',
    chair: '#8d97a3',
    metal: '#9aa3ad',
    plant: '#4aa877',
    pot: '#b58a68',
  },
};

interface Room {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROOMS: Room[] = [
  { id: 'planning', title: 'PLANEJAMENTO', x: 1, y: 1, w: 6, h: 4 },
  { id: 'architecture', title: 'ARQUITETURA', x: 8, y: 1, w: 5, h: 4 },
  { id: 'monitoring', title: 'MONITORAMENTO', x: 14, y: 1, w: 7, h: 4 },
  { id: 'development', title: 'DESENVOLVIMENTO', x: 1, y: 8, w: 9, h: 5 },
  { id: 'tests', title: 'TESTES', x: 11, y: 8, w: 4, h: 5 },
  { id: 'review', title: 'REVISÃO', x: 16, y: 8, w: 5, h: 5 },
];

const ROOM_OF_ROLE: Record<RoleId, string> = {
  coordinator: 'planning',
  architect: 'architecture',
  developer: 'development',
  frontend: 'development',
  backend: 'development',
  unreal: 'development',
  designer: 'development',
  docs: 'development',
  custom: 'development',
  tester: 'tests',
  reviewer: 'review',
};

interface Seat {
  room: string;
  x: number;
  y: number;
  /** Mesa de trabalho, ou lugar à mesa de reunião. */
  kind: 'desk' | 'table';
  ownerId: string | null;
}

function buildSeats(): Seat[] {
  const seats: Seat[] = [];
  const desks = (room: string, positions: Array<[number, number]>) => {
    for (const [x, y] of positions) seats.push({ room, x, y, kind: 'desk', ownerId: null });
  };
  for (const [x, y] of [[2, 3], [4, 3], [5, 3]] as Array<[number, number]>) seats.push({ room: 'planning', x, y, kind: 'table', ownerId: null });
  desks('architecture', [[9, 2], [11, 2], [9, 4], [11, 4]]);
  desks('development', [[2, 9], [5, 9], [8, 9], [2, 12], [5, 12], [8, 12]]);
  desks('tests', [[11, 9], [13, 9], [11, 12], [13, 12]]);
  desks('review', [[16, 9], [18, 9], [16, 12], [18, 12]]);
  desks('monitoring', [[15, 2], [15, 4], [18, 4]]);
  return seats;
}

// ---------------------------------------------------------------------------

function shade(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * factor)));
  return `rgb(${clamp((value >> 16) & 255)},${clamp((value >> 8) & 255)},${clamp(value & 255)})`;
}

function hash(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const SKINS = ['#f2c9a5', '#e0a97f', '#c58a5f', '#9c6644', '#6f4a33', '#f6d7bc'];
const HAIRS = ['#2b2118', '#4a2f1b', '#7a4b24', '#c9a24a', '#1d1d24', '#8d3b2e', '#b9bcc2'];

const STATE_COLORS: Record<AgentActivity, string> = {
  available: '#7f8b9a',
  thinking: '#7fb2ff',
  executing: '#2dd4bf',
  waiting: '#f5b544',
  reviewing: '#bda6ff',
  error: '#ff7a7a',
  finished: '#5ee08f',
};

type Facing = 'x+' | 'x-' | 'y+' | 'y-';

interface Step {
  kind: 'walk' | 'wait';
  x?: number;
  y?: number;
  seconds?: number;
  carrying?: boolean;
  bubble?: string;
}

interface Actor extends SceneAgent {
  x: number;
  y: number;
  facing: Facing;
  seat: Seat | null;
  path: Array<{ x: number; y: number }>;
  script: Step[];
  waited: number;
  carrying: boolean;
  scriptBubble: string | null;
  walkPhase: number;
  hop: number;
  lastActivity: AgentActivity;
  skin: string;
  hair: string;
}

interface Drawable {
  depth: number;
  draw: () => void;
}

export class OfficeScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly actors = new Map<string, Actor>();
  private readonly seats = buildSeats();
  private readonly blocked = new Set<string>();
  private readonly fixedBlocks = new Set<string>();
  private readonly furniture: Array<{ depth: number; draw: (now: number) => void }> = [];
  private palette: Palette = PALETTES.dark;
  private mode: 'dark' | 'light' = 'dark';
  private stats: SceneStats = { running: 0, done: 0, failed: 0, missionTitle: null, missionStatus: null, tasksDone: 0, tasksTotal: 0 };
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
  private readonly tagBoxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  onSelect: ((id: string | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.buildFurniture();
    this.refreshDeskBlocks();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.resize();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.resetView);
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
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.tick(dt);
      this.render(now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  setTheme(mode: 'dark' | 'light'): void {
    this.mode = mode;
    this.palette = PALETTES[mode];
  }

  setStats(stats: SceneStats): void {
    this.stats = stats;
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
        const seat = this.claimSeat(agent);
        const h = hash(agent.id);
        actor = {
          ...agent,
          x: seat ? seat.x + 0.5 : 11,
          y: seat ? seat.y + 0.5 : 6.5,
          facing: 'y-',
          seat,
          path: [],
          script: [],
          waited: 0,
          carrying: false,
          scriptBubble: null,
          walkPhase: 0,
          hop: 0,
          lastActivity: agent.activity,
          skin: SKINS[h % SKINS.length]!,
          hair: HAIRS[(h >> 3) % HAIRS.length]!,
        };
        this.actors.set(agent.id, actor);
      } else {
        const roomChanged = actor.seat && actor.seat.room !== ROOM_OF_ROLE[agent.role];
        if (roomChanged) {
          actor.seat!.ownerId = null;
          actor.seat = this.claimSeat(agent);
          this.goHome(actor);
        }
        if (agent.activity === 'finished' && actor.lastActivity !== 'finished') actor.hop = 1;
        actor.lastActivity = agent.activity;
        Object.assign(actor, agent);
      }
    }
    for (const [id, actor] of this.actors) {
      if (!seen.has(id)) {
        if (actor.seat) actor.seat.ownerId = null;
        this.actors.delete(id);
        this.refreshDeskBlocks();
      }
    }
  }

  private claimSeat(agent: SceneAgent): Seat | null {
    const room = ROOM_OF_ROLE[agent.role];
    const seat = this.seats.find((item) => item.room === room && !item.ownerId)
      ?? this.seats.find((item) => item.room === 'development' && !item.ownerId)
      ?? this.seats.find((item) => !item.ownerId)
      ?? null;
    if (seat) seat.ownerId = agent.id;
    this.refreshDeskBlocks();
    return seat;
  }

  /** Só quem tem mesa ocupa espaço: sala sem ninguém fica livre para passar. */
  private refreshDeskBlocks(): void {
    this.blocked.clear();
    for (const key of this.fixedBlocks) this.blocked.add(key);
    for (const seat of this.seats) {
      if (seat.kind === 'desk' && seat.ownerId) {
        this.blocked.add(`${seat.x},${seat.y - 1}`);
        this.blocked.add(`${seat.x + 1},${seat.y - 1}`);
      }
    }
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
      { kind: 'wait', seconds: 1.4, carrying: true, bubble: `Para ${to.name}: ${title}` },
      { kind: 'walk', x: from.seat?.x ?? target.x, y: from.seat?.y ?? target.y },
    );
  }

  private freeTileNear(x: number, y: number): { x: number; y: number } | null {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [2, 0]] as Array<[number, number]>) {
      if (!this.isBlocked(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return null;
  }

  private goHome(actor: Actor): void {
    if (actor.seat) this.walkTo(actor, actor.seat.x, actor.seat.y);
  }

  // -------------------------------------------------------------------------
  // Movimento
  // -------------------------------------------------------------------------

  private isBlocked(x: number, y: number): boolean {
    if (x < 1 || y < 1 || x >= GRID_W - 1 || y >= GRID_H - 1) return true;
    return this.blocked.has(`${x},${y}`);
  }

  private findPath(fromX: number, fromY: number, toX: number, toY: number): Array<{ x: number; y: number }> {
    const key = (x: number, y: number) => `${x},${y}`;
    const start = key(fromX, fromY);
    const goal = key(toX, toY);
    const came = new Map<string, string | null>([[start, null]]);
    const queue: Array<[number, number]> = [[fromX, fromY]];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      if (key(x, y) === goal) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        const nx = x + dx;
        const ny = y + dy;
        const next = key(nx, ny);
        if (came.has(next)) continue;
        if (this.isBlocked(nx, ny) && next !== goal) continue;
        came.set(next, key(x, y));
        queue.push([nx, ny]);
      }
    }
    if (!came.has(goal)) return [];
    const path: Array<{ x: number; y: number }> = [];
    let current: string | null = goal;
    while (current && current !== start) {
      const [x, y] = current.split(',').map(Number) as [number, number];
      path.unshift({ x: x + 0.5, y: y + 0.5 });
      current = came.get(current) ?? null;
    }
    return path;
  }

  private walkTo(actor: Actor, x: number, y: number): void {
    actor.path = this.findPath(Math.floor(actor.x), Math.floor(actor.y), x, y);
  }

  private tick(dt: number): void {
    for (const actor of this.actors.values()) {
      if (actor.hop > 0) actor.hop = Math.max(0, actor.hop - dt * 1.6);

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
          }
        }
      } else if (!actor.path.length && !actor.script.length) {
        actor.carrying = false;
        actor.scriptBubble = null;
        // Terminou de andar: volta ao lugar dele e olha para a mesa.
        if (actor.seat && (Math.abs(actor.x - actor.seat.x - 0.5) > 0.05 || Math.abs(actor.y - actor.seat.y - 0.5) > 0.05)) {
          this.goHome(actor);
        } else {
          actor.facing = 'y-';
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
        actor.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'x+' : 'x-') : (dy > 0 ? 'y+' : 'y-');
        actor.walkPhase += dt * 11;
      }
    }
  }

  private isSeated(actor: Actor): boolean {
    return Boolean(actor.seat) && !actor.path.length && !actor.script.length
      && Math.abs(actor.x - actor.seat!.x - 0.5) < 0.05 && Math.abs(actor.y - actor.seat!.y - 0.5) < 0.05;
  }

  // -------------------------------------------------------------------------
  // Desenho básico
  // -------------------------------------------------------------------------

  private px(x: number, y: number, z = 0): [number, number] {
    return [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z * ZH];
  }

  private poly(points: Array<[number, number, number]>, fill: string): void {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach(([x, y, z], index) => {
      const [sx, sy] = this.px(x, y, z);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  private box(x: number, y: number, z: number, w: number, d: number, h: number, color: string): void {
    this.poly([[x, y + d, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x, y + d, z]], shade(color, 0.62));
    this.poly([[x + w, y, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x + w, y, z]], shade(color, 0.8));
    this.poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], color);
  }

  // -------------------------------------------------------------------------
  // Mobília
  // -------------------------------------------------------------------------

  private block(x: number, y: number, w = 1, d = 1): void {
    for (let i = 0; i < w; i += 1) {
      for (let j = 0; j < d; j += 1) this.fixedBlocks.add(`${x + i},${y + j}`);
    }
  }

  private add(x: number, y: number, draw: (now: number) => void): void {
    this.furniture.push({ depth: x + y, draw });
  }

  private buildFurniture(): void {
    // Divisórias baixas entre as salas, com portas.
    const partitionX = (x: number, from: number, to: number, doors: number[]) => {
      for (let y = from; y < to; y += 1) {
        if (doors.includes(y)) continue;
        this.block(x, y);
        this.add(x + 0.5, y + 0.5, () => this.box(x + 0.42, y, 0, 0.16, 1, 0.55, this.palette.wallTop));
      }
    };
    const partitionY = (y: number, from: number, to: number, doors: number[]) => {
      for (let x = from; x < to; x += 1) {
        if (doors.includes(x)) continue;
        this.block(x, y);
        this.add(x + 0.5, y + 0.5, () => this.box(x, y + 0.42, 0, 1, 0.16, 0.55, this.palette.wallTop));
      }
    };
    partitionX(7, 1, 5, [3]);
    partitionX(13, 1, 5, [3]);
    partitionX(10, 8, 13, [10]);
    partitionX(15, 8, 13, [10]);
    partitionY(5, 1, 21, [3, 10, 17]);
    partitionY(7, 1, 21, [4, 12, 17]);

    // Mesa de reunião da sala de planejamento.
    this.block(2, 1, 4, 2);
    this.add(4, 2, () => {
      this.box(2.2, 1.2, 0, 0.16, 0.16, 0.55, this.palette.metal);
      this.box(5.6, 1.2, 0, 0.16, 0.16, 0.55, this.palette.metal);
      this.box(2.2, 2.6, 0, 0.16, 0.16, 0.55, this.palette.metal);
      this.box(5.6, 2.6, 0, 0.16, 0.16, 0.55, this.palette.metal);
      this.box(2, 1.05, 0.55, 3.95, 1.85, 0.1, this.palette.desk);
    });

    for (const seat of this.seats) {
      if (seat.kind === 'desk') {
        this.addDesk(seat);
      } else {
        this.add(seat.x + 0.5, seat.y + 0.5, () => this.box(seat.x + 0.22, seat.y + 0.3, 0.3, 0.56, 0.5, 0.07, this.palette.chair));
      }
    }

    // Servidores da sala de monitoramento: as luzes acompanham o que está rodando.
    this.block(19, 1, 2, 1);
    this.add(20, 2, (now) => {
      for (const x of [19, 20]) {
        this.box(x + 0.1, 1.1, 0, 0.8, 0.8, 1.8, this.palette.metal);
        for (let row = 0; row < 5; row += 1) {
          const lit = row < this.stats.running + 1 && (this.reducedMotion || Math.sin(now / 240 + row * 1.7 + x) > -0.3);
          const color = this.stats.running > 0 && lit ? '#2dd4bf' : '#2a3540';
          this.poly([
            [x + 0.2 + row * 0.12, 1.9, 1.5 - row * 0.28],
            [x + 0.3 + row * 0.12, 1.9, 1.5 - row * 0.28],
            [x + 0.3 + row * 0.12, 1.9, 1.42 - row * 0.28],
            [x + 0.2 + row * 0.12, 1.9, 1.42 - row * 0.28],
          ], color);
        }
      }
    });

    // Plantas
    for (const [x, y] of [[6, 4], [12, 1], [20, 4], [9, 12], [14, 12], [20, 12]] as Array<[number, number]>) {
      this.block(x, y);
      this.add(x + 0.5, y + 0.5, () => {
        this.box(x + 0.28, y + 0.28, 0, 0.44, 0.44, 0.4, this.palette.pot);
        this.box(x + 0.22, y + 0.22, 0.4, 0.56, 0.56, 0.4, this.palette.plant);
        this.box(x + 0.32, y + 0.32, 0.8, 0.36, 0.36, 0.34, shade(this.palette.plant, 1.14));
      });
    }
  }

  private addDesk(seat: Seat): void {
    const { x, y } = seat;
    this.add(x + 0.5, y - 0.3, (now) => {
      if (!seat.ownerId) return;
      const owner = this.actors.get(seat.ownerId);
      const { desk, metal } = this.palette;
      this.box(x - 0.3, y - 0.86, 0, 0.1, 0.1, 0.55, metal);
      this.box(x + 1.2, y - 0.86, 0, 0.1, 0.1, 0.55, metal);
      this.box(x - 0.3, y - 0.32, 0, 0.1, 0.1, 0.55, metal);
      this.box(x + 1.2, y - 0.32, 0, 0.1, 0.1, 0.55, metal);
      this.box(x - 0.4, y - 0.92, 0.55, 1.8, 0.74, 0.08, desk);
      this.box(x + 0.42, y - 0.68, 0.63, 0.16, 0.1, 0.14, metal);
      this.box(x + 0.02, y - 0.74, 0.77, 0.96, 0.08, 0.56, '#1c2530');
      this.drawScreen(x + 0.02, y - 0.66, 0.77, 0.96, 0.56, owner, now);
      this.box(x + 0.1, y - 0.46, 0.63, 0.8, 0.22, 0.02, '#3a4552');
    });
    // A cadeira vai depois da pessoa em profundidade, para o encosto cobrir as costas.
    this.add(x + 0.72, y + 0.72, () => {
      const owner = seat.ownerId ? this.actors.get(seat.ownerId) : undefined;
      if (!owner || this.isSeated(owner)) return;
      this.box(x + 0.22, y + 0.26, 0.3, 0.56, 0.5, 0.07, this.palette.chair);
      this.box(x + 0.22, y + 0.72, 0.37, 0.56, 0.07, 0.4, this.palette.chair);
      this.box(x + 0.46, y + 0.46, 0, 0.1, 0.1, 0.3, this.palette.metal);
    });
  }

  /** O monitor só mostra atividade quando o agente está trabalhando de verdade. */
  private drawScreen(x: number, y: number, z: number, w: number, h: number, owner: Actor | undefined, now: number): void {
    const activity = owner && this.isSeated(owner) ? owner.activity : 'available';
    const active = activity === 'executing' || activity === 'reviewing' || activity === 'thinking';
    const base = activity === 'error' ? '#3a1d22' : active ? '#0e1f26' : '#111820';
    this.poly([[x, y, z + h], [x + w, y, z + h], [x + w, y, z], [x, y, z]], base);
    if (!active && activity !== 'error') return;
    const accent = STATE_COLORS[activity];
    const lines = 5;
    const scroll = this.reducedMotion ? 0 : Math.floor(now / 170);
    for (let i = 0; i < lines; i += 1) {
      const seed = (hash(owner!.id) + i + scroll) % 11;
      const length = activity === 'thinking' ? 0.18 : 0.2 + (seed / 11) * 0.62;
      const ly = z + h - 0.09 - i * 0.09;
      const indent = 0.06 + (seed % 3) * 0.05;
      this.poly([
        [x + indent, y, ly],
        [x + indent + length * w, y, ly],
        [x + indent + length * w, y, ly - 0.035],
        [x + indent, y, ly - 0.035],
      ], accent);
    }
  }

  // -------------------------------------------------------------------------
  // Pessoas
  // -------------------------------------------------------------------------

  private drawActor(actor: Actor, now: number): void {
    const seated = this.isSeated(actor);
    const { x, y } = actor;
    const walking = actor.path.length > 0;
    const swing = walking ? Math.sin(actor.walkPhase) * 0.09 : 0;
    const hopZ = actor.hop > 0 ? Math.sin(actor.hop * Math.PI) * 0.35 : 0;
    const baseZ = (seated ? 0.3 : 0) + hopZ;
    const color = actor.color;
    const px = x - 0.16;
    const py = y - 0.1;

    // Sombra
    const [sx, sy] = this.px(x, y, 0);
    this.ctx.beginPath();
    this.ctx.ellipse(sx, sy, 18, 9, 0, 0, Math.PI * 2);
    this.ctx.fillStyle = this.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.14)';
    this.ctx.fill();

    if (actor.id === this.selectedId || actor.id === this.hoverId) {
      this.ctx.beginPath();
      this.ctx.ellipse(sx, sy, 26, 13, 0, 0, Math.PI * 2);
      this.ctx.strokeStyle = actor.id === this.selectedId ? actor.color : 'rgba(255,255,255,0.4)';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    if (seated) {
      this.box(x - 0.28, y - 0.24, 0.3, 0.56, 0.5, 0.07, this.palette.chair);
      this.box(x - 0.08, y - 0.04, 0, 0.1, 0.1, 0.3, this.palette.metal);
    } else {
      const dx = actor.facing[0] === 'x' ? swing : 0;
      const dy = actor.facing[0] === 'y' ? swing : 0;
      this.box(px + dx, py + 0.02 + dy, hopZ, 0.13, 0.15, 0.42, '#2f3a48');
      this.box(px + 0.2 - dx, py + 0.02 - dy, hopZ, 0.13, 0.15, 0.42, '#2f3a48');
    }

    const bodyZ = baseZ + (seated ? 0.08 : 0.42);
    const armBob = actor.activity === 'executing' && seated && !this.reducedMotion ? Math.sin(now / 90 + hash(actor.id)) * 0.03 : 0;
    this.box(px - 0.07, py + 0.03, bodyZ + 0.08 + armBob, 0.08, 0.14, 0.42, shade(color, 0.88));
    this.box(px, py, bodyZ, 0.33, 0.2, 0.56, color);
    this.box(px + 0.32, py + 0.03, bodyZ + 0.08 - armBob, 0.08, 0.14, 0.42, shade(color, 0.88));

    if (actor.carrying) {
      this.box(px + 0.02, py + 0.24, bodyZ + 0.3, 0.3, 0.05, 0.3, '#f4f4ee');
    }

    const headZ = bodyZ + 0.58;
    this.box(px + 0.02, py - 0.02, headZ, 0.29, 0.25, 0.3, actor.skin);
    this.box(px, py - 0.04, headZ + 0.23, 0.33, 0.29, 0.1, actor.hair);
    if (actor.facing === 'x+') {
      this.box(px + 0.31, py + 0.05, headZ + 0.13, 0.005, 0.05, 0.05, '#1a1a1a');
      this.box(px + 0.31, py + 0.15, headZ + 0.13, 0.005, 0.05, 0.05, '#1a1a1a');
    } else if (actor.facing === 'y+') {
      this.box(px + 0.08, py + 0.23, headZ + 0.13, 0.05, 0.005, 0.05, '#1a1a1a');
      this.box(px + 0.2, py + 0.23, headZ + 0.13, 0.05, 0.005, 0.05, '#1a1a1a');
    } else {
      this.box(px, py + 0.2, headZ + 0.05, 0.33, 0.05, 0.2, actor.hair);
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private drawOverlay(actor: Actor, now: number): void {
    const { ctx } = this;
    const [sx, sy] = this.px(actor.x, actor.y, 0);
    ctx.font = "600 11px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif";
    const nameWidth = ctx.measureText(actor.name).width;
    const tagW = nameWidth + 24;
    const tagH = 18;
    const tagX = sx - tagW / 2;
    const tagY = sy + 8;
    this.roundRect(tagX, tagY, tagW, tagH, 5);
    ctx.fillStyle = this.palette.tagBg;
    ctx.fill();
    const state = STATE_COLORS[actor.activity];
    const pulsing = ['thinking', 'executing', 'reviewing'].includes(actor.activity) && !this.reducedMotion;
    ctx.globalAlpha = pulsing ? 0.55 + 0.45 * Math.abs(Math.sin(now / 500)) : 1;
    ctx.beginPath();
    ctx.arc(tagX + 10, tagY + tagH / 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = state;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.palette.tagText;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(actor.name, tagX + 18, tagY + tagH / 2 + 0.5);
    this.tagBoxes.set(actor.id, { x: tagX, y: tagY, w: tagW, h: tagH });

    const bubble = actor.scriptBubble ?? (actor.activity !== 'available' ? actor.detail : null);
    if (bubble) {
      ctx.font = "11px 'Cascadia Code','Segoe UI',monospace";
      const text = this.truncate(bubble, 34);
      const width = ctx.measureText(text).width + 16;
      const bx = sx - width / 2;
      const by = sy - 104;
      this.roundRect(bx, by, width, 20, 6);
      ctx.fillStyle = this.palette.tagBg;
      ctx.fill();
      ctx.strokeStyle = state;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 4, by + 20);
      ctx.lineTo(sx + 4, by + 20);
      ctx.lineTo(sx, by + 25);
      ctx.closePath();
      ctx.fillStyle = state;
      ctx.fill();
      ctx.fillStyle = this.palette.tagText;
      ctx.textAlign = 'center';
      ctx.fillText(text, sx, by + 10.5);
    }

    if (actor.activity === 'error' || actor.activity === 'finished' || actor.activity === 'waiting') {
      const symbol = actor.activity === 'error' ? '!' : actor.activity === 'finished' ? '✓' : '…';
      const iy = bubble ? sy - 120 : sy - 90;
      ctx.beginPath();
      ctx.arc(sx, iy, 9, 0, Math.PI * 2);
      ctx.fillStyle = state;
      ctx.fill();
      ctx.fillStyle = '#0b0f14';
      ctx.font = "700 12px 'Segoe UI',sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText(symbol, sx, iy + 0.5);
    }
  }

  // -------------------------------------------------------------------------
  // Salas e paredes
  // -------------------------------------------------------------------------

  private drawFloor(): void {
    const { ctx, palette } = this;
    this.poly([[0, 0, 0], [GRID_W, 0, 0], [GRID_W, GRID_H, 0], [0, GRID_H, 0]], palette.zones.hall!);
    for (const room of ROOMS) {
      this.poly([[room.x, room.y, 0], [room.x + room.w, room.y, 0], [room.x + room.w, room.y + room.h, 0], [room.x, room.y + room.h, 0]], palette.zones[room.id]!);
    }
    ctx.beginPath();
    for (let x = 0; x <= GRID_W; x += 1) {
      const [ax, ay] = this.px(x, 0);
      const [bx, by] = this.px(x, GRID_H);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    for (let y = 0; y <= GRID_H; y += 1) {
      const [ax, ay] = this.px(0, y);
      const [bx, by] = this.px(GRID_W, y);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Nome das salas no chão, seguindo a perspectiva.
    for (const room of ROOMS) {
      const [lx, ly] = this.px(room.x + 0.35, room.y + room.h - 0.3);
      ctx.save();
      ctx.transform(1, 0.5, -1, 0.5, lx, ly);
      ctx.font = "700 13px 'Segoe UI Variable Display','Segoe UI',sans-serif";
      ctx.fillStyle = palette.label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(room.title, 0, -2);
      ctx.restore();
    }
  }

  private drawWalls(): void {
    const { palette } = this;
    const h = 3.2;
    this.poly([[0, 0, 0], [GRID_W, 0, 0], [GRID_W, 0, h], [0, 0, h]], shade(palette.wall, 0.86));
    this.poly([[0, 0, 0], [0, GRID_H, 0], [0, GRID_H, h], [0, 0, h]], shade(palette.wall, 0.74));
    this.poly([[-0.2, -0.2, h], [GRID_W, -0.2, h], [GRID_W, 0, h], [0, 0, h], [0, GRID_H, h], [-0.2, GRID_H, h]], palette.wallTop);
  }

  /** Desenha sobre a parede do fundo com a perspectiva dela. 40 unidades valem um ladrilho. */
  private onBackWall(x: number, z: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    const { ctx } = this;
    const [ox, oy] = this.px(x, 0, z);
    ctx.save();
    ctx.transform(TW / 2 / 40, TH / 2 / 40, 0, ZH / 40, ox, oy);
    draw(ctx);
    ctx.restore();
  }

  private drawWallScreens(): void {
    const { stats } = this;
    // Quadro da sala de planejamento: a missão atual, de verdade.
    this.onBackWall(1, 2.7, (ctx) => {
      ctx.fillStyle = this.mode === 'dark' ? '#e7ebef' : '#ffffff';
      ctx.beginPath();
      ctx.roundRect(0, 0, 240, 72, 4);
      ctx.fill();
      ctx.fillStyle = '#1c2530';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = "700 13px 'Segoe UI',sans-serif";
      ctx.fillText('MISSÃO', 10, 8);
      ctx.font = "12px 'Segoe UI',sans-serif";
      ctx.fillStyle = '#44505c';
      ctx.fillText(this.truncate(stats.missionTitle ?? 'Nenhuma missão ativa', 34), 10, 26);
      ctx.fillStyle = '#cfd6dc';
      ctx.fillRect(10, 50, 220, 10);
      if (stats.tasksTotal > 0) {
        ctx.fillStyle = '#0fa18f';
        ctx.fillRect(10, 50, 220 * (stats.tasksDone / stats.tasksTotal), 10);
      }
    });

    // Painéis da central de monitoramento, com os números reais.
    const panels: Array<[string, number, string]> = [
      ['RODANDO', stats.running, '#2dd4bf'],
      ['CONCLUÍDAS', stats.done, '#5ee08f'],
      ['FALHAS', stats.failed, '#ff7a7a'],
    ];
    panels.forEach(([label, value, color], index) => {
      this.onBackWall(14.2 + index * 2.2, 2.7, (ctx) => {
        ctx.fillStyle = '#0c1218';
        ctx.beginPath();
        ctx.roundRect(0, 0, 80, 62, 4);
        ctx.fill();
        ctx.strokeStyle = '#2a3540';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#7f8b9a';
        ctx.font = "700 9px 'Segoe UI',sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, 40, 8);
        ctx.fillStyle = color;
        ctx.font = "700 28px 'Segoe UI Variable Display','Segoe UI',sans-serif";
        ctx.fillText(String(value), 40, 22);
      });
    });

    // Janelas e relógio de verdade.
    for (const wx of [8.5, 10.6]) {
      this.onBackWall(wx, 2.7, (ctx) => {
        ctx.fillStyle = this.mode === 'dark' ? '#14202e' : '#bcd9ea';
        ctx.fillRect(0, 0, 66, 66);
        ctx.strokeStyle = this.palette.wallTop;
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, 66, 66);
        ctx.beginPath();
        ctx.moveTo(33, 0);
        ctx.lineTo(33, 66);
        ctx.moveTo(0, 33);
        ctx.lineTo(66, 33);
        ctx.stroke();
      });
    }
    this.onBackWall(6.2, 2.6, (ctx) => {
      const time = new Date();
      ctx.fillStyle = '#0c1218';
      ctx.beginPath();
      ctx.roundRect(0, 0, 46, 22, 3);
      ctx.fill();
      ctx.fillStyle = '#f5b544';
      ctx.font = "700 13px 'Cascadia Code',monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), 23, 11);
    });
  }

  // -------------------------------------------------------------------------
  // Quadro
  // -------------------------------------------------------------------------

  private fit(): void {
    const left = ((0 - GRID_H) * TW) / 2;
    const right = ((GRID_W - 0) * TW) / 2;
    const top = -3.4 * ZH;
    const bottom = ((GRID_W + GRID_H) * TH) / 2 + 40;
    const scale = Math.min(this.width / (right - left + 40), this.height / (bottom - top + 30));
    this.scale = Math.max(0.3, Math.min(1.6, scale));
    this.offsetX = (this.width - (right + left) * this.scale) / 2;
    this.offsetY = (this.height - (bottom + top) * this.scale) / 2;
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
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.palette.backdrop;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, ratio * this.offsetX, ratio * this.offsetY);

    this.drawFloor();
    this.drawWalls();
    this.drawWallScreens();

    const items: Drawable[] = this.furniture.map((item) => ({ depth: item.depth, draw: () => item.draw(now) }));
    for (const actor of this.actors.values()) {
      items.push({ depth: actor.x + actor.y + 0.01, draw: () => this.drawActor(actor, now) });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) item.draw();

    const overlay = [...this.actors.values()].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const actor of overlay) this.drawOverlay(actor, now);
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
      const [sx, sy] = this.px(actor.x, actor.y);
      const box = this.tagBoxes.get(actor.id);
      const onBody = wx > sx - 20 && wx < sx + 20 && wy > sy - 78 && wy < sy + 8;
      const onTag = box && wx > box.x && wx < box.x + box.w && wy > box.y && wy < box.y + box.h;
      if ((onBody || onTag) && (!best || actor.x + actor.y > best.depth)) best = { id: actor.id, depth: actor.x + actor.y };
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
    const next = Math.max(0.3, Math.min(2.5, this.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
    this.offsetX = mx - ((mx - this.offsetX) * next) / this.scale;
    this.offsetY = my - ((my - this.offsetY) * next) / this.scale;
    this.scale = next;
    this.userMoved = true;
  };
}

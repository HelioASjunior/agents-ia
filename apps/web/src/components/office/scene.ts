import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
  WALL_BANDS,
  WALL_COLUMNS,
  type Seat,
} from './layout.ts';

// Escritório em 3D, com modelos feitos por código, sem arquivos externos. Nada aqui decide o
// que um agente faz: a cena só representa o estado recebido de fora, que vem dos eventos
// reais do backend. Quem está trabalhando vai para a mesa; quem está disponível fica na copa.

const WALK_SPEED = 3.4;
const TALL_WALL = 3;
const LOW_WALL = 1.15;
// Proporção de boneco: maior que o tamanho real em relação à mobília, para ler bem de longe.
const BODY_SCALE = 1.32;
const SEATED_DROP = 0.2;
const HEAD_STANDING = 2.05;
const HEAD_SEATED = 1.8;
// A cena roda ao lado de agentes que usam o computador, às vezes com um editor 3D aberto.
const FRAME_MS = 1000 / 30;
const COMPACT_FRAME_MS = 1000 / 15;
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

interface Step {
  kind: 'walk' | 'wait';
  x?: number;
  y?: number;
  seconds?: number;
  carrying?: boolean;
  bubble?: string;
}

interface Body {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  paper: THREE.Mesh;
  ring: THREE.Mesh;
  shirt: THREE.MeshStandardMaterial;
  shirtDark: THREE.MeshStandardMaterial;
}

interface Actor extends SceneAgent {
  /** Em ladrilhos: o centro do ladrilho x fica em x + 0,5. */
  x: number;
  y: number;
  angle: number;
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
  body: Body;
}

interface Screen {
  seat: Seat;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  code: THREE.Texture;
}

const FLOORS: Record<string, { base: string; line: string; kind: 'wood' | 'carpet' | 'tile' }> = {
  planning: { base: '#6d8fb8', line: '#5f80a8', kind: 'carpet' },
  architecture: { base: '#9483bf', line: '#8675b0', kind: 'carpet' },
  monitoring: { base: '#5d6b78', line: '#4f5c68', kind: 'tile' },
  development: { base: '#c09468', line: '#a57c54', kind: 'wood' },
  tests: { base: '#79b089', line: '#6aa07a', kind: 'carpet' },
  review: { base: '#b083a8', line: '#a07498', kind: 'carpet' },
  lounge: { base: '#dcbd8e', line: '#c6a677', kind: 'wood' },
};

function drawFloorTexture(kind: 'wood' | 'carpet' | 'tile', base: string, line: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  if (kind === 'wood') {
    for (let row = 0; row < 4; row += 1) {
      const y = row * 32;
      ctx.fillStyle = row % 2 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, y, size, 32);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      const seam = row % 2 ? 40 : 96;
      ctx.moveTo(seam, y);
      ctx.lineTo(seam, y + 32);
      ctx.stroke();
    }
  } else if (kind === 'tile') {
    ctx.strokeRect(0, 0, size, size);
  } else {
    // Trama leve, fixa: a mesma imagem a cada abertura.
    let seed = 7;
    for (let i = 0; i < 900; i += 1) {
      seed = (seed * 16807) % 2147483647;
      ctx.fillStyle = seed % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(seed % size, (seed >> 7) % size, 2, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function drawCodeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a141a';
  ctx.fillRect(0, 0, 128, 256);
  let seed = 11;
  for (let row = 0; row < 26; row += 1) {
    seed = (seed * 16807) % 2147483647;
    let x = 6 + (seed % 4) * 7;
    const words = 1 + (seed >> 5) % 4;
    for (let word = 0; word < words && x < 118; word += 1) {
      seed = (seed * 16807) % 2147483647;
      const length = 8 + seed % 26;
      ctx.fillStyle = seed % 3 === 0 ? '#ffffff' : seed % 3 === 1 ? '#b8c4cc' : '#7f8c95';
      ctx.fillRect(x, 5 + row * 10, Math.min(length, 124 - x), 4);
      x += length + 5;
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1, 0.32);
  return texture;
}

export class OfficeScene {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly labels: CanvasRenderingContext2D;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#555555', 1);
  private readonly sun = new THREE.DirectionalLight('#ffffff', 1);
  private readonly lamps: THREE.PointLight[] = [];
  private readonly compact: boolean;
  private readonly actors = new Map<string, Actor>();
  private readonly owners = new Map<Seat, string>();
  private readonly blocked = buildBlocked();
  private readonly screens: Screen[] = [];
  private readonly leds: Array<{ material: THREE.MeshBasicMaterial; row: number; rack: number }> = [];
  private readonly windows: THREE.MeshBasicMaterial[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly boxes = new Map<string, THREE.BufferGeometry>();
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly screenOff = new THREE.MeshBasicMaterial({ color: '#0c1116', toneMapped: false });
  private readonly codeSource = drawCodeTexture();
  private boardTexture: THREE.CanvasTexture | null = null;
  private boardKey = '';
  private missionTitle: string | null = null;
  private taskStatuses: TaskStatus[] = [];
  private scale = 1;
  private fitScale = 1;
  private panX = 0;
  private panY = 0;
  private userMoved = false;
  private width = 0;
  private height = 0;
  private frame = 0;
  private lastFrame = 0;
  private running = false;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private dragging: { x: number; y: number; moved: boolean } | null = null;
  private readonly center = new THREE.Vector3(COLS / 2, 0.8, ROWS / 2);
  private readonly projected = new THREE.Vector3();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly observer: ResizeObserver;
  onSelect: ((id: string | null) => void) | null = null;

  /** Lança erro se o computador não tiver WebGL: quem chama oferece a visão compacta. */
  constructor(host: HTMLElement, options: { compact?: boolean } = {}) {
    this.host = host;
    this.compact = Boolean(options.compact);
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;display:block;touch-action:none';
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
    host.append(this.canvas, this.overlay);
    this.labels = this.overlay.getContext('2d')!;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    } catch (error) {
      this.canvas.remove();
      this.overlay.remove();
      throw error;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = !this.compact;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Vista de três quartos, um pouco mais de frente que a isométrica: as telas das mesas
    // ficam viradas para quem olha, e os personagens aparecem maiores.
    const direction = new THREE.Vector3(0.38, 1.02, 1).normalize();
    this.camera.position.copy(this.center).addScaledVector(direction, 60);
    this.camera.lookAt(this.center);
    this.camera.updateMatrixWorld();

    this.buildLights();
    this.buildFloors();
    this.buildWalls();
    this.buildFurniture();
    this.setTheme('dark');

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    if (!this.compact) {
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.canvas.addEventListener('dblclick', this.resetView);
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
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        (object.geometry as THREE.BufferGeometry).dispose();
        const material = object.material as THREE.Material & { map?: THREE.Texture | null };
        material.map?.dispose();
        material.dispose();
      }
    });
    this.renderer.dispose();
    // O navegador limita quantos contextos 3D ficam abertos.
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.overlay.remove();
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
    const dark = mode === 'dark';
    this.scene.background = new THREE.Color(dark ? '#0b0f14' : '#e9ebe6');
    this.hemi.color.set(dark ? '#8fa6d6' : '#ffffff');
    this.hemi.groundColor.set(dark ? '#3a3440' : '#b5ab9c');
    this.hemi.intensity = dark ? 1.15 : 2;
    this.sun.color.set(dark ? '#a9bde8' : '#fff1dc');
    this.sun.intensity = dark ? 1.1 : 2.6;
    // De noite, as luzes do teto é que iluminam as salas.
    for (const lamp of this.lamps) lamp.intensity = dark ? 26 : 0;
    this.renderer.toneMappingExposure = dark ? 1.05 : 1;
    const hour = new Date().getHours();
    const sky = hour < 6 || hour >= 19 ? '#25376a' : hour < 8 || hour >= 17 ? '#f0a56c' : '#9fdcff';
    for (const glass of this.windows) glass.color.set(sky);
  }

  setMission(title: string | null, statuses: TaskStatus[]): void {
    this.missionTitle = title;
    this.taskStatuses = statuses;
    this.drawBoard();
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
          angle: 0.4,
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
          body: this.buildBody(agent, h),
        };
        this.actors.set(agent.id, actor);
        // Quem já estava ali ao abrir a tela aparece no lugar, sem atravessar a sala.
        const [x, y] = this.desiredTile(actor);
        actor.x = x;
        actor.y = y;
        if (this.isWorking(actor)) actor.angle = Math.PI;
      } else {
        if (actor.seat && actor.seat.room !== ROOM_OF_ROLE[agent.role]) {
          this.owners.delete(actor.seat);
          actor.seat = this.claimSeat(agent);
        }
        if (agent.activity === 'finished' && actor.activity !== 'finished') actor.hop = 1;
        if (agent.color !== actor.color) {
          actor.body.shirt.color.set(agent.color);
          actor.body.shirtDark.color.set(agent.color).multiplyScalar(0.75);
        }
        Object.assign(actor, agent);
      }
    }
    for (const [id, actor] of this.actors) {
      if (seen.has(id)) continue;
      if (actor.seat) this.owners.delete(actor.seat);
      this.scene.remove(actor.body.root);
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
      if (!this.blocked.has(`${x + dx},${y + dy}`)) return { x: x + dx, y: y + dy };
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
      if (actor.hop > 0) actor.hop = Math.max(0, actor.hop - dt * 1.1);
      let wanted: number | null = null;

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
          wanted = this.isWorking(actor) ? Math.PI : 0.45;
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
        wanted = Math.atan2(dx, dy);
        actor.walkPhase += dt * 9;
      }

      if (wanted !== null) {
        const delta = Math.atan2(Math.sin(wanted - actor.angle), Math.cos(wanted - actor.angle));
        actor.angle += this.reducedMotion ? delta : delta * Math.min(1, dt * 10);
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
  }

  private isSeated(actor: Actor): boolean {
    return this.isWorking(actor) && !actor.path.length && !actor.script.length
      && Math.abs(actor.x - actor.seat!.x) < 0.05 && Math.abs(actor.y - actor.seat!.y) < 0.05;
  }

  // -------------------------------------------------------------------------
  // Peças
  // -------------------------------------------------------------------------

  private material(color: string, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial {
    const key = `${color}|${roughness}|${metalness}`;
    let found = this.materials.get(key);
    if (!found) {
      found = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      this.materials.set(key, found);
    }
    return found;
  }

  private add<T extends THREE.Object3D>(object: T, parent: THREE.Object3D = this.scene): T {
    parent.add(object);
    return object;
  }

  /** Caixa de cantos retos. O centro da base fica em (x, y, z). */
  private box(w: number, h: number, d: number, color: string | THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(this.unitBox, typeof color === 'string' ? this.material(color) : color);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh, parent);
  }

  /** Caixa de cantos arredondados: é o que tira a cara de blocos da mobília. */
  private soft(w: number, h: number, d: number, color: string | THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D, radius = 0.04): THREE.Mesh {
    const key = `${w}|${h}|${d}|${radius}`;
    let geometry = this.boxes.get(key);
    if (!geometry) {
      geometry = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) / 2.01));
      this.boxes.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, typeof color === 'string' ? this.material(color) : color);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh, parent);
  }

  private cylinder(radiusTop: number, radiusBottom: number, h: number, color: string, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, 16), this.material(color));
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh, parent);
  }

  private sphere(radius: number, color: string, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), this.material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return this.add(mesh, parent);
  }

  private buildLights(): void {
    this.add(this.hemi);
    this.sun.position.set(COLS / 2 + 12, 34, ROWS / 2 + 22);
    this.sun.target.position.copy(this.center);
    this.add(this.sun.target);
    if (!this.compact) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const area = this.sun.shadow.camera;
      area.left = -26;
      area.right = 26;
      area.top = 24;
      area.bottom = -24;
      area.near = 1;
      area.far = 90;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
    }
    this.add(this.sun);
    // Sem sombra própria: luz de ambiente de cada ala, para a noite não ficar chapada.
    for (const [x, z] of [[6, 4], [20, 4], [6, 15], [20, 15]] as Array<[number, number]>) {
      const lamp = new THREE.PointLight('#ffd9a8', 0, 22, 1.6);
      lamp.position.set(x, 5.5, z);
      this.lamps.push(lamp);
      this.add(lamp);
    }
  }

  private buildFloors(): void {
    const plane = (x: number, z: number, w: number, d: number, material: THREE.Material, y = 0) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x + w / 2, y, z + d / 2);
      mesh.receiveShadow = true;
      return this.add(mesh);
    };
    const textured = (kind: 'wood' | 'carpet' | 'tile', base: string, line: string, w: number, d: number) => {
      const map = drawFloorTexture(kind, base, line);
      map.repeat.set(w, d);
      return new THREE.MeshStandardMaterial({ map, roughness: kind === 'tile' ? 0.45 : 0.92 });
    };

    // Base do corredor, inclusive sob as portas.
    plane(0, 0, COLS, ROWS, textured('tile', '#aeb5bc', '#99a0a7', COLS, ROWS));
    for (const room of ROOMS) {
      const floor = FLOORS[room.id]!;
      plane(room.x, room.y, room.w, room.h, textured(floor.kind, floor.base, floor.line, room.w, room.h), 0.01);
    }
    // Passadeira do corredor.
    plane(HALL.x, HALL.y + 0.45, HALL.w, HALL.h - 0.9, this.material('#8f4d4d', 0.95), 0.02);
    plane(HALL.x, HALL.y + 0.6, HALL.w, HALL.h - 1.2, this.material('#a85e5e', 0.95), 0.025);
    // Tapete da copa.
    plane(RUG.x, RUG.y, RUG.w, RUG.h, this.material('#3a8a86', 0.95), 0.02);
    plane(RUG.x + 0.25, RUG.y + 0.25, RUG.w - 0.5, RUG.h - 0.5, this.material('#4ea9a4', 0.95), 0.025);
  }

  private wall(x0: number, z0: number, x1: number, z1: number, height: number): void {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = x0 + w / 2;
    const cz = z0 + d / 2;
    this.box(w, height, d, '#ded8ca', cx, 0, cz);
    // Topo e rodapé: é o que dá leitura de parede cortada.
    this.box(w + 0.02, 0.06, d + 0.02, '#46515e', cx, height, cz);
    this.box(w + 0.02, 0.14, d + 0.02, '#a89f90', cx, 0, cz);
  }

  private buildWalls(): void {
    // Fundo e esquerda inteiros. Frente e direita baixas, para não cobrirem nada.
    this.wall(0, 0.55, COLS, 1, TALL_WALL);
    this.wall(0.55, 1, 1, ROWS, TALL_WALL);
    this.wall(COLS - 1, 1, COLS - 0.75, ROWS, 0.3);
    this.wall(0.55, ROWS - 1, COLS - 0.75, ROWS - 0.75, 0.3);

    // Paredes internas baixas: quem está na sala aparece por cima delas.
    for (const band of WALL_BANDS) {
      if (band.y === 0 || band.y === ROWS - 1) continue;
      let start: number | null = null;
      for (let x = 1; x <= COLS - 1; x += 1) {
        const solid = x < COLS - 1 && !band.doors.includes(x);
        if (solid && start === null) start = x;
        if (!solid && start !== null) {
          this.wall(start, band.y + 0.35, x, band.y + 0.65, LOW_WALL);
          start = null;
        }
      }
    }
    for (const column of WALL_COLUMNS) this.wall(column.x + 0.35, column.from - 0.1, column.x + 0.65, column.to + 1.1, LOW_WALL);

    // Janelas de verdade na parede do fundo e na da esquerda, com o céu da hora.
    const glass = () => {
      const material = new THREE.MeshBasicMaterial({ color: '#9fdcff', toneMapped: false });
      this.windows.push(material);
      return material;
    };
    for (const x of [12.2, 15, 20, 22.6]) {
      this.box(2.1, 1.25, 0.05, '#47515c', x, 1.25, 1.02);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.1), glass());
      pane.position.set(x, 1.875, 1.05);
      this.add(pane);
      this.box(0.05, 1.1, 0.03, '#47515c', x, 1.325, 1.07);
    }
    for (const z of [10, 14, 17]) {
      this.box(0.05, 1.25, 2.1, '#47515c', 1.02, 1.25, z);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.1), glass());
      pane.rotation.y = Math.PI / 2;
      pane.position.set(1.05, 1.875, z);
      this.add(pane);
    }

    // Placas das salas: nas paredes altas, ou na parede baixa que fica atrás da sala.
    for (const room of ROOMS) {
      const top = room.y === 1;
      this.sign(room.title, room.x + room.w / 2, top ? 2.68 : 0.72, top ? 1.04 : room.y - 0.33);
    }
    this.sign('XinoIA', 10.5, 0.72, 8.67);

    // Quadro branco com a missão real.
    this.box(5.9, 1.42, 0.05, '#47515c', 5.5, 0.98, 1.02);
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 160;
    this.boardTexture = new THREE.CanvasTexture(canvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    this.boardTexture.anisotropy = 4;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.75, 1.28), new THREE.MeshBasicMaterial({ map: this.boardTexture, toneMapped: false }));
    board.position.set(5.5, 1.69, 1.06);
    this.add(board);
    this.drawBoard();
  }

  private sign(text: string, x: number, y: number, z: number): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = `700 34px ${FONT}`;
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 44;
    canvas.width = width;
    canvas.height = 58;
    ctx.fillStyle = '#26303b';
    ctx.fillRect(0, 0, width, 58);
    ctx.font = font;
    ctx.fillStyle = '#f2efe4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, 30);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry((width / 58) * 0.46, 0.46), new THREE.MeshBasicMaterial({ map: texture }));
    mesh.position.set(x, y, z);
    this.add(mesh);
  }

  /** A missão no quadro é real: é o objetivo em andamento e as tarefas dele. */
  private drawBoard(): void {
    const texture = this.boardTexture;
    if (!texture) return;
    const key = `${this.missionTitle}|${this.taskStatuses.join()}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f5f2e8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1c2530';
    ctx.textBaseline = 'top';
    ctx.font = `600 32px ${FONT}`;
    const text = this.missionTitle ?? 'Nenhuma missão ativa';
    const max = 38;
    ctx.fillText(text.length > max ? `${text.slice(0, max - 1)}…` : text, 24, 24);
    this.taskStatuses.slice(0, 18).forEach((status, index) => {
      const done = status === 'done' || status === 'skipped';
      ctx.fillStyle = done ? '#2f9d62' : status === 'running' ? '#e0a020' : status === 'failed' ? '#d04848' : '#c6c1b2';
      ctx.fillRect(24 + index * 37, 96, 30, 34);
    });
    texture.needsUpdate = true;
  }

  private addScreen(seat: Seat, mesh: THREE.Mesh): void {
    const code = this.codeSource.clone();
    code.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff', map: code, toneMapped: false });
    mesh.material = this.screenOff;
    this.screens.push({ seat, mesh, material, code });
  }

  private buildChair(group: THREE.Object3D, x: number, z: number): void {
    this.soft(0.62, 0.1, 0.58, '#37404c', x, 0.44, z, group);
    this.soft(0.58, 0.26, 0.07, '#2e3641', x, 0.54, z + 0.3, group);
    this.cylinder(0.04, 0.04, 0.36, '#6f7b88', x, 0.08, z, group);
    this.cylinder(0.24, 0.26, 0.05, '#47515c', x, 0.03, z, group);
  }

  private buildDesk(seat: Seat): void {
    const group = this.add(new THREE.Group());
    group.position.set(seat.x + 0.5, 0, seat.y - 0.5);
    this.soft(2.75, 0.08, 0.86, '#b07c50', 0, 0.72, 0, group);
    for (const [x, z] of [[-1.25, -0.32], [1.25, -0.32], [-1.25, 0.32], [1.25, 0.32]] as Array<[number, number]>) {
      this.box(0.08, 0.72, 0.08, '#5c4029', x, 0, z, group);
    }
    this.box(2.6, 0.46, 0.04, '#8a6240', 0, 0.26, -0.34, group);
    // Monitor com a tela virada para a cadeira, e para quem olha.
    this.cylinder(0.14, 0.17, 0.03, '#47515c', 0, 0.8, -0.14, group);
    this.box(0.07, 0.24, 0.05, '#47515c', 0, 0.82, -0.17, group);
    this.soft(1.22, 0.72, 0.07, '#1a2027', 0, 1.0, -0.17, group, 0.03);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.62));
    screen.position.set(0, 1.36, -0.13);
    this.add(screen, group);
    this.addScreen(seat, screen);
    // Teclado, mouse, xícara e papéis.
    this.soft(0.62, 0.025, 0.2, '#3c4652', 0, 0.8, 0.17, group, 0.01);
    this.soft(0.09, 0.03, 0.14, '#3c4652', 0.44, 0.8, 0.17, group, 0.012);
    this.cylinder(0.05, 0.045, 0.1, '#f4f1e6', 0.92, 0.8, 0.1, group);
    this.box(0.36, 0.015, 0.46, '#f4f1e6', -0.9, 0.8, 0.05, group).rotation.y = 0.12;
    this.box(0.34, 0.015, 0.44, '#dcd7c6', -0.88, 0.815, 0.03, group).rotation.y = -0.1;
    const chair = this.add(new THREE.Group());
    chair.position.set(seat.x + 0.5, 0, seat.y + 0.52);
    this.buildChair(chair, 0, 0);
  }

  private buildMeetingTable(): void {
    const { x, y, w, h } = MEETING_TABLE;
    const cx = x + w / 2;
    const cz = y + h / 2;
    this.soft(w - 0.3, 0.1, h - 0.25, '#b07c50', cx, 0.72, cz, undefined, 0.05);
    for (const [dx, dz] of [[-w / 2 + 0.5, -h / 2 + 0.45], [w / 2 - 0.5, -h / 2 + 0.45], [-w / 2 + 0.5, h / 2 - 0.45], [w / 2 - 0.5, h / 2 - 0.45]] as Array<[number, number]>) {
      this.cylinder(0.05, 0.07, 0.72, '#5c4029', cx + dx, 0, cz + dz);
    }
    for (const seat of SEATS.filter((item) => item.kind === 'table')) {
      const group = this.add(new THREE.Group());
      group.position.set(seat.x + 0.5, 0.82, y + h - 0.42);
      this.soft(0.62, 0.02, 0.42, '#6f7b88', 0, 0, 0.04, group, 0.008);
      const lid = this.soft(0.62, 0.42, 0.02, '#47515c', 0, 0.02, -0.18, group, 0.008);
      lid.rotation.x = -0.18;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36));
      screen.position.set(0, 0.23, -0.155);
      screen.rotation.x = -0.18;
      this.add(screen, group);
      this.addScreen(seat, screen);
      const chair = this.add(new THREE.Group());
      chair.position.set(seat.x + 0.5, 0, seat.y + 0.52);
      this.buildChair(chair, 0, 0);
    }
    // Pastas e um vaso no centro da mesa.
    this.box(0.46, 0.02, 0.34, '#f4f1e6', cx - 2.4, 0.82, cz - 0.3);
    this.box(0.46, 0.02, 0.34, '#dcd7c6', cx + 2.4, 0.82, cz - 0.25);
    this.cylinder(0.1, 0.08, 0.16, '#a86a45', cx, 0.82, cz - 0.3);
    this.sphere(0.17, '#4aa96c', cx, 1.12, cz - 0.3);
  }

  private buildPlant(x: number, z: number): void {
    const group = this.add(new THREE.Group());
    group.position.set(x + 0.5, 0, z + 0.5);
    this.cylinder(0.26, 0.19, 0.42, '#b06f49', 0, 0, 0, group);
    this.cylinder(0.25, 0.25, 0.02, '#3a2a1f', 0, 0.41, 0, group);
    this.cylinder(0.03, 0.04, 0.32, '#5c4029', 0, 0.42, 0, group);
    const color = hash(`${x},${z}`) % 2 ? '#3f9d5d' : '#4cae6a';
    for (const [dx, dy, dz, r] of [[0, 0.98, 0, 0.3], [0.2, 0.84, 0.1, 0.22], [-0.2, 0.86, -0.08, 0.23], [0.05, 1.18, -0.08, 0.19], [-0.08, 0.82, 0.2, 0.17]] as Array<[number, number, number, number]>) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), this.material(color));
      leaf.position.set(dx, dy, dz);
      leaf.castShadow = true;
      this.add(leaf, group);
    }
  }

  private buildRacks(): void {
    const { x, y, w } = RACKS;
    for (let i = 0; i < w; i += 1) {
      const group = this.add(new THREE.Group());
      group.position.set(x + i + 0.5, 0, y + 0.5);
      this.soft(0.9, 2.3, 0.8, '#2d353f', 0, 0, 0, group, 0.03);
      for (let row = 0; row < 7; row += 1) {
        this.box(0.74, 0.22, 0.02, '#191f26', 0, 0.28 + row * 0.28, 0.41, group);
        for (let led = 0; led < 3; led += 1) {
          const material = new THREE.MeshBasicMaterial({ color: '#2a3540', toneMapped: false });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.05), material);
          mesh.position.set(-0.26 + led * 0.14, 0.39 + row * 0.28, 0.425);
          this.add(mesh, group);
          this.leds.push({ material, row: row + led * 2, rack: i });
        }
      }
    }
  }

  private buildCoffeeBar(): void {
    const { x, y, w } = COFFEE_BAR;
    const cx = x + w / 2;
    const cz = y + 0.5;
    this.soft(w, 0.95, 0.9, '#7b5a3f', cx, 0, cz);
    this.soft(w + 0.06, 0.06, 0.96, '#e4dfd2', cx, 0.95, cz);
    this.soft(0.5, 0.62, 0.42, '#2f3741', cx - 0.9, 1.01, cz - 0.08, undefined, 0.04);
    this.box(0.26, 0.08, 0.02, '#ff6b6b', cx - 0.9, 1.45, cz + 0.135);
    this.cylinder(0.05, 0.045, 0.1, '#f4f1e6', cx - 0.25, 1.01, cz + 0.2);
    this.cylinder(0.05, 0.045, 0.1, '#f4f1e6', cx - 0.05, 1.01, cz + 0.05);
    this.cylinder(0.22, 0.14, 0.12, '#b0523b', cx + 0.75, 1.01, cz);
    this.sphere(0.08, '#e0b040', cx + 0.7, 1.15, cz);
    this.sphere(0.08, '#7fb24a', cx + 0.84, 1.15, cz + 0.04);
    this.sphere(0.08, '#d0503c', cx + 0.74, 1.16, cz - 0.1);
  }

  private buildSofa(): void {
    const { x, y, w } = SOFA;
    const cx = x + w / 2;
    const cz = y + 0.5;
    this.soft(w, 0.32, 0.9, '#a2433d', cx, 0.08, cz, undefined, 0.08);
    this.soft(w, 0.68, 0.24, '#a2433d', cx, 0.28, cz + 0.36, undefined, 0.08);
    for (let i = 0; i < w; i += 1) this.soft(0.94, 0.16, 0.66, '#c7564f', x + i + 0.5, 0.38, cz - 0.08, undefined, 0.07);
    this.soft(0.24, 0.5, 0.92, '#a2433d', x - 0.02, 0.1, cz, undefined, 0.08);
    this.soft(0.24, 0.5, 0.92, '#a2433d', x + w + 0.02, 0.1, cz, undefined, 0.08);
    // Mesinha em frente.
    this.soft(1.6, 0.06, 0.7, '#8a6240', cx, 0.4, y - 0.9);
    for (const [dx, dz] of [[-0.68, -0.26], [0.68, -0.26], [-0.68, 0.26], [0.68, 0.26]] as Array<[number, number]>) {
      this.cylinder(0.025, 0.025, 0.4, '#3c4652', cx + dx, 0, y - 0.9 + dz);
    }
  }

  private buildFurniture(): void {
    for (const seat of SEATS) if (seat.kind === 'desk') this.buildDesk(seat);
    this.buildMeetingTable();
    for (const [x, z] of PLANTS) this.buildPlant(x, z);
    this.buildRacks();
    this.buildCoffeeBar();
    this.buildSofa();
  }

  // -------------------------------------------------------------------------
  // Personagens
  // -------------------------------------------------------------------------

  private buildBody(agent: SceneAgent, h: number): Body {
    const skin = SKINS[h % SKINS.length]!;
    const hair = HAIRS[(h >> 3) % HAIRS.length]!;
    const pants = PANTS[(h >> 5) % PANTS.length]!;
    const hairStyle = (h >> 7) % 4;
    const shirt = new THREE.MeshStandardMaterial({ color: agent.color, roughness: 0.8 });
    const shirtDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(agent.color).multiplyScalar(0.75), roughness: 0.8 });

    const root = this.add(new THREE.Group());
    root.scale.setScalar(BODY_SCALE);
    const capsule = (radius: number, length: number, color: string | THREE.Material, parent: THREE.Object3D, y: number) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), typeof color === 'string' ? this.material(color) : color);
      mesh.position.y = y;
      mesh.castShadow = true;
      return this.add(mesh, parent);
    };

    const leg = (side: number) => {
      const hip = this.add(new THREE.Group(), root);
      hip.position.set(side * 0.1, 0.58, 0);
      capsule(0.085, 0.2, pants, hip, -0.14);
      const knee = this.add(new THREE.Group(), hip);
      knee.position.y = -0.29;
      capsule(0.075, 0.18, pants, knee, -0.13);
      this.soft(0.15, 0.08, 0.26, '#1f242c', 0, -0.33, 0.05, knee, 0.03);
      return { hip, knee };
    };
    const left = leg(-1);
    const right = leg(1);

    const torso = this.add(new THREE.Group(), root);
    torso.position.y = 0.58;
    this.soft(0.42, 0.5, 0.26, shirt, 0, 0, 0, torso, 0.1);

    const arm = (side: number) => {
      const shoulder = this.add(new THREE.Group(), torso);
      shoulder.position.set(side * 0.27, 0.44, 0);
      capsule(0.06, 0.26, shirtDark, shoulder, -0.17);
      this.sphere(0.065, skin, 0, -0.37, 0, shoulder);
      return shoulder;
    };
    const armL = arm(-1);
    const armR = arm(1);

    const paper = this.box(0.26, 0.3, 0.02, '#f4f1e6', 0, 0.12, 0.2, torso);
    paper.visible = false;

    // Detalhe na roupa conforme a função, para reconhecer quem é quem de relance.
    if (agent.role === 'coordinator') this.box(0.05, 0.28, 0.02, '#b83a3a', 0, 0.18, 0.135, torso);
    if (agent.role === 'tester') this.box(0.3, 0.04, 0.02, '#f4f1e6', 0, 0.3, 0.135, torso);
    if (agent.role === 'architect') this.box(0.3, 0.03, 0.02, '#f4f1e6', 0, 0.12, 0.135, torso);
    if (agent.role === 'reviewer') this.box(0.07, 0.07, 0.02, '#f4f1e6', -0.1, 0.34, 0.135, torso);

    const head = this.add(new THREE.Group(), torso);
    head.position.y = 0.72;
    this.sphere(0.2, skin, 0, 0, 0, head);
    for (const side of [-1, 1]) {
      const eye = this.sphere(0.024, '#17181c', side * 0.075, 0.015, 0.183, head);
      eye.castShadow = false;
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), this.material(hair));
    cap.position.y = 0.012;
    cap.rotation.x = -0.32;
    cap.castShadow = true;
    this.add(cap, head);
    if (hairStyle === 1) this.soft(0.34, 0.3, 0.1, hair, 0, -0.26, -0.15, head, 0.05);
    if (hairStyle === 2) this.sphere(0.09, hair, 0, 0.13, -0.2, head);
    if (hairStyle === 3) {
      for (const side of [-1, 0, 1]) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 8), this.material(hair));
        tuft.position.set(side * 0.09, 0.22, 0);
        tuft.rotation.z = -side * 0.35;
        this.add(tuft, head);
      }
    }
    if (agent.role === 'reviewer') {
      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.009, 6, 14), this.material('#3a2a1f'));
        lens.position.set(side * 0.075, 0.015, 0.186);
        this.add(lens, head);
      }
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.visible = false;
    this.add(ring, root);

    return { root, torso, head, hipL: left.hip, hipR: right.hip, kneeL: left.knee, kneeR: right.knee, armL, armR, paper, ring, shirt, shirtDark };
  }

  private pose(actor: Actor, now: number): void {
    const { body } = actor;
    const seated = this.isSeated(actor);
    const walking = actor.path.length > 0;
    const motion = !this.reducedMotion;
    const t = now / 1000;
    const seed = hash(actor.id) % 100;

    const hopY = actor.hop > 0 ? Math.abs(Math.sin(actor.hop * Math.PI * 3)) * 0.34 : 0;
    // Sentado fica um pouco atrás do centro do ladrilho, sobre a cadeira.
    body.root.position.set(actor.x + 0.5, hopY - (seated ? SEATED_DROP : 0), actor.y + (seated ? 0.52 : 0.5));
    body.root.rotation.y = actor.angle;
    body.paper.visible = actor.carrying;
    body.ring.visible = actor.id === this.selectedId || actor.id === this.hoverId;
    (body.ring.material as THREE.MeshBasicMaterial).color.set(actor.id === this.selectedId ? '#ffffff' : '#9fb0c2');

    let hipL = 0;
    let hipR = 0;
    let kneeL = 0;
    let kneeR = 0;
    let armL = 0;
    let armR = 0;
    let headX = 0;
    let headY = 0;
    let bob = 0;

    if (seated) {
      hipL = -Math.PI / 2 + 0.04;
      hipR = -Math.PI / 2 - 0.04;
      kneeL = Math.PI / 2;
      kneeR = Math.PI / 2;
      if (actor.activity === 'executing' && motion) {
        armL = -1.25 + Math.sin(t * 15 + seed) * 0.09;
        armR = -1.25 + Math.sin(t * 13 + seed + 1.4) * 0.09;
        headX = 0.08;
      } else if (actor.activity === 'reviewing') {
        armL = -1.1;
        armR = -1.1;
        headX = 0.14 + (motion ? Math.sin(t * 1.4 + seed) * 0.05 : 0);
        headY = motion ? Math.sin(t * 0.8 + seed) * 0.16 : 0;
      } else if (actor.activity === 'thinking') {
        armL = -1.1;
        armR = -2.35;
        headX = -0.08;
        headY = motion ? Math.sin(t * 0.7 + seed) * 0.2 : 0;
      } else if (actor.activity === 'waiting') {
        armL = -0.7;
        armR = motion ? -2.8 + Math.sin(t * 5 + seed) * 0.12 : -2.8;
        headX = -0.12;
      } else if (actor.activity === 'error') {
        armL = -2.5;
        armR = -2.5;
        headX = 0.2;
        headY = motion ? Math.sin(t * 7) * 0.22 : 0;
      } else if (actor.activity === 'finished') {
        armL = -2.9;
        armR = -2.9;
        headX = -0.15;
      }
    } else if (walking) {
      const swing = Math.sin(actor.walkPhase);
      hipL = swing * 0.62;
      hipR = -swing * 0.62;
      kneeL = Math.max(0, -swing) * 0.85;
      kneeR = Math.max(0, swing) * 0.85;
      armL = -swing * 0.5;
      armR = swing * 0.5;
      bob = Math.abs(swing) * 0.03;
    } else if (motion) {
      // Parado na copa: respira e olha em volta.
      bob = Math.sin(t * 1.6 + seed) * 0.008;
      armL = Math.sin(t * 1.6 + seed) * 0.03;
      armR = -armL;
      headY = Math.sin(t * 0.5 + seed) * 0.28;
    }
    if (actor.carrying) {
      armL = -1.1;
      armR = -1.1;
    }

    body.hipL.rotation.x = hipL;
    body.hipR.rotation.x = hipR;
    body.kneeL.rotation.x = kneeL;
    body.kneeR.rotation.x = kneeR;
    body.armL.rotation.x = armL;
    body.armR.rotation.x = armR;
    body.head.rotation.set(headX, headY, 0);
    body.torso.position.y = 0.58 + bob;
    body.hipL.position.y = 0.58 + bob;
    body.hipR.position.y = 0.58 + bob;
  }

  private animateScreens(now: number): void {
    for (const screen of this.screens) {
      const ownerId = this.owners.get(screen.seat);
      const owner = ownerId ? this.actors.get(ownerId) : undefined;
      const activity = owner && this.isSeated(owner) ? owner.activity : 'available';
      if (activity === 'available') {
        screen.mesh.material = this.screenOff;
        continue;
      }
      screen.mesh.material = screen.material;
      const blink = activity === 'error' && !this.reducedMotion && Math.floor(now / 400) % 2 === 0;
      screen.material.color.set(blink ? '#3a1216' : STATE_COLORS[activity]);
      // O texto rolando é só desenho: o conteúdo real está no terminal ao lado.
      const rolling = !this.reducedMotion && (activity === 'executing' || activity === 'reviewing');
      if (rolling) screen.code.offset.y = (now / 2600 + hash(owner!.id) * 0.13) % 1;
    }
    const running = [...this.actors.values()].filter((actor) => ['executing', 'thinking', 'reviewing'].includes(actor.activity)).length;
    for (const led of this.leds) {
      // As luzes acompanham o que está rodando: sem trabalho, ficam apagadas.
      const lit = running > 0 && (led.row + led.rack) % 5 < running + 2 && (this.reducedMotion || Math.sin(now / 210 + led.row * 1.7 + led.rack) > -0.2);
      led.material.color.set(!lit ? '#27313b' : led.row % 3 === 0 ? '#f5b544' : '#2dd4bf');
    }
  }

  // -------------------------------------------------------------------------
  // Textos, em resolução de tela para continuarem legíveis
  // -------------------------------------------------------------------------

  private toScreen(x: number, y: number, z: number): [number, number] {
    this.projected.set(x, y, z).project(this.camera);
    return [(this.projected.x + 1) * 0.5 * this.width, (1 - this.projected.y) * 0.5 * this.height];
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private plate(x: number, y: number, w: number, h: number, fill: string, border: string): void {
    const ctx = this.labels;
    ctx.beginPath();
    ctx.roundRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), 4);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
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
    const ctx = this.labels;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const ordered = [...this.actors.values()].sort((a, b) => b.y - a.y);
    const size = this.compact ? 10 : 12;
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const clampX = (x: number, w: number) => Math.max(2, Math.min(this.width - w - 2, x));

    for (const actor of ordered) {
      const state = STATE_COLORS[actor.activity];
      const seated = this.isSeated(actor);
      const [sx, feetY] = this.toScreen(actor.x + 0.5, 0, actor.y + 0.5);
      const [, headY] = this.toScreen(actor.x + 0.5, seated ? HEAD_SEATED : HEAD_STANDING, actor.y + 0.5);

      // Plaquinha com o nome e a ferramenta. Na telinha, só de quem está trabalhando.
      if (!this.compact || actor.activity !== 'available') {
        ctx.font = `700 ${size}px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const label = this.compact ? actor.name : `${actor.name} · ${actor.tool}`;
        const width = ctx.measureText(label).width + size + 10;
        const height = size + 6;
        const x = clampX(sx - width / 2, width);
        const y = this.place(placed, x, feetY + 3, width, height, height + 1);
        this.plate(x, y, width, height, 'rgba(18,23,30,0.88)', 'rgba(255,255,255,0.14)');
        ctx.beginPath();
        ctx.arc(x + 8, y + height / 2, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = state;
        ctx.fill();
        ctx.fillStyle = '#f2f4f7';
        ctx.fillText(label, x + size + 3, y + height / 2 + 0.5);
      }

      // Balão: a atividade real, ou o ícone do estado.
      const icon = actor.activity === 'error' ? '!' : actor.activity === 'finished' ? '✓' : actor.activity === 'waiting' ? '?' : null;
      const bubble = actor.scriptBubble ?? (actor.activity !== 'available' && actor.detail ? actor.detail : null);
      let top = headY;
      if (bubble && !this.compact) {
        ctx.font = `${size}px ${FONT}`;
        ctx.textAlign = 'left';
        const text = this.truncate(bubble, 30);
        const w = ctx.measureText(text).width + 14;
        const h = size + 9;
        const bx = clampX(sx - w / 2, w);
        const by = this.place(placed, bx, headY - h - 7, w, h, -(h + 2));
        this.plate(bx, by, w, h, '#fbfaf5', state);
        ctx.beginPath();
        ctx.moveTo(sx - 4, by + h);
        ctx.lineTo(sx + 4, by + h);
        ctx.lineTo(sx, by + h + 5);
        ctx.closePath();
        ctx.fillStyle = state;
        ctx.fill();
        ctx.fillStyle = '#1c2530';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + 7, by + h / 2 + 0.5);
        top = by;
      } else if (actor.activity === 'thinking') {
        const dots = this.reducedMotion ? 3 : (Math.floor(now / 350) % 3) + 1;
        const w = this.compact ? 18 : 28;
        const h = this.compact ? 10 : 15;
        this.plate(sx - w / 2, headY - h - 4, w, h, '#fbfaf5', state);
        ctx.fillStyle = state;
        const gap = this.compact ? 4 : 7;
        for (let i = 0; i < dots; i += 1) {
          ctx.beginPath();
          ctx.arc(sx - gap + i * gap, headY - h / 2 - 4, this.compact ? 1.2 : 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (icon) {
        const iconSize = this.compact ? 13 : 19;
        const iy = top - iconSize - 4;
        ctx.beginPath();
        ctx.arc(sx, iy + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = state;
        ctx.fill();
        ctx.strokeStyle = '#12171e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#12171e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${iconSize - 6}px ${FONT}`;
        ctx.fillText(icon, sx, iy + iconSize / 2 + 0.5);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Quadro
  // -------------------------------------------------------------------------

  private applyCamera(): void {
    const halfW = this.width / 2 / this.scale;
    const halfH = this.height / 2 / this.scale;
    this.camera.left = -halfW - this.panX;
    this.camera.right = halfW - this.panX;
    this.camera.top = halfH + this.panY;
    this.camera.bottom = -halfH + this.panY;
    this.camera.updateProjectionMatrix();
  }

  /** Enquadra o prédio inteiro, medindo os cantos na direção em que a câmera olha. */
  private fit(): void {
    if (!this.width || !this.height) return;
    const corner = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [0, COLS]) {
      for (const y of [0, TALL_WALL]) {
        for (const z of [0, ROWS]) {
          corner.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        }
      }
    }
    const margin = this.compact ? 1.02 : 1.06;
    this.fitScale = Math.min(this.width / ((maxX - minX) * margin), this.height / ((maxY - minY) * margin));
    this.scale = this.fitScale;
    this.panX = -(maxX + minX) / 2;
    this.panY = (maxY + minY) / 2;
  }

  private readonly resetView = () => {
    this.userMoved = false;
    this.fit();
    this.applyCamera();
  };

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    if (!this.width || !this.height) return;
    // Acima disso o ganho é pouco, e o custo na placa de vídeo é grande.
    this.renderer.setPixelRatio(Math.min(ratio, this.compact ? 1 : 1.5));
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.overlay.width = Math.floor(this.width * ratio);
    this.overlay.height = Math.floor(this.height * ratio);
    this.overlay.style.width = `${this.width}px`;
    this.overlay.style.height = `${this.height}px`;
    if (!this.userMoved) this.fit();
    this.applyCamera();
  }

  private render(now: number): void {
    if (!this.width || !this.height) return;
    for (const actor of this.actors.values()) this.pose(actor, now);
    this.animateScreens(now);
    this.renderer.render(this.scene, this.camera);
    this.drawLabels(now);
  }

  // -------------------------------------------------------------------------
  // Interação
  // -------------------------------------------------------------------------

  private actorAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: { id: string; depth: number } | null = null;
    for (const actor of this.actors.values()) {
      const [sx, feet] = this.toScreen(actor.x + 0.5, 0, actor.y + 0.5);
      const [, head] = this.toScreen(actor.x + 0.5, HEAD_STANDING, actor.y + 0.5);
      const half = Math.max(12, this.scale * 0.45);
      const onBody = px > sx - half && px < sx + half && py > head && py < feet + 18;
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
        this.panX += dx / this.scale;
        this.panY += dy / this.scale;
        this.dragging.x = event.clientX;
        this.dragging.y = event.clientY;
        this.applyCamera();
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
    const mx = event.clientX - rect.left - this.width / 2;
    const my = event.clientY - rect.top - this.height / 2;
    const next = Math.max(this.fitScale * 0.6, Math.min(this.fitScale * 5, this.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
    // Mantém parado o ponto sob o mouse.
    this.panX += mx / next - mx / this.scale;
    this.panY -= my / next - my / this.scale;
    this.scale = next;
    this.userMoved = true;
    this.applyCamera();
  };
}

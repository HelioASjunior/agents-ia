import type { RoleId } from '@xinoia/shared';

// Planta do escritório, em ladrilhos. Só dados e cálculo, sem desenho, para poder ser
// testada: toda mesa e todo lugar da copa precisam ser alcançáveis a pé.

export const TILE = 16;
export const COLS = 30;
export const ROWS = 23;

export interface Room {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOMS: Room[] = [
  { id: 'planning', title: 'PLANEJAMENTO', x: 1, y: 2, w: 9, h: 7 },
  { id: 'architecture', title: 'ARQUITETURA', x: 11, y: 2, w: 7, h: 7 },
  { id: 'monitoring', title: 'SERVIDORES', x: 19, y: 2, w: 10, h: 7 },
  { id: 'development', title: 'DESENVOLVIMENTO', x: 1, y: 15, w: 10, h: 7 },
  { id: 'tests', title: 'TESTES', x: 12, y: 15, w: 4, h: 7 },
  { id: 'review', title: 'REVISÃO', x: 17, y: 15, w: 4, h: 7 },
  { id: 'lounge', title: 'COPA', x: 22, y: 15, w: 7, h: 7 },
];

export const HALL = { x: 1, y: 11, w: 28, h: 2 };

/** Faixas de parede que correm na horizontal: a linha de cima é o topo, a de baixo, a face. */
export const WALL_BANDS = [
  { y: 0, doors: [] as number[] },
  { y: 9, doors: [5, 6, 14, 15, 23, 24] },
  { y: 13, doors: [4, 5, 14, 15, 19, 20, 24, 25] },
];

export const WALL_COLUMNS = [
  { x: 10, from: 2, to: 8 },
  { x: 18, from: 2, to: 8 },
  { x: 11, from: 15, to: 21 },
  { x: 16, from: 15, to: 21 },
  { x: 21, from: 15, to: 21 },
];

export const ROOM_OF_ROLE: Record<RoleId, string> = {
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

export interface Seat {
  room: string;
  /** Ladrilho da cadeira. A mesa fica logo acima, ocupando três ladrilhos. */
  x: number;
  y: number;
  kind: 'desk' | 'table';
}

const desks = (room: string, positions: Array<[number, number]>): Seat[] =>
  positions.map(([x, y]) => ({ room, x, y, kind: 'desk' }));

// Entre uma fileira e a seguinte sobra uma linha livre: sem ela, o monitor de trás
// cobriria quem está sentado na frente.
export const SEATS: Seat[] = [
  { room: 'planning', x: 3, y: 6, kind: 'table' },
  { room: 'planning', x: 5, y: 6, kind: 'table' },
  { room: 'planning', x: 7, y: 6, kind: 'table' },
  ...desks('architecture', [[12, 4], [16, 4], [12, 7], [16, 7]]),
  ...desks('development', [[2, 17], [6, 17], [9, 17], [2, 20], [6, 20], [9, 20]]),
  ...desks('tests', [[13, 17], [13, 20]]),
  ...desks('review', [[18, 17], [18, 20]]),
  ...desks('monitoring', [[20, 4], [23, 4], [20, 7], [23, 7]]),
];

/** Mesa de reunião, em ladrilhos. */
export const MEETING_TABLE = { x: 2, y: 4, w: 7, h: 2 };
export const RACKS = { x: 25, y: 2, w: 4, h: 1 };
// Ao lado da porta da copa, nunca na frente dela.
export const COFFEE_BAR = { x: 26, y: 15, w: 3, h: 1 };
export const SOFA = { x: 23, y: 21, w: 4, h: 1 };
export const RUG = { x: 23, y: 18, w: 5, h: 2 };
export const PLANTS: Array<[number, number]> = [[1, 2], [9, 2], [17, 2], [28, 8], [1, 11], [28, 11], [13, 12], [10, 15], [12, 15], [28, 21], [1, 8], [9, 8]];

/** Onde quem está disponível fica, na copa. */
export const LOUNGE_SPOTS: Array<[number, number]> = [[23, 17], [25, 17], [27, 17], [24, 19], [26, 19], [22, 18], [28, 18], [23, 19], [27, 19], [25, 18], [22, 20], [28, 19]];

export function buildBlocked(): Set<string> {
  const blocked = new Set<string>();
  const add = (x: number, y: number) => blocked.add(`${x},${y}`);
  const area = (a: { x: number; y: number; w: number; h: number }) => {
    for (let i = 0; i < a.w; i += 1) for (let j = 0; j < a.h; j += 1) add(a.x + i, a.y + j);
  };
  for (let x = 0; x < COLS; x += 1) {
    add(x, ROWS - 1);
    for (const band of WALL_BANDS) {
      if (band.doors.includes(x)) continue;
      add(x, band.y);
      add(x, band.y + 1);
    }
  }
  for (let y = 0; y < ROWS; y += 1) {
    add(0, y);
    add(COLS - 1, y);
  }
  for (const column of WALL_COLUMNS) for (let y = column.from; y <= column.to; y += 1) add(column.x, y);
  for (const seat of SEATS) {
    if (seat.kind === 'desk') for (const dx of [-1, 0, 1]) add(seat.x + dx, seat.y - 1);
  }
  area(MEETING_TABLE);
  area(RACKS);
  area(COFFEE_BAR);
  area(SOFA);
  for (const [x, y] of PLANTS) add(x, y);
  return blocked;
}

/** Caminho entre ladrilhos, em largura. Vazio se já chegou ou se não há como chegar. */
export function findPath(blocked: Set<string>, fromX: number, fromY: number, toX: number, toY: number): Array<{ x: number; y: number }> {
  const key = (x: number, y: number) => `${x},${y}`;
  const start = key(fromX, fromY);
  const goal = key(toX, toY);
  const came = new Map<string, string | null>([[start, null]]);
  const queue: Array<[number, number]> = [[fromX, fromY]];
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head]!;
    if (key(x, y) === goal) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const nx = x + dx;
      const ny = y + dy;
      const next = key(nx, ny);
      if (came.has(next) || blocked.has(next)) continue;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      came.set(next, key(x, y));
      queue.push([nx, ny]);
    }
  }
  if (!came.has(goal)) return [];
  const path: Array<{ x: number; y: number }> = [];
  let current: string | null = goal;
  while (current && current !== start) {
    const [x, y] = current.split(',').map(Number) as [number, number];
    path.unshift({ x, y });
    current = came.get(current) ?? null;
  }
  return path;
}

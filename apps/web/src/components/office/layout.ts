import type { RoleId } from '@xinoia/shared';

// Planta do escritório, em ladrilhos. Só dados e cálculo, sem desenho, para poder ser
// testada: toda mesa e todo lugar da copa precisam ser alcançáveis a pé.

export const COLS = 30;
export const ROWS = 20;

export interface Room {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOMS: Room[] = [
  { id: 'planning', title: 'PLANEJAMENTO', x: 1, y: 1, w: 9, h: 7 },
  { id: 'architecture', title: 'ARQUITETURA', x: 11, y: 1, w: 7, h: 7 },
  { id: 'monitoring', title: 'SERVIDORES', x: 19, y: 1, w: 10, h: 7 },
  { id: 'development', title: 'DESENVOLVIMENTO', x: 1, y: 12, w: 10, h: 7 },
  { id: 'tests', title: 'TESTES', x: 12, y: 12, w: 4, h: 7 },
  { id: 'review', title: 'REVISÃO', x: 17, y: 12, w: 4, h: 7 },
  { id: 'lounge', title: 'COPA', x: 22, y: 12, w: 7, h: 7 },
];

export const HALL = { x: 1, y: 9, w: 28, h: 2 };

/** Paredes que correm na horizontal, cada uma com um ladrilho de espessura. */
export const WALL_BANDS = [
  { y: 0, doors: [] as number[] },
  { y: 8, doors: [5, 6, 14, 15, 23, 24] },
  { y: 11, doors: [4, 5, 14, 15, 19, 20, 24, 25] },
  { y: ROWS - 1, doors: [] as number[] },
];

export const WALL_COLUMNS = [
  { x: 10, from: 1, to: 7 },
  { x: 18, from: 1, to: 7 },
  { x: 11, from: 12, to: 18 },
  { x: 16, from: 12, to: 18 },
  { x: 21, from: 12, to: 18 },
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
  /** Ladrilho da cadeira. A mesa fica logo atrás dela, ocupando três ladrilhos. */
  x: number;
  y: number;
  kind: 'desk' | 'table';
}

const desks = (room: string, positions: Array<[number, number]>): Seat[] =>
  positions.map(([x, y]) => ({ room, x, y, kind: 'desk' }));

// Entre uma fileira e a seguinte sobra uma linha livre: sem ela, o monitor de trás
// cobriria quem está sentado na frente.
export const SEATS: Seat[] = [
  { room: 'planning', x: 3, y: 5, kind: 'table' },
  { room: 'planning', x: 5, y: 5, kind: 'table' },
  { room: 'planning', x: 7, y: 5, kind: 'table' },
  ...desks('architecture', [[12, 3], [16, 3], [12, 6], [16, 6]]),
  ...desks('development', [[2, 14], [6, 14], [9, 14], [2, 17], [6, 17], [9, 17]]),
  ...desks('tests', [[13, 14], [13, 17]]),
  ...desks('review', [[18, 14], [18, 17]]),
  ...desks('monitoring', [[20, 3], [23, 3], [20, 6], [23, 6]]),
];

/** Mesa de reunião, em ladrilhos. */
export const MEETING_TABLE = { x: 2, y: 3, w: 7, h: 2 };
export const RACKS = { x: 25, y: 1, w: 4, h: 1 };
// Ao lado da porta da copa, nunca na frente dela.
export const COFFEE_BAR = { x: 26, y: 12, w: 3, h: 1 };
export const SOFA = { x: 23, y: 18, w: 4, h: 1 };
export const RUG = { x: 23, y: 15, w: 5, h: 2 };
export const PLANTS: Array<[number, number]> = [[1, 1], [9, 1], [17, 1], [28, 7], [1, 9], [28, 9], [13, 10], [10, 12], [12, 12], [28, 18], [1, 7], [9, 7]];

/** Onde quem está disponível fica, na copa. */
export const LOUNGE_SPOTS: Array<[number, number]> = [[23, 14], [25, 14], [27, 14], [24, 16], [26, 16], [22, 15], [28, 15], [23, 16], [27, 16], [25, 15], [22, 17], [28, 16]];

export function buildBlocked(): Set<string> {
  const blocked = new Set<string>();
  const add = (x: number, y: number) => blocked.add(`${x},${y}`);
  const area = (a: { x: number; y: number; w: number; h: number }) => {
    for (let i = 0; i < a.w; i += 1) for (let j = 0; j < a.h; j += 1) add(a.x + i, a.y + j);
  };
  for (let x = 0; x < COLS; x += 1) {
    for (const band of WALL_BANDS) {
      if (!band.doors.includes(x)) add(x, band.y);
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

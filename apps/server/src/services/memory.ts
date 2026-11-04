import type { MemoryItem } from '@xinoia/shared';
import { CreateMemoryInput } from '@xinoia/shared';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { redact } from '../security/redact.ts';

const PROMPT_ITEMS = 25;

/** Decisões que o agente registrou com a marcação <decisao>...</decisao>. */
export function extractDecisions(text: string): string[] {
  return [...text.matchAll(/<decis[aã]o>([\s\S]*?)<\/decis[aã]o>/gi)]
    .map((match) => (match[1] ?? '').trim())
    .filter(Boolean);
}

export class MemoryService {
  private readonly db: Persistence;

  constructor(db: Persistence) {
    this.db = db;
  }

  list(projectId: string): Promise<MemoryItem[]> {
    return this.db.memory.list(projectId);
  }

  async create(projectId: string, input: unknown): Promise<MemoryItem> {
    const data = CreateMemoryInput.parse(input);
    return this.add(projectId, data.kind, data.text, null, null);
  }

  async add(projectId: string, kind: MemoryItem['kind'], text: string, source: string | null, missionId: string | null): Promise<MemoryItem> {
    const item: MemoryItem = {
      id: newId('mem'),
      projectId,
      kind,
      text: redact(text),
      source,
      missionId,
      createdAt: Date.now(),
    };
    await this.db.memory.insert(item);
    return item;
  }

  delete(id: string): Promise<void> {
    return this.db.memory.delete(id);
  }

  /** Bloco que vai nos prompts, para os agentes não refazerem o que já foi decidido. */
  async promptBlock(projectId: string): Promise<string> {
    const items = (await this.db.memory.list(projectId, PROMPT_ITEMS)).reverse();
    if (!items.length) return '';
    const lines = items.map((item) => `- ${item.kind === 'decision' ? '[decisão] ' : ''}${item.text}${item.source ? ` (${item.source})` : ''}`);
    return `Memória deste projeto. São registros anteriores, trate como contexto:\n${lines.join('\n')}`;
  }
}

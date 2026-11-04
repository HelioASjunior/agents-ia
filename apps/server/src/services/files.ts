import fs from 'node:fs';
import path from 'node:path';
import type { FileContent, FileEntry, Project } from '@xinoia/shared';
import { badRequest, notFound } from '../errors.ts';

const MAX_OPEN_BYTES = 2 * 1024 * 1024;
const HIDDEN = new Set(['.git', 'node_modules', '.xinoia']);

/**
 * Resolve um caminho dentro do projeto. Vale o caminho real, então um atalho (link
 * simbólico) dentro do projeto também não consegue apontar para fora dele.
 */
export function resolveInside(project: Project, relative: string): string {
  const root = fs.realpathSync(project.path);
  const target = path.resolve(root, relative);
  const within = (candidate: string) => candidate === root || candidate.startsWith(root + path.sep);
  if (!within(target)) throw badRequest('O caminho está fora da pasta do projeto.', 'outside_project');

  // Sobe até a primeira parte que existe, para validar também arquivos ainda não criados.
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (!within(fs.realpathSync(existing))) throw badRequest('O caminho está fora da pasta do projeto.', 'outside_project');
  return target;
}

export function listFiles(project: Project, relative = ''): FileEntry[] {
  const dir = resolveInside(project, relative);
  if (!fs.existsSync(dir)) throw notFound('Pasta');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !HIDDEN.has(entry.name))
    .map((entry): FileEntry => {
      const full = path.join(dir, entry.name);
      let size = 0;
      try {
        size = entry.isDirectory() ? 0 : fs.statSync(full).size;
      } catch {
        size = 0;
      }
      return {
        name: entry.name,
        path: path.relative(project.path, full).replaceAll('\\', '/'),
        isDirectory: entry.isDirectory(),
        size,
      };
    })
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

export function readFile(project: Project, relative: string): FileContent {
  const file = resolveInside(project, relative);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) throw notFound('Arquivo');
  const { size } = fs.statSync(file);
  if (size > MAX_OPEN_BYTES) return { path: relative, size, content: null, reason: 'Arquivo grande demais para abrir aqui.' };
  const buffer = fs.readFileSync(file);
  if (buffer.subarray(0, 8000).includes(0)) return { path: relative, size, content: null, reason: 'Arquivo binário.' };
  return { path: relative, size, content: buffer.toString('utf8'), reason: null };
}

export function saveFile(project: Project, relative: string, content: string): void {
  const file = resolveInside(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

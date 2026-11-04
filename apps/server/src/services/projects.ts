import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Project, ProjectInfo } from '@xinoia/shared';
import { CreateProjectInput } from '@xinoia/shared';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';

const exec = promisify(execFile);

const MARKERS: Array<[RegExp, string]> = [
  [/^package\.json$/, 'Node.js'],
  [/^tsconfig\.json$/, 'TypeScript'],
  [/^(requirements\.txt|pyproject\.toml|setup\.py)$/, 'Python'],
  [/^Cargo\.toml$/, 'Rust'],
  [/^go\.mod$/, 'Go'],
  [/^(pom\.xml|build\.gradle(\.kts)?)$/, 'Java/Kotlin'],
  [/\.(sln|csproj)$/, '.NET'],
  [/^composer\.json$/, 'PHP'],
  [/^Gemfile$/, 'Ruby'],
  [/\.uproject$/, 'Unreal Engine'],
  [/^ProjectSettings$/, 'Unity'],
  [/^(Dockerfile|docker-compose\.ya?ml)$/, 'Docker'],
];

/** Reconhece o projeto pelo que existe na pasta, antes de qualquer alteração. */
export async function inspectProject(projectPath: string): Promise<ProjectInfo> {
  const names = fs.readdirSync(projectPath);
  const stack = MARKERS.filter(([pattern]) => names.some((name) => pattern.test(name))).map(([, label]) => label);
  const isUnreal = names.some((name) => name.endsWith('.uproject'));
  let isGit = false;
  let branch: string | null = null;
  try {
    const { stdout } = await exec('git', ['-C', projectPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000, windowsHide: true });
    isGit = true;
    branch = stdout.trim();
  } catch {
    // Repositório sem commits ainda responde a esta segunda pergunta.
    try {
      await exec('git', ['-C', projectPath, 'rev-parse', '--git-dir'], { timeout: 5000, windowsHide: true });
      isGit = true;
    } catch {
      isGit = false;
    }
  }
  return { isGit, branch, isUnreal, stack };
}

export class ProjectService {
  private readonly db: Persistence;

  constructor(db: Persistence) {
    this.db = db;
  }

  list(): Promise<Project[]> {
    return this.db.projects.list();
  }

  async get(id: string): Promise<Project> {
    const project = await this.db.projects.get(id);
    if (!project) throw notFound('Projeto');
    return project;
  }

  async create(input: unknown): Promise<Project> {
    const data = CreateProjectInput.parse(input);
    if (!path.isAbsolute(data.path)) throw badRequest('Informe o caminho completo da pasta.');
    const resolved = path.resolve(data.path);
    if (await this.db.projects.findByPath(resolved)) throw conflict('Esta pasta já está cadastrada como projeto.');

    if (!fs.existsSync(resolved)) {
      if (!data.create) throw badRequest(`A pasta não existe: ${resolved}`, 'path_not_found');
      fs.mkdirSync(resolved, { recursive: true });
    } else if (!fs.statSync(resolved).isDirectory()) {
      throw badRequest('O caminho informado não é uma pasta.');
    }

    const project: Project = {
      id: newId('proj'),
      name: data.name || path.basename(resolved) || resolved,
      path: resolved,
      info: await inspectProject(resolved),
      createdAt: Date.now(),
    };
    await this.db.projects.insert(project);
    return project;
  }

  async refresh(id: string): Promise<Project> {
    const project = await this.get(id);
    const info = await inspectProject(project.path);
    await this.db.projects.updateInfo(id, info);
    return { ...project, info };
  }

  /** Remove o projeto do XinoIA e o histórico dele. A pasta e os arquivos não são tocados. */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db.projects.delete(id);
  }
}

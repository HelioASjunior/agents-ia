import type { AgentEvent, ErrorKind, PermissionLevel, Profile, SupportLevel, Toolkit } from '@xinoia/shared';

export interface BuildArgsOptions {
  model?: string | null;
  effort?: string | null;
  sessionId?: string | null;
  permission: PermissionLevel;
  extraArgs?: string[];
}

export interface ToolArgsOptions {
  toolkits: Toolkit[];
  profile: Profile | null;
  permission: PermissionLevel;
  mcpConfigFile: string | null;
  quotePath: (value: string) => string;
}

export interface ToolArgsResult {
  args: string[];
  /** false: o CLI não carrega plugins, então as skills são indicadas no prompt. */
  loadsPlugins: boolean;
}

export type LineParser = (line: string) => AgentEvent[];

export interface StatusResult {
  loggedIn: boolean;
  subscription: boolean | null;
  method: string | null;
  email: string | null;
  plan: string | null;
}

export interface ProviderAdapter {
  id: string;
  label: string;
  command: string;
  /** Sem shell: usado quando `command` já é um executável, como em testes. */
  noShell?: boolean;
  /** Variável que aponta a pasta de dados do CLI. null: não dá para separar perfis. */
  homeEnv: string | null;
  defaultHomeDir: string | null;
  support: SupportLevel;
  note: string | null;
  installCommand: string | null;
  installUrl: string | null;
  loginCommand: string | null;
  logoutArgs: string[] | null;
  statusArgs: string[] | null;
  /** Comando de ajuda e opções que indicam cada capacidade. */
  capabilityProbe: { args: string[]; flags: Record<string, string> } | null;
  models: string[];
  efforts: string[];
  /** Mantém variáveis de API no ambiente. Só para CLIs personalizados. */
  keepsApiEnv?: boolean;
  requiresProfile: boolean;

  parseStatus?(stdout: string, stderr: string): StatusResult;
  statusFromHome?(homeDir: string): StatusResult;
  prepareHome?(homeDir: string): void;
  buildArgs(options: BuildArgsOptions): string[];
  toolArgs?(options: ToolArgsOptions): ToolArgsResult;
  createParser(): LineParser;
  classifyError(text: string): ErrorKind | null;
  isNoise?(line: string): boolean;
}

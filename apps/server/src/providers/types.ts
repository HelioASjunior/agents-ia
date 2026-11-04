import type { AgentEvent, ErrorKind, ModelOption, PermissionLevel, Profile, SupportLevel, Toolkit } from '@xinoia/shared';

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

export type LineParser = ((line: string) => AgentEvent[]) & {
  /** Erro que só conta se a execução acabar sem o CLI confirmar que se recuperou dele. */
  pendingError?: () => string | null;
};

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
  /** Comando que lista os modelos da versão instalada, quando o CLI oferece um. */
  modelProbe?: { args: string[]; parse(stdout: string): ModelOption[] };
  /** Variável em que o CLI lê a chave de API. null: não aceita chave por aqui. */
  apiKeyEnv: string | null;
  apiKeyUrl: string | null;
  /** Mantém variáveis de API no ambiente. Só para CLIs personalizados. */
  keepsApiEnv?: boolean;
  requiresProfile: boolean;

  parseStatus?(stdout: string, stderr: string): StatusResult;
  statusFromHome?(homeDir: string): StatusResult;
  prepareHome?(homeDir: string): void;
  buildArgs(options: BuildArgsOptions): string[];
  /** Argumentos que dependem de como o CLI está configurado neste computador. */
  sandboxArgs?(homeDir: string | null, permission: PermissionLevel, platform?: NodeJS.Platform): string[];
  toolArgs?(options: ToolArgsOptions): ToolArgsResult;
  /** Regras de segurança que o próprio CLI aplica antes de executar. */
  policyArgs?(policyFile: string, quotePath: (value: string) => string): string[];
  createParser(): LineParser;
  classifyError(text: string): ErrorKind | null;
  isNoise?(line: string): boolean;
}

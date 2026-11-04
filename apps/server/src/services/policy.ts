import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, ExecutionMode, PermissionLevel } from '@xinoia/shared';
import { AppSettings as AppSettingsSchema } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import type { Persistence } from '../persistence/types.ts';

const SETTINGS_KEY = 'app_settings';

export class SettingsService {
  private readonly db: Persistence;
  private current: AppSettings = AppSettingsSchema.parse({});

  constructor(db: Persistence) {
    this.db = db;
  }

  async load(): Promise<void> {
    this.current = AppSettingsSchema.parse((await this.db.settings.get(SETTINGS_KEY)) ?? {});
  }

  get(): AppSettings {
    return this.current;
  }

  async update(patch: unknown): Promise<AppSettings> {
    this.current = AppSettingsSchema.parse({ ...this.current, ...(patch as object) });
    await this.db.settings.set(SETTINGS_KEY, this.current);
    return this.current;
  }
}

/** A permissão que o agente tem de fato, dado o modo de execução. */
export function effectivePermission(requested: PermissionLevel, mode: ExecutionMode): { permission: PermissionLevel; reason: string | null } {
  if (requested !== 'full' || mode === 'autonomous') return { permission: requested, reason: null };
  return {
    permission: 'edit',
    reason: `O modo ${mode === 'supervised' ? 'supervisionado' : 'semiautônomo'} limita a permissão total a "editar".`,
  };
}

const DANGEROUS: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|[a-z]:|\*|\.\.?(\s|$))/i, 'apagar pastas inteiras'],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, 'apagar arquivos à força'],
  [/\b(Remove-Item|ri)\b[^|;&]*-Recurse\b[^|;&]*-Force\b|\b(Remove-Item|ri)\b[^|;&]*-Force\b[^|;&]*-Recurse\b/i, 'apagar pastas à força'],
  [/\b(rmdir|rd)\s+\/s\b|\bdel\s+\/[sf]\b/i, 'apagar pastas à força'],
  [/\bgit\s+push\b[^|;&]*(--force|-f\b)/i, 'sobrescrever o histórico remoto'],
  [/\bgit\s+reset\s+--hard\b/i, 'descartar alterações do Git'],
  [/\bgit\s+clean\b[^|;&]*-[a-z]*f/i, 'apagar arquivos não versionados'],
  [/\bgit\s+push\b/i, 'enviar código para o repositório remoto'],
  [/\b(mkfs|fdisk|diskpart|format\s+[a-z]:)/i, 'formatar disco'],
  [/\bdd\s+[^|;&]*of=\/dev\//i, 'sobrescrever disco'],
  [/\b(shutdown|reboot|Stop-Computer|Restart-Computer)\b/i, 'desligar ou reiniciar o computador'],
  [/\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i, 'apagar dados de um banco'],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;&]*\|\s*(sh|bash|iex|Invoke-Expression|powershell)\b/i, 'executar código baixado da internet'],
  [/\b(reg\s+delete|Set-ExecutionPolicy)\b/i, 'alterar configurações do sistema'],
];

/** Reconhece um comando perigoso. É uma rede de proteção, não uma garantia. */
export function dangerousCommand(command: string): string | null {
  for (const [pattern, reason] of DANGEROUS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

/**
 * Regras de negação que o próprio Claude Code aplica antes de executar, mesmo com a
 * permissão total. Vão em um arquivo porque passariam pelo cmd.exe se fossem argumentos.
 */
export function writeClaudePolicy(config: AppConfig): string {
  const file = path.join(config.dataDir, 'policies', 'claude-deny.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    permissions: {
      deny: [
        'Bash(rm -rf:*)',
        'Bash(rm -fr:*)',
        'Bash(git push --force:*)',
        'Bash(git push -f:*)',
        'Bash(git reset --hard:*)',
        'Bash(git clean -f:*)',
        'Bash(mkfs:*)',
        'Bash(diskpart:*)',
        'Bash(shutdown:*)',
        'Bash(reboot:*)',
        'PowerShell(Remove-Item -Recurse -Force:*)',
        'PowerShell(Stop-Computer:*)',
        'PowerShell(Restart-Computer:*)',
      ],
    },
  }, null, 2));
  return file;
}

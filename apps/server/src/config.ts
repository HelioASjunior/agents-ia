import os from 'node:os';
import path from 'node:path';
import { PRODUCT_NAME } from '@xinoia/shared';

export interface AppConfig {
  dataDir: string;
  profilesDir: string;
  logsDir: string;
  backupsDir: string;
  databaseFile: string;
  /** Pasta pessoal do usuário, onde cada CLI guarda seu login padrão. */
  homeDir: string;
  inactivityMs: number;
}

// Fica fora da pasta de instalação para sobreviver a atualizações e desinstalação.
export function defaultDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), PRODUCT_NAME);
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', PRODUCT_NAME);
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), PRODUCT_NAME);
  }
}

export function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = path.resolve(overrides.dataDir || process.env.XINOIA_DATA_DIR || defaultDataDir());
  return {
    dataDir,
    profilesDir: path.join(dataDir, 'profiles'),
    logsDir: path.join(dataDir, 'logs'),
    backupsDir: path.join(dataDir, 'backups'),
    databaseFile: path.join(dataDir, 'xinoia.db'),
    homeDir: os.homedir(),
    inactivityMs: 30 * 60_000,
    ...overrides,
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, net } from 'electron';
import electronUpdater, { type UpdateInfo } from 'electron-updater';
import { verifyFile } from './verify.ts';

const { autoUpdater } = electronUpdater;

// Fixo no pacote oficial. Só o teste de atualização, em uma compilação própria, troca isto.
declare const __XINOIA_RELEASE_BASE__: string | undefined;
const RELEASE_BASE = typeof __XINOIA_RELEASE_BASE__ === 'string'
  ? __XINOIA_RELEASE_BASE__
  : 'https://github.com/HelioASjunior/agents-ia/releases/download';
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 15_000;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  channel: 'latest' | 'beta';
  autoCheck: boolean;
  available: { version: string; notes: string | null } | null;
  progress: { percent: number; transferred: number; total: number } | null;
  error: string | null;
  lastCheckedAt: number | null;
}

interface Stored {
  autoCheck: boolean;
  channel: 'latest' | 'beta';
  snoozedVersion: string | null;
  snoozedUntil: number;
}

export interface UpdaterHost {
  /** Trabalho em andamento: uma atualização não pode interromper sem autorização. */
  activeRuns(): Promise<number>;
  /** Cópia de segurança dos dados antes de instalar. */
  backup(): Promise<void>;
  publicKey: string;
  notify(title: string, body: string): void;
  beforeQuit(): Promise<void>;
}

function notesToText(notes: UpdateInfo['releaseNotes']): string | null {
  if (!notes) return null;
  const text = typeof notes === 'string' ? notes : notes.map((item) => `${item.version}\n${item.note ?? ''}`).join('\n\n');
  return text.replace(/<[^>]+>/g, '').trim() || null;
}

export function setupUpdater(host: UpdaterHost): void {
  const file = path.join(app.getPath('userData'), 'updater.json');
  const isBeta = app.getVersion().includes('-');
  let stored: Stored = { autoCheck: true, channel: isBeta ? 'beta' : 'latest', snoozedVersion: null, snoozedUntil: 0 };
  try {
    stored = { ...stored, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // Primeira vez: fica o padrão.
  }
  const save = () => fs.writeFileSync(file, JSON.stringify(stored));

  const state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    channel: stored.channel,
    autoCheck: stored.autoCheck,
    available: null,
    progress: null,
    error: null,
    lastCheckedAt: null,
  };

  const broadcast = () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('updates:changed', state);
  };
  const set = (patch: Partial<UpdateState>) => {
    Object.assign(state, patch);
    broadcast();
  };

  autoUpdater.autoDownload = false;
  // Instalar ao fechar pularia a verificação de assinatura: só instala depois dela.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.channel = stored.channel;
  autoUpdater.allowPrerelease = stored.channel === 'beta';

  let downloaded: { file: string; version: string; name: string } | null = null;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'none', available: null, lastCheckedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => {
    const snoozed = stored.snoozedVersion === info.version && Date.now() < stored.snoozedUntil;
    set({
      status: 'available',
      available: { version: info.version, notes: notesToText(info.releaseNotes) },
      lastCheckedAt: Date.now(),
    });
    if (!snoozed) host.notify('XinoIA', `A versão ${info.version} está disponível.`);
  });
  autoUpdater.on('download-progress', (progress) => set({
    status: 'downloading',
    progress: { percent: progress.percent, transferred: progress.transferred, total: progress.total },
  }));
  autoUpdater.on('error', (error) => set({
    status: 'error',
    progress: null,
    error: `Não foi possível atualizar: ${error.message.split('\n')[0]}. Sua instalação e seus dados não foram alterados.`,
  }));
  autoUpdater.on('update-downloaded', async (event) => {
    const installer = event.downloadedFile;
    const name = path.basename(new URL(event.files[0]?.url ?? `file:///${installer}`, RELEASE_BASE).pathname);
    try {
      const response = await net.fetch(`${RELEASE_BASE}/v${event.version}/${name}.sig`);
      if (!response.ok) throw new Error('a assinatura não foi encontrada na versão publicada');
      const valid = await verifyFile(installer, await response.text(), host.publicKey);
      if (!valid) throw new Error('a assinatura do pacote é inválida');
      downloaded = { file: installer, version: event.version, name };
      set({ status: 'ready', progress: null });
      host.notify('XinoIA', `A versão ${event.version} está pronta para instalar.`);
    } catch (error) {
      // Pacote que não se confirma nunca é executado, e nem fica guardado.
      fs.rmSync(installer, { force: true });
      downloaded = null;
      set({
        status: 'error',
        progress: null,
        error: `Atualização recusada: ${error instanceof Error ? error.message : String(error)}. Nada foi instalado.`,
      });
    }
  });

  const check = async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      set({ status: 'error', error: `Não foi possível verificar: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` });
    }
  };

  let waitingForAgents: NodeJS.Timeout | null = null;
  const install = async () => {
    if (!downloaded) throw new Error('Nenhuma atualização verificada para instalar.');
    await host.backup().catch(() => undefined);
    await host.beforeQuit();
    autoUpdater.quitAndInstall(true, true);
  };

  ipcMain.handle('updates:getState', () => state);
  ipcMain.handle('updates:check', () => check());
  ipcMain.handle('updates:download', async () => {
    set({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 0 } });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      set({ status: 'error', progress: null, error: `O download falhou: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}. Você pode tentar de novo.` });
    }
  });
  ipcMain.handle('updates:dismiss', () => {
    stored.snoozedVersion = state.available?.version ?? null;
    stored.snoozedUntil = Date.now() + SNOOZE_MS;
    save();
    set({ status: 'idle' });
  });
  ipcMain.handle('updates:install', async (_event, force: boolean) => {
    if (force || (await host.activeRuns()) === 0) {
      await install();
      return;
    }
    // Agentes trabalhando: espera eles terminarem, sem interromper ninguém.
    if (waitingForAgents) return;
    host.notify('XinoIA', 'A atualização será instalada quando os agentes terminarem.');
    waitingForAgents = setInterval(() => {
      void host.activeRuns().then((count) => {
        if (count === 0) {
          clearInterval(waitingForAgents!);
          waitingForAgents = null;
          void install();
        }
      });
    }, 5000);
  });
  ipcMain.handle('updates:setAutoCheck', (_event, value: boolean) => {
    stored.autoCheck = value;
    save();
    set({ autoCheck: value });
  });
  ipcMain.handle('updates:setChannel', (_event, value: 'latest' | 'beta') => {
    stored.channel = value;
    save();
    autoUpdater.channel = value;
    autoUpdater.allowPrerelease = value === 'beta';
    set({ channel: value });
    void check();
  });

  // Não atrasa a abertura, e continua verificando enquanto o programa estiver aberto.
  const automatic = () => {
    if (stored.autoCheck && state.status !== 'downloading' && state.status !== 'ready') void check();
  };
  setTimeout(automatic, FIRST_CHECK_MS).unref();
  setInterval(automatic, CHECK_EVERY_MS).unref();
}

/** Versão portátil e desenvolvimento não se atualizam sozinhos: a interface explica. */
export function setupUpdaterUnavailable(reason: string): void {
  const state: UpdateState = {
    status: 'error',
    currentVersion: app.getVersion(),
    channel: 'latest',
    autoCheck: false,
    available: null,
    progress: null,
    error: reason,
    lastCheckedAt: null,
  };
  ipcMain.handle('updates:getState', () => state);
  for (const channel of ['updates:check', 'updates:download', 'updates:dismiss', 'updates:install', 'updates:setAutoCheck', 'updates:setChannel']) {
    ipcMain.handle(channel, () => undefined);
  }
}

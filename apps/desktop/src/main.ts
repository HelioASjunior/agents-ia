import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, utilityProcess, type UtilityProcess } from 'electron';
import { setupUpdater, setupUpdaterUnavailable } from './updater.ts';

const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;

// Na versão portátil, os dados ficam ao lado do programa. Definir antes de tudo faz o
// Chromium guardar o perfil dele no mesmo lugar, sem espalhar arquivos pelo computador.
if (portableDir && !app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(portableDir, 'XinoIA-dados'));

app.setAppUserModelId('com.xinoia.app');

let server: UtilityProcess | null = null;
let connection: { port: number; token: string } | null = null;
let mainWindow: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let quitting = false;

const resource = (...parts: string[]) => path.join(__dirname, ...parts);

function showSplash(): void {
  splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: '#0b0f14',
    icon: resource('icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  void splash.loadFile(resource('splash.html'));
}

function startServer(): Promise<{ port: number; token: string }> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(resource('server', 'index.mjs'), [], {
      serviceName: 'XinoIA Backend',
      stdio: 'pipe',
      env: {
        ...process.env,
        XINOIA_DATA_DIR: app.getPath('userData'),
        XINOIA_WEB_DIR: resource('web'),
        XINOIA_PORT: '0',
      },
    });
    server = child;
    let lastOutput = '';
    const remember = (data: Buffer) => {
      lastOutput = `${lastOutput}${data.toString()}`.slice(-2000);
    };
    child.stdout?.on('data', remember);
    child.stderr?.on('data', remember);
    child.on('message', (message: { type?: string; port?: number; token?: string; error?: string }) => {
      if (message.type === 'ready' && message.port && message.token) {
        resolve({ port: message.port, token: message.token });
      } else if (message.type === 'fatal') {
        reject(new Error(message.error ?? 'O backend não conseguiu iniciar.'));
      }
    });
    child.on('exit', (code) => {
      server = null;
      if (quitting) return;
      if (!connection) {
        reject(new Error(lastOutput.trim() || `O backend terminou com o código ${code}.`));
        return;
      }
      void onServerCrash();
    });
  });
}

/** Se o backend cair, oferece reiniciar em vez de deixar uma janela morta. */
async function onServerCrash(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'XinoIA',
    message: 'O XinoIA encontrou um problema e parou.',
    detail: 'Seus dados estão salvos. Execuções em andamento foram interrompidas e podem ser retomadas.',
    buttons: ['Reiniciar', 'Fechar'],
    defaultId: 0,
  });
  if (response === 1) {
    quitting = true;
    app.quit();
    return;
  }
  try {
    connection = null;
    connection = await startServer();
    await loadApp();
  } catch (error) {
    fatal(error);
  }
}

async function loadApp(): Promise<void> {
  if (!connection || !mainWindow) return;
  // O token vai no fragmento: nunca é enviado em requisições nem aparece em logs.
  await mainWindow.loadURL(`http://127.0.0.1:${connection.port}/#token=${connection.token}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'XinoIA',
    backgroundColor: '#0b0f14',
    icon: resource('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: resource('preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    splash?.close();
    splash = null;
    mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links dos agentes não navegam dentro do app. Só endereços da web abrem, no navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (connection && url.startsWith(`http://127.0.0.1:${connection.port}/`)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'notifications');
  });
}

function fatal(error: unknown): void {
  splash?.close();
  const message = error instanceof Error ? error.message : String(error);
  const tooNew = /mais nova que esta versão/.test(message);
  dialog.showErrorBox(
    'O XinoIA não conseguiu abrir',
    tooNew
      ? `${message}\n\nInstale a versão mais recente do XinoIA. Seus dados não foram alterados.`
      : `${message}\n\nSeus dados não foram alterados. Se continuar, abra um aviso em github.com/HelioASjunior/agents-ia/issues.`,
  );
  quitting = true;
  app.quit();
}

async function apiCall<T>(method: string, url: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${connection!.port}${url}`, {
    method,
    headers: { authorization: `Bearer ${connection!.token}` },
  });
  if (!response.ok) throw new Error(`Erro ${response.status}`);
  return (await response.json()) as T;
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, icon: resource('icon.png') }).show();
}

/** Encerra os agentes e fecha o banco antes de sair, sem deixar processos para trás. */
function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      server?.kill();
      resolve();
    }, 8000);
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    server.postMessage({ type: 'shutdown' });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    showSplash();

    ipcMain.handle('dialog:pickFolder', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Escolha a pasta do projeto',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    });
    ipcMain.on('notify', (_event, title: string, body: string) => notify(title, body));

    if (!app.isPackaged) {
      setupUpdaterUnavailable('As atualizações automáticas funcionam no aplicativo instalado.');
    } else if (portableDir) {
      setupUpdaterUnavailable('A versão portátil não se atualiza sozinha. Baixe a versão nova em Releases, no GitHub. Seus dados continuam na pasta XinoIA-dados.');
    } else {
      setupUpdater({
        publicKey: fs.readFileSync(resource('update-public-key.pem'), 'utf8'),
        notify,
        activeRuns: async () => (await apiCall<{ activeRuns: number }>('GET', '/api/system')).activeRuns,
        backup: async () => {
          await apiCall('POST', '/api/system/backup');
        },
        beforeQuit: async () => {
          quitting = true;
          await stopServer();
        },
      });
    }

    try {
      connection = await startServer();
      createWindow();
      await loadApp();
    } catch (error) {
      fatal(error);
    }
  });

  let stopped = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (stopped || !server) return;
    event.preventDefault();
    void stopServer().then(() => {
      stopped = true;
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

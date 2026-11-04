import { contextBridge, ipcRenderer } from 'electron';

// A página vê só esta lista de funções, e nada do Node ou do Electron.
contextBridge.exposeInMainWorld('xinoia', {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  notify: (title: string, body: string) => ipcRenderer.send('notify', String(title), String(body)),
  updates: {
    getState: () => ipcRenderer.invoke('updates:getState'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    dismiss: () => ipcRenderer.invoke('updates:dismiss'),
    install: (force: boolean) => ipcRenderer.invoke('updates:install', Boolean(force)),
    setAutoCheck: (value: boolean) => ipcRenderer.invoke('updates:setAutoCheck', Boolean(value)),
    setChannel: (value: 'latest' | 'beta') => ipcRenderer.invoke('updates:setChannel', value === 'beta' ? 'beta' : 'latest'),
    onChange: (listener: (state: unknown) => void) => {
      const wrapped = (_event: unknown, state: unknown) => listener(state);
      ipcRenderer.on('updates:changed', wrapped);
      return () => ipcRenderer.removeListener('updates:changed', wrapped);
    },
  },
});

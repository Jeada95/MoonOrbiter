import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splashApi', {
  selectFolder: (): Promise<{ path: string | null; error: string | null }> =>
    ipcRenderer.invoke('splash-select-folder'),
  confirmFolder: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('splash-confirm-folder', folderPath),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('splash-open-external', url),
});

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('moonOrbiterElectron', {
  isElectron: true,
  getDataBaseUrl: (): Promise<string> => ipcRenderer.invoke('get-data-base-url'),
  getAvailableGrids: (): Promise<number[]> => ipcRenderer.invoke('get-available-grids'),
  getDataFolderPath: (): Promise<string> => ipcRenderer.invoke('get-data-folder-path'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
});

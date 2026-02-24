import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('moonOrbiterElectron', {
  isElectron: true,
  getDataBaseUrl: (): Promise<string> => ipcRenderer.invoke('get-data-base-url'),
  getAvailableGrids: (): Promise<number[]> => ipcRenderer.invoke('get-available-grids'),
  getDataFolderPath: (): Promise<string> => ipcRenderer.invoke('get-data-folder-path'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('toggle-fullscreen'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('quit-app'),

  // Data Manager
  getDataPackStatuses: (): Promise<any[]> => ipcRenderer.invoke('get-data-pack-statuses'),
  downloadDataPack: (packId: string): Promise<number[]> => ipcRenderer.invoke('download-data-pack', packId),
  refreshAvailableGrids: (): Promise<number[]> => ipcRenderer.invoke('refresh-available-grids'),
  onDownloadProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('download-progress', handler);
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress');
  },
});

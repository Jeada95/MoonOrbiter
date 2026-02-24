import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig, validateDataFolder, detectAvailableGrids, AppConfig } from './config-store';
import { startDataServer, DataServer } from './data-server';

// Ensure consistent userData path in dev and production
app.setName('moon-orbiter');
// Force userData path explicitly (app.setName alone may not work reliably in dev)
app.setPath('userData', path.join(app.getPath('appData'), 'moon-orbiter'));

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
try { require('electron-squirrel-startup'); } catch {}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let dataServer: DataServer | null = null;
let config: AppConfig | null = null;
let availableGrids: number[] = [];

const isDev = !!process.env.VITE_DEV_SERVER_URL;

function getPreloadPath(name: string): string {
  return path.join(__dirname, `${name}.js`);
}

// ─── Splash Window (first-launch folder picker) ────────────────

function showSplash(): Promise<string> {
  return new Promise((resolve) => {
    splashWindow = new BrowserWindow({
      width: 600,
      height: 420,
      resizable: false,
      frame: false,
      center: true,
      backgroundColor: '#0a0a1a',
      webPreferences: {
        preload: getPreloadPath('splash-preload'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    splashWindow.loadFile(path.join(__dirname, '..', 'electron', 'splash.html'));

    // IPC: select folder dialog
    ipcMain.handle('splash-select-folder', async () => {
      const result = await dialog.showOpenDialog(splashWindow!, {
        title: 'Sélectionnez le dossier de données MoonOrbiter',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) return { path: null, error: null };

      const folder = result.filePaths[0];
      const error = validateDataFolder(folder);
      return { path: folder, error };
    });

    // IPC: confirm folder selection
    ipcMain.handle('splash-confirm-folder', async (_event, folderPath: string) => {
      splashWindow?.close();
      splashWindow = null;
      resolve(folderPath);
    });

    // IPC: open external link (validate URL scheme for security)
    ipcMain.handle('splash-open-external', async (_event, url: string) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url);
      }
    });

    // If the splash window is closed without selecting, quit
    splashWindow.on('closed', () => {
      splashWindow = null;
      // Clean up splash IPC handlers
      ipcMain.removeHandler('splash-select-folder');
      ipcMain.removeHandler('splash-confirm-folder');
      ipcMain.removeHandler('splash-open-external');
      if (!mainWindow) app.quit();
    });
  });
}

// ─── Main Window ────────────────────────────────────────────────

let ipcRegistered = false;

function registerMainIpcHandlers(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('get-data-base-url', () => {
    if (isDev) return ''; // In dev, Vite plugin serves /moon-data/
    return dataServer ? `http://127.0.0.1:${dataServer.port}` : '';
  });
  ipcMain.handle('get-available-grids', () => availableGrids);
  ipcMain.handle('get-data-folder-path', () => config?.dataFolder || '');
  ipcMain.handle('get-version', () => app.getVersion());

  // Secure external link opener (validate URL scheme)
  ipcMain.handle('open-external', async (_event, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
  });

  // Fullscreen toggle — returns new fullscreen state
  ipcMain.handle('toggle-fullscreen', () => {
    if (mainWindow) {
      const newState = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(newState);
      return newState;
    }
    return false;
  });

  // Quit app
  ipcMain.handle('quit-app', () => {
    app.quit();
  });
}

async function createMainWindow(): Promise<void> {
  const bounds = config?.windowBounds || { width: 1400, height: 900 };

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'MoonOrbiter',
    show: false,
    webPreferences: {
      preload: getPreloadPath('preload'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  // Maximize and show once ready
  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow!.show());

  // Ctrl+Shift+D toggles DevTools (works in production too)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'd') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // Register IPC handlers (only once — they persist for the app lifetime)
  registerMainIpcHandlers();

  // Load the app
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Save window bounds on resize/move
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    if (config) {
      config.windowBounds = bounds;
      saveConfig(config);
    }
  };
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log('[main] userData:', app.getPath('userData'));

  // Step 1: Load or create config
  config = loadConfig();
  console.log('[main] Config loaded:', config ? config.dataFolder : 'null (showing splash)');

  // Step 2: If no valid data folder, show splash
  if (!config) {
    const folderPath = await showSplash();
    config = { dataFolder: folderPath };
    saveConfig(config);
  }

  // Step 3: Detect available grid levels
  availableGrids = detectAvailableGrids(config.dataFolder);
  console.log('[main] Available grids:', availableGrids);

  // Step 4: Start data server (only in production mode)
  if (!isDev) {
    dataServer = await startDataServer(config.dataFolder);
    console.log(`[main] Data server on port ${dataServer.port}`);
  }

  // Step 5: Create main window
  await createMainWindow();
});

app.on('window-all-closed', () => {
  if (dataServer) dataServer.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

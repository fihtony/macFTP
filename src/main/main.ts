import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import './services/ftpHandlers';
import { saveSites, loadSites, cleanupCorruptedData, saveAllDownloads, loadAllDownloads, initializeEncryptionKey } from './services/database';
import { cleanupAllTempFiles } from './services/ftpHandlers';

// Set application name for macOS menu bar - MUST be called BEFORE any other app methods
// This ensures the menu bar and dock show the correct name
// In development, we need to set it very early
if (process.platform === 'darwin') {
  // Force set name early
  app.setName('MacFTP');
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  // Destroy existing window if any
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Frameless window for custom title bar (prevents overlap)
    show: true, // Explicitly show the window
    backgroundColor: '#1e1e1e', // Match app background color
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Show window immediately and ensure it's on top
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  
  // Ensure window is visible (bring to front)
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  // In production, load the dist/index.html.
  // In development, load the Vite dev server.
  if (process.env.NODE_ENV === 'development') {
    // Wait a moment for Vite to be ready, then load
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.loadURL('http://localhost:5173').catch(err => {
          console.error('Failed to load Vite dev server:', err);
          // Retry after a short delay
          setTimeout(() => {
            if (mainWindow) {
              mainWindow.loadURL('http://localhost:5173');
            }
          }, 2000);
        });
      }
    }, 500);
    // Don't open DevTools by default, user can toggle with Cmd+Option+I
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Ensure window is shown when content is loaded
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
      console.log('Window should now be visible');
    }
  });

  // Keyboard shortcut to toggle DevTools (Cmd+Option+I on Mac, Ctrl+Shift+I on Windows/Linux)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key.toLowerCase() === 'i' && 
        input.control && input.shift && !input.alt && !input.meta) {
      // Ctrl+Shift+I (Windows/Linux)
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
      event.preventDefault();
    } else if (input.key.toLowerCase() === 'i' && 
               input.meta && input.alt && !input.control && !input.shift) {
      // Cmd+Option+I (Mac)
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
      event.preventDefault();
    } else if (input.key === 'F12') {
      // F12 key (universal)
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
      event.preventDefault();
    }
  });

  // Handle renderer errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  // Handle unresponsive renderer
  mainWindow.webContents.on('unresponsive', () => {
    console.error('Renderer process unresponsive');
  });

  // Suppress DevTools autofill errors (non-critical warnings)
  // Note: console-message is deprecated, but we keep it for now to filter warnings
  mainWindow.webContents.on('console-message', (event: any, level: number, message: string) => {
    // Filter out Autofill-related DevTools warnings
    if (message.includes('Autofill') || message.includes('autofill') || 
        message.includes('setAddresses') || message.includes('protocol_client')) {
      // Silently ignore these non-critical warnings by preventing default
      event.preventDefault();
      return;
    }
  });

  // Set icon path if available - use the same icon for window and about panel
  const iconPath = path.join(__dirname, '../assets/icons/icon.png');
  const iconPathIcons = path.join(__dirname, '../assets/icons/icon.icns');
  try {
    const fs = require('fs');
    let finalIconPath: string | null = null;
    if (fs.existsSync(iconPathIcons)) {
      finalIconPath = iconPathIcons;
    } else if (fs.existsSync(iconPath)) {
      finalIconPath = iconPath;
    }
    
    if (finalIconPath) {
      mainWindow.setIcon(finalIconPath);
      if (process.platform === 'darwin') {
        app.dock?.setIcon(finalIconPath); // Set dock icon on macOS
        // Update About panel icon to match window/dock icon
        app.setAboutPanelOptions({
          applicationName: 'MacFTP',
          applicationVersion: app.getVersion(),
          copyright: '© 2025 Tony Xu',
          credits: 'Data is stored locally, credentials are encrypted.',
          authors: ['Tony Xu'],
          iconPath: finalIconPath, // Use same icon as window and dock
        });
      }
    }
  } catch (e) {
    // Icon file might not exist yet, that's okay
  }
};

// Window control handlers (registered once, outside createWindow)
ipcMain.handle('window:minimize', () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win) win.minimize();
});

ipcMain.handle('window:maximize', () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win) win.close();
});

// File dialog handler
ipcMain.handle('dialog:selectFile', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win) return { cancelled: true };
  const properties = options.properties || ['openFile'];
  const result = await dialog.showOpenDialog(win, {
    ...options,
    properties,
  });
  return result;
});

// Create application menu for macOS
const createMenu = () => {
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.getName(),
        submenu: [
          {
            label: `About ${app.getName()}`,
            role: 'about',
          },
          { type: 'separator' },
          {
            label: 'Services',
            role: 'services',
            submenu: [],
          },
          { type: 'separator' },
          {
            label: `Hide ${app.getName()}`,
            accelerator: 'Command+H',
            role: 'hide',
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            role: 'hideOthers',
          },
          {
            label: 'Show All',
            role: 'unhide',
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => {
              app.quit();
            },
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: (item, focusedWindow) => {
              const win = (focusedWindow || mainWindow) as BrowserWindow | null;
              if (win && win.webContents) {
                if (win.webContents.isDevToolsOpened()) {
                  win.webContents.closeDevTools();
                } else {
                  win.webContents.openDevTools();
                }
              }
            },
          },
          { type: 'separator' },
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
          { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
          { type: 'separator' },
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
          { type: 'separator' },
          { label: 'Toggle Full Screen', accelerator: 'Ctrl+Cmd+F', role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
          { label: 'Minimize', accelerator: 'Cmd+M', role: 'minimize' },
          { label: 'Zoom', role: 'zoom' },
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' },
        ],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
};

// Set About panel options for macOS (will be updated with actual icon path after window creation)
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'MacFTP',
    applicationVersion: app.getVersion(),
    copyright: '© 2025',
    credits: 'FTP/SFTP Client for macOS',
    authors: ['MacFTP Team'],
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // Initialize encryption key from Keychain (or fallback to electron-store)
  await initializeEncryptionKey();
  
  // App name should already be set above, but ensure it's set
  if (process.platform === 'darwin') {
    app.setName('MacFTP');
  }
  
  // Clean up any corrupted encrypted data on startup
  try {
    cleanupCorruptedData();
  } catch (e) {
    console.warn('Error cleaning up corrupted data:', e);
  }
  
  createMenu();
  createWindow();
  
  // Ensure window is visible and focused
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  }
  
  app.on('activate', () => {
    // On macOS it's common to re-create a window when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      // If window exists but is hidden, show it
      // Use mainWindow directly instead of getAllWindows to avoid type issues
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.moveTop();
      } else {
        // If mainWindow is null or destroyed, recreate it
        createWindow();
      }
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  // Cleanup temp files before closing
  cleanupAllTempFiles();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Also cleanup on before-quit for macOS
app.on('before-quit', () => {
  cleanupAllTempFiles();
});


// Database handlers
ipcMain.handle('store:saveSites', (event, sites: any[]) => {
  saveSites(sites);
  return { success: true };
});

ipcMain.handle('store:loadSites', () => {
  return { success: true, sites: loadSites() };
});

// Download history handlers
ipcMain.handle('store:saveDownloads', (event, downloads: any[]) => {
  try {
    console.log('[IPC] Saving downloads:', downloads.length, 'items');
    saveAllDownloads(downloads);
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] Error saving downloads:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('store:loadDownloads', () => {
  try {
    console.log('[IPC] Loading downloads from database...');
    const downloads = loadAllDownloads();
    console.log('[IPC] Loaded', downloads.length, 'downloads from database');
    return { success: true, downloads };
  } catch (error: any) {
    console.error('[IPC] Error loading downloads:', error);
    return { success: false, error: error.message, downloads: [] };
  }
});


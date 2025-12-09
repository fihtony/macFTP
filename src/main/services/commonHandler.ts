import { ipcMain, dialog, BrowserWindow } from 'electron';
import Client from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Client Instances and Connection State
// ============================================================================

export let sftpClient: Client | null = null;
export let ftpClient: ftp.Client | null = null;
export let currentProtocol: 'ftp' | 'sftp' | null = null;
export let currentConnectionConfig: ConnectionConfig | null = null;

export function setSftpClient(client: Client | null) {
  sftpClient = client;
}

export function setFtpClient(client: ftp.Client | null) {
  ftpClient = client;
}

export function setCurrentProtocol(protocol: 'ftp' | 'sftp' | null) {
  currentProtocol = protocol;
}

export function setCurrentConnectionConfig(config: ConnectionConfig | null) {
  currentConnectionConfig = config;
}

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface ConnectionConfig {
  protocol: 'ftp' | 'sftp';
  host: string;
  port?: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyContent?: string;
  secure?: boolean;
  initialPath?: string;
}

export interface LocalFileEntry {
  localPath: string;
  relativePath: string;
  size: number;
}

export interface LocalDirectoryEntry {
  relativePath: string;
}

export interface CollectedEntries {
  files: LocalFileEntry[];
  directories: LocalDirectoryEntry[];
  totalBytes: number;
  totalFiles: number;
}

export interface RemoteFileEntry {
  remotePath: string;
  relativePath: string;
  size: number;
}

export interface RemoteDirectoryEntry {
  relativePath: string;
}

export interface CollectedRemoteEntries {
  files: RemoteFileEntry[];
  directories: RemoteDirectoryEntry[];
  totalBytes: number;
  totalFiles: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

// Track temp files for cleanup
const tempFiles = new Set<string>();

export function addTempFile(filePath: string) {
  tempFiles.add(filePath);
}

export function removeTempFile(filePath: string) {
  tempFiles.delete(filePath);
}

export const cleanupTempFile = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[Cleanup] Deleted temp file:', filePath);
    }
    tempFiles.delete(filePath);
  } catch (err) {
    console.error('[Cleanup] Error deleting temp file:', err);
  }
};

export const cleanupAllTempFiles = () => {
  console.log('[Cleanup] Cleaning up', tempFiles.size, 'temp files');
  tempFiles.forEach((filePath) => cleanupTempFile(filePath));
};

const pendingFileNames = new Set<string>();

export const generateUniqueFileName = (dir: string, fileName: string): string => {
  const baseName = path.parse(fileName).name;
  const ext = path.parse(fileName).ext;
  let counter = 1;
  let newName = fileName;

  while (fs.existsSync(path.join(dir, newName)) || pendingFileNames.has(path.join(dir, newName))) {
    newName = `${baseName} (${counter})${ext}`;
    counter++;
  }

  pendingFileNames.add(path.join(dir, newName));
  setTimeout(() => pendingFileNames.delete(path.join(dir, newName)), 5000);

  return newName;
};

export const formatFile = (file: any, protocol: 'ftp' | 'sftp') => {
  if (protocol === 'ftp') {
    return {
      name: file.name,
      type: file.type === ftp.FileType.Directory ? 'd' : file.type === ftp.FileType.SymbolicLink ? 'l' : '-',
      size: file.size || 0,
      date: file.modifiedAt ? file.modifiedAt.getTime() : Date.now(),
      rights: file.permissions ? file.permissions.toString() : '0',
      owner: file.user || 'unknown',
      group: file.group || 'unknown'
    };
  } else {
    return {
      name: file.name,
      type: file.type === 'd' ? 'd' : file.type === 'l' ? 'l' : '-',
      size: file.size || 0,
      date: file.modifyTime || Date.now(),
      rights: file.rights || {},
      owner: file.owner || 'unknown',
      group: file.group || 'unknown'
    };
  }
};

export const removeFtpDirectoryRecursive = async (client: ftp.Client, dirPath: string) => {
  const list = await client.list(dirPath);
  for (const item of list) {
    const itemPath = `${dirPath}/${item.name}`;
    if (item.type === ftp.FileType.Directory) {
      await removeFtpDirectoryRecursive(client, itemPath);
    } else {
      await client.remove(itemPath);
    }
  }
  await client.removeDir(dirPath);
};

export const runExclusiveFtpOperation = async <T>(operationName: string, operation: () => Promise<T>): Promise<T> => {
  console.log(`[FTP Operation] Starting: ${operationName}`);
  try {
    const result = await operation();
    console.log(`[FTP Operation] Completed: ${operationName}`);
    return result;
  } catch (err) {
    console.error(`[FTP Operation] Failed: ${operationName}`, err);
    throw err;
  }
};

// ============================================================================
// Keep-Alive for Connection
// ============================================================================

const KEEP_ALIVE_INTERVAL = 30000; // 30 seconds
let keepAliveTimer: NodeJS.Timeout | null = null;

export const startKeepAlive = () => {
  stopKeepAlive();
  keepAliveTimer = setInterval(async () => {
    try {
      if (currentProtocol === 'sftp' && sftpClient) {
        await sftpClient.list('/');
      } else if (currentProtocol === 'ftp' && ftpClient) {
        await ftpClient.pwd();
      }
    } catch (err) {
      console.error('[Keep-Alive] Error:', err);
    }
  }, KEEP_ALIVE_INTERVAL);
};

export const stopKeepAlive = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
};

// ============================================================================
// IPC Handlers - Connection
// ============================================================================

ipcMain.handle('ftp:connect', async (event, config: ConnectionConfig) => {
  try {
    if (sftpClient) {
      await sftpClient.end();
      sftpClient = null;
    }
    if (ftpClient) {
      await ftpClient.close();
      ftpClient = null;
    }

    currentConnectionConfig = config;
    currentProtocol = config.protocol;
    isDisconnected = false; // Reset disconnected flag on connect

    if (config.protocol === 'sftp') {
      sftpClient = new Client();
      await sftpClient.connect({
        host: config.host,
        port: config.port || 22,
        username: config.user,
        password: config.password,
        readyTimeout: 30000
      });
    } else {
      ftpClient = new ftp.Client();
      ftpClient.ftp.verbose = false;
      await ftpClient.access({
        host: config.host,
        port: config.port || 21,
        user: config.user,
        password: config.password,
        secure: config.secure || false
      });
    }

    startKeepAlive();
    return { success: true };
  } catch (err: any) {
    console.error('[Error] Connection failed:', { host: config.host, port: config.port, protocol: config.protocol, error: err.message, code: err.code });
    currentProtocol = null;
    currentConnectionConfig = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:disconnect', async () => {
  try {
    stopKeepAlive();
    
    // Set disconnected flag to prevent new downloads from starting
    isDisconnected = true;

    // Cancel all downloads (active and queued) before disconnecting
    // This ensures downloads are properly marked as failed and moved to history
    const { cancelAllDownloads } = await import('./downloadFileHandler');
    const { cancelAllFolderDownloads } = await import('./downloadFolderHandler');
    
    // Cancel all downloads - this will send failure notifications
    cancelAllDownloads('failed');
    cancelAllFolderDownloads('failed');
    
    // Give a brief moment for notifications to be sent
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (sftpClient) {
      await sftpClient.end();
      sftpClient = null;
    }
    if (ftpClient) {
      await ftpClient.close();
      ftpClient = null;
    }
    currentProtocol = null;
    currentConnectionConfig = null;
    return { success: true };
  } catch (err: any) {
    console.error('[Error] Disconnect failed:', { error: err.message });
    return { success: false, error: err.message };
  }
});

// ============================================================================
// IPC Handlers - File Operations
// ============================================================================

ipcMain.handle('ftp:list', async (event, dirPath: string) => {
  try {
    if (currentProtocol === 'sftp' && sftpClient) {
      const list = await sftpClient.list(dirPath);
      return { success: true, files: list.map((f) => formatFile(f, 'sftp')) };
    } else if (currentProtocol === 'ftp' && ftpClient) {
      const list = await ftpClient.list(dirPath);
      return { success: true, files: list.map((f) => formatFile(f, 'ftp')) };
    } else {
      return { success: false, error: 'Not connected' };
    }
  } catch (err: any) {
    console.error('[Error] List directory failed:', { dirPath, error: err.message, code: err.code });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:delete-entry', async (_event, { targetPath, isDirectory }: { targetPath: string, isDirectory: boolean }) => {
  try {
    if (currentProtocol === 'sftp' && sftpClient) {
      if (isDirectory) {
        await sftpClient.rmdir(targetPath, true);
      } else {
        await sftpClient.delete(targetPath);
      }
    } else if (currentProtocol === 'ftp' && ftpClient) {
      if (isDirectory) {
        await removeFtpDirectoryRecursive(ftpClient, targetPath);
      } else {
        await ftpClient.remove(targetPath);
      }
    } else {
      throw new Error('Not connected');
    }
    return { success: true };
  } catch (err: any) {
    console.error('[Delete] Failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:create-directory', async (_event, { targetPath }: { targetPath: string }) => {
  try {
    if (currentProtocol === 'sftp' && sftpClient) {
      await sftpClient.mkdir(targetPath, true);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      const previousDir = await ftpClient.pwd();
      await ftpClient.ensureDir(targetPath);
      await ftpClient.cd(previousDir);
    } else {
      throw new Error('Not connected');
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs:path-info', async (_event, { targetPath }: { targetPath: string }) => {
  try {
    const stats = fs.statSync(targetPath);
    return { success: true, isDirectory: stats.isDirectory() };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Recursively collect all files from a folder (including empty folders)
ipcMain.handle('fs:collect-folder-files', async (_event, { folderPath, baseRemotePath }: { folderPath: string; baseRemotePath: string }) => {
  const files: Array<{ name: string; localPath: string; remotePath: string; size: number }> = [];
  const emptyFolders: Array<{ name: string; localPath: string; remotePath: string }> = [];

  const walk = async (currentPath: string, relativePath: string) => {
    try {
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      let hasFiles = false;

      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
        const entryRemotePath = baseRemotePath === '/' ? `/${entryRelativePath}` : `${baseRemotePath}/${entryRelativePath}`;

        if (entry.isDirectory()) {
          // Recursively walk subdirectories
          await walk(entryPath, entryRelativePath);
          hasFiles = true; // Subdirectory exists, so this directory is not empty
        } else if (entry.isFile()) {
          // Add file
          hasFiles = true;
          try {
            const stats = await fs.promises.stat(entryPath);
            files.push({
              name: entry.name,
              localPath: entryPath,
              remotePath: entryRemotePath,
              size: stats.size
            });
          } catch (err: any) {
            console.error(`[fs:collect-folder-files] Failed to get file stats for ${entryPath}:`, err);
          }
        }
      }
      
      // If this directory is empty, add it to emptyFolders list
      if (!hasFiles && relativePath) {
        const folderRemotePath = baseRemotePath === '/' ? `/${relativePath}` : `${baseRemotePath}/${relativePath}`;
        emptyFolders.push({
          name: path.basename(relativePath),
          localPath: currentPath,
          remotePath: folderRemotePath
        });
      }
    } catch (err: any) {
      console.error(`[fs:collect-folder-files] Failed to read directory ${currentPath}:`, err);
    }
  };

  try {
    await walk(folderPath, '');
    // Return both files and empty folders (empty folders will need to be created separately)
    return { success: true, files, emptyFolders };
  } catch (err: any) {
    return { success: false, error: err.message, files: [], emptyFolders: [] };
  }
});

ipcMain.handle('ftp:chmod', async (event, { path: remotePath, mode }: { path: string, mode: string }) => {
  try {
    if (currentProtocol === 'sftp' && sftpClient) {
      await sftpClient.chmod(remotePath, mode);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      try {
        await ftpClient.send(`SITE CHMOD ${mode} ${remotePath}`);
      } catch (e) {
        throw new Error('CHMOD failed: ' + (e as any).message);
      }
    } else {
      throw new Error('Not connected');
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:check-exists', async (_event, remotePath: string) => {
  try {
    if (!currentProtocol) {
      return { success: false, error: 'Not connected' };
    }

    let exists = false;
    if (currentProtocol === 'sftp' && sftpClient) {
      try {
        await sftpClient.stat(remotePath);
        exists = true;
      } catch (err: any) {
        exists = false;
      }
    } else if (currentProtocol === 'ftp' && ftpClient) {
      try {
        await ftpClient.size(remotePath);
        exists = true;
      } catch (err: any) {
        exists = false;
      }
    }

    return { success: true, exists };
  } catch (err: any) {
    console.error('[Check Exists] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:quick-view', async (event, remotePath: string) => {
  try {
    const tempDir = os.tmpdir();
    const fileName = path.basename(remotePath);
    const tempFilePath = path.join(tempDir, `preview-${Date.now()}-${fileName}`);

    if (currentProtocol === 'sftp' && sftpClient) {
      await sftpClient.fastGet(remotePath, tempFilePath);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      await ftpClient.downloadTo(tempFilePath, remotePath);
    } else {
      throw new Error('Not connected');
    }

    tempFiles.add(tempFilePath);
    return { success: true, tempFilePath };
  } catch (err: any) {
    console.error('[Quick View] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:preview-file', async (event, { remotePath, fileName }: { remotePath: string, fileName: string }) => {
  try {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `preview-${Date.now()}-${fileName}`);

    if (currentProtocol === 'sftp' && sftpClient) {
      await sftpClient.fastGet(remotePath, tempFilePath);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      await ftpClient.downloadTo(tempFilePath, remotePath);
    } else {
      throw new Error('Not connected');
    }

    const ext = path.extname(fileName).toLowerCase();
    const textExtensions = ['.txt', '.log', '.md', '.json', '.xml', '.csv', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.yaml', '.yml', '.ini', '.conf', '.cfg'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];

    const isText = textExtensions.includes(ext);
    const isImage = imageExtensions.includes(ext);

    if (isText) {
      const content = fs.readFileSync(tempFilePath, 'utf-8');
      tempFiles.add(tempFilePath);
      return { success: true, data: content, isText: true, tempPath: tempFilePath };
    } else if (isImage) {
      const imageData = fs.readFileSync(tempFilePath);
      const base64 = imageData.toString('base64');
      const mimeType = ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
          ext === '.gif' ? 'image/gif' :
            ext === '.webp' ? 'image/webp' :
              ext === '.svg' ? 'image/svg+xml' :
                'image/png';

      tempFiles.add(tempFilePath);
      return {
        success: true,
        imageDataUrl: `data:${mimeType};base64,${base64}`,
        tempPath: tempFilePath
      };
    } else {
      cleanupTempFile(tempFilePath);
      return { success: false, error: 'Unsupported file type for preview' };
    }
  } catch (err: any) {
    console.error('[Preview] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:cleanup-temp-file', async (event, tempPath: string) => {
  cleanupTempFile(tempPath);
  return { success: true };
});

ipcMain.handle('ftp:save-temp-file', async (event, { tempPath, fileName }: { tempPath: string, fileName: string }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) {
      return { success: false, error: 'No window' };
    }

    const result = await dialog.showSaveDialog(win, {
      defaultPath: fileName,
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, cancelled: true };
    }

    fs.copyFileSync(tempPath, result.filePath);
    return { success: true, savedPath: result.filePath };
  } catch (err: any) {
    console.error('[Save Temp File] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:get-path-suggestions', async (event, targetPath: string) => {
  try {
    if (!currentProtocol) {
      return { success: true, suggestions: [] };
    }

    const parentPath = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) || '/' : '/';
    const searchTerm = targetPath.includes('/') ? targetPath.substring(targetPath.lastIndexOf('/') + 1).toLowerCase() : targetPath.toLowerCase();

    let files;
    if (currentProtocol === 'sftp' && sftpClient) {
      files = await sftpClient.list(parentPath);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      files = await ftpClient.list(parentPath);
    } else {
      return { success: false, error: 'Not connected' };
    }

    let suggestions: string[];
    if (searchTerm === '') {
      suggestions = files
        .filter(file => file.type === 'd' || (currentProtocol === 'ftp' && file.type === ftp.FileType.Directory))
        .map(file => `${parentPath}/${file.name}`.replace('//', '/'))
        .slice(0, 10);
    } else {
      suggestions = files
        .filter(file => {
          const isDir = file.type === 'd' || (currentProtocol === 'ftp' && file.type === ftp.FileType.Directory);
          return isDir && file.name.toLowerCase().startsWith(searchTerm);
        })
        .map(file => `${parentPath}/${file.name}`.replace('//', '/'))
        .slice(0, 10);
    }

    return { success: true, suggestions };
  } catch (err: any) {
    console.error('Error getting path suggestions:', err);
    return { success: true, suggestions: [] };
  }
});

// Note: 'settings:update-max-downloads' is handled in downloadFileHandler.ts

// Consolidated upload cancel handler (both file and folder uploads share uploadControllers from uploadFileHandler)
ipcMain.handle('upload:cancel', async (_event, { uploadId }: { uploadId: string }) => {
  const { uploadControllers, uploadStates, notifyUploadProgress } = await import('./uploadFileHandler');
  
  const controller = uploadControllers.get(uploadId);
  if (!controller) {
    // Upload not found - it may have already completed or been cleaned up
    // This is not an error, just return success since the frontend will handle cancellation via cancelRequested flag
    console.log('[Upload] Cancel request for uploadId not found (may have already completed):', { uploadId });
    return { success: true };
  }
  
  console.log('[Upload] Cancel request received:', { uploadId });
  controller.cancelRequested = true;
  const snapshot = uploadStates.get(uploadId);
  if (snapshot) {
    notifyUploadProgress({ ...snapshot, status: 'cancelled' });
  }
  console.log('[Upload] Cancel request confirmed:', { uploadId });
  
  return { success: true };
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  const { shell } = require('electron');
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err: any) {
    console.error('[Shell] Error opening external URL:', err);
    return { success: false, error: err.message };
  }
});

// ============================================================================
// Unified Download Queue Management
// ============================================================================

export interface UnifiedQueueItem {
  type: 'file' | 'folder';
  id: string;
  enqueueTime: number; // For FIFO ordering
  fileJob?: {
    job: any; // Will be typed by downloadFileHandler
    resolve: (value: { success: true; savedPath: string }) => void;
    reject: (reason: any) => void;
  };
  folderJob?: {
    id: string;
    remotePath: string;
    localPath: string;
    folderName: string;
    totalSize: number;
    totalFiles: number;
  };
}

// Unified queue for both file and folder downloads (FIFO order)
export const unifiedDownloadQueue: UnifiedQueueItem[] = [];
let totalActiveDownloads = 0; // Combined count of file + folder downloads
let isDisconnected = false; // Track if connection is disconnected to prevent new downloads

// Max concurrent downloads setting
export let MAX_CONCURRENT_DOWNLOADS = 3;

export const getMaxConcurrentDownloads = () => MAX_CONCURRENT_DOWNLOADS;

export const setMaxConcurrentDownloads = (max: number) => {
  MAX_CONCURRENT_DOWNLOADS = Math.max(1, Math.min(10, max));
};

// Callbacks for download processing
let startFileDownloadCallback: ((job: any) => Promise<void>) | null = null;
let startFolderDownloadCallback: ((id: string, remotePath: string, localPath: string, folderName: string) => Promise<void>) | null = null;
let notifyDownloadProgressCallback: ((update: any) => void) | null = null;

export const setStartFileDownloadCallback = (callback: (job: any) => Promise<void>) => {
  startFileDownloadCallback = callback;
};

export const setStartFolderDownloadCallback = (callback: (id: string, remotePath: string, localPath: string, folderName: string) => Promise<void>) => {
  startFolderDownloadCallback = callback;
};

export const setNotifyDownloadProgressCallback = (callback: (update: any) => void) => {
  notifyDownloadProgressCallback = callback;
};

export const getTotalActiveDownloads = () => totalActiveDownloads;

// Add item to unified queue
export const enqueueToUnifiedQueue = (item: UnifiedQueueItem) => {
  unifiedDownloadQueue.push(item);
  setImmediate(() => processUnifiedQueue());
};

// Cancel/remove item from unified queue
export const cancelQueuedDownload = (id: string): UnifiedQueueItem | null => {
  const index = unifiedDownloadQueue.findIndex(item => item.id === id);
  if (index !== -1) {
    const item = unifiedDownloadQueue.splice(index, 1)[0];
    console.log('[Unified Queue] Cancelled queued download:', id);
    return item;
  }
  return null;
};

// Cancel all downloads in unified queue
export const cancelAllQueuedDownloads = (reason: 'failed' | 'cancelled' = 'failed') => {
  console.log('[Unified Queue] Cancelling all queued downloads:', unifiedDownloadQueue.length);
  
  // Cancel all queued downloads
  while (unifiedDownloadQueue.length > 0) {
    const item = unifiedDownloadQueue.shift();
    if (!item) break;
    
    // Send failure notification
    if (notifyDownloadProgressCallback) {
      notifyDownloadProgressCallback({
        id: item.id,
        downloadedSize: 0,
        totalSize: item.type === 'file' ? item.fileJob?.job.totalSize || 0 : 0,
        status: reason,
        error: 'Connection terminated by user',
        actualFileName: item.type === 'file' ? item.fileJob?.job.fileName : item.folderJob?.folderName,
        localPath: item.type === 'file' ? item.fileJob?.job.localPath : (item.folderJob?.localPath ? path.join(item.folderJob.localPath, item.folderJob.folderName) : undefined),
        endTime: Date.now()
      });
    }
    
    // Reject promises for file downloads
    if (item.type === 'file' && item.fileJob) {
      item.fileJob.reject(new Error('Connection terminated by user'));
    }
  }
  
  // Reset counter
  totalActiveDownloads = 0;
};

// Process unified queue (FIFO order)
export const processUnifiedQueue = () => {
  const max = MAX_CONCURRENT_DOWNLOADS;
  
  // Don't process queue if disconnected
  if (isDisconnected) {
    console.log('[Unified Queue] Connection disconnected, not processing queue');
    return;
  }
  
  // Check if we're at the limit - if so, items stay in queue
  if (totalActiveDownloads >= max || unifiedDownloadQueue.length === 0) {
    if (totalActiveDownloads >= max && unifiedDownloadQueue.length > 0) {
      console.log('[Unified Queue] At max concurrent limit:', totalActiveDownloads, '/', max, 'Queue length:', unifiedDownloadQueue.length);
    }
    return;
  }
  
  // Get the next item (FIFO - first in, first out)
  const item = unifiedDownloadQueue.shift();
  if (!item) return;
  
  // Increment counter BEFORE starting download to reserve the slot
  totalActiveDownloads++;
  
  if (item.type === 'file' && item.fileJob && startFileDownloadCallback) {
    // Process file download
    console.log('[Unified Queue] Starting file download:', item.id, 'Active:', totalActiveDownloads, 'Queue:', unifiedDownloadQueue.length);
    
    startFileDownloadCallback(item)
      .then(() => {
        // Resolve/reject is handled in performFileDownload
      })
      .catch((err) => {
        // Error handling is done in performFileDownload
      })
      .finally(() => {
        totalActiveDownloads = Math.max(0, totalActiveDownloads - 1); // Ensure counter never goes negative
        console.log('[Unified Queue] File download finished:', item.id, 'Active:', totalActiveDownloads, 'Queue:', unifiedDownloadQueue.length);
        setTimeout(() => processUnifiedQueue(), 100);
      });
      
  } else if (item.type === 'folder' && item.folderJob && startFolderDownloadCallback) {
    // Process folder download
    console.log('[Unified Queue] Starting folder download:', item.id, 'Active:', totalActiveDownloads, 'Queue:', unifiedDownloadQueue.length);
    
    // Set status to 'downloading' immediately (like file downloads do)
    // This ensures the UI shows it as downloading even during setup phase
    if (notifyDownloadProgressCallback) {
      notifyDownloadProgressCallback({
        id: item.folderJob.id,
        downloadedSize: 0,
        totalSize: 0, // Will be updated after entries are collected
        status: 'downloading',
        startTime: Date.now(),
        localPath: item.folderJob.localPath ? path.join(item.folderJob.localPath, item.folderJob.folderName) : undefined,
        actualFileName: item.folderJob.folderName
      });
    }
    
    // Check if disconnected before starting
    if (isDisconnected) {
      console.log('[Unified Queue] Connection disconnected, cancelling folder download:', item.id);
      if (notifyDownloadProgressCallback) {
        notifyDownloadProgressCallback({
          id: item.folderJob.id,
          downloadedSize: 0,
          totalSize: 0,
          status: 'failed',
          error: 'Connection terminated by user',
          localPath: item.folderJob.localPath ? path.join(item.folderJob.localPath, item.folderJob.folderName) : undefined,
          actualFileName: item.folderJob.folderName,
          endTime: Date.now()
        });
      }
      totalActiveDownloads = Math.max(0, totalActiveDownloads - 1);
      return;
    }
    
    startFolderDownloadCallback(item.folderJob.id, item.folderJob.remotePath, item.folderJob.localPath, item.folderJob.folderName)
      .catch((err) => {
        console.error('[Unified Queue] Folder download error:', err);
      })
      .finally(() => {
        totalActiveDownloads = Math.max(0, totalActiveDownloads - 1); // Ensure counter never goes negative
        console.log('[Unified Queue] Folder download finished:', item.id, 'Active:', totalActiveDownloads, 'Queue:', unifiedDownloadQueue.length);
        setTimeout(() => processUnifiedQueue(), 100);
      });
  }
};

// ============================================================================
// Duplication Check and Resolution
// ============================================================================

export interface DuplicateResolutionResult {
  savedPath: string;
  actualFileName: string;
  duplicateAction: 'overwrite' | 'rename' | 'skip';
  applyToAll: boolean;
  cancelled?: boolean;
  skipped?: boolean;
  dialogCancelled?: boolean;
}

export interface DuplicateUploadResolutionResult {
  remotePath: string;
  actualFileName: string;
  duplicateAction: 'overwrite' | 'rename' | 'skip';
  applyToAll: boolean;
  cancelled?: boolean;
  skipped?: boolean;
  dialogCancelled?: boolean;
}

export const handleDuplicateFile = async (
  win: BrowserWindow,
  defaultPath: string,
  fileName: string,
  duplicateAction?: 'overwrite' | 'rename' | 'skip',
  applyToAll?: boolean,
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt'
): Promise<DuplicateResolutionResult> => {
  let finalDuplicateAction = duplicateAction;
  let finalApplyToAll = applyToAll || false;
  let savedFilePath: string;

  if (fs.existsSync(defaultPath)) {
    if (finalDuplicateAction && finalApplyToAll) {
      if (finalDuplicateAction === 'skip') {
        return { savedPath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: true, skipped: true };
      } else if (finalDuplicateAction === 'overwrite') {
        savedFilePath = defaultPath;
      } else {
        const uniqueFileName = generateUniqueFileName(path.dirname(defaultPath), fileName);
        savedFilePath = path.join(path.dirname(defaultPath), uniqueFileName);
      }
    } else if (defaultConflictResolution && defaultConflictResolution !== 'prompt') {
      // Use global default conflict resolution setting
      if (defaultConflictResolution === 'overwrite') {
        savedFilePath = defaultPath;
        finalDuplicateAction = 'overwrite';
      } else if (defaultConflictResolution === 'rename') {
        const uniqueFileName = generateUniqueFileName(path.dirname(defaultPath), fileName);
        savedFilePath = path.join(path.dirname(defaultPath), uniqueFileName);
        finalDuplicateAction = 'rename';
      } else { // skip
        return { savedPath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: false, skipped: true };
      }
    } else {
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Overwrite', 'Rename', 'Skip', 'Cancel'],
        defaultId: 1,
        title: 'File Already Exists',
        message: `The file "${fileName}" already exists.`,
        detail: `What would you like to do?`,
        checkboxLabel: 'Apply to all similar cases',
        checkboxChecked: false
      });
      
      if (result.response === 3) {
        return { savedPath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: false, cancelled: true, dialogCancelled: true };
      }
      
      if (result.response === 2) {
        return { savedPath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: false, skipped: true };
      }
      
      finalApplyToAll = result.checkboxChecked || false;
      
      if (result.response === 0) {
        finalDuplicateAction = 'overwrite';
        savedFilePath = defaultPath;
      } else {
        finalDuplicateAction = 'rename';
        const uniqueFileName = generateUniqueFileName(path.dirname(defaultPath), fileName);
        savedFilePath = path.join(path.dirname(defaultPath), uniqueFileName);
      }
    }
  } else {
    savedFilePath = defaultPath;
  }

  const actualFileName = path.basename(savedFilePath);
  return {
    savedPath: savedFilePath,
    actualFileName,
    duplicateAction: finalDuplicateAction || 'overwrite',
    applyToAll: finalApplyToAll
  };
};

export const handleDuplicateFolder = async (
  win: BrowserWindow,
  defaultPath: string,
  folderName: string,
  duplicateAction?: 'overwrite' | 'rename' | 'skip',
  applyToAll?: boolean,
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt'
): Promise<DuplicateResolutionResult> => {
  let finalDuplicateAction = duplicateAction;
  let finalApplyToAll = applyToAll || false;
  let savedFolderPath: string;

  if (fs.existsSync(defaultPath)) {
    if (finalDuplicateAction && finalApplyToAll) {
      if (finalDuplicateAction === 'skip') {
        return { savedPath: '', actualFileName: folderName, duplicateAction: 'skip', applyToAll: true, skipped: true };
      } else if (finalDuplicateAction === 'overwrite') {
        savedFolderPath = defaultPath;
      } else {
        const uniqueFolderName = generateUniqueFileName(path.dirname(defaultPath), folderName);
        savedFolderPath = path.join(path.dirname(defaultPath), uniqueFolderName);
      }
    } else if (defaultConflictResolution && defaultConflictResolution !== 'prompt') {
      if (defaultConflictResolution === 'overwrite') {
        savedFolderPath = defaultPath;
        finalDuplicateAction = 'overwrite';
      } else if (defaultConflictResolution === 'rename') {
        const uniqueFolderName = generateUniqueFileName(path.dirname(defaultPath), folderName);
        savedFolderPath = path.join(path.dirname(defaultPath), uniqueFolderName);
        finalDuplicateAction = 'rename';
      } else { // skip
        return { savedPath: '', actualFileName: folderName, duplicateAction: 'skip', applyToAll: false, skipped: true };
      }
    } else {
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Overwrite', 'Rename', 'Skip', 'Cancel'],
        defaultId: 1,
        title: 'Folder Already Exists',
        message: `The folder "${folderName}" already exists.`,
        detail: `What would you like to do?`,
        checkboxLabel: 'Apply to all similar cases',
        checkboxChecked: false
      });

      if (result.response === 3) { // Cancel
        return { savedPath: '', actualFileName: folderName, duplicateAction: 'skip', applyToAll: false, cancelled: true, dialogCancelled: true };
      }

      if (result.response === 2) { // Skip
        return { savedPath: '', actualFileName: folderName, duplicateAction: 'skip', applyToAll: false, skipped: true };
      }

      finalApplyToAll = result.checkboxChecked || false;

      if (result.response === 0) { // Overwrite
        finalDuplicateAction = 'overwrite';
        savedFolderPath = defaultPath;
      } else { // Rename
        finalDuplicateAction = 'rename';
        const uniqueFolderName = generateUniqueFileName(path.dirname(defaultPath), folderName);
        savedFolderPath = path.join(path.dirname(defaultPath), uniqueFolderName);
      }
    }
  } else {
    savedFolderPath = defaultPath;
  }

  const actualFolderName = path.basename(savedFolderPath);
  return {
    savedPath: savedFolderPath,
    actualFileName: actualFolderName,
    duplicateAction: finalDuplicateAction || 'overwrite',
    applyToAll: finalApplyToAll
  };
};

// ============================================================================
// Handle duplicate file during upload (similar to handleDuplicateFile but for remote files)
export const handleDuplicateUploadFile = async (
  win: BrowserWindow,
  remotePath: string,
  fileName: string,
  duplicateAction?: 'overwrite' | 'rename' | 'skip',
  applyToAll?: boolean,
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt'
): Promise<DuplicateUploadResolutionResult> => {
  let finalDuplicateAction = duplicateAction;
  let finalApplyToAll = applyToAll || false;
  let finalRemotePath: string = remotePath;

  // Check if remote file exists
  const checkRemoteExists = async (remotePath: string) => {
    try {
      if (currentProtocol === 'sftp' && sftpClient) {
        await sftpClient.stat(remotePath);
        return { success: true, exists: true };
      } else if (currentProtocol === 'ftp' && ftpClient) {
        await ftpClient.size(remotePath);
        return { success: true, exists: true };
      }
    } catch {
      return { success: true, exists: false };
    }
    return { success: false };
  };

  const existsResult = await checkRemoteExists(remotePath);
  
  if (existsResult.success && existsResult.exists) {
    console.log('[Duplicate Upload] Remote file exists:', remotePath);
    console.log('[Duplicate Upload] Default Conflict Resolution:', defaultConflictResolution);
    console.log('[Duplicate Upload] Session Conflict Resolution:', finalDuplicateAction);
    console.log('[Duplicate Upload] Apply to All Flag:', finalApplyToAll);
    
    if (finalDuplicateAction && finalApplyToAll) {
      console.log('[Duplicate Upload] Applying previous "apply to all" action:', finalDuplicateAction);
      if (finalDuplicateAction === 'skip') {
        return { remotePath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: true, skipped: true };
      } else if (finalDuplicateAction === 'overwrite') {
        finalRemotePath = remotePath;
      } else {
        // Rename: generate unique remote filename
        const pathParts = path.posix.parse(remotePath);
        const dir = pathParts.dir;
        const baseName = pathParts.name;
        const ext = pathParts.ext;
        let counter = 1;
        let newRemotePath: string;
        
        do {
          const newFileName = `${baseName} (${counter})${ext}`;
          newRemotePath = path.posix.join(dir, newFileName);
          const checkResult = await checkRemoteExists(newRemotePath);
          if (!checkResult.success || !checkResult.exists) {
            break;
          }
          counter++;
        } while (true);
        
        finalRemotePath = newRemotePath;
      }
    } else if (defaultConflictResolution && defaultConflictResolution !== 'prompt') {
      // Use global default conflict resolution setting
      if (defaultConflictResolution === 'overwrite') {
        finalRemotePath = remotePath;
        finalDuplicateAction = 'overwrite';
      } else if (defaultConflictResolution === 'rename') {
        // Rename: generate unique remote filename
        const pathParts = path.posix.parse(remotePath);
        const dir = pathParts.dir;
        const baseName = pathParts.name;
        const ext = pathParts.ext;
        let counter = 1;
        let newRemotePath: string;
        
        do {
          const newFileName = `${baseName} (${counter})${ext}`;
          newRemotePath = path.posix.join(dir, newFileName);
          const checkResult = await checkRemoteExists(newRemotePath);
          if (!checkResult.success || !checkResult.exists) {
            break;
          }
          counter++;
        } while (true);
        
        finalRemotePath = newRemotePath;
        finalDuplicateAction = 'rename';
      } else { // skip
        return { remotePath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: false, skipped: true };
      }
    } else {
      // Show dialog (same as download)
      console.log('[Duplicate Upload] Showing duplicate resolution dialog.');
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Overwrite', 'Rename', 'Skip', 'Cancel'],
        defaultId: 1,
        title: 'File Already Exists',
        message: `The file "${fileName}" already exists on the server.`,
        detail: `What would you like to do?`,
        checkboxLabel: 'Apply to all similar cases',
        checkboxChecked: false
      });
      
      console.log('[Duplicate Upload] User chose in dialog:', {
        response: result.response,
        checkboxChecked: result.checkboxChecked
      });
      
      if (result.response === 3) {
        return { remotePath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: false, cancelled: true, dialogCancelled: true };
      }
      
      if (result.response === 2) {
        finalApplyToAll = result.checkboxChecked || false;
        console.log('[Duplicate Upload] User chose Skip:', {
          sessionConflictResolution: 'skip',
          applyToAll: finalApplyToAll
        });
        return { remotePath: '', actualFileName: fileName, duplicateAction: 'skip', applyToAll: finalApplyToAll, skipped: true };
      }
      
      finalApplyToAll = result.checkboxChecked || false;
      
      if (result.response === 0) {
        finalDuplicateAction = 'overwrite';
        finalRemotePath = remotePath;
        console.log('[Duplicate Upload] User chose Overwrite:', {
          sessionConflictResolution: 'overwrite',
          applyToAll: finalApplyToAll
        });
      } else {
        finalDuplicateAction = 'rename';
        console.log('[Duplicate Upload] User chose Rename:', {
          sessionConflictResolution: 'rename',
          applyToAll: finalApplyToAll
        });
        // Rename: generate unique remote filename
        const pathParts = path.posix.parse(remotePath);
        const dir = pathParts.dir;
        const baseName = pathParts.name;
        const ext = pathParts.ext;
        let counter = 1;
        let newRemotePath: string;
        
        do {
          const newFileName = `${baseName} (${counter})${ext}`;
          newRemotePath = path.posix.join(dir, newFileName);
          const checkResult = await checkRemoteExists(newRemotePath);
          if (!checkResult.success || !checkResult.exists) {
            break;
          }
          counter++;
        } while (true);
        
        finalRemotePath = newRemotePath;
      }
    }
  } else {
    finalRemotePath = remotePath;
  }

  const actualFileName = path.posix.basename(finalRemotePath);
  console.log('[Duplicate Upload] Final resolution:', {
    remotePath: finalRemotePath,
    actualFileName,
    duplicateAction: finalDuplicateAction || 'overwrite',
    applyToAll: finalApplyToAll
  });
  return {
    remotePath: finalRemotePath,
    actualFileName,
    duplicateAction: finalDuplicateAction || 'overwrite',
    applyToAll: finalApplyToAll
  };
};

// IPC handler for handling duplicate upload files
ipcMain.handle('upload:handle-duplicate', async (event, {
  remotePath,
  fileName,
  duplicateAction,
  applyToAll,
  defaultConflictResolution
}: {
  remotePath: string;
  fileName: string;
  duplicateAction?: 'overwrite' | 'rename' | 'skip';
  applyToAll?: boolean;
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt';
}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { success: false, error: 'No window' };
  }

  try {
    const result = await handleDuplicateUploadFile(win, remotePath, fileName, duplicateAction, applyToAll, defaultConflictResolution);
    return { success: true, ...result };
  } catch (err: any) {
    console.error('[Upload] Error handling duplicate:', err);
    return { success: false, error: err.message };
  }
});

// Registration Function
// ============================================================================

export const registerFtpHandlers = () => {
  console.log('[Common Handlers] Registered');
  // Download and Upload handlers are registered in their respective modules
};


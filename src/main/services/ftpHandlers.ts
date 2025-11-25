import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import Client from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';

let sftpClient: Client | null = null;
let ftpClient: ftp.Client | null = null;
let currentProtocol: 'ftp' | 'sftp' | null = null;

// Track temp files for cleanup
const tempFiles = new Set<string>();

export interface ConnectionConfig {
  protocol: 'ftp' | 'sftp';
  host: string;
  port?: number;
  user: string;
  password?: string;
  privateKeyPath?: string; // For SFTP key auth
  privateKeyContent?: string; // For SFTP key auth (alternative to path)
}

// Helper to format file listing
const formatFile = (file: any, protocol: 'ftp' | 'sftp') => {
  if (protocol === 'sftp') {
    // ssh2-sftp-client format
    return {
      name: file.name,
      type: file.type, // d, -, l
      size: file.size,
      date: file.modifyTime, // ms timestamp
      rights: file.rights,
      owner: file.owner,
      group: file.group
    };
  } else {
    // basic-ftp format
    return {
      name: file.name,
      type: file.isDirectory ? 'd' : '-',
      size: file.size,
      date: file.rawModifiedAt ? new Date(file.rawModifiedAt).getTime() : Date.now(),
      rights: file.permissions,
      owner: file.user,
      group: file.group
    };
  }
};

const KEEP_ALIVE_INTERVAL = 30000; // 30 seconds
let keepAliveTimer: NodeJS.Timeout | null = null;

const startKeepAlive = () => {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(async () => {
    try {
      if (currentProtocol === 'sftp' && sftpClient) {
        // SFTP keep-alive: just verify connection or list current dir (lightweight)
        // ssh2-sftp-client doesn't have explicit no-op, usually the underlying connection handles it
        // but we can do a lightweight check.
        // However, ssh2 usually manages keepalive if configured. 
        // Let's do a stat on '.' to keep channel active if needed.
        await sftpClient.cwd(); 
      } else if (currentProtocol === 'ftp' && ftpClient) {
        if (!ftpClient.closed) {
           await ftpClient.send('NOOP');
        }
      }
    } catch (e) {
      console.error('Keep-alive failed', e);
      // If keep-alive fails, connection might be dead.
    }
  }, KEEP_ALIVE_INTERVAL);
};

ipcMain.handle('ftp:connect', async (event, config: ConnectionConfig) => {
  try {
    // Disconnect existing
    if (sftpClient) {
      await sftpClient.end();
      sftpClient = null;
    }
    if (ftpClient) {
      ftpClient.close();
      ftpClient = null;
    }
    if (keepAliveTimer) clearInterval(keepAliveTimer);

    currentProtocol = config.protocol;

    if (config.protocol === 'sftp') {
      sftpClient = new Client();
      const connectConfig: any = {
        host: config.host,
        port: config.port || 22,
        username: config.user,
        // Add basic keepalive options for SSH layer
        readyTimeout: 20000,
        keepaliveInterval: 10000, 
        keepaliveCountMax: 5
      };
      
      // SSH key authentication - prefer key content over path
      if (config.privateKeyContent) {
        connectConfig.privateKey = config.privateKeyContent;
      } else if (config.privateKeyPath) {
        connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
      } else {
        connectConfig.password = config.password;
      }

      await sftpClient.connect(connectConfig);
      startKeepAlive();
      return { success: true, message: 'Connected via SFTP' };

    } else {
      ftpClient = new ftp.Client();
      ftpClient.ftp.verbose = true;
      await ftpClient.access({
        host: config.host,
        port: config.port || 21,
        user: config.user,
        password: config.password,
        secure: false
      });
      startKeepAlive();
      return { success: true, message: 'Connected via FTP' };
    }
  } catch (err: any) {
    console.error('Connection failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:disconnect', async () => {
  try {
    // Clean up all temporary preview files before disconnecting
    cleanupAllTempFiles();
    
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
    if (sftpClient) {
      await sftpClient.end();
      sftpClient = null;
    }
    if (ftpClient) {
      ftpClient.close();
      ftpClient = null;
    }
    currentProtocol = null;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:list', async (event, dirPath: string) => {
  try {
    if (currentProtocol === 'sftp' && sftpClient) {
      const list = await sftpClient.list(dirPath);
      return { success: true, files: list.map(f => formatFile(f, 'sftp')) };
    } else if (currentProtocol === 'ftp' && ftpClient) {
      const list = await ftpClient.list(dirPath);
      return { success: true, files: list.map(f => formatFile(f, 'ftp')) };
    } else {
      throw new Error('Not connected');
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:download', async (event, { remotePath, fileName }: { remotePath: string, fileName: string }) => {
    try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            console.error('[Download] No window available');
            return { success: false, error: 'No window' };
        }

        console.log('[Download] Starting download:', { remotePath, fileName });
        const { filePath, canceled } = await dialog.showSaveDialog(win, {
            defaultPath: fileName
        });

        if (canceled || !filePath) {
            console.log('[Download] User cancelled save dialog');
            return { success: false, cancelled: true, canceled: true }; // Support both spellings
        }

        console.log('[Download] Save path selected:', filePath);
        
        // Store filePath in a const to ensure it's preserved
        const savedFilePath = filePath;

        if (currentProtocol === 'sftp' && sftpClient) {
            console.log('[Download] Downloading via SFTP...');
            await sftpClient.get(remotePath, savedFilePath);
        } else if (currentProtocol === 'ftp' && ftpClient) {
            console.log('[Download] Downloading via FTP...');
            await ftpClient.downloadTo(savedFilePath, remotePath);
        } else {
            throw new Error('Not connected');
        }

        console.log('[Download] Download successful');
        console.log('[Download] Saved file path:', savedFilePath);
        console.log('[Download] Saved file path type:', typeof savedFilePath);
        console.log('[Download] Saved file path length:', savedFilePath?.length);
        
        // Create result object explicitly
        const result = { 
            success: true, 
            savedPath: String(savedFilePath) // Ensure it's a string
        };
        
        console.log('[Download] Returning result object:', result);
        console.log('[Download] Result.savedPath:', result.savedPath);
        console.log('[Download] Result JSON:', JSON.stringify(result));
        
        return result;
    } catch (err: any) {
        console.error('[Download] Download error:', err);
        return { success: false, error: err.message || 'Unknown error' };
    }
});

ipcMain.handle('ftp:quick-view', async (event, remotePath: string) => {
    try {
        const tempPath = path.join(app.getPath('temp'), 'preview_' + Date.now());
        
        if (currentProtocol === 'sftp' && sftpClient) {
            // Get file size first
            const stats = await sftpClient.stat(remotePath);
            if (stats.size > 1024 * 1024 * 5) { // 5MB limit for preview
                return { success: false, error: 'File too large for preview' };
            }
            const buffer = await sftpClient.get(remotePath);
            // @ts-ignore
            return { success: true, data: buffer.toString('utf8').substring(0, 10000), isText: true }; 
        } else if (currentProtocol === 'ftp' && ftpClient) {
            // For FTP, download whole file to temp
             await ftpClient.downloadTo(tempPath, remotePath);
             const buf = fs.readFileSync(tempPath);
             return { success: true, data: buf.toString('utf8').substring(0, 10000), isText: true };
        }
        return { success: false, error: 'Not connected' };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

// Cleanup temp file helper
const cleanupTempFile = (filePath: string) => {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            tempFiles.delete(filePath);
        }
    } catch (e) {
        console.error('Failed to cleanup temp file:', filePath, e);
    }
};

// Export cleanup function for use in disconnect
export const cleanupAllTempFiles = () => {
    console.log('[Cleanup] Cleaning up all temporary files:', tempFiles.size);
    tempFiles.forEach(cleanupTempFile);
    tempFiles.clear();
};

// Cleanup all temp files on app quit (handled in main.ts)

ipcMain.handle('ftp:preview-file', async (event, { remotePath, fileName }: { remotePath: string, fileName: string }) => {
    console.log('=== PREVIEW FILE HANDLER CALLED ===');
    console.log('Parameters:', { remotePath, fileName });
    try {
        const fileExt = path.extname(fileName).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(fileExt);
        const isText = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.log', '.conf', '.ini', '.yaml', '.yml', '.sh', '.bash', '.zsh'].includes(fileExt);
        
        console.log('Preview file request:', { fileName, fileExt, isImage, isText, remotePath });
        console.log('Current protocol:', currentProtocol);
        console.log('SFTP client exists:', !!sftpClient);
        console.log('FTP client exists:', !!ftpClient);
        
        if (!isImage && !isText) {
            console.log('File type not supported:', fileExt);
            return { success: false, error: 'File type not supported for preview', fileExt };
        }

        const tempPath = path.join(app.getPath('temp'), `macftp_preview_${Date.now()}_${path.basename(fileName)}`);
        
        if (currentProtocol === 'sftp' && sftpClient) {
            console.log('[SFTP] Starting preview for:', fileName);
            const stats = await sftpClient.stat(remotePath);
            console.log('[SFTP] File stats:', { size: stats.size, isDirectory: stats.isDirectory });
            const maxSize = isImage ? 50 * 1024 * 1024 : 10 * 1024 * 1024; // 50MB for images, 10MB for text
            if (stats.size > maxSize) {
                console.log('[SFTP] File too large:', stats.size, 'max:', maxSize);
                return { success: false, error: `File too large for preview (max ${maxSize / 1024 / 1024}MB)` };
            }
            
            // Download file to temp path
            console.log('[SFTP] Downloading file to:', tempPath);
            await sftpClient.get(remotePath, tempPath);
            console.log('[SFTP] Download complete');
            
            // Verify file exists and has content
            if (!fs.existsSync(tempPath)) {
                console.error('[SFTP] Temp file does not exist after download');
                return { success: false, error: 'Failed to download file for preview' };
            }
            
            const fileStats = fs.statSync(tempPath);
            console.log('[SFTP] Downloaded file stats:', { size: fileStats.size });
            if (fileStats.size === 0) {
                console.error('[SFTP] Downloaded file is empty');
                cleanupTempFile(tempPath);
                return { success: false, error: 'Downloaded file is empty' };
            }
            
            // Add to temp files tracking before returning
            tempFiles.add(tempPath);
            console.log('[SFTP] Temp file added to tracking');
            console.log('[SFTP] File type check - isImage:', isImage, 'isText:', isText, 'fileExt:', fileExt);
            
            if (isImage) {
                console.log('[SFTP] Entering image processing block');
                try {
                    // Read image file and convert to base64 data URL for security (Electron can't load file:// directly)
                    console.log('[SFTP] Reading image file from temp path:', tempPath);
                    const imageBuffer = fs.readFileSync(tempPath);
                    console.log('[SFTP] Image buffer size:', imageBuffer.length, 'bytes');
                    const base64Image = imageBuffer.toString('base64');
                    console.log('[SFTP] Base64 conversion complete, length:', base64Image.length);
                    
                    // Determine MIME type from extension
                    const mimeTypes: { [key: string]: string } = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.gif': 'image/gif',
                        '.bmp': 'image/bmp',
                        '.webp': 'image/webp',
                        '.svg': 'image/svg+xml',
                        '.ico': 'image/x-icon'
                    };
                    const mimeType = mimeTypes[fileExt] || 'image/png';
                    console.log('[SFTP] MIME type:', mimeType, 'for extension:', fileExt);
                    const dataUrl = `data:${mimeType};base64,${base64Image}`;
                    console.log('[SFTP] Data URL created, total length:', dataUrl.length);
                    
                    // Check if data URL is too large for IPC (Electron IPC limit is ~256MB, but we'll be conservative)
                    const maxDataUrlSize = 100 * 1024 * 1024; // 100MB limit for base64 data URL
                    if (dataUrl.length > maxDataUrlSize) {
                        console.error('[SFTP] Data URL too large for IPC:', dataUrl.length, 'bytes');
                        return { success: false, error: 'Image too large for preview (max ~75MB original size)' };
                    }
                    
                    const result = { 
                        success: true, 
                        tempPath: path.resolve(tempPath), 
                        imageDataUrl: dataUrl, 
                        isImage: true 
                    };
                    console.log('[SFTP] Returning result, has imageDataUrl:', !!result.imageDataUrl, 'length:', result.imageDataUrl?.length);
                    console.log('[SFTP] Result keys:', Object.keys(result));
                    return result;
                } catch (imageError: any) {
                    console.error('[SFTP] Error processing image:', imageError);
                    console.error('[SFTP] Error stack:', imageError.stack);
                    return { success: false, error: 'Failed to process image: ' + imageError.message };
                }
            } else {
                // Read and return text content
                console.log('[SFTP] Processing text file');
                const data = fs.readFileSync(tempPath, 'utf8');
                // Limit text preview to first 100KB
                const previewData = data.length > 100000 ? data.substring(0, 100000) + '\n\n... (truncated)' : data;
                // Keep temp file for text preview too in case user wants to save
                console.log('[SFTP] Text preview ready, data length:', previewData.length);
                return { success: true, data: previewData, isText: true, tempPath: path.resolve(tempPath) };
            }
        } else if (currentProtocol === 'ftp' && ftpClient) {
            console.log('[FTP] Starting preview for:', fileName);
            await ftpClient.downloadTo(tempPath, remotePath);
            
            // Verify file exists
            if (!fs.existsSync(tempPath)) {
                return { success: false, error: 'Failed to download file for preview' };
            }
            
            const fileStats = fs.statSync(tempPath);
            if (fileStats.size === 0) {
                cleanupTempFile(tempPath);
                return { success: false, error: 'Downloaded file is empty' };
            }
            
            tempFiles.add(tempPath);
            
            if (isImage) {
                try {
                    // Read image file and convert to base64 data URL for security (Electron can't load file:// directly)
                    console.log('Reading image file from temp path (FTP):', tempPath);
                    const imageBuffer = fs.readFileSync(tempPath);
                    console.log('Image buffer size (FTP):', imageBuffer.length);
                    const base64Image = imageBuffer.toString('base64');
                    console.log('Base64 conversion complete (FTP), length:', base64Image.length);
                    
                    // Determine MIME type from extension
                    const mimeTypes: { [key: string]: string } = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.gif': 'image/gif',
                        '.bmp': 'image/bmp',
                        '.webp': 'image/webp',
                        '.svg': 'image/svg+xml',
                        '.ico': 'image/x-icon'
                    };
                    const mimeType = mimeTypes[fileExt] || 'image/png';
                    console.log('MIME type (FTP):', mimeType, 'for extension:', fileExt);
                    const dataUrl = `data:${mimeType};base64,${base64Image}`;
                    console.log('[FTP] Data URL created, total length:', dataUrl.length);
                    
                    // Check if data URL is too large for IPC
                    const maxDataUrlSize = 100 * 1024 * 1024; // 100MB limit
                    if (dataUrl.length > maxDataUrlSize) {
                        console.error('[FTP] Data URL too large for IPC:', dataUrl.length, 'bytes');
                        return { success: false, error: 'Image too large for preview (max ~75MB original size)' };
                    }
                    
                    const result = { success: true, tempPath: path.resolve(tempPath), imageDataUrl: dataUrl, isImage: true };
                    console.log('[FTP] Returning result, has imageDataUrl:', !!result.imageDataUrl, 'length:', result.imageDataUrl?.length);
                    console.log('[FTP] Result keys:', Object.keys(result));
                    return result;
                } catch (imageError: any) {
                    console.error('Error processing image (FTP):', imageError);
                    return { success: false, error: 'Failed to process image: ' + imageError.message };
                }
            } else {
                const data = fs.readFileSync(tempPath, 'utf8');
                const previewData = data.length > 100000 ? data.substring(0, 100000) + '\n\n... (truncated)' : data;
                console.log('Text preview ready (FTP), data length:', previewData.length);
                return { success: true, data: previewData, isText: true, tempPath: path.resolve(tempPath) };
            }
        }
        
        console.error('Not connected - protocol:', currentProtocol, 'sftpClient:', !!sftpClient, 'ftpClient:', !!ftpClient);
        console.error('Not connected - protocol:', currentProtocol, 'sftpClient:', !!sftpClient, 'ftpClient:', !!ftpClient);
        return { success: false, error: 'Not connected' };
    } catch (err: any) {
        console.error('Preview file error:', err);
        console.error('Preview file error stack:', err.stack);
        return { success: false, error: err.message };
    }
});

// Handler to cleanup temp file when preview is closed
ipcMain.handle('ftp:cleanup-temp-file', async (event, tempPath: string) => {
    cleanupTempFile(tempPath);
    return { success: true };
});

// Handler to save temp file to user's chosen location
ipcMain.handle('ftp:save-temp-file', async (event, { tempPath, fileName }: { tempPath: string, fileName: string }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };

    if (!fs.existsSync(tempPath)) {
        return { success: false, error: 'Temporary file not found' };
    }

    const { filePath } = await dialog.showSaveDialog(win, {
        defaultPath: fileName,
    });

    if (!filePath) return { success: false, cancelled: true };

    try {
        // Copy temp file to user's chosen location
        fs.copyFileSync(tempPath, filePath);
        return { success: true, savedPath: filePath };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

// Handler to get path suggestions for autocomplete (non-blocking)
ipcMain.handle('ftp:get-path-suggestions', async (event, targetPath: string) => {
    try {
        if (!targetPath || targetPath === '/') {
            return { success: true, suggestions: [] };
        }

        // Check if path ends with '/' - if so, list all folders in that directory
        const endsWithSlash = targetPath.endsWith('/');
        let parentPath: string;
        let searchTerm: string;

        if (endsWithSlash) {
            // Path ends with '/', so list all folders in that directory
            parentPath = targetPath.slice(0, -1) || '/'; // Remove trailing slash
            searchTerm = ''; // No search term, show all folders
        } else {
            // Path doesn't end with '/', use existing logic
            const parts = targetPath.split('/').filter(Boolean);
            if (parts.length === 0) {
                return { success: true, suggestions: [] };
            }

            // Get parent directory path
            const parentParts = parts.slice(0, -1);
            parentPath = parentParts.length > 0 ? '/' + parentParts.join('/') : '/';
            searchTerm = parts[parts.length - 1].toLowerCase();
        }

        // List parent directory
        let files: any[] = [];
        if (currentProtocol === 'sftp' && sftpClient) {
            const list = await sftpClient.list(parentPath);
            files = list.map(f => formatFile(f, 'sftp'));
        } else if (currentProtocol === 'ftp' && ftpClient) {
            const list = await ftpClient.list(parentPath);
            files = list.map(f => formatFile(f, 'ftp'));
        } else {
            return { success: false, error: 'Not connected' };
        }

        // Filter directories
        let suggestions: string[];
        if (searchTerm === '') {
            // No search term, return all folders
            suggestions = files
                .filter(file => file.type === 'd')
                .map(file => `${parentPath}/${file.name}`.replace('//', '/'))
                .slice(0, 10);
        } else {
            // Filter directories that match search term
            suggestions = files
                .filter(file => file.type === 'd' && file.name.toLowerCase().startsWith(searchTerm))
                .map(file => `${parentPath}/${file.name}`.replace('//', '/'))
                .slice(0, 10);
        }

        return { success: true, suggestions };
    } catch (err: any) {
        // Return empty suggestions on error (non-blocking)
        console.error('Error getting path suggestions:', err);
        return { success: true, suggestions: [] };
    }
});

ipcMain.handle('ftp:upload', async (event, { localPath, remotePath }: { localPath: string, remotePath: string }) => {
    try {
        if (currentProtocol === 'sftp' && sftpClient) {
            await sftpClient.put(localPath, remotePath);
        } else if (currentProtocol === 'ftp' && ftpClient) {
            await ftpClient.uploadFrom(localPath, remotePath);
        } else {
             throw new Error('Not connected');
        }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('ftp:chmod', async (event, { path, mode }: { path: string, mode: string }) => {
    try {
        if (currentProtocol === 'sftp' && sftpClient) {
            await sftpClient.chmod(path, mode); 
        } else if (currentProtocol === 'ftp' && ftpClient) {
            try {
                 await ftpClient.send(`SITE CHMOD ${mode} ${path}`);
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


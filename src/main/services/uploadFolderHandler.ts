// Upload Folder Handler - folder uploads (cancel-only, no pause/resume)
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import Client from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';
import {
  sftpClient,
  ftpClient,
  currentProtocol,
  currentConnectionConfig,
  generateUniqueFileName,
  type LocalFileEntry,
  type LocalDirectoryEntry,
  type CollectedEntries
} from './commonHandler';
import {
  notifyUploadProgress,
  type UploadStatus,
  uploadControllers,
  UploadController
} from './uploadFileHandler';

const createUploadAbortError = (reason: UploadStatus = 'cancelled') => {
  const err: any = new Error(reason === 'cancelled' ? 'Upload cancelled' : 'Upload failed');
  err.code = reason === 'cancelled' ? 'UPLOAD_CANCELLED' : 'UPLOAD_FAILED';
  return err;
};

const collectLocalEntries = async (rootPath: string): Promise<CollectedEntries> => {
  const files: LocalFileEntry[] = [];
  const directories: LocalDirectoryEntry[] = [];

  const walk = async (currentPath: string, relativePath: string) => {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        directories.push({ relativePath: entryRelativePath });
        await walk(entryPath, entryRelativePath);
      } else if (entry.isFile()) {
        const stats = await fs.promises.stat(entryPath);
        files.push({
          localPath: entryPath,
          relativePath: entryRelativePath,
          size: stats.size
        });
      }
    }
  };

  await walk(rootPath, '');

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    files,
    directories,
    totalBytes,
    totalFiles: files.length
  };
};

const ensureSftpDirectory = async (remoteDir: string) => {
  if (!remoteDir || remoteDir === '.' || remoteDir === '/') return;
  if (sftpClient) {
    await sftpClient.mkdir(remoteDir, true);
  }
};

const ensureFtpDirectory = async (remoteDir: string) => {
  if (!remoteDir || remoteDir === '.' || remoteDir === '/') return;
  if (!ftpClient) throw new Error('FTP client not initialized');
  const previousDir = await ftpClient.pwd();
  await ftpClient.ensureDir(remoteDir);
  await ftpClient.cd(previousDir);
};

const deleteRemoteFile = async (remotePath: string) => {
  try {
    if (currentProtocol === 'sftp' && sftpClient) {
      await sftpClient.delete(remotePath);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      await ftpClient.remove(remotePath);
    }
  } catch (err) {
    console.warn('[Upload] Failed to cleanup remote file after cancel:', remotePath, err);
  }
};

const uploadFileViaSftp = async (
  controller: UploadController,
  localPath: string,
  remotePath: string,
  fileSize: number,
  baseUploaded: number,
  startedAt: number
) => {
  if (!sftpClient) throw new Error('SFTP client not initialized');
  const remoteDir = path.posix.dirname(remotePath);
  await ensureSftpDirectory(remoteDir);

  const remoteStream = sftpClient.createWriteStream(remotePath);
  const localStream = fs.createReadStream(localPath);

  let currentUploaded = 0;

  const emitProgress = () => {
    const now = Date.now();
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
    notifyUploadProgress({
      uploadId: controller.uploadId,
      status: 'uploading',
      totalBytes: fileSize,
      uploadedBytes: baseUploaded + currentUploaded,
      completedFiles: 0,
      totalFiles: 1,
      currentFile: path.posix.basename(remotePath),
      currentFileUploaded: currentUploaded,
      currentFileSize: fileSize,
      speed: (baseUploaded + currentUploaded) / elapsedSeconds
    });
  };

  const cleanup = () => {
    localStream.removeAllListeners();
    remoteStream.removeAllListeners();
    localStream.destroy();
    remoteStream.destroy();
  };

  await new Promise<void>((resolve, reject) => {
    remoteStream.on('error', (err: any) => {
      cleanup();
      reject(err);
    });

    remoteStream.on('close', () => {
      cleanup();
      resolve();
    });

    localStream.on('data', (chunk: Buffer | string) => {
      const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      currentUploaded += chunkLength;
      emitProgress();

      if (controller.cancelRequested) {
        cleanup();
        reject(createUploadAbortError('cancelled'));
        return;
      }
    });

    localStream.on('error', (err) => {
      cleanup();
      reject(err);
    });

    localStream.pipe(remoteStream);
  });
};

const uploadFileViaFtp = async (
  controller: UploadController,
  localPath: string,
  remotePath: string,
  fileSize: number,
  baseUploaded: number,
  startedAt: number
) => {
  if (!ftpClient) throw new Error('FTP client not initialized');
  const remoteDir = path.posix.dirname(remotePath);
  await ensureFtpDirectory(remoteDir);

  await new Promise<void>((resolve, reject) => {
    const client = ftpClient;
    if (!client) {
      reject(new Error('FTP client not initialized'));
      return;
    }
    const stream = fs.createReadStream(localPath);
    let currentUploaded = 0;

    const cleanup = () => {
      stream.removeAllListeners();
    };

    const emitProgress = () => {
      const now = Date.now();
      const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
      notifyUploadProgress({
        uploadId: controller.uploadId,
        status: 'uploading',
        totalBytes: fileSize,
        uploadedBytes: baseUploaded + currentUploaded,
        completedFiles: 0,
        totalFiles: 1,
        currentFile: path.posix.basename(remotePath),
        currentFileUploaded: currentUploaded,
        currentFileSize: fileSize,
        speed: (baseUploaded + currentUploaded) / elapsedSeconds
      });
    };

    stream.on('data', (chunk: Buffer | string) => {
      const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      currentUploaded += chunkLength;
      emitProgress();
      if (controller.cancelRequested) {
        cleanup();
        stream.destroy(createUploadAbortError('cancelled'));
        return;
      }
    });

    stream.on('error', (err) => {
      cleanup();
      reject(err);
    });

    client.uploadFrom(stream, remotePath).then(() => {
      cleanup();
      resolve();
    }).catch((err) => {
      cleanup();
      reject(err);
    });
  });
};

const createUploadController = (uploadId: string): UploadController => ({
  uploadId,
  cancelRequested: false
});

const startFolderUpload = async (uploadId: string, localPath: string, remotePath: string) => {
  const controller = createUploadController(uploadId);
  uploadControllers.set(uploadId, controller);
  const startedAt = Date.now();
  console.log('[Upload] Starting folder upload:', { uploadId, localPath, remotePath, protocol: currentProtocol });
  try {
    const entries = await collectLocalEntries(localPath);
    console.log('[Upload] Folder upload collected entries:', { uploadId, totalFiles: entries.totalFiles, totalBytes: entries.totalBytes, directories: entries.directories.length });
    if (currentProtocol === 'sftp') {
      await ensureSftpDirectory(remotePath);
    } else if (currentProtocol === 'ftp') {
      await ensureFtpDirectory(remotePath);
    }

    notifyUploadProgress({
      uploadId,
      status: 'starting',
      uploadedBytes: 0,
      totalBytes: entries.totalBytes,
      completedFiles: 0,
      totalFiles: entries.totalFiles,
      currentFile: '',
      currentFileSize: 0,
      currentFileUploaded: 0,
      speed: 0
    });

    // Create remote directories
    for (const dir of entries.directories) {
      const targetDir = dir.relativePath
        ? path.posix.join(remotePath, dir.relativePath).replace(/\\/g, '/')
        : remotePath;
      if (currentProtocol === 'sftp') {
        await ensureSftpDirectory(targetDir);
      } else if (currentProtocol === 'ftp') {
        await ensureFtpDirectory(targetDir);
      }
    }

    if (!entries.files.length) {
      notifyUploadProgress({
        uploadId,
        status: 'completed',
        uploadedBytes: 0,
        totalBytes: 0,
        completedFiles: 0,
        totalFiles: 0
      });
      return;
    }

    let uploadedBytes = 0;
    let completedFiles = 0;

    for (const file of entries.files) {
      if (controller.cancelRequested) throw createUploadAbortError('cancelled');

      const remoteFilePath = path.posix.join(remotePath, file.relativePath).replace(/\\/g, '/');
      notifyUploadProgress({
        uploadId,
        status: 'uploading',
        uploadedBytes,
        totalBytes: entries.totalBytes,
        completedFiles,
        totalFiles: entries.totalFiles,
        currentFile: file.relativePath,
        currentFileSize: file.size,
        currentFileUploaded: 0,
        speed: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 0.001)
      });

      if (currentProtocol === 'sftp') {
        await uploadFileViaSftp(controller, file.localPath, remoteFilePath, file.size, uploadedBytes, startedAt);
      } else if (currentProtocol === 'ftp') {
        await uploadFileViaFtp(controller, file.localPath, remoteFilePath, file.size, uploadedBytes, startedAt);
      } else {
        throw new Error('Not connected');
      }

      uploadedBytes += file.size;
      completedFiles += 1;

      notifyUploadProgress({
        uploadId,
        status: 'uploading',
        uploadedBytes,
        totalBytes: entries.totalBytes,
        completedFiles,
        totalFiles: entries.totalFiles,
        currentFile: file.relativePath,
        currentFileUploaded: file.size,
        currentFileSize: file.size,
        speed: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 0.001)
      });
    }

    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const finalStatus = controller.cancelRequested ? 'cancelled' : 'completed';
    if (finalStatus === 'completed') {
      console.log('[Success] Folder upload completed:', { uploadId, localPath, remotePath, totalFiles: entries.totalFiles, totalBytes: entries.totalBytes, elapsedSeconds });
    } else {
      console.log('[Upload] Folder upload cancelled:', { uploadId, localPath, remotePath });
    }
    notifyUploadProgress({
      uploadId,
      status: finalStatus,
      uploadedBytes,
      totalBytes: entries.totalBytes,
      completedFiles,
      totalFiles: entries.totalFiles,
      speed: 0,
      currentFile: '',
      currentFileUploaded: 0,
      currentFileSize: 0
    });
  } catch (err: any) {
    const status: UploadStatus = controller.cancelRequested || err?.code === 'UPLOAD_CANCELLED' ? 'cancelled' : 'failed';
    if (status === 'cancelled') {
      console.log('[Upload] Folder upload cancelled:', { uploadId, localPath, remotePath });
    } else {
      console.error('[Error] Folder upload failed:', { uploadId, localPath, remotePath, error: err.message, code: err.code });
    }
    notifyUploadProgress({
      uploadId,
      status,
      uploadedBytes: 0,
      totalBytes: 0,
      completedFiles: 0,
      totalFiles: 0,
      error: err.message
    });
    throw err;
  } finally {
    uploadControllers.delete(uploadId);
  }
};

// ------------------------
// IPC Handlers
// ------------------------

ipcMain.handle('ftp:upload-folder', async (_event, {
  localPath,
  remotePath,
  defaultConflictResolution
}: {
  localPath: string,
  remotePath: string,
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt' | 'skip'
}) => {
  try {
    if (!currentProtocol || !currentConnectionConfig) throw new Error('Not connected');

    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };

    const folderName = path.basename(remotePath);

    let remoteExists = false;
    try {
      if (currentProtocol === 'sftp' && sftpClient) {
        const stat = await sftpClient.stat(remotePath);
        remoteExists = stat.isDirectory;
      } else if (currentProtocol === 'ftp' && ftpClient) {
        await ftpClient.list(remotePath);
        remoteExists = true;
      }
    } catch {
      remoteExists = false;
    }

    if (remoteExists) {
      if (defaultConflictResolution && defaultConflictResolution !== 'prompt') {
        if (defaultConflictResolution === 'skip') {
          return { success: false, cancelled: true, skipped: true };
        }
        if (defaultConflictResolution === 'rename') {
          const parent = path.posix.dirname(remotePath);
          const base = path.posix.basename(remotePath);
          let counter = 1;
          let candidate = base;
          while (true) {
            const candidatePath = path.posix.join(parent, candidate);
            const existsResult = await (async () => {
              try {
                if (currentProtocol === 'sftp' && sftpClient) {
                  await sftpClient.stat(candidatePath);
                  return true;
                } else if (currentProtocol === 'ftp' && ftpClient) {
                  await ftpClient.list(candidatePath);
                  return true;
                }
              } catch {
                return false;
              }
              return false;
            })();
            if (!existsResult) {
              remotePath = candidatePath;
              break;
            }
            candidate = `${base} (${counter})`;
            counter++;
          }
        }
        // overwrite: continue
      } else {
        const result = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Overwrite', 'Skip', 'Cancel'],
          title: 'Folder Already Exists',
          message: `The folder \"${folderName}\" already exists on the server.`
        });
        if (result.response === 1) { // Skip
          return { success: false, cancelled: true, skipped: true };
        }
        if (result.response === 2) { // Cancel
          return { success: false, cancelled: true };
        }
        // Overwrite -> continue
      }
    }

    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log('[Upload] Starting folder upload:', { uploadId, localPath, remotePath, folderName });
    startFolderUpload(uploadId, localPath, remotePath).catch((err) => {
      console.error('[Error] Folder upload failed:', { uploadId, localPath, remotePath, error: err.message, code: err.code });
    });
    return { success: true, uploadId };
  } catch (err: any) {
    console.error('[Error] Folder upload exception:', { error: err.message });
    return { success: false, error: err.message };
  }
});

// Note: upload:cancel is handled in commonHandler.ts (shared between file and folder uploads)
// uploadControllers is shared from uploadFileHandler.ts

console.log('[Upload Folder Handler] Registered');


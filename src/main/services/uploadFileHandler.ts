// Upload File Handler - single file uploads (cancel-only, no pause/resume)
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  sftpClient,
  ftpClient,
  currentProtocol,
  currentConnectionConfig,
  generateUniqueFileName,
  type ConnectionConfig
} from './commonHandler';
import Client from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';

export type UploadStatus = 'starting' | 'uploading' | 'completed' | 'cancelled' | 'failed';

export interface UploadProgressUpdate {
  uploadId: string;
  status: UploadStatus;
  uploadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentFile?: string;
  currentFileUploaded?: number;
  currentFileSize?: number;
  currentFileLocalPath?: string;
  currentFileRemotePath?: string;
  speed?: number;
  error?: string;
  message?: string;
}

export interface UploadController {
  uploadId: string;
  cancelRequested: boolean;
}

export const uploadControllers = new Map<string, UploadController>();
export const uploadStates = new Map<string, UploadProgressUpdate>();

export const notifyUploadProgress = (update: UploadProgressUpdate) => {
  const previous: Partial<UploadProgressUpdate> = uploadStates.get(update.uploadId) || {};
  const next: UploadProgressUpdate = {
    uploadId: update.uploadId,
    status: update.status,
    uploadedBytes: update.uploadedBytes ?? previous.uploadedBytes ?? 0,
    totalBytes: update.totalBytes ?? previous.totalBytes ?? 0,
    completedFiles: update.completedFiles ?? previous.completedFiles ?? 0,
    totalFiles: update.totalFiles ?? previous.totalFiles ?? 0,
    currentFile: update.currentFile ?? previous.currentFile,
    currentFileUploaded: update.currentFileUploaded ?? previous.currentFileUploaded,
    currentFileSize: update.currentFileSize ?? previous.currentFileSize,
    currentFileLocalPath: update.currentFileLocalPath ?? previous.currentFileLocalPath,
    currentFileRemotePath: update.currentFileRemotePath ?? previous.currentFileRemotePath,
    speed: update.speed ?? previous.speed,
    error: update.error,
    message: update.message
  };

  uploadStates.set(update.uploadId, next);

  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('upload:progress', next);
  });

  if (update.status === 'completed' || update.status === 'failed' || update.status === 'cancelled') {
    uploadStates.delete(update.uploadId);
  }
};

const createUploadAbortError = (reason: UploadStatus = 'cancelled') => {
  const err: any = new Error(reason === 'cancelled' ? 'Upload cancelled' : 'Upload failed');
  err.code = reason === 'cancelled' ? 'UPLOAD_CANCELLED' : 'UPLOAD_FAILED';
  return err;
};

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

const generateUniqueRemoteName = async (remoteDir: string, baseName: string): Promise<string> => {
  const { name, ext } = path.parse(baseName);
  let counter = 1;
  let candidate = baseName;
  while (true) {
    const remotePath = path.posix.join(remoteDir, candidate);
    const exists = await checkRemoteExists(remotePath);
    if (!exists.success || !exists.exists) {
      return remotePath;
    }
    candidate = `${name} (${counter})${ext}`;
    counter++;
  }
};

const uploadFileViaSftp = async (
  controller: UploadController,
  localPath: string,
  remotePath: string,
  fileSize: number,
  startedAt: number
) => {
  if (!sftpClient) throw new Error('SFTP client not initialized');
  const remoteDir = path.posix.dirname(remotePath);
  await sftpClient.mkdir(remoteDir, true);

  const remoteStream = sftpClient.createWriteStream(remotePath);
  const localStream = fs.createReadStream(localPath);

  let currentUploaded = 0;

  const emitProgress = () => {
    // Check for cancellation during progress updates
    if (controller.cancelRequested) {
      console.log('[Upload] Cancellation detected during single file upload (SFTP), stopping:', { uploadId: controller.uploadId, file: path.posix.basename(remotePath) });
      return; // Stop emitting progress if cancelled
    }
    
    const now = Date.now();
    const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
    notifyUploadProgress({
      uploadId: controller.uploadId,
      status: 'uploading',
      totalBytes: fileSize,
      uploadedBytes: currentUploaded,
      completedFiles: 0,
      totalFiles: 1,
      currentFile: path.posix.basename(remotePath),
      currentFileUploaded: currentUploaded,
      currentFileSize: fileSize,
      speed: currentUploaded / elapsedSeconds
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
      console.error('[Error] SFTP upload stream error:', { uploadId: controller.uploadId, localPath, remotePath, error: err.message, code: err.code });
      cleanup();
      reject(err);
    });

    remoteStream.on('close', () => {
      cleanup();
      resolve();
    });

    localStream.on('data', (chunk: Buffer | string) => {
      // Check for cancellation first, before processing chunk
      if (controller.cancelRequested) {
        console.log('[Upload] Cancellation detected in data stream (SFTP single file), stopping immediately:', { uploadId: controller.uploadId, file: path.posix.basename(remotePath) });
        cleanup();
        reject(createUploadAbortError('cancelled'));
        return;
      }
      
      const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      currentUploaded += chunkLength;
      emitProgress();
    });

    localStream.on('error', (err) => {
      console.error('[Error] SFTP upload local stream error:', { uploadId: controller.uploadId, localPath, remotePath, error: err.message });
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
  startedAt: number
) => {
  if (!ftpClient) throw new Error('FTP client not initialized');
  const remoteDir = path.posix.dirname(remotePath);
  await ftpClient.ensureDir(remoteDir);

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
      // Check for cancellation during progress updates
      if (controller.cancelRequested) {
        console.log('[Upload] Cancellation detected during single file upload (FTP), stopping:', { uploadId: controller.uploadId, file: path.posix.basename(remotePath) });
        return; // Stop emitting progress if cancelled
      }
      
      const now = Date.now();
      const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
      notifyUploadProgress({
        uploadId: controller.uploadId,
        status: 'uploading',
        totalBytes: fileSize,
        uploadedBytes: currentUploaded,
        completedFiles: 0,
        totalFiles: 1,
        currentFile: path.posix.basename(remotePath),
        currentFileUploaded: currentUploaded,
        currentFileSize: fileSize,
        speed: currentUploaded / elapsedSeconds
      });
    };

    stream.on('data', (chunk: Buffer | string) => {
      // Check for cancellation first, before processing chunk
      if (controller.cancelRequested) {
        console.log('[Upload] Cancellation detected in data stream (FTP single file), stopping immediately:', { uploadId: controller.uploadId, file: path.posix.basename(remotePath) });
        cleanup();
        stream.destroy();
        reject(createUploadAbortError('cancelled'));
        return;
      }
      
      const chunkLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      currentUploaded += chunkLength;
      emitProgress();
    });

    stream.on('error', (err) => {
      console.error('[Error] FTP upload stream error:', { uploadId: controller.uploadId, localPath, remotePath, error: err.message });
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

// ------------------------
// IPC: Upload single file (with conflict resolution)
// ------------------------

ipcMain.handle('ftp:upload', async (event, { localPath, remotePath, uploadId: providedUploadId, defaultConflictResolution }: {
  localPath: string,
  remotePath: string,
  uploadId?: string,
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt' | 'skip'
}) => {
  try {
    if (!localPath) throw new Error('Local file path is missing');
    if (!fs.existsSync(localPath)) throw new Error('Local file not found');
    if (!currentConnectionConfig || !currentProtocol) throw new Error('Not connected');

    // Note: Duplicate checking is now handled by the frontend via handleUploadDuplicate
    // The remotePath passed here is already resolved (may be renamed or confirmed for overwrite)
    // No need to check again here to avoid duplicate dialogs

    const fileSize = fs.statSync(localPath).size;
    const uploadId = providedUploadId || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const controller: UploadController = { uploadId, cancelRequested: false };
    uploadControllers.set(uploadId, controller);
    const startedAt = Date.now();

    console.log('[Upload] Starting file upload:', { uploadId, localPath, remotePath, fileSize, protocol: currentProtocol });
    notifyUploadProgress({
      uploadId,
      status: 'starting',
      uploadedBytes: 0,
      totalBytes: fileSize,
      completedFiles: 0,
      totalFiles: 1,
      currentFile: path.posix.basename(remotePath),
      currentFileSize: fileSize,
      currentFileUploaded: 0,
      speed: 0
    });

    try {
      if (currentProtocol === 'sftp' && sftpClient) {
        await uploadFileViaSftp(controller, localPath, remotePath, fileSize, startedAt);
      } else if (currentProtocol === 'ftp' && ftpClient) {
        await uploadFileViaFtp(controller, localPath, remotePath, fileSize, startedAt);
      } else {
        throw new Error('Not connected');
      }

      // Check if cancelled before marking as completed
      if (controller.cancelRequested) {
        console.log('[Upload] Upload cancelled before completion (confirmed):', { uploadId, localPath, remotePath });
        throw createUploadAbortError('cancelled');
      }
      
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
      console.log('[Success] Upload completed:', { uploadId, localPath, remotePath, fileSize, elapsedSeconds, speed: fileSize / elapsedSeconds });
      notifyUploadProgress({
        uploadId,
        status: 'completed',
        uploadedBytes: fileSize,
        totalBytes: fileSize,
        completedFiles: 1,
        totalFiles: 1,
        currentFile: path.posix.basename(remotePath),
        currentFileSize: fileSize,
        currentFileUploaded: fileSize,
        speed: fileSize / elapsedSeconds
      });
      return { success: true, uploadId };
    } catch (err: any) {
      const status: UploadStatus = controller.cancelRequested || err?.code === 'UPLOAD_CANCELLED' ? 'cancelled' : 'failed';
      notifyUploadProgress({
        uploadId,
        status,
        uploadedBytes: 0,
        totalBytes: fileSize,
        completedFiles: 0,
        totalFiles: 1,
        currentFile: path.posix.basename(remotePath),
        currentFileSize: fileSize,
        currentFileUploaded: 0,
        speed: 0,
        error: err?.message
      });
      if (status === 'cancelled') {
        try {
          if (currentProtocol === 'sftp' && sftpClient) {
            await sftpClient.delete(remotePath);
          } else if (currentProtocol === 'ftp' && ftpClient) {
            await ftpClient.remove(remotePath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
      if (status === 'cancelled') {
        console.log('[Upload] Upload cancelled (confirmed):', { uploadId, localPath, remotePath, error: err.message });
      } else {
        console.error('[Error] Upload failed:', { uploadId, localPath, remotePath, error: err.message, code: err.code });
      }
      return { success: false, error: err.message };
    } finally {
      uploadControllers.delete(uploadId);
      uploadStates.delete(uploadId);
    }
  } catch (err: any) {
    console.error('[Error] Upload exception:', { error: err.message });
    return { success: false, error: err.message };
  }
});

// ------------------------
// IPC: Upload cancel
// ------------------------

// Note: upload:cancel is handled in commonHandler.ts (shared between file and folder uploads)

console.log('[Upload File Handler] Registered');


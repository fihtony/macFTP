import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import Client from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';

let sftpClient: Client | null = null;
let ftpClient: ftp.Client | null = null;
let currentProtocol: 'ftp' | 'sftp' | null = null;

type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

interface DownloadProgressUpdate {
  id: string;
  downloadedSize: number;
  totalSize?: number;
  speed?: number;
  eta?: number;
  status?: DownloadStatus;
  startTime?: number;
  endTime?: number;
  actualFileName?: string; // Actual file name after rename
  localPath?: string; // Local file path
  totalFiles?: number; // Total files in folder download
  completedFiles?: number; // Completed files in folder download
  error?: string; // Error message
}

const notifyDownloadProgress = (update: DownloadProgressUpdate) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('download:progress', update);
  });
};

const createDownloadAbortError = (reason: DownloadStatus) => {
  const error: any = new Error(reason === 'paused' ? 'Download paused by user' : 'Download cancelled by user');
  error.code = reason === 'paused' ? 'DOWNLOAD_PAUSED' : 'DOWNLOAD_CANCELLED';
  return error;
};

// Track temp files for cleanup
const tempFiles = new Set<string>();

let currentConnectionConfig: ConnectionConfig | null = null;

let MAX_CONCURRENT_DOWNLOADS = 3; // Can be updated via settings

interface DownloadQueueItem {
  id: string;
  remotePath: string;
  localPath: string;
  fileName: string;
  connection: ConnectionConfig;
  totalSize: number;
  resolve: (value: { success: true; savedPath: string }) => void;
  reject: (reason: any) => void;
}

type DownloadJobPayload = Omit<DownloadQueueItem, 'resolve' | 'reject'>;

interface FolderDownloadJobPayload {
  id: string;
  remotePath: string;
  localPath: string;
  folderName: string;
  pendingDialog?: Promise<{ localPath: string; folderName: string }>;
}

const downloadQueue: DownloadQueueItem[] = [];
// Track active folder jobs that are being processed (for updating after dialog resolution)
const activeFolderJobs = new Map<string, any>();
const activeDownloadControllers = new Map<string, (reason?: DownloadStatus) => void>();
let activeDownloadJobs = 0;

type UploadStatus = 'starting' | 'uploading' | 'paused' | 'completed' | 'cancelled' | 'failed';

interface UploadProgressUpdate {
  uploadId: string;
  status: UploadStatus;
  uploadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentFile?: string;
  currentFileUploaded?: number;
  currentFileSize?: number;
  speed?: number;
  error?: string;
  message?: string;
}

interface LocalFileEntry {
  localPath: string;
  relativePath: string;
  size: number;
}

interface LocalDirectoryEntry {
  relativePath: string;
}

interface CollectedEntries {
  files: LocalFileEntry[];
  directories: LocalDirectoryEntry[];
  totalBytes: number;
  totalFiles: number;
}

interface RemoteFileEntry {
  remotePath: string;
  relativePath: string;
  size: number;
}

interface RemoteDirectoryEntry {
  relativePath: string;
}

interface CollectedRemoteEntries {
  files: RemoteFileEntry[];
  directories: RemoteDirectoryEntry[];
  totalBytes: number;
  totalFiles: number;
}

interface UploadController {
  uploadId: string;
  paused: boolean;
  cancelRequested: boolean;
  resumeResolvers: Array<() => void>;
}

const uploadControllers = new Map<string, UploadController>();
const uploadStates = new Map<string, UploadProgressUpdate>();

interface DownloadFolderController {
  downloadId: string;
  cancelRequested: boolean;
}

const downloadFolderControllers = new Map<string, DownloadFolderController>();

const notifyUploadProgress = (update: UploadProgressUpdate) => {
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
  const err: any = new Error(reason === 'paused' ? 'Upload paused' : 'Upload cancelled');
  err.code = reason === 'paused' ? 'UPLOAD_PAUSED' : 'UPLOAD_CANCELLED';
  return err;
};

const createUploadController = (uploadId: string): UploadController => ({
  uploadId,
  paused: false,
  cancelRequested: false,
  resumeResolvers: []
});

const waitForUploadResume = (controller: UploadController) => {
  if (!controller.paused) return Promise.resolve();
  return new Promise<void>((resolve) => {
    controller.resumeResolvers.push(resolve);
  });
};

const resumeUploadController = (controller: UploadController) => {
  controller.paused = false;
  const resolvers = [...controller.resumeResolvers];
  controller.resumeResolvers = [];
  resolvers.forEach((resolve) => resolve());
};

const cancelPendingJob = (id: string, reason: DownloadStatus) => {
  const index = downloadQueue.findIndex(job => job.id === id);
  if (index === -1) {
    return false;
  }
  const [job] = downloadQueue.splice(index, 1);
  job.reject(createDownloadAbortError(reason));
  notifyDownloadProgress({
    id,
    downloadedSize: 0,
    totalSize: job.totalSize,
    status: reason
  });
  return true;
};

const cancelDownloadJob = (id: string, reason: DownloadStatus = 'cancelled', localPath?: string) => {
  console.log('[Download] Cancelling download job:', id, 'reason:', reason, 'Active jobs:', activeDownloadJobs, 'Active controllers:', activeDownloadControllers.size);
  
  if (cancelPendingJob(id, reason)) {
    console.log('[Download] Cancelled pending job in queue');
    // Delete incomplete file if path provided
    if (localPath) {
      try {
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
          console.log('[Download] Deleted incomplete file:', localPath);
        }
      } catch (err) {
        console.error('[Download] Failed to delete incomplete file:', err);
      }
    }
    return true;
  }
  const controller = activeDownloadControllers.get(id);
  if (controller) {
    console.log('[Download] Calling abort controller for active download:', id);
    controller(reason);
    // The controller will be removed in the finally block of the download function
    // Immediately notify cancellation status to prevent UI hanging
    setTimeout(() => {
      console.log('[Download] Sending delayed cancellation notification for:', id);
      notifyDownloadProgress({
        id: id,
        downloadedSize: 0,
        totalSize: 0,
        status: 'cancelled'
      });
    }, 1000); // Give the abort operation a moment to propagate
    return true;
  }
  console.warn('[Download] No controller found for download:', id, 'Queue length:', downloadQueue.length, 'Active controllers:', Array.from(activeDownloadControllers.keys()));
  return false;
};

const cancelAllDownloads = (reason: DownloadStatus = 'cancelled') => {
  console.log('[Download] Cancelling all downloads, reason:', reason, {
    queueLength: downloadQueue.length,
    activeFileControllers: activeDownloadControllers.size,
    activeFolderControllers: downloadFolderControllers.size,
    activeJobs: activeDownloadJobs
  });
  
  // Count jobs to decrement
  let jobsToDecrement = 0;
  
  // Cancel all downloads in queue (both file and folder)
  while (downloadQueue.length > 0) {
    const job = downloadQueue.shift();
    if (job) {
      // Check if this job has already started (incremented activeDownloadJobs)
      // Jobs in queue but already being processed have incremented the counter
      if ((job as any).isFolder) {
        // Folder job in queue that was being processed
        if (activeFolderJobs.has(job.id)) {
          jobsToDecrement++;
        }
      }
      
      job.reject(createDownloadAbortError(reason));
      notifyDownloadProgress({
        id: job.id,
        downloadedSize: 0,
        totalSize: job.totalSize,
        status: reason,
        endTime: Date.now()
      });
    }
  }
  
  // Cancel all active file downloads
  activeDownloadControllers.forEach(controller => controller(reason));
  
  // Cancel all active folder downloads
  const folderDownloadCount = downloadFolderControllers.size;
  downloadFolderControllers.forEach((controller, downloadId) => {
    console.log('[Download] Cancelling folder download:', downloadId, 'reason:', reason);
    controller.cancelRequested = true;
    
    // Notify cancellation
    notifyDownloadProgress({
      id: downloadId,
      downloadedSize: 0,
      totalSize: 0,
      status: reason,
      speed: 0,
      eta: 0,
      endTime: Date.now()
    });
  });
  
  // Clear folder controllers - they won't complete naturally
  downloadFolderControllers.clear();
  
  // Decrement activeDownloadJobs for folder jobs that were waiting
  if (jobsToDecrement > 0) {
    console.log('[Download] Decrementing activeDownloadJobs by:', jobsToDecrement);
    activeDownloadJobs = Math.max(0, activeDownloadJobs - jobsToDecrement);
  }
  
  // Manually decrement for each active folder download since their finally blocks won't run
  if (folderDownloadCount > 0) {
    console.log('[Download] Decrementing activeDownloadJobs for cancelled folder downloads:', folderDownloadCount);
    activeDownloadJobs = Math.max(0, activeDownloadJobs - folderDownloadCount);
  }
  
  // Clear all tracking maps
  activeFolderJobs.clear();
  
  console.log('[Download] All downloads cancelled, final activeDownloadJobs:', activeDownloadJobs);
};

const removeFtpDirectoryRecursive = async (client: ftp.Client, dirPath: string) => {
  const normalizedPath = dirPath.replace(/\\/g, '/');
  const list = await client.list(normalizedPath);
  for (const item of list) {
    const childPath = path.posix.join(normalizedPath, item.name).replace(/\\/g, '/');
    if (item.isDirectory) {
      await removeFtpDirectoryRecursive(client, childPath);
    } else {
      await client.remove(childPath);
    }
  }
  await client.removeDir(normalizedPath);
};

const collectLocalEntries = async (rootPath: string): Promise<CollectedEntries> => {
  const files: LocalFileEntry[] = [];
  const directories: LocalDirectoryEntry[] = [];

  const walk = async (currentPath: string, relativePath: string) => {
    const dirEntries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of dirEntries) {
      const entryPath = path.join(currentPath, entry.name);
      const entryRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
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

const collectRemoteEntries = async (remotePath: string): Promise<CollectedRemoteEntries> => {
  const files: RemoteFileEntry[] = [];
  const directories: RemoteDirectoryEntry[] = [];

  const walk = async (currentRemotePath: string, relativePath: string) => {
    let list: any[] = [];
    
    if (currentProtocol === 'sftp' && sftpClient) {
      list = await sftpClient.list(currentRemotePath);
    } else if (currentProtocol === 'ftp' && ftpClient) {
      list = await ftpClient.list(currentRemotePath);
    }

    for (const item of list) {
      const itemName = item.name;
      const itemRemotePath = path.posix.join(currentRemotePath, itemName).replace(/\\/g, '/');
      const itemRelativePath = relativePath ? path.posix.join(relativePath, itemName) : itemName;
      
      const isDirectory = currentProtocol === 'sftp' ? item.type === 'd' : item.isDirectory;
      
      if (isDirectory) {
        directories.push({ relativePath: itemRelativePath });
        await walk(itemRemotePath, itemRelativePath);
      } else {
        files.push({
          remotePath: itemRemotePath,
          relativePath: itemRelativePath,
          size: item.size || 0
        });
      }
    }
  };

  await walk(remotePath, '');

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
      status: controller.paused ? 'paused' : 'uploading',
      totalBytes: uploadStates.get(controller.uploadId)?.totalBytes || 0,
      uploadedBytes: baseUploaded + currentUploaded,
      completedFiles: uploadStates.get(controller.uploadId)?.completedFiles || 0,
      totalFiles: uploadStates.get(controller.uploadId)?.totalFiles || 0,
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

      if (controller.paused) {
        localStream.pause();
        waitForUploadResume(controller).then(() => {
          if (controller.cancelRequested) {
            cleanup();
            reject(createUploadAbortError('cancelled'));
            return;
          }
          localStream.resume();
        });
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
        status: controller.paused ? 'paused' : 'uploading',
        totalBytes: uploadStates.get(controller.uploadId)?.totalBytes || 0,
        uploadedBytes: baseUploaded + currentUploaded,
        completedFiles: uploadStates.get(controller.uploadId)?.completedFiles || 0,
        totalFiles: uploadStates.get(controller.uploadId)?.totalFiles || 0,
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
      if (controller.paused) {
        stream.pause();
        waitForUploadResume(controller).then(() => {
          if (controller.cancelRequested) {
            cleanup();
            stream.destroy(createUploadAbortError('cancelled'));
            return;
          }
          stream.resume();
        });
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

const createUploadDirectories = async (remoteRoot: string, directories: LocalDirectoryEntry[]) => {
  for (const dir of directories) {
    const targetDir = dir.relativePath
      ? path.posix.join(remoteRoot, dir.relativePath).replace(/\\/g, '/')
      : remoteRoot;
    if (currentProtocol === 'sftp') {
      await ensureSftpDirectory(targetDir);
    } else if (currentProtocol === 'ftp') {
      await ensureFtpDirectory(targetDir);
    }
  }
};

const createLocalDirectories = async (localRoot: string, directories: RemoteDirectoryEntry[]) => {
  for (const dir of directories) {
    const targetDir = dir.relativePath
      ? path.join(localRoot, dir.relativePath)
      : localRoot;
    await fs.promises.mkdir(targetDir, { recursive: true });
  }
};


const startFolderDownload = async (downloadId: string, remotePath: string, localPath: string, folderName: string) => {
  const controller: DownloadFolderController = { downloadId, cancelRequested: false };
  downloadFolderControllers.set(downloadId, controller);
  console.log('[Folder Download] Controller registered for:', downloadId);
  const startedAt = Date.now();
  
  try {
    // Create local folder with folder name
    const targetPath = path.join(localPath, folderName);
    await fs.promises.mkdir(targetPath, { recursive: true });
    
    // Check if already cancelled
    if (controller.cancelRequested) {
      console.log('[Folder Download] Cancelled before starting');
      throw new Error('Download cancelled');
    }
    
    // Collect all remote files and directories
    const entries = await collectRemoteEntries(remotePath);
    
    // Update status to 'downloading' now that we're starting the folder download
    notifyDownloadProgress({
      id: downloadId,
      status: 'downloading',
      downloadedSize: 0,
      totalSize: entries.totalBytes,
      speed: 0,
      eta: undefined,
      totalFiles: entries.totalFiles,
      completedFiles: 0,
      localPath: targetPath
    });

    // Create all local directories first (preserve hierarchy)
    await createLocalDirectories(targetPath, entries.directories);

    if (!entries.files.length) {
      notifyDownloadProgress({
        id: downloadId,
        status: 'completed',
        downloadedSize: 0,
        totalSize: 0,
        speed: 0,
        eta: 0,
        totalFiles: 0,
        completedFiles: 0
      });
      return;
    }

    let downloadedBytes = 0;
    let completedFiles = 0;

    // Download all files preserving relative paths
    for (const file of entries.files) {
      // Check cancellation at the start of each file
      if (controller.cancelRequested) {
        console.log('[Folder Download] Cancelled before file:', file.relativePath);
        throw new Error('Download cancelled');
      }

      try {
        const localFilePath = path.join(targetPath, file.relativePath);
        
        console.log('[Folder Download] Downloading file:', file.relativePath);
        
        // Track progress within this file
        let currentFileDownloaded = 0;
        
        // Download file with progress tracking
        if (currentProtocol === 'sftp' && sftpClient) {
          await sftpClient.fastGet(file.remotePath, localFilePath, {
            step: (transferredBytes: number) => {
              if (controller.cancelRequested) return;
              
              currentFileDownloaded = transferredBytes;
              const totalDownloaded = downloadedBytes + currentFileDownloaded;
              const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
              const speed = totalDownloaded / elapsedSeconds;
              const eta = entries.totalBytes > 0 && speed > 0 ? (entries.totalBytes - totalDownloaded) / speed : undefined;
              
              notifyDownloadProgress({
                id: downloadId,
                status: 'downloading',
                downloadedSize: totalDownloaded,
                totalSize: entries.totalBytes,
                speed,
                eta,
                totalFiles: entries.totalFiles,
                completedFiles
              });
            }
          });
        } else if (currentProtocol === 'ftp' && ftpClient) {
          // FTP also supports progress tracking
          const ftpDownloadClient = new ftp.Client();
          ftpDownloadClient.ftp.verbose = ftpClient.ftp.verbose;
          
          ftpDownloadClient.trackProgress((info) => {
            if (controller.cancelRequested) return;
            
            currentFileDownloaded = info.bytesOverall;
            const totalDownloaded = downloadedBytes + currentFileDownloaded;
            const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
            const speed = totalDownloaded / elapsedSeconds;
            const eta = entries.totalBytes > 0 && speed > 0 ? (entries.totalBytes - totalDownloaded) / speed : undefined;
            
            notifyDownloadProgress({
              id: downloadId,
              status: 'downloading',
              downloadedSize: totalDownloaded,
              totalSize: entries.totalBytes,
              speed,
              eta,
              totalFiles: entries.totalFiles,
              completedFiles
            });
          });
          
          await ftpDownloadClient.access({
            host: currentConnectionConfig!.host,
            port: currentConnectionConfig!.port || 21,
            user: currentConnectionConfig!.user,
            password: currentConnectionConfig!.password,
            secure: false
          });
          
          await ftpDownloadClient.downloadTo(localFilePath, file.remotePath);
          
          ftpDownloadClient.trackProgress(null as any);
          ftpDownloadClient.close();
        }
        
        // Check immediately after file completes
        if (controller.cancelRequested) {
          console.log('[Folder Download] Cancelled after file:', file.relativePath);
          throw new Error('Download cancelled');
        }

        downloadedBytes += file.size;
        completedFiles += 1;

        // Final update after file completes
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
        const speed = downloadedBytes / elapsedSeconds;
        const eta = entries.totalBytes > 0 && speed > 0 ? (entries.totalBytes - downloadedBytes) / speed : undefined;

        notifyDownloadProgress({
          id: downloadId,
          status: 'downloading',
          downloadedSize: downloadedBytes,
          totalSize: entries.totalBytes,
          speed,
          eta,
          totalFiles: entries.totalFiles,
          completedFiles
        });
      } catch (err: any) {
        if (controller.cancelRequested || err.message === 'Download cancelled') {
          console.log('[Folder Download] Stopping due to cancellation');
          throw new Error('Download cancelled');
        }
        console.error('[Folder Download] Error downloading file:', file.relativePath, err);
        throw err;
      }
    }

    const finalStatus = controller.cancelRequested ? 'cancelled' : 'completed';
    const endTime = Date.now();
    notifyDownloadProgress({
      id: downloadId,
      status: finalStatus,
      downloadedSize: downloadedBytes,
      totalSize: entries.totalBytes,
      speed: 0,
      eta: 0,
      totalFiles: entries.totalFiles,
      completedFiles,
      localPath: targetPath,
      endTime
    });
    
    console.log(`[Folder Download] ${finalStatus}:`, { downloadId, targetPath, files: completedFiles, endTime });
  } catch (err: any) {
    const status = controller.cancelRequested || err.message === 'Download cancelled' ? 'cancelled' : 'failed';
    const endTime = Date.now();
    console.log('[Folder Download] Error caught, status:', status, 'error:', err.message);
    notifyDownloadProgress({
      id: downloadId,
      status,
      downloadedSize: 0,
      totalSize: 0,
      speed: 0,
      eta: 0,
      error: err.message,
      endTime
    });
  } finally {
    console.log('[Folder Download] Cleanup, removing controller for:', downloadId);
    downloadFolderControllers.delete(downloadId);
  }
};

const startFolderUpload = async (uploadId: string, localPath: string, remotePath: string) => {
  const controller = createUploadController(uploadId);
  uploadControllers.set(uploadId, controller);
  const startedAt = Date.now();
  try {
    const entries = await collectLocalEntries(localPath);
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

    await createUploadDirectories(remotePath, entries.directories);

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
      try {
        if (controller.cancelRequested) {
          throw createUploadAbortError('cancelled');
        }
        if (controller.paused) {
          await waitForUploadResume(controller);
          if (controller.cancelRequested) {
            throw createUploadAbortError('cancelled');
          }
        }

        const remoteFilePath = path.posix.join(remotePath, file.relativePath).replace(/\\/g, '/');
        notifyUploadProgress({
          uploadId,
          status: controller.paused ? 'paused' : 'uploading',
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
          status: controller.paused ? 'paused' : 'uploading',
          uploadedBytes,
          totalBytes: entries.totalBytes,
          completedFiles,
          totalFiles: entries.totalFiles,
          currentFile: file.relativePath,
          currentFileSize: file.size,
          currentFileUploaded: file.size,
          speed: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 0.001)
        });
      } catch (err: any) {
        const remoteFilePath = path.posix.join(remotePath, file.relativePath).replace(/\\/g, '/');
        if (controller.cancelRequested || err?.code === 'UPLOAD_CANCELLED') {
          await deleteRemoteFile(remoteFilePath);
        }
        throw err;
      }
    }

    notifyUploadProgress({
      uploadId,
      status: controller.cancelRequested ? 'cancelled' : 'completed',
      uploadedBytes,
      totalBytes: entries.totalBytes,
      completedFiles,
      totalFiles: entries.totalFiles,
      currentFile: undefined,
      currentFileSize: undefined,
      currentFileUploaded: undefined,
      speed: uploadedBytes / Math.max((Date.now() - startedAt) / 1000, 0.001)
    });
  } catch (err: any) {
    const status: UploadStatus =
      controller.cancelRequested || err.code === 'UPLOAD_CANCELLED'
        ? 'cancelled'
        : err.code === 'UPLOAD_PAUSED'
          ? 'paused'
          : 'failed';
    notifyUploadProgress({
      uploadId,
      status,
      uploadedBytes: uploadStates.get(uploadId)?.uploadedBytes || 0,
      totalBytes: uploadStates.get(uploadId)?.totalBytes || 0,
      completedFiles: uploadStates.get(uploadId)?.completedFiles || 0,
      totalFiles: uploadStates.get(uploadId)?.totalFiles || 0,
      currentFile: uploadStates.get(uploadId)?.currentFile,
      currentFileSize: uploadStates.get(uploadId)?.currentFileSize,
      currentFileUploaded: uploadStates.get(uploadId)?.currentFileUploaded,
      speed: uploadStates.get(uploadId)?.speed,
      error: err.message
    });
  } finally {
    uploadControllers.delete(uploadId);
  }
};

const enqueueDownloadJob = (jobData: DownloadJobPayload) => {
  return new Promise<{ success: true; savedPath: string }>((resolve, reject) => {
    downloadQueue.push({ ...jobData, resolve, reject });
    processDownloadQueue();
  });
};

const enqueueFolderDownload = (job: FolderDownloadJobPayload): Promise<void> => {
  return new Promise((resolve, reject) => {
    const folderJob = {
      ...job,
      isFolder: true,
      resolve,
      reject
    };
    downloadQueue.push(folderJob as any);
    processDownloadQueue();
  });
};

const processDownloadQueue = () => {
  console.log('[Download Queue] Processing queue. Active jobs:', activeDownloadJobs, 'Queue length:', downloadQueue.length);
  
  if (activeDownloadJobs >= MAX_CONCURRENT_DOWNLOADS) {
    console.log('[Download Queue] Max concurrent downloads reached, waiting...');
    return;
  }

  const nextJob = downloadQueue.shift();
  if (!nextJob) {
    console.log('[Download Queue] No jobs in queue');
    return;
  }

  console.log('[Download Queue] Starting job:', nextJob.id);
  activeDownloadJobs += 1;
  
  // Check if it's a folder download
  if ((nextJob as any).isFolder) {
    const job = nextJob as any;
    
    // Store the job reference so the backend can update it after dialog
    activeFolderJobs.set(job.id, job);
    
    // Wait for dialog to be resolved (paths to be populated)
    const waitForDialog = async () => {
      console.log('[Download Queue] Checking dialog status for:', job.id, { 
        hasLocalPath: !!job.localPath, 
        hasFolderName: !!job.folderName,
        dialogResolved: job.dialogResolved 
      });
      
      if (!job.localPath || !job.folderName) {
        console.log('[Download Queue] Waiting for dialog resolution for:', job.id);
        let attempts = 0;
        const maxAttempts = 3000; // 5 minutes (3000 * 100ms)
        
        while ((!job.localPath || !job.folderName) && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
          
          // Check if job was cancelled (removed from activeFolderJobs)
          if (!activeFolderJobs.has(job.id)) {
            console.log('[Download Queue] Job was cancelled while waiting for dialog:', job.id);
            throw new Error('Cancelled while queued');
          }
        }
        
        if (!job.localPath || !job.folderName) {
          console.error('[Download Queue] Dialog timeout for:', job.id);
          activeFolderJobs.delete(job.id);
          throw new Error('Dialog timeout');
        }
        
        console.log('[Download Queue] Dialog resolved for:', job.id, { localPath: job.localPath, folderName: job.folderName });
      } else {
        console.log('[Download Queue] Dialog already resolved, starting immediately:', job.id);
      }
    };
    
    waitForDialog()
      .then(() => {
        console.log('[Download Queue] Starting folder download for:', job.id);
        return startFolderDownload(job.id, job.remotePath, job.localPath, job.folderName);
      })
      .then(() => {
        console.log('[Download Queue] Folder job completed:', job.id);
        if (job.resolve) job.resolve();
      })
      .catch((err) => {
        console.log('[Download Queue] Folder job failed/cancelled:', job.id, 'error:', err.message);
        if (job.reject) job.reject(err);
      })
      .finally(() => {
        activeDownloadJobs -= 1;
        activeFolderJobs.delete(job.id);
        console.log('[Download Queue] Folder job finished. Active jobs:', activeDownloadJobs);
        processDownloadQueue();
      });
  } else {
    const { resolve, reject, ...payload } = nextJob;
    performDownloadJob(payload)
      .then(() => {
        console.log('[Download Queue] Job completed:', payload.id);
        resolve({ success: true, savedPath: payload.localPath });
      })
      .catch((err) => {
        console.log('[Download Queue] Job failed/cancelled:', payload.id, 'error:', err.message);
        reject(err);
      })
      .finally(() => {
        activeDownloadJobs -= 1;
        console.log('[Download Queue] Job finished, active jobs now:', activeDownloadJobs);
        processDownloadQueue();
      });
  }
};

const performDownloadJob = async (job: DownloadJobPayload) => {
  // Don't set startTime here - it should already be set after dialog resolution
  const startTime = Date.now(); // This is just for speed calculation

  let finalSize = job.totalSize;

  try {
    // Update status to 'downloading' now that we're actually starting
    notifyDownloadProgress({
      id: job.id,
      downloadedSize: 0,
      totalSize: job.totalSize,
      status: 'downloading'
    });
    
    if (job.connection.protocol === 'ftp') {
      finalSize = await performFtpDownload(job, startTime);
    } else {
      finalSize = await performSftpDownload(job, startTime);
    }

    const completedSize = finalSize || job.totalSize || 0;

    notifyDownloadProgress({
      id: job.id,
      downloadedSize: completedSize,
      totalSize: completedSize,
      status: 'completed'
    });
  } catch (err: any) {
    if (err?.code === 'DOWNLOAD_CANCELLED' || err?.code === 'DOWNLOAD_PAUSED') {
      const status = err.code === 'DOWNLOAD_PAUSED' ? 'paused' : 'cancelled';
      notifyDownloadProgress({
        id: job.id,
        downloadedSize: 0,
        totalSize: finalSize || job.totalSize,
        status
      });
    }
    throw err;
  }
};

const performFtpDownload = async (job: DownloadJobPayload, startTime: number): Promise<number> => {
  const downloadClient = new ftp.Client();
  downloadClient.ftp.verbose = ftpClient?.ftp.verbose ?? false;
  let totalSize = job.totalSize || 0;
  let aborted = false;
  let abortReason: DownloadStatus = 'cancelled';

  const abort = (reason: DownloadStatus = 'cancelled') => {
    console.log('[FTP Download] Abort called for job:', job.id, 'reason:', reason);
    aborted = true;
    abortReason = reason;
    try {
      downloadClient.close();
    } catch {
      // ignore
    }
  };

  activeDownloadControllers.set(job.id, abort);

  let ftpAbortLoggedOnce = false;
  downloadClient.trackProgress((info) => {
    // Stop sending progress if download was aborted
    if (aborted) {
      if (!ftpAbortLoggedOnce) {
        console.log('[FTP Download] Skipping progress updates for aborted download:', job.id);
        ftpAbortLoggedOnce = true;
      }
      return;
    }
    const downloadedSize = info.bytesOverall;
    if (downloadedSize > totalSize) {
      totalSize = downloadedSize;
    }
    const elapsedSeconds = Math.max((Date.now() - startTime) / 1000, 0.001);
    const speed = downloadedSize / elapsedSeconds;
    const eta = totalSize > 0 && speed > 0 ? Math.max((totalSize - downloadedSize) / speed, 0) : undefined;
    notifyDownloadProgress({
      id: job.id,
      downloadedSize,
      totalSize: totalSize > 0 ? totalSize : undefined,
      speed,
      eta,
      status: 'downloading'
    });
  });

  try {
    await downloadClient.access({
      host: job.connection.host,
      port: job.connection.port || 21,
      user: job.connection.user,
      password: job.connection.password ?? undefined,
      secure: false
    });

    if (totalSize <= 0) {
      try {
        totalSize = await downloadClient.size(job.remotePath);
      } catch {
        // Ignore failures in determining size
      }
    }

    await downloadClient.downloadTo(job.localPath, job.remotePath);
    if (aborted) {
      throw createDownloadAbortError(abortReason);
    }
    return totalSize || job.totalSize || 0;
  } catch (err) {
    if (aborted) {
      // Delete incomplete file on cancellation
      try {
        if (fs.existsSync(job.localPath)) {
          fs.unlinkSync(job.localPath);
          console.log('[Download] Deleted incomplete file after cancel:', job.localPath);
        }
      } catch (cleanupErr) {
        console.error('[Download] Failed to delete incomplete file:', cleanupErr);
      }
      throw createDownloadAbortError(abortReason);
    }
    throw err;
  } finally {
    downloadClient.trackProgress(null as any);
    activeDownloadControllers.delete(job.id);
    try {
      downloadClient.close();
    } catch {
      // ignore
    }
  }
};

const performSftpDownload = async (job: DownloadJobPayload, startTime: number): Promise<number> => {
  const tempSftpClient = new Client();
  const connectConfig: any = {
    host: job.connection.host,
    port: job.connection.port || 22,
    username: job.connection.user,
    readyTimeout: 20000
  };

  if (job.connection.privateKeyContent) {
    connectConfig.privateKey = job.connection.privateKeyContent;
  } else if (job.connection.privateKeyPath) {
    connectConfig.privateKey = fs.readFileSync(job.connection.privateKeyPath);
  } else {
    connectConfig.password = job.connection.password;
  }

  let totalSize = job.totalSize || 0;
  let aborted = false;
  let abortReason: DownloadStatus = 'cancelled';
  let abortLoggedOnce = false;
  let abortReject: ((err: any) => void) | null = null;

  const abort = (reason: DownloadStatus = 'cancelled') => {
    console.log('[SFTP Download] Abort called for job:', job.id, 'reason:', reason);
    aborted = true;
    abortReason = reason;
    // Force close the connection immediately
    tempSftpClient.end().catch(() => undefined);
    // Also try to destroy the underlying connection
    try {
      (tempSftpClient as any).client?.end();
      (tempSftpClient as any).client?.destroy();
    } catch {
      // Ignore errors
    }
    // Force reject the promise if it's hanging
    if (abortReject) {
      console.log('[SFTP Download] Force rejecting hanging download promise');
      abortReject(createDownloadAbortError(reason));
    }
  };

  activeDownloadControllers.set(job.id, abort);

  try {
    await tempSftpClient.connect(connectConfig);
    if (totalSize <= 0) {
      try {
        const stats = await tempSftpClient.stat(job.remotePath);
        totalSize = stats.size || totalSize;
      } catch {
        // Ignore errors fetching size
      }
    }

    // Wrap the download in a promise that can be force-rejected on abort
    await new Promise<void>((resolve, reject) => {
      abortReject = reject;
      
      tempSftpClient.fastGet(job.remotePath, job.localPath, {
        step: (downloadedSize: number, _chunk: number, remoteSize: number) => {
          // Stop sending progress if download was aborted
          if (aborted) {
            if (!abortLoggedOnce) {
              console.log('[SFTP Download] Skipping progress updates for aborted download:', job.id);
              abortLoggedOnce = true;
            }
            return;
          }
          if (remoteSize && remoteSize > 0 && totalSize <= 0) {
            totalSize = remoteSize;
          }
          const elapsedSeconds = Math.max((Date.now() - startTime) / 1000, 0.001);
          const speed = downloadedSize / elapsedSeconds;
          const eta = totalSize > 0 && speed > 0 ? Math.max((totalSize - downloadedSize) / speed, 0) : undefined;
          notifyDownloadProgress({
            id: job.id,
            downloadedSize,
            totalSize: totalSize > 0 ? totalSize : undefined,
            speed,
            eta,
            status: 'downloading'
          });
        }
      })
      .then(() => {
        abortReject = null;
        if (aborted) {
          console.log('[SFTP Download] Download completed but was aborted, rejecting');
          reject(createDownloadAbortError(abortReason));
        } else {
          resolve();
        }
      })
      .catch((err) => {
        abortReject = null;
        reject(err);
      });
    });

    return totalSize || job.totalSize || 0;
  } catch (err) {
    if (aborted) {
      // Delete incomplete file on cancellation
      try {
        if (fs.existsSync(job.localPath)) {
          fs.unlinkSync(job.localPath);
          console.log('[Download] Deleted incomplete file after cancel:', job.localPath);
        }
      } catch (cleanupErr) {
        console.error('[Download] Failed to delete incomplete file:', cleanupErr);
      }
      throw createDownloadAbortError(abortReason);
    }
    throw err;
  } finally {
    activeDownloadControllers.delete(job.id);
    await tempSftpClient.end().catch(() => undefined);
  }
};

// Track ongoing FTP operations that must remain exclusive on the UI connection (e.g. previews)
let ftpTransferInProgress: string | null = null;

const runExclusiveFtpOperation = async <T>(operationName: string, operation: () => Promise<T>): Promise<T> => {
  if (ftpTransferInProgress) {
    const error: any = new Error(`Another FTP transfer ("${ftpTransferInProgress}") is already running. Please wait until it finishes.`);
    error.code = 'FTP_TRANSFER_IN_PROGRESS';
    throw error;
  }

  ftpTransferInProgress = operationName;
  try {
    return await operation();
  } finally {
    ftpTransferInProgress = null;
  }
};

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

// Helper function to generate unique file name
// Uses a lock to prevent race conditions when multiple downloads happen simultaneously
const pendingFileNames = new Set<string>();

const generateUniqueFileName = (dir: string, fileName: string): string => {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let counter = 1;
    let newPath = path.join(dir, fileName);
    
    // Check both filesystem AND pending downloads to avoid race conditions
    while (fs.existsSync(newPath) || pendingFileNames.has(newPath)) {
        const newFileName = `${baseName} (${counter})${ext}`;
        newPath = path.join(dir, newFileName);
        counter++;
    }
    
    // Reserve this filename
    pendingFileNames.add(newPath);
    
    // Remove from pending after 30 seconds (cleanup in case download fails)
    setTimeout(() => {
        pendingFileNames.delete(newPath);
    }, 30000);
    
    return newPath;
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
    currentConnectionConfig = { ...config };
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
    currentConnectionConfig = { ...config };
      return { success: true, message: 'Connected via FTP' };
    }
  } catch (err: any) {
    console.error('Connection failed:', err);
  currentConnectionConfig = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp:disconnect', async () => {
  try {
    // Clean up all temporary preview files before disconnecting
    cleanupAllTempFiles();
    cancelAllDownloads('cancelled');
    
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
    currentConnectionConfig = null;
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

ipcMain.handle('ftp:download', async (event, { remotePath, fileName, downloadId, totalSize, defaultDownloadPath, duplicateAction, applyToAll }: { remotePath: string, fileName: string, downloadId?: string, totalSize?: number, defaultDownloadPath?: string, duplicateAction?: 'overwrite' | 'rename' | 'skip', applyToAll?: boolean }) => {
    let savedFilePath: string = '';
    let actualFileName: string = fileName;
    let finalDuplicateAction = duplicateAction;
    let finalApplyToAll = applyToAll || false;
    
    try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            console.error('[Download] No window available');
            return { success: false, error: 'No window' };
        }

        console.log('[Download] Starting download:', { remotePath, fileName, defaultDownloadPath });

        // If default download path is set, use it
        if (defaultDownloadPath) {
            const defaultPath = path.join(defaultDownloadPath, fileName);
            
            // Check if file exists
            if (fs.existsSync(defaultPath)) {
                // If we have a duplicate action preference and applyToAll, use it
                if (finalDuplicateAction && finalApplyToAll) {
                    if (finalDuplicateAction === 'skip') {
                        return { success: false, cancelled: true, dialogCancelled: false, skipped: true };
                    } else if (finalDuplicateAction === 'overwrite') {
                        savedFilePath = defaultPath;
                    } else { // rename
                        savedFilePath = generateUniqueFileName(defaultDownloadPath, fileName);
                    }
                } else {
                    // Prompt user for action
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
                    
                    if (result.response === 3) { // Cancel
                        return { success: false, cancelled: true, dialogCancelled: true };
                    }
                    
                    if (result.response === 2) { // Skip
                        return { success: false, cancelled: true, dialogCancelled: false, skipped: true };
                    }
                    
                    finalApplyToAll = result.checkboxChecked || false;
                    
                    if (result.response === 0) { // Overwrite
                        finalDuplicateAction = 'overwrite';
                        savedFilePath = defaultPath;
                    } else { // Rename
                        finalDuplicateAction = 'rename';
                        savedFilePath = generateUniqueFileName(defaultDownloadPath, fileName);
                    }
                }
            } else {
                savedFilePath = defaultPath;
            }
        } else {
            // No default path, show save dialog
            const { filePath, canceled } = await dialog.showSaveDialog(win, {
                defaultPath: fileName
            });

            if (canceled || !filePath) {
                console.log('[Download] User cancelled save dialog');
                return { success: false, cancelled: true, canceled: true, dialogCancelled: true };
            }

            savedFilePath = filePath;
        }

        console.log('[Download] Save path selected:', savedFilePath);
        
        if (!currentConnectionConfig) {
            throw new Error('Not connected');
        }

        const connectionSnapshot: ConnectionConfig = { ...currentConnectionConfig };
        const jobId = downloadId || `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        actualFileName = path.basename(savedFilePath);
        
        // Notify about the actual file name and local path immediately
        notifyDownloadProgress({
            id: jobId,
            downloadedSize: 0,
            totalSize: totalSize || 0,
            status: 'downloading',
            actualFileName: actualFileName,
            localPath: savedFilePath
        });
        
        console.log('[Download] Queuing job', { jobId, protocol: connectionSnapshot.protocol, remotePath, savedFilePath, actualFileName });

        // Send start time notification now (after dialog is resolved)
        // Status is 'queued' initially, will change to 'downloading' when job actually starts
        const actualStartTime = Date.now();
        notifyDownloadProgress({
            id: jobId,
            downloadedSize: 0,
            totalSize: totalSize || 0,
            status: 'queued',
            startTime: actualStartTime
        });

        const result = await enqueueDownloadJob({
            id: jobId,
            remotePath,
            localPath: savedFilePath,
            fileName: actualFileName, // Use actual file name
            connection: connectionSnapshot,
            totalSize: totalSize ?? 0
        });

        console.log('[Download] Job completed', { jobId, savedFilePath });
        return {
            ...result,
            duplicateAction: finalDuplicateAction,
            applyToAll: finalApplyToAll,
            actualFileName: actualFileName,
            savedPath: savedFilePath // Always include the saved path
        };
    } catch (err: any) {
        console.error('[Download] Download error:', err);
        if (err?.code === 'DOWNLOAD_CANCELLED' || err?.code === 'DOWNLOAD_PAUSED') {
            return { 
                success: false, 
                cancelled: true, 
                reason: err.code, 
                dialogCancelled: false,
                savedPath: savedFilePath || '', // Include the path even when cancelled
                actualFileName: actualFileName || fileName
            };
        }
        return { success: false, error: err.message || 'Unknown error' };
    }
});

ipcMain.handle('download:cancel', async (_event, { downloadId }: { downloadId: string }) => {
    const success = cancelDownloadJob(downloadId, 'cancelled');
    return { success };
});

ipcMain.handle('ftp:upload-folder', async (_event, { localPath, remotePath }: { localPath: string, remotePath: string }) => {
    try {
        if (!currentProtocol) {
            throw new Error('Not connected');
        }
        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        startFolderUpload(uploadId, localPath, remotePath).catch((err) => {
            console.error('[Upload] Folder upload failed:', err);
        });
        return { success: true, uploadId };
    } catch (err: any) {
        console.error('[Upload] Unable to start folder upload:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('ftp:download-folder', async (event, { remotePath, folderName, downloadId, defaultDownloadPath, duplicateAction, applyToAll, defaultConflictResolution }: { 
  remotePath: string, 
  folderName: string, 
  downloadId: string, 
  defaultDownloadPath?: string, 
  duplicateAction?: 'overwrite' | 'rename' | 'skip', 
  applyToAll?: boolean,
  defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt'
}) => {
    try {
        if (!currentProtocol) {
            throw new Error('Not connected');
        }
        
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
            console.error('[Folder Download] No window available');
            return { success: false, error: 'No window' };
        }
        
        // IMPORTANT: Reserve a download slot BEFORE showing dialog
        // This ensures the folder download stays in queue during dialog interaction
        let dialogResolveCallback: ((value: { localPath: string; folderName: string }) => void) | null = null;
        let dialogRejectCallback: ((reason: any) => void) | null = null;
        let jobResolveCallback: (() => void) | null = null;
        let jobRejectCallback: ((reason: any) => void) | null = null;
        
        const folderJob = {
            id: downloadId,
            remotePath,
            localPath: '', // Will be set after dialog
            fileName: folderName,
            folderName: '', // Will be set after dialog
            connection: currentConnectionConfig!,
            totalSize: 0,
            isFolder: true,
            resolve: (() => {}) as any, // Will be set
            reject: (() => {}) as any, // Will be set
            dialogResolved: false
        };
        
        downloadQueue.push(folderJob as any);
        console.log('[Folder Download] Added to queue before dialog:', downloadId);
        processDownloadQueue();
        
        let savedFolderPath: string;
        let finalDuplicateAction = duplicateAction;
        let finalApplyToAll = applyToAll || false;
        
        // Determine download location
        if (defaultDownloadPath) {
            const defaultPath = path.join(defaultDownloadPath, folderName);
            
            // Check if folder exists
            if (fs.existsSync(defaultPath)) {
                // If we have a duplicate action preference and applyToAll, use it
                if (finalDuplicateAction && finalApplyToAll) {
                    if (finalDuplicateAction === 'skip') {
                        // Remove from activeFolderJobs to stop the wait loop
                        activeFolderJobs.delete(downloadId);
                        console.log('[Folder Download] Auto-skip (applyToAll), removed from activeFolderJobs:', downloadId);
                        return { success: false, cancelled: true, dialogCancelled: false, skipped: true };
                    } else if (finalDuplicateAction === 'overwrite') {
                        savedFolderPath = defaultPath;
                    } else { // rename
                        savedFolderPath = generateUniqueFileName(defaultDownloadPath, folderName);
                    }
                } else if (defaultConflictResolution && defaultConflictResolution !== 'prompt') {
                    // Use global setting if not 'prompt'
                    console.log('[Folder Download] Using global conflict resolution:', defaultConflictResolution);
                    if (defaultConflictResolution === 'overwrite') {
                        savedFolderPath = defaultPath;
                        finalDuplicateAction = 'overwrite';
                    } else { // rename
                        savedFolderPath = generateUniqueFileName(defaultDownloadPath, folderName);
                        finalDuplicateAction = 'rename';
                    }
                } else {
                    // Prompt user for action
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
                        // Remove from activeFolderJobs to stop the wait loop
                        activeFolderJobs.delete(downloadId);
                        console.log('[Folder Download] User cancelled dialog, removed from activeFolderJobs:', downloadId);
                        return { success: false, cancelled: true, dialogCancelled: true };
                    }
                    
                    if (result.response === 2) { // Skip
                        // Remove from activeFolderJobs to stop the wait loop
                        activeFolderJobs.delete(downloadId);
                        console.log('[Folder Download] User skipped, removed from activeFolderJobs:', downloadId);
                        return { success: false, cancelled: true, dialogCancelled: false, skipped: true };
                    }
                    
                    finalApplyToAll = result.checkboxChecked || false;
                    
                    if (result.response === 0) { // Overwrite
                        finalDuplicateAction = 'overwrite';
                        savedFolderPath = defaultPath;
                    } else { // Rename
                        finalDuplicateAction = 'rename';
                        savedFolderPath = generateUniqueFileName(defaultDownloadPath, folderName);
                    }
                }
            } else {
                savedFolderPath = defaultPath;
            }
        } else {
            // No default path, show save dialog
            const { filePath, canceled } = await dialog.showSaveDialog(win, {
                defaultPath: folderName,
                properties: ['createDirectory', 'showOverwriteConfirmation']
            });

            if (canceled || !filePath) {
                console.log('[Folder Download] User cancelled save dialog');
                // Remove from activeFolderJobs to stop the wait loop
                activeFolderJobs.delete(downloadId);
                return { success: false, cancelled: true, canceled: true, dialogCancelled: true };
            }

            savedFolderPath = filePath;
        }
        
        const actualFolderName = path.basename(savedFolderPath);
        const parentPath = path.dirname(savedFolderPath);
        
        console.log('[Folder Download] Dialog resolved, updating job:', { downloadId, savedFolderPath, actualFolderName });
        
        // Try to find the job in activeFolderJobs first (being processed)
        let job = activeFolderJobs.get(downloadId);
        
        // If not in activeFolderJobs, check the queue (still waiting to be processed)
        if (!job) {
            console.log('[Folder Download] Not in activeFolderJobs, checking queue...');
            job = downloadQueue.find((j: any) => j.id === downloadId && j.isFolder) as any;
        }
        
        if (job) {
            job.localPath = parentPath;
            job.folderName = actualFolderName;
            job.dialogResolved = true;
            console.log('[Folder Download] Updated job successfully:', downloadId, { 
                localPath: job.localPath, 
                folderName: job.folderName,
                dialogResolved: job.dialogResolved,
                inActiveJobs: activeFolderJobs.has(downloadId),
                inQueue: downloadQueue.some((j: any) => j.id === downloadId)
            });
        } else {
            console.warn('[Folder Download] Job not found anywhere:', downloadId, {
                activeJobs: Array.from(activeFolderJobs.keys()),
                queueJobs: downloadQueue.filter((j: any) => j.isFolder).map((j: any) => j.id)
            });
        }
        
        // Send notification with actual path
        notifyDownloadProgress({
            id: downloadId,
            downloadedSize: 0,
            totalSize: 0,
            status: 'queued',
            startTime: Date.now(),
            localPath: savedFolderPath,
            actualFileName: actualFolderName
        });
        
        return { 
            success: true, 
            downloadId,
            savedPath: savedFolderPath,
            actualFileName: actualFolderName,
            duplicateAction: finalDuplicateAction,
            applyToAll: finalApplyToAll
        };
    } catch (err: any) {
        console.error('[Download] Unable to start folder download:', err);
        // Remove from queue on error
        const jobIndex = downloadQueue.findIndex((j: any) => j.id === downloadId);
        if (jobIndex !== -1) {
            const job = downloadQueue.splice(jobIndex, 1)[0] as any;
            if (job.pendingDialogReject) job.pendingDialogReject(err);
        }
        return { success: false, error: err.message };
    }
});

ipcMain.handle('download-folder:cancel', async (_event, { downloadId }: { downloadId: string }) => {
    console.log('[Folder Download] Cancel requested for:', downloadId);
    
    // FIRST check for active controller (actually downloading) - this is most important
    const controller = downloadFolderControllers.get(downloadId);
    if (controller) {
        console.log('[Folder Download] Found active controller, setting cancel flag:', downloadId);
        controller.cancelRequested = true;
        // Don't send cancellation notification here - let the download logic handle it
        return { success: true, wasActive: true };
    }
    
    // Second, check if it's in the queue (not started yet)
    const queueIndex = downloadQueue.findIndex((job: any) => job.id === downloadId && job.isFolder);
    if (queueIndex !== -1) {
        console.log('[Folder Download] Found in queue, removing:', downloadId);
        const job = downloadQueue.splice(queueIndex, 1)[0] as any;
        activeFolderJobs.delete(downloadId); // Also remove from active jobs
        if (job.reject) {
            job.reject(new Error('Cancelled while queued'));
        }
        
        // Notify cancellation
        notifyDownloadProgress({
            id: downloadId,
            downloadedSize: 0,
            totalSize: 0,
            status: 'cancelled',
            speed: 0,
            eta: 0,
            endTime: Date.now()
        });
        
        return { success: true, wasQueued: true };
    }
    
    // Finally, check if it's waiting for dialog (in activeFolderJobs but not started yet)
    if (activeFolderJobs.has(downloadId)) {
        console.log('[Folder Download] Found in activeFolderJobs (waiting for dialog), removing:', downloadId);
        activeFolderJobs.delete(downloadId);
        
        // Notify cancellation
        notifyDownloadProgress({
            id: downloadId,
            downloadedSize: 0,
            totalSize: 0,
            status: 'cancelled',
            speed: 0,
            eta: 0,
            endTime: Date.now()
        });
        
        return { success: true, wasWaiting: true };
    }
    
    // Not found anywhere
    console.warn('[Folder Download] Not found anywhere:', downloadId);
    notifyDownloadProgress({
        id: downloadId,
        downloadedSize: 0,
        totalSize: 0,
        status: 'cancelled',
        speed: 0,
        eta: 0,
        endTime: Date.now()
    });
    return { success: false, error: 'Download not found' };
});

ipcMain.handle('upload:pause', async (_event, { uploadId }: { uploadId: string }) => {
    const controller = uploadControllers.get(uploadId);
    if (!controller) {
        return { success: false, error: 'Upload not found' };
    }
    controller.paused = true;
    const snapshot = uploadStates.get(uploadId);
    if (snapshot) {
        notifyUploadProgress({
            ...snapshot,
            status: 'paused'
        });
    }
    return { success: true };
});

ipcMain.handle('upload:resume', async (_event, { uploadId }: { uploadId: string }) => {
    const controller = uploadControllers.get(uploadId);
    if (!controller) {
        return { success: false, error: 'Upload not found' };
    }
    if (!controller.paused) {
        return { success: true };
    }
    resumeUploadController(controller);
    const snapshot = uploadStates.get(uploadId);
    if (snapshot) {
        notifyUploadProgress({
            ...snapshot,
            status: 'uploading'
        });
    }
    return { success: true };
});

ipcMain.handle('upload:cancel', async (_event, { uploadId }: { uploadId: string }) => {
    const controller = uploadControllers.get(uploadId);
    if (!controller) {
        return { success: false, error: 'Upload not found' };
    }
    controller.cancelRequested = true;
    resumeUploadController(controller);
    return { success: true };
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
        console.error('[Mkdir] Failed:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('fs:path-info', async (_event, { targetPath }: { targetPath: string }) => {
    try {
        const stats = await fs.promises.stat(targetPath);
        return {
            success: true,
            isDirectory: stats.isDirectory(),
            size: stats.size
        };
    } catch (err: any) {
        return { success: false, error: err.message };
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
            return await runExclusiveFtpOperation('preview', async () => {
                console.log('[FTP] Starting preview for:', fileName);
                await ftpClient!.downloadTo(tempPath, remotePath);
                
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
            });
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
        if (!localPath) {
            throw new Error('Local file path is missing');
        }

        if (!fs.existsSync(localPath)) {
            throw new Error('Local file not found');
        }

        if (currentProtocol === 'sftp' && sftpClient) {
            const readStream = fs.createReadStream(localPath);
            await sftpClient.put(readStream, remotePath);
        } else if (currentProtocol === 'ftp' && ftpClient) {
            const remoteDir = path.posix.dirname(remotePath).replace(/\\/g, '/');
            if (remoteDir && remoteDir !== '.' && remoteDir !== '/') {
                await ftpClient.ensureDir(remoteDir);
            }
            await ftpClient.uploadFrom(localPath, remotePath);
        } else {
             throw new Error('Not connected');
        }
        return { success: true };
    } catch (err: any) {
        console.error('[Upload] Failed:', err);
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

// Settings handlers
ipcMain.handle('settings:update-max-downloads', async (_event, maxDownloads: number) => {
  console.log('[Settings] Updating max concurrent downloads to:', maxDownloads);
  MAX_CONCURRENT_DOWNLOADS = Math.max(1, Math.min(10, maxDownloads));
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

export const registerFtpHandlers = () => {
  console.log('[FTP Handlers] Registered');
};

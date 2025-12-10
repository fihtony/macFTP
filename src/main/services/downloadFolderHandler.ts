// Download Folder Handler - Folder download operations
import { ipcMain, dialog, BrowserWindow } from "electron";
import Client from "ssh2-sftp-client";
import * as ftp from "basic-ftp";
import * as fs from "fs";
import * as path from "path";
import {
  sftpClient,
  ftpClient,
  currentProtocol,
  currentConnectionConfig,
  type RemoteFileEntry,
  type RemoteDirectoryEntry,
  type CollectedRemoteEntries,
} from "./commonHandler";
import { notifyDownloadProgress, type DownloadStatus } from "./downloadFileHandler";
import {
  enqueueToUnifiedQueue,
  type UnifiedQueueItem,
  setStartFolderDownloadCallback,
  handleDuplicateFolder,
  getMaxConcurrentDownloads,
  cancelQueuedDownload,
  generateUniqueFileName,
} from "./commonHandler";

interface FolderDownloadJob {
  id: string;
  remotePath: string;
  localPath: string;
  folderName: string;
  totalSize: number;
  totalFiles: number;
  dialogResolved?: boolean;
  defaultConflictResolution?: "overwrite" | "rename" | "prompt";
}

const activeFolderJobs = new Map<string, FolderDownloadJob>();
const downloadFolderControllers = new Map<
  string,
  { downloadId: string; cancelRequested: boolean; cancelReason?: "failed" | "cancelled" }
>();

// Export for disconnect handler to cancel all folder downloads
export const cancelAllFolderDownloads = (reason: "failed" | "cancelled" = "failed") => {
  console.log("[Folder Download] Cancelling all folder downloads:", downloadFolderControllers.size);

  // Cancel all active folder downloads and send failure notifications
  downloadFolderControllers.forEach((controller, id) => {
    console.log("[Folder Download] Cancelling active folder download:", id, "reason:", reason);
    controller.cancelRequested = true;
    controller.cancelReason = reason; // Store the reason for later use

    // Send failure notification immediately
    const job = activeFolderJobs.get(id);
    if (job) {
      notifyDownloadProgress({
        id,
        downloadedSize: 0,
        totalSize: 0,
        status: reason,
        error: reason === "failed" ? "Connection terminated by user" : undefined,
        speed: 0,
        eta: 0,
        localPath: job.localPath ? path.join(job.localPath, job.folderName) : undefined,
        actualFileName: job.folderName,
        endTime: Date.now(),
      });
    }
  });

  // Don't clear controllers/jobs here - let the download's finally block clean up
  // This ensures the download can properly detect cancellation and send final notification
};
const folderQueue: FolderDownloadJob[] = [];
let activeFolderDownloads = 0;

// Export function to get current active folder download count (for file downloads to check combined limit)
export const getActiveFolderDownloadCount = () => activeFolderDownloads;

// ------------------------
// Helpers
// ------------------------

const collectRemoteEntries = async (remotePath: string): Promise<CollectedRemoteEntries> => {
  const files: RemoteFileEntry[] = [];
  const directories: RemoteDirectoryEntry[] = [];

  const walk = async (currentRemotePath: string, relativePath: string) => {
    let list: any[] = [];

    if (currentProtocol === "sftp" && sftpClient) {
      list = await sftpClient.list(currentRemotePath);
    } else if (currentProtocol === "ftp" && ftpClient) {
      list = await ftpClient.list(currentRemotePath);
    }

    for (const item of list) {
      const itemName = item.name;
      const itemRemotePath = path.posix.join(currentRemotePath, itemName).replace(/\\/g, "/");
      const itemRelativePath = relativePath ? path.posix.join(relativePath, itemName) : itemName;

      const isDirectory = currentProtocol === "sftp" ? item.type === "d" : item.isDirectory;

      if (isDirectory) {
        directories.push({ relativePath: itemRelativePath });
        await walk(itemRemotePath, itemRelativePath);
      } else {
        files.push({
          remotePath: itemRemotePath,
          relativePath: itemRelativePath,
          size: item.size || 0,
        });
      }
    }
  };

  await walk(remotePath, "");

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    files,
    directories,
    totalBytes,
    totalFiles: files.length,
  };
};

const createLocalDirectories = async (localRoot: string, directories: RemoteDirectoryEntry[]) => {
  for (const dir of directories) {
    const targetDir = dir.relativePath ? path.join(localRoot, dir.relativePath) : localRoot;
    await fs.promises.mkdir(targetDir, { recursive: true });
  }
};

// ------------------------
// Core download
// ------------------------

export const startFolderDownload = async (
  downloadId: string,
  remotePath: string,
  localPath: string,
  folderName: string,
  defaultConflictResolution?: "overwrite" | "rename" | "prompt"
) => {
  const controller = { downloadId, cancelRequested: false, cancelReason: undefined as "failed" | "cancelled" | undefined };
  downloadFolderControllers.set(downloadId, controller);

  // Store job info for cancellation
  activeFolderJobs.set(downloadId, {
    id: downloadId,
    remotePath,
    localPath,
    folderName,
    totalSize: 0,
    totalFiles: 0,
  });

  const startedAt = Date.now();

  try {
    const targetPath = path.join(localPath, folderName);
    console.log("[Folder Download] Starting:", { downloadId, remotePath, localPath, folderName, targetPath });
    await fs.promises.mkdir(targetPath, { recursive: true });

    if (controller.cancelRequested) {
      throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
    }

    const entries = await collectRemoteEntries(remotePath);

    await createLocalDirectories(targetPath, entries.directories);

    if (!entries.files.length) {
      notifyDownloadProgress({
        id: downloadId,
        status: "completed",
        downloadedSize: 0,
        totalSize: 0,
        speed: 0,
        eta: 0,
        totalFiles: 0,
        completedFiles: 0,
        localPath: targetPath,
        actualFileName: folderName,
        endTime: Date.now(),
      });
      return;
    }

    // Setup is complete, now update with actual totals and start downloading files
    // Status is already 'downloading' (set in unified queue processor), just update totals
    notifyDownloadProgress({
      id: downloadId,
      status: "downloading",
      downloadedSize: 0,
      totalSize: entries.totalBytes,
      speed: 0,
      eta: undefined,
      totalFiles: entries.totalFiles,
      completedFiles: 0,
      localPath: targetPath,
      actualFileName: folderName,
    });

    console.log("[Folder Download] Starting file downloads:", {
      id: downloadId,
      activeCount: activeFolderDownloads,
      totalFiles: entries.totalFiles,
    });

    let downloadedBytes = 0;
    let completedFiles = 0;

    for (const file of entries.files) {
      if (controller.cancelRequested) {
        throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
      }

      let localFilePath = path.join(targetPath, file.relativePath);

      // Handle file conflicts based on defaultConflictResolution setting
      if (fs.existsSync(localFilePath) && defaultConflictResolution && defaultConflictResolution !== "overwrite") {
        if (defaultConflictResolution === "rename") {
          // Generate a unique filename for the file
          const fileDir = path.dirname(localFilePath);
          const fileName = path.basename(localFilePath);
          const uniqueFileName = generateUniqueFileName(fileDir, fileName);
          localFilePath = path.join(fileDir, uniqueFileName);
          console.log("[Folder Download] Renamed conflicting file:", {
            original: path.basename(file.relativePath),
            renamed: path.basename(localFilePath),
          });
        } else if (defaultConflictResolution === "prompt") {
          // For folder downloads, prompt is treated as skip to prevent blocking downloads
          console.log("[Folder Download] Skipping conflicting file (prompt mode):", file.relativePath);
          completedFiles++;
          continue;
        }
      }

      let currentFileDownloaded = 0;

      if (currentProtocol === "sftp" && sftpClient) {
        try {
          await sftpClient.fastGet(file.remotePath, localFilePath, {
            step: (transferredBytes: number) => {
              if (controller.cancelRequested) {
                // Stop progress updates if cancelled
                return;
              }
              currentFileDownloaded = transferredBytes;
              const totalDownloaded = downloadedBytes + currentFileDownloaded;
              const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
              const speed = totalDownloaded / elapsedSeconds;
              const eta = entries.totalBytes > 0 && speed > 0 ? (entries.totalBytes - totalDownloaded) / speed : undefined;

              notifyDownloadProgress({
                id: downloadId,
                status: "downloading",
                downloadedSize: totalDownloaded,
                totalSize: entries.totalBytes,
                speed,
                eta,
                totalFiles: entries.totalFiles,
                completedFiles,
                localPath: targetPath,
                actualFileName: folderName,
              });
            },
          });
        } catch (err: any) {
          // If cancelled, throw cancellation error; otherwise rethrow
          if (controller.cancelRequested) {
            throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
          }
          throw err;
        }

        // Check cancellation immediately after file completes
        if (controller.cancelRequested) {
          console.log("[Folder Download] Cancelled after file:", file.relativePath);
          throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
        }
      } else if (currentProtocol === "ftp" && ftpClient) {
        const ftpDownloadClient = new ftp.Client();
        ftpDownloadClient.ftp.verbose = ftpClient.ftp.verbose;

        ftpDownloadClient.trackProgress((info) => {
          if (controller.cancelRequested) {
            // Stop progress updates if cancelled
            return;
          }
          currentFileDownloaded = info.bytesOverall;
          const totalDownloaded = downloadedBytes + currentFileDownloaded;
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
          const speed = totalDownloaded / elapsedSeconds;
          const eta = entries.totalBytes > 0 && speed > 0 ? (entries.totalBytes - totalDownloaded) / speed : undefined;

          notifyDownloadProgress({
            id: downloadId,
            status: "downloading",
            downloadedSize: totalDownloaded,
            totalSize: entries.totalBytes,
            speed,
            eta,
            totalFiles: entries.totalFiles,
            completedFiles,
            localPath: targetPath,
            actualFileName: folderName,
          });
        });

        try {
          await ftpDownloadClient.access({
            host: currentConnectionConfig!.host,
            port: currentConnectionConfig!.port || 21,
            user: currentConnectionConfig!.user,
            password: currentConnectionConfig!.password,
            secure: false,
          });

          await ftpDownloadClient.downloadTo(localFilePath, file.remotePath);
        } catch (err: any) {
          // If cancelled, throw cancellation error; otherwise rethrow
          if (controller.cancelRequested) {
            throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
          }
          throw err;
        } finally {
          ftpDownloadClient.trackProgress(null as any);
          ftpDownloadClient.close();
        }

        // Check cancellation immediately after file completes
        if (controller.cancelRequested) {
          console.log("[Folder Download] Cancelled after FTP file:", file.relativePath);
          throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
        }
      }

      if (controller.cancelRequested) {
        throw new Error(controller.cancelReason === "failed" ? "Connection terminated by user" : "Download cancelled");
      }

      downloadedBytes += file.size;
      completedFiles += 1;

      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const speed = downloadedBytes / elapsedSeconds;
      const eta = entries.totalBytes > 0 && speed > 0 ? (entries.totalBytes - downloadedBytes) / speed : undefined;

      notifyDownloadProgress({
        id: downloadId,
        status: "downloading",
        downloadedSize: downloadedBytes,
        totalSize: entries.totalBytes,
        speed,
        eta,
        totalFiles: entries.totalFiles,
        completedFiles,
        localPath: targetPath,
        actualFileName: folderName,
      });
    }

    const finalStatus = controller.cancelRequested ? controller.cancelReason || "cancelled" : "completed";
    const errorMessage = controller.cancelRequested && controller.cancelReason === "failed" ? "Connection terminated by user" : undefined;
    const endTime = Date.now();
    console.log(`[Folder Download] ${finalStatus}:`, { downloadId, targetPath, files: completedFiles, endTime });
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
      actualFileName: folderName,
      error: errorMessage,
      endTime,
    });
  } catch (err: any) {
    // Check if this was cancelled due to disconnect (failed) or user cancellation
    const isDisconnected = controller.cancelRequested && controller.cancelReason === "failed";
    const isCancelled = controller.cancelRequested && controller.cancelReason === "cancelled";
    const isErrorCancelled = err.message === "Download cancelled" || err?.code === "DOWNLOAD_CANCELLED";
    const isErrorDisconnected = err.message === "Connection terminated by user" || err?.code === "DOWNLOAD_FAILED";

    // Determine status: disconnected -> failed, user cancelled -> cancelled, other errors -> failed
    const status = isDisconnected || isErrorDisconnected ? "failed" : isCancelled || isErrorCancelled ? "cancelled" : "failed";
    const errorMessage =
      isDisconnected || isErrorDisconnected ? "Connection terminated by user" : isCancelled || isErrorCancelled ? undefined : err.message;
    const endTime = Date.now();
    console.log("[Folder Download] Error caught, status:", status, "error:", errorMessage, "err.message:", err.message);

    // Get the job to retrieve folderName and localPath
    const job = activeFolderJobs.get(downloadId);
    const targetPath = job ? path.join(job.localPath, job.folderName) : undefined;

    notifyDownloadProgress({
      id: downloadId,
      status,
      downloadedSize: 0,
      totalSize: 0,
      speed: 0,
      eta: 0,
      error: errorMessage,
      localPath: targetPath,
      actualFileName: folderName,
      endTime,
    });
  } finally {
    downloadFolderControllers.delete(downloadId);
    activeFolderJobs.delete(downloadId);
    console.log("[Folder Download] Cleanup");
  }
};

// ------------------------
// Queue
// ------------------------

const enqueueFolderDownload = (job: FolderDownloadJob) => {
  // Add to unified queue for FIFO ordering with file downloads
  const queueItem: UnifiedQueueItem = {
    type: "folder",
    id: job.id,
    enqueueTime: Date.now(),
    folderJob: {
      id: job.id,
      remotePath: job.remotePath || "",
      localPath: job.localPath,
      folderName: job.folderName,
      totalSize: job.totalSize,
      totalFiles: job.totalFiles,
      defaultConflictResolution: job.defaultConflictResolution,
    },
  };

  // Send 'queued' status notification immediately when enqueued
  notifyDownloadProgress({
    id: job.id,
    downloadedSize: 0,
    totalSize: 0,
    status: "queued",
    startTime: Date.now(),
    localPath: job.localPath ? path.join(job.localPath, job.folderName) : undefined,
    actualFileName: job.folderName,
  });

  // Add to unified queue and process
  enqueueToUnifiedQueue(queueItem);
};

// processFolderQueue is no longer needed - queue processing is handled by commonHandler's unified queue

// ------------------------
// IPC Handlers
// ------------------------

ipcMain.handle(
  "ftp:download-folder",
  async (
    event,
    {
      remotePath,
      folderName,
      downloadId,
      defaultDownloadPath,
      duplicateAction,
      applyToAll,
      defaultConflictResolution,
    }: {
      remotePath: string;
      folderName: string;
      downloadId: string;
      defaultDownloadPath?: string;
      duplicateAction?: "overwrite" | "rename" | "skip";
      applyToAll?: boolean;
      defaultConflictResolution?: "overwrite" | "rename" | "prompt";
    }
  ) => {
    try {
      if (!currentProtocol || !currentConnectionConfig) {
        throw new Error("Not connected");
      }

      // Use focused window or first available window (dialog may steal focus)
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!win) {
        return { success: false, error: "No window" };
      }

      let savedFolderPath: string;
      let finalDuplicateAction = duplicateAction;
      let finalApplyToAll = applyToAll || false;

      if (defaultDownloadPath) {
        const defaultPath = path.join(defaultDownloadPath, folderName);

        // Use commonHandler's duplication check
        const result = await handleDuplicateFolder(
          win,
          defaultPath,
          folderName,
          duplicateAction,
          applyToAll,
          defaultConflictResolution,
          false
        ); // Single folder download

        if (result.cancelled || result.skipped) {
          return { success: false, cancelled: result.cancelled, skipped: result.skipped, dialogCancelled: result.dialogCancelled };
        }

        savedFolderPath = result.savedPath;
        finalDuplicateAction = result.duplicateAction;
        finalApplyToAll = result.applyToAll;
      } else {
        const { filePath, canceled } = await dialog.showSaveDialog(win, {
          defaultPath: folderName,
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });

        if (canceled || !filePath) {
          return { success: false, cancelled: true, dialogCancelled: true };
        }

        savedFolderPath = filePath;
      }

      const actualFolderName = path.basename(savedFolderPath);
      const parentPath = path.dirname(savedFolderPath);

      const job: FolderDownloadJob = {
        id: downloadId,
        remotePath,
        localPath: parentPath,
        folderName: actualFolderName,
        totalSize: 0,
        totalFiles: 0,
        dialogResolved: true,
        defaultConflictResolution,
      };

      enqueueFolderDownload(job);

      // Note: 'queued' status notification is now sent in enqueueFolderDownload

      return {
        success: true,
        downloadId,
        savedPath: savedFolderPath,
        actualFileName: actualFolderName,
        duplicateAction: finalDuplicateAction,
        applyToAll: finalApplyToAll,
      };
    } catch (err: any) {
      console.error("[Download Folder] Error:", err);
      return { success: false, error: err.message };
    }
  }
);

ipcMain.handle("download-folder:cancel", async (_event, { downloadId }: { downloadId: string }) => {
  console.log("[Folder Download] Cancel request received:", { downloadId });

  // Check for active controller (currently downloading)
  const controller = downloadFolderControllers.get(downloadId);
  if (controller) {
    console.log("[Folder Download] Found active controller, setting cancel flag:", { downloadId });
    controller.cancelRequested = true;
    console.log("[Folder Download] Cancel request confirmed (active download):", { downloadId });
    // Don't send notification here - let the download logic handle it naturally
    return { success: true, wasActive: true };
  }

  // Check if in unified queue (not started yet)
  const queuedItem = cancelQueuedDownload(downloadId);
  if (queuedItem && queuedItem.type === "folder" && queuedItem.folderJob) {
    console.log("[Folder Download] Cancelled queued folder download from unified queue:", { downloadId });
    notifyDownloadProgress({
      id: downloadId,
      downloadedSize: 0,
      totalSize: 0,
      status: "cancelled",
      speed: 0,
      eta: 0,
      localPath: queuedItem.folderJob.localPath ? path.join(queuedItem.folderJob.localPath, queuedItem.folderJob.folderName) : undefined,
      actualFileName: queuedItem.folderJob.folderName,
      endTime: Date.now(),
    });
    console.log("[Folder Download] Cancel request confirmed (queued download):", { downloadId });
    return { success: true, wasQueued: true };
  }

  // Check if waiting for dialog resolution
  if (activeFolderJobs.has(downloadId)) {
    console.log("[Folder Download] Found waiting for dialog, removing:", { downloadId });
    const waitingJob = activeFolderJobs.get(downloadId);
    activeFolderJobs.delete(downloadId);
    notifyDownloadProgress({
      id: downloadId,
      downloadedSize: 0,
      totalSize: 0,
      status: "cancelled",
      speed: 0,
      eta: 0,
      localPath: waitingJob ? path.join(waitingJob.localPath, waitingJob.folderName) : undefined,
      actualFileName: waitingJob?.folderName,
      endTime: Date.now(),
    });
    console.log("[Folder Download] Cancel request confirmed (waiting for dialog):", { downloadId });
    return { success: true, wasWaitingForDialog: true };
  }

  console.log("[Folder Download] Download not found in any state:", downloadId);
  return { success: false, error: "Download not found" };
});

// Register the folder download handler with commonHandler
setStartFolderDownloadCallback(startFolderDownload);

console.log("[Download Folder Handler] Registered");

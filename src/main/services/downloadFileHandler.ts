// Download File Handler - Single file download operations
import { ipcMain, dialog, BrowserWindow } from "electron";
import Client from "ssh2-sftp-client";
import * as ftp from "basic-ftp";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  sftpClient,
  ftpClient,
  currentProtocol,
  currentConnectionConfig,
  type ConnectionConfig,
  enqueueToUnifiedQueue,
  type UnifiedQueueItem,
  handleDuplicateFile,
  setStartFileDownloadCallback,
  setNotifyDownloadProgressCallback,
  getMaxConcurrentDownloads,
  setMaxConcurrentDownloads,
  cancelQueuedDownload,
} from "./commonHandler";

// ============================================================================
// Types
// ============================================================================

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";

export interface DownloadProgressUpdate {
  id: string;
  downloadedSize: number;
  totalSize?: number;
  speed?: number;
  eta?: number;
  status?: DownloadStatus;
  startTime?: number;
  endTime?: number;
  actualFileName?: string;
  localPath?: string;
  totalFiles?: number;
  completedFiles?: number;
  error?: string;
}

interface DownloadQueueItem {
  id: string;
  remotePath: string;
  localPath: string;
  fileName: string;
  connection: ConnectionConfig;
  totalSize: number;
  resolve: (value: { success: true; savedPath: string }) => void;
  reject: (reason: any) => void;
  type: "file";
}

type DownloadJobPayload = Omit<DownloadQueueItem, "resolve" | "reject" | "type">;

// Extended job payload with conflict resolution metadata
export interface DownloadJobWithConflictInfo extends DownloadJobPayload {
  defaultDownloadPath?: string;
  duplicateAction?: "overwrite" | "rename" | "skip";
  applyToAll?: boolean;
  defaultConflictResolution?: "overwrite" | "rename" | "prompt";
}

// ============================================================================
// State Management
// ============================================================================

const downloadQueue: DownloadQueueItem[] = [];
const activeDownloadControllers = new Map<string, (reason?: DownloadStatus) => void>();
const activeDownloadJobsMap = new Map<string, { fileName: string; localPath: string; totalSize: number }>();
let activeDownloadJobs = 0;

// Dialog queue to ensure conflict dialogs are shown one at a time
let isShowingConflictDialog = false;
const conflictDialogQueue: Array<{
  resolve: (result: any) => void;
  show: () => Promise<any>;
}> = [];

// Process next dialog in queue
const processConflictDialogQueue = async () => {
  if (isShowingConflictDialog || conflictDialogQueue.length === 0) {
    return;
  }

  isShowingConflictDialog = true;
  const dialogItem = conflictDialogQueue.shift();

  try {
    if (dialogItem) {
      const result = await dialogItem.show();
      dialogItem.resolve(result);
    }
  } finally {
    isShowingConflictDialog = false;
    // Process next dialog if available
    if (conflictDialogQueue.length > 0) {
      setImmediate(() => processConflictDialogQueue());
    }
  }
};

// Show conflict dialog with queuing to prevent multiple dialogs at once
const showConflictDialogQueued = (show: () => Promise<any>): Promise<any> => {
  return new Promise((resolve) => {
    conflictDialogQueue.push({ resolve, show });
    processConflictDialogQueue();
  });
};

// Export function to get current active file download count
export const getActiveFileDownloadCount = () => activeDownloadJobs;

// ============================================================================
// Notification
// ============================================================================

export const notifyDownloadProgress = (update: DownloadProgressUpdate) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send("download:progress", update);
  });
};

const createDownloadAbortError = (reason: DownloadStatus) => {
  if (reason === "paused") {
    const error: any = new Error("Download paused by user");
    error.code = "DOWNLOAD_PAUSED";
    return error;
  } else if (reason === "failed") {
    const error: any = new Error("Connection terminated by user");
    error.code = "DOWNLOAD_FAILED";
    return error;
  } else {
    const error: any = new Error("Download cancelled by user");
    error.code = "DOWNLOAD_CANCELLED";
    return error;
  }
};

// ============================================================================
// Queue Management
// ============================================================================

const cancelPendingJob = (id: string, reason: DownloadStatus) => {
  const index = downloadQueue.findIndex((job) => job.id === id);
  if (index === -1) {
    return false;
  }
  const [job] = downloadQueue.splice(index, 1);
  job.reject(createDownloadAbortError(reason));
  notifyDownloadProgress({
    id,
    downloadedSize: 0,
    totalSize: job.totalSize,
    status: reason,
    actualFileName: job.fileName,
    localPath: job.localPath,
    endTime: Date.now(),
  });
  return true;
};

export const cancelDownloadJob = (id: string, reason: DownloadStatus = "cancelled", localPath?: string) => {
  console.log("[Download] Cancel request received:", { downloadId: id, reason, activeJobs: activeDownloadJobs });

  // Check unified queue first (for queued downloads)
  const queuedItem = cancelQueuedDownload(id);
  if (queuedItem) {
    console.log("[Download] Cancelled queued download from unified queue:", { downloadId: id });

    // Send cancellation notification
    if (queuedItem.type === "file" && queuedItem.fileJob) {
      notifyDownloadProgress({
        id: queuedItem.id,
        downloadedSize: 0,
        totalSize: queuedItem.fileJob.job.totalSize,
        status: "cancelled",
        actualFileName: queuedItem.fileJob.job.fileName,
        localPath: queuedItem.fileJob.job.localPath,
        endTime: Date.now(),
      });
      // Reject the promise
      queuedItem.fileJob.reject(createDownloadAbortError("cancelled"));
    }

    if (localPath) {
      try {
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
          console.log("[Download] Deleted incomplete file:", localPath);
        }
      } catch (err) {
        console.error("[Download] Failed to delete incomplete file:", err);
      }
    }
    return true;
  }

  // Check old downloadQueue (legacy, should be empty now)
  if (cancelPendingJob(id, reason)) {
    console.log("[Download] Cancelled pending job in legacy queue");
    if (localPath) {
      try {
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
          console.log("[Download] Deleted incomplete file:", localPath);
        }
      } catch (err) {
        console.error("[Download] Failed to delete incomplete file:", err);
      }
    }
    return true;
  }

  // Check active downloads
  const controller = activeDownloadControllers.get(id);
  if (controller) {
    console.log("[Download] Found active download, calling abort controller:", { downloadId: id, reason });
    controller(reason);
    console.log("[Download] Cancel request confirmed (active download):", { downloadId: id });
    // Don't send delayed notification - let the error handler in performDownloadJob send it
    return true;
  }

  return false;
};

export const cancelAllDownloads = (reason: DownloadStatus = "cancelled") => {
  console.log("[Download] Cancelling all downloads, active jobs:", activeDownloadJobs);

  // Cancel all downloads in unified queue (handles both file and folder downloads)
  const queueReason = reason === "failed" || reason === "cancelled" ? reason : "failed";
  import("./commonHandler").then(({ cancelAllQueuedDownloads }) => {
    cancelAllQueuedDownloads(queueReason);
  });

  // Cancel legacy queue (should be empty now)
  [...downloadQueue].forEach((job) => cancelPendingJob(job.id, reason));

  // Cancel active file downloads and send immediate failure notifications
  activeDownloadControllers.forEach((controller, id) => {
    console.log("[Download] Cancelling active download:", id, "reason:", reason);

    // Send immediate failure notification for disconnect
    if (reason === "failed") {
      const jobInfo = activeDownloadJobsMap.get(id);
      if (jobInfo) {
        notifyDownloadProgress({
          id,
          downloadedSize: 0,
          totalSize: jobInfo.totalSize,
          status: "failed",
          error: "Connection terminated by user",
          actualFileName: jobInfo.fileName,
          localPath: jobInfo.localPath,
          endTime: Date.now(),
        });
      }
    }

    // Call abort controller
    controller(reason);
  });
};

// Function to perform file download (called by commonHandler's unified queue)
const performFileDownload = async (item: UnifiedQueueItem): Promise<void> => {
  if (!item.fileJob) return;

  activeDownloadJobs++;
  const job = item.fileJob.job as DownloadJobWithConflictInfo;

  // Store job info for immediate cancellation
  activeDownloadJobsMap.set(job.id, {
    fileName: job.fileName,
    localPath: job.localPath,
    totalSize: job.totalSize,
  });

  try {
    // Handle conflict resolution BEFORE starting download
    // This defers the blocking dialog to the actual download processing
    // allowing multiple files to be enqueued while conflicts are resolved sequentially
    let finalLocalPath = job.localPath;
    let finalFileName = job.fileName;

    // Check if file exists and resolve conflicts if needed
    // Handle both "prompt" and "rename" modes - need to resolve conflicts for both
    if (fs.existsSync(finalLocalPath) && job.defaultConflictResolution !== "overwrite") {
      // Use focused window or first available window (dialog may steal focus)
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error("No window available for conflict dialog");

      const result = await showConflictDialogQueued(async () => {
        console.log("[Download] Showing conflict dialog for:", job.id, job.fileName);
        return await handleDuplicateFile(
          win,
          finalLocalPath,
          job.fileName,
          job.duplicateAction,
          job.applyToAll,
          job.defaultConflictResolution,
          false // Single file download - don't show "apply to all"
        );
      });

      if (result.cancelled || result.skipped) {
        // Notify about skipped/cancelled download
        notifyDownloadProgress({
          id: job.id,
          downloadedSize: 0,
          totalSize: job.totalSize,
          status: "cancelled", // Use cancelled for both skipped and user-cancelled
          actualFileName: job.fileName,
          localPath: job.localPath,
          endTime: Date.now(),
        });
        item.fileJob.resolve({ success: true, savedPath: job.localPath });
        return;
      }

      finalLocalPath = result.savedPath;
      finalFileName = result.actualFileName;
    }

    notifyDownloadProgress({
      id: job.id,
      downloadedSize: 0,
      totalSize: job.totalSize,
      status: "downloading",
      startTime: Date.now(),
      actualFileName: finalFileName,
      localPath: finalLocalPath,
    });

    // Update job with resolved paths
    const resolvedJob = { ...job, localPath: finalLocalPath, fileName: finalFileName };

    await performDownloadJob(resolvedJob);
    console.log("[File Download] Completed:", job.id);
    item.fileJob.resolve({ success: true, savedPath: finalLocalPath });
  } catch (err: any) {
    console.log("[File Download] Failed:", job.id, err.message);
    if (err?.code === "DOWNLOAD_CANCELLED" || err?.code === "DOWNLOAD_PAUSED" || err?.code === "DOWNLOAD_FAILED") {
      const status = err.code === "DOWNLOAD_PAUSED" ? "paused" : err.code === "DOWNLOAD_FAILED" ? "failed" : "cancelled";
      const errorMessage = err.code === "DOWNLOAD_FAILED" ? "Connection terminated by user" : undefined;
      notifyDownloadProgress({
        id: job.id,
        downloadedSize: 0,
        totalSize: job.totalSize,
        status,
        error: errorMessage,
        actualFileName: job.fileName,
        localPath: job.localPath,
        endTime: Date.now(),
      });
      item.fileJob.reject(createDownloadAbortError(status));
    } else {
      notifyDownloadProgress({
        id: job.id,
        downloadedSize: 0,
        totalSize: job.totalSize,
        status: "failed",
        error: err.message,
        actualFileName: job.fileName,
        localPath: job.localPath,
        endTime: Date.now(),
      });
      item.fileJob.reject(err);
    }
  } finally {
    activeDownloadJobs--;
    activeDownloadJobsMap.delete(job.id);
    // Queue processing is handled by the callback's finally block in processUnifiedQueue()
    // which decrements totalActiveDownloads and calls processUnifiedQueue()
  }
};

const enqueueDownloadJob = (jobData: DownloadJobPayload) => {
  return new Promise<{ success: true; savedPath: string }>((resolve, reject) => {
    // Add to unified queue for FIFO ordering with folder downloads
    const queueItem: UnifiedQueueItem = {
      type: "file",
      id: jobData.id,
      enqueueTime: Date.now(),
      fileJob: { job: jobData, resolve, reject },
    };

    // Send 'queued' status notification immediately when enqueued
    notifyDownloadProgress({
      id: jobData.id,
      downloadedSize: 0,
      totalSize: jobData.totalSize,
      status: "queued",
      startTime: Date.now(),
      actualFileName: jobData.fileName,
      localPath: jobData.localPath,
    });

    // Add to unified queue and process (managed by commonHandler)
    enqueueToUnifiedQueue(queueItem);
  });
};

// ============================================================================
// Download Execution
// ============================================================================

const performDownloadJob = async (job: DownloadJobPayload) => {
  const startTime = Date.now();
  let finalSize = job.totalSize;

  try {
    notifyDownloadProgress({
      id: job.id,
      downloadedSize: 0,
      totalSize: job.totalSize,
      status: "downloading",
    });

    if (job.connection.protocol === "ftp") {
      finalSize = await performFtpDownload(job, startTime);
    } else {
      finalSize = await performSftpDownload(job, startTime);
    }

    const completedSize = finalSize || job.totalSize || 0;

    notifyDownloadProgress({
      id: job.id,
      downloadedSize: completedSize,
      totalSize: completedSize,
      status: "completed",
      actualFileName: job.fileName,
      localPath: job.localPath,
      endTime: Date.now(),
    });
  } catch (err: any) {
    if (err?.code === "DOWNLOAD_CANCELLED" || err?.code === "DOWNLOAD_PAUSED" || err?.code === "DOWNLOAD_FAILED") {
      const status = err.code === "DOWNLOAD_PAUSED" ? "paused" : err.code === "DOWNLOAD_FAILED" ? "failed" : "cancelled";
      const errorMessage = err.code === "DOWNLOAD_FAILED" ? "Connection terminated by user" : undefined;
      console.log("[Download] Download cancelled/paused/failed:", { id: job.id, fileName: job.fileName, status });
      notifyDownloadProgress({
        id: job.id,
        downloadedSize: 0,
        totalSize: finalSize || job.totalSize,
        status,
        error: errorMessage,
        actualFileName: job.fileName,
        localPath: job.localPath,
        endTime: Date.now(),
      });
    } else {
      console.error("[Error] Download failed:", { id: job.id, fileName: job.fileName, error: err.message, stack: err.stack });
    }
    throw err;
  }
};

const performFtpDownload = async (job: DownloadJobPayload, startTime: number): Promise<number> => {
  const downloadClient = new ftp.Client();
  downloadClient.ftp.verbose = ftpClient?.ftp.verbose ?? false;
  let totalSize = job.totalSize || 0;
  let aborted = false;
  let abortReason: DownloadStatus = "cancelled";

  const abort = (reason: DownloadStatus = "cancelled") => {
    console.log("[FTP Download] Abort called for job:", job.id, "reason:", reason);
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
    if (aborted) {
      if (!ftpAbortLoggedOnce) {
        console.log("[FTP Download] Skipping progress updates for aborted download:", job.id);
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
      status: "downloading",
      actualFileName: job.fileName,
      localPath: job.localPath,
    });
  });

  try {
    await downloadClient.access({
      host: job.connection.host,
      port: job.connection.port || 21,
      user: job.connection.user,
      password: job.connection.password ?? undefined,
      secure: false,
    });

    if (totalSize <= 0) {
      try {
        totalSize = await downloadClient.size(job.remotePath);
      } catch {
        // Ignore failures
      }
    }

    await downloadClient.downloadTo(job.localPath, job.remotePath);
    if (aborted) {
      throw createDownloadAbortError(abortReason);
    }
    return totalSize || job.totalSize || 0;
  } catch (err: any) {
    // Always check aborted first - if aborted, it's a cancellation, not a failure
    if (aborted || err?.code === "DOWNLOAD_CANCELLED" || err?.code === "DOWNLOAD_PAUSED" || err?.code === "DOWNLOAD_FAILED") {
      try {
        if (fs.existsSync(job.localPath)) {
          fs.unlinkSync(job.localPath);
          console.log("[Download] Deleted incomplete file after cancel:", job.localPath);
        }
      } catch (cleanupErr) {
        console.error("[Error] Failed to delete incomplete file:", { localPath: job.localPath, error: cleanupErr });
      }
      throw createDownloadAbortError(abortReason);
    }
    console.error("[Error] FTP download failed:", {
      id: job.id,
      fileName: job.fileName,
      remotePath: job.remotePath,
      localPath: job.localPath,
      error: err.message,
      code: err.code,
    });
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
    readyTimeout: 20000,
  };

  // Handle authentication: SSH key takes precedence over password
  if (job.connection.privateKeyContent) {
    // Use key content directly (e.g., pasted from ~/.ssh/id_rsa)
    connectConfig.privateKey = job.connection.privateKeyContent;
  } else if (job.connection.privateKeyPath) {
    // Use key file path
    try {
      const expandedPath = job.connection.privateKeyPath.startsWith("~")
        ? path.join(os.homedir(), job.connection.privateKeyPath.slice(1))
        : job.connection.privateKeyPath;

      if (fs.existsSync(expandedPath)) {
        connectConfig.privateKey = fs.readFileSync(expandedPath);
      } else {
        throw new Error(`SSH key file not found: ${job.connection.privateKeyPath}`);
      }
    } catch (err: any) {
      throw new Error(`Failed to read SSH key: ${err.message}`);
    }
  } else if (job.connection.password) {
    // Fall back to password authentication if no SSH key provided
    connectConfig.password = job.connection.password;
  }

  let totalSize = job.totalSize || 0;
  let aborted = false;
  let abortReason: DownloadStatus = "cancelled";
  let abortLoggedOnce = false;
  let abortReject: ((err: any) => void) | null = null;

  const abort = (reason: DownloadStatus = "cancelled") => {
    console.log("[SFTP Download] Abort called for job:", job.id, "reason:", reason);
    aborted = true;
    abortReason = reason;
    tempSftpClient.end().catch(() => undefined);
    try {
      (tempSftpClient as any).client?.end();
      (tempSftpClient as any).client?.destroy();
    } catch {
      // Ignore errors
    }
    if (abortReject) {
      console.log("[SFTP Download] Force rejecting hanging download promise");
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
        // Ignore errors
      }
    }

    await new Promise<void>((resolve, reject) => {
      abortReject = reject;

      tempSftpClient
        .fastGet(job.remotePath, job.localPath, {
          step: (downloadedSize: number, _chunk: number, remoteSize: number) => {
            if (aborted) {
              if (!abortLoggedOnce) {
                console.log("[SFTP Download] Skipping progress updates for aborted download:", job.id);
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
              status: "downloading",
              actualFileName: job.fileName,
              localPath: job.localPath,
            });
          },
        })
        .then(() => {
          abortReject = null;
          if (aborted) {
            console.log("[SFTP Download] Download completed but was aborted, rejecting");
            reject(createDownloadAbortError(abortReason));
          } else {
            resolve();
          }
        })
        .catch((err: any) => {
          abortReject = null;
          // If aborted, always throw abort error, not the original error
          if (aborted || err?.code === "DOWNLOAD_CANCELLED" || err?.code === "DOWNLOAD_PAUSED" || err?.code === "DOWNLOAD_FAILED") {
            reject(createDownloadAbortError(abortReason));
          } else {
            console.error("[Error] SFTP download stream error:", {
              id: job.id,
              fileName: job.fileName,
              error: err.message,
              code: err.code,
            });
            reject(err);
          }
        });
    });

    return totalSize || job.totalSize || 0;
  } catch (err: any) {
    // Always check aborted first - if aborted, it's a cancellation, not a failure
    if (aborted || err?.code === "DOWNLOAD_CANCELLED" || err?.code === "DOWNLOAD_PAUSED" || err?.code === "DOWNLOAD_FAILED") {
      try {
        if (fs.existsSync(job.localPath)) {
          fs.unlinkSync(job.localPath);
          console.log("[Download] Deleted incomplete file after cancel:", job.localPath);
        }
      } catch (cleanupErr) {
        console.error("[Error] Failed to delete incomplete file:", { localPath: job.localPath, error: cleanupErr });
      }
      throw createDownloadAbortError(abortReason);
    }
    console.error("[Error] SFTP download failed:", {
      id: job.id,
      fileName: job.fileName,
      remotePath: job.remotePath,
      localPath: job.localPath,
      error: err.message,
      code: err.code,
    });
    throw err;
  } finally {
    activeDownloadControllers.delete(job.id);
    try {
      await tempSftpClient.end();
    } catch {
      // ignore
    }
  }
};

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle(
  "ftp:download",
  async (
    event,
    {
      remotePath,
      fileName,
      downloadId,
      totalSize,
      defaultDownloadPath,
      duplicateAction,
      applyToAll,
      defaultConflictResolution,
    }: {
      remotePath: string;
      fileName: string;
      downloadId?: string;
      totalSize?: number;
      defaultDownloadPath?: string;
      duplicateAction?: "overwrite" | "rename" | "skip";
      applyToAll?: boolean;
      defaultConflictResolution?: "overwrite" | "rename" | "prompt";
    }
  ) => {
    try {
      console.log("[Download] IPC handler called:", { fileName, downloadId, defaultDownloadPath });

      if (!currentConnectionConfig) {
        console.error("[Download] Not connected");
        return { success: false, error: "Not connected" };
      }

      // Use focused window or first available window (dialog may steal focus)
      const targetWin = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!targetWin) {
        console.error("[Download] No window available");
        return { success: false, error: "No window" };
      }

      console.log("[Download] Using window:", {
        isFocused: BrowserWindow.getFocusedWindow() !== null,
        totalWindows: BrowserWindow.getAllWindows().length,
      });

      const id = downloadId || `download-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      let savedFilePath: string;
      let finalDuplicateAction = duplicateAction;
      let finalApplyToAll = applyToAll || false;

      if (defaultDownloadPath) {
        const defaultPath = path.join(defaultDownloadPath, fileName);
        // Don't resolve conflict here - defer to queue processing in performFileDownload
        // This allows multiple files to be enqueued immediately while conflicts are resolved sequentially
        // during the download execution phase, preventing the blocking behavior where Downloads 2 & 3 never start
        savedFilePath = defaultPath;
        console.log("[Download] Using default download path:", { defaultPath, savedFilePath });
      } else {
        const result = await dialog.showSaveDialog(targetWin, {
          defaultPath: fileName,
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, cancelled: true };
        }

        savedFilePath = result.filePath;
      }

      const actualFileName = path.basename(savedFilePath);

      console.log("[Download] About to enqueue job:", { id, fileName: actualFileName, savedFilePath });

      // Enqueue the job but don't await it - return immediately with actualFileName
      // The download will continue in the background
      // IMPORTANT: Conflict resolution is deferred to performFileDownload in queue processing
      // This allows multiple files to be enqueued while conflict dialogs are shown sequentially
      enqueueDownloadJob({
        id,
        remotePath,
        localPath: savedFilePath,
        fileName: actualFileName,
        connection: currentConnectionConfig,
        totalSize: totalSize || 0,
        defaultDownloadPath,
        duplicateAction,
        applyToAll,
        defaultConflictResolution,
      } as DownloadJobWithConflictInfo).catch((err) => {
        // Errors are handled in the download job processing
        console.error("[Download] Job error:", err);
      });

      console.log("[Download] Job enqueued successfully, returning success");

      return {
        success: true,
        savedPath: savedFilePath,
        actualFileName: actualFileName,
        duplicateAction: "prompt",
        applyToAll: false,
      };
    } catch (err: any) {
      console.error("[Download] Error in IPC handler:", err);
      return { success: false, error: err.message };
    }
  }
);

ipcMain.handle("download:cancel", async (_event, { downloadId }: { downloadId: string }) => {
  console.log("[Download] Cancel request received:", { downloadId });
  const success = cancelDownloadJob(downloadId, "cancelled");
  if (success) {
    console.log("[Download] Cancel request confirmed:", { downloadId });
  } else {
    console.log("[Download] Cancel request failed: Download not found:", { downloadId });
  }
  return { success };
});

ipcMain.handle("settings:update-max-downloads", async (_event, maxDownloads: number) => {
  console.log("[Settings] Updating max concurrent downloads to:", maxDownloads);
  setMaxConcurrentDownloads(maxDownloads);
  return { success: true };
});

export const getCurrentActiveDownloads = () => ({
  activeDownloadControllersCount: activeDownloadControllers.size,
  queueLength: downloadQueue.length,
  activeDownloadJobs,
});

// Register callbacks with commonHandler
setStartFileDownloadCallback(performFileDownload);
setNotifyDownloadProgressCallback(notifyDownloadProgress);

console.log("[Download File Handler] Registered");

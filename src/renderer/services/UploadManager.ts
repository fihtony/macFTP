// Unified Upload Manager
// Handles all upload types: single file, multiple files, folders, and mixed uploads

import React from "react";
import { UploadTaskState, UploadListItem, ConflictResolution } from "../types/upload";

interface UploadItem {
  name: string;
  localPath: string;
  remotePath: string;
  size: number;
  isFolder: boolean;
}

interface UploadManagerOptions {
  electron: any;
  settings: { defaultConflictResolution: string };
  currentSite: { name?: string; host?: string } | null;
  currentPath: string;
  setActiveUpload: (updater: (prev: UploadTaskState | null) => UploadTaskState | null) => void;
  setToast: (toast: { message: string; type: "success" | "error" | "info" | "warning" }) => void;
  handleNavigate: (path: string) => void;
  cancelUploadsRef: React.MutableRefObject<boolean>;
  uploadCompletionToastShownRef: React.MutableRefObject<boolean>;
  currentFileUploadIdRef: React.MutableRefObject<string | null>;
}

// Helper function to collect folder contents recursively
const collectFolderContents = async (
  electron: any,
  localPath: string,
  remotePath: string
): Promise<{ items: UploadListItem[]; totalBytes: number; totalFiles: number }> => {
  const result = await electron.collectLocalEntries(localPath);
  if (!result.success) {
    throw new Error(result.error || "Failed to collect folder contents");
  }

  const items: UploadListItem[] = [];
  let totalBytes = 0;
  let totalFiles = 0;

  // Helper to get last part of path
  const getBaseName = (fullPath: string) => {
    const parts = fullPath.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
  };

  // Helper to join paths
  const joinPath = (...parts: string[]) => {
    return parts.join("/").replace(/\/+/g, "/").replace(/\\/g, "/");
  };

  // Process directories first (empty folders)
  for (const dir of result.directories) {
    const dirRemotePath = joinPath(remotePath, dir.relativePath);
    items.push({
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: getBaseName(dir.relativePath),
      localPath: joinPath(localPath, dir.relativePath),
      remotePath: dirRemotePath,
      size: 0,
      isFolder: true,
      items: [], // Empty folder
      status: "pending",
      uploadedBytes: 0,
    });
  }

  // Process files
  for (const file of result.files) {
    const fileRemotePath = joinPath(remotePath, file.relativePath);
    items.push({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: getBaseName(file.relativePath),
      localPath: file.localPath,
      remotePath: fileRemotePath,
      size: file.size,
      isFolder: false,
      status: "pending",
      uploadedBytes: 0,
    });
    totalBytes += file.size;
    totalFiles += 1;
  }

  return { items, totalBytes, totalFiles };
};

export const startUnifiedUpload = async (items: UploadItem[], options: UploadManagerOptions): Promise<void> => {
  const {
    electron,
    settings,
    currentSite,
    currentPath,
    setActiveUpload,
    setToast,
    handleNavigate,
    cancelUploadsRef,
    uploadCompletionToastShownRef,
    currentFileUploadIdRef,
  } = options;

  if (items.length === 0) return;
  if (!electron) return;

  // Reset cancellation flag
  cancelUploadsRef.current = false;
  uploadCompletionToastShownRef.current = false;

  try {
    // Build first-level items array with folder contents
    const firstLevelItems: UploadListItem[] = [];
    let totalBytes = 0;
    let totalFiles = 0;

    for (const item of items) {
      if (item.isFolder) {
        // Collect folder contents
        const {
          items: subItems,
          totalBytes: folderBytes,
          totalFiles: folderFiles,
        } = await collectFolderContents(electron, item.localPath, item.remotePath);

        firstLevelItems.push({
          id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: item.name,
          localPath: item.localPath,
          remotePath: item.remotePath,
          size: folderBytes, // Total size of all files in folder
          isFolder: true,
          items: subItems,
          status: "pending",
          uploadedBytes: 0,
        });

        totalBytes += folderBytes;
        totalFiles += folderFiles;
      } else {
        // Single file
        firstLevelItems.push({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: item.name,
          localPath: item.localPath,
          remotePath: item.remotePath,
          size: item.size,
          isFolder: false,
          status: "pending",
          uploadedBytes: 0,
        });

        totalBytes += item.size;
        totalFiles += 1;
      }
    }

    // Create session ID
    const sessionId = `upload-session-${Date.now()}`;

    // Initialize upload state
    const initialUploadState: UploadTaskState = {
      id: sessionId,
      status: "starting",
      uploadedBytes: 0,
      totalBytes,
      completedFiles: 0,
      totalFiles,
      items: firstLevelItems,
      currentItem: undefined,
      speed: 0,
      uploadConflictResolution: settings.defaultConflictResolution as ConflictResolution,
      sessionConflictResolutionApplied: false,
      siteName: currentSite?.name,
      siteHost: currentSite?.host,
      cancelRequested: false,
    };

    setActiveUpload(() => initialUploadState);

    // Log initial upload state
    console.log("[Upload Manager] Initial upload state:", {
      id: initialUploadState.id,
      status: initialUploadState.status,
      totalFiles: initialUploadState.totalFiles,
      totalBytes: initialUploadState.totalBytes,
      itemsCount: initialUploadState.items.length,
    });

    // Start processing items with DFS
    let wasCancelled = false;

    // Get current conflict resolution from state
    let conflictResolution: ConflictResolution = settings.defaultConflictResolution as ConflictResolution;
    let sessionConflictResolutionApplied = false;

    // Speed tracking for ETA - maintain rolling average for stability
    let sessionStartTime = Date.now();
    const speedSamples: number[] = []; // Store recent speed samples
    const MAX_SPEED_SAMPLES = 5; // Keep last 5 samples for rolling average

    // DFS upload function
    const uploadItemDFS = async (item: UploadListItem, parentPath: string = ""): Promise<boolean> => {
      if (cancelUploadsRef.current) {
        return false; // Stop processing
      }

      // Update current item if it's a file
      if (!item.isFolder) {
        setActiveUpload((prev) => {
          if (!prev) return prev;
          // Don't override status if it's already 'cancelling'
          if (prev.status === "cancelling") {
            return { ...prev, currentItem: item };
          }
          return {
            ...prev,
            currentItem: item,
            status: "uploading",
          };
        });
      }

      // Mark item as uploading
      item.status = "uploading";

      if (item.isFolder) {
        // Process folder: create directory and upload contents
        console.log("[Upload Manager] Processing folder:", {
          name: item.name,
          remotePath: item.remotePath,
          subItems: item.items?.length || 0,
        });

        // Create empty folder on server
        try {
          const createResult = await electron.createDirectory(item.remotePath);
          if (!createResult.success) {
            console.error("[Upload Manager] Failed to create folder:", {
              name: item.name,
              error: createResult.error,
            });
            item.status = "failed";
            item.error = createResult.error || "Failed to create folder";
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return { ...prev };
            });
            return true; // Continue with next item
          }
        } catch (err: any) {
          console.error("[Upload Manager] Exception creating folder:", {
            name: item.name,
            error: err.message,
          });
          item.status = "failed";
          item.error = err.message;
          setActiveUpload((prev) => {
            if (!prev) return prev;
            return { ...prev };
          });
          return true; // Continue with next item
        }

        // Upload sub-items
        if (item.items && item.items.length > 0) {
          for (const subItem of item.items) {
            const success = await uploadItemDFS(subItem, item.remotePath);
            if (!success) {
              return false; // Cancelled
            }
          }
        }

        // Mark folder as completed
        item.status = "completed";
        setActiveUpload((prev) => {
          if (!prev) return prev;
          return { ...prev };
        });
      } else {
        // Upload file
        console.log("[Upload Manager] Uploading file:", {
          name: item.name,
          size: item.size,
          remotePath: item.remotePath,
        });

        // Check for cancellation before starting upload
        if (cancelUploadsRef.current) {
          return false;
        }

        // Create uploadId for this file
        const fileUploadId = `${sessionId}-${item.name}-${Math.random().toString(36).slice(2, 6)}`;
        currentFileUploadIdRef.current = fileUploadId;

        // Set currentItem BEFORE starting upload (for real-time progress from backend)
        setActiveUpload((prev) => {
          if (!prev) return prev;
          // Don't override status if it's already 'cancelling'
          if (prev.status === "cancelling") {
            return {
              ...prev,
              currentItem: {
                id: item.id,
                name: item.name,
                localPath: item.localPath,
                remotePath: item.remotePath,
                size: item.size,
                isFolder: false,
                uploadedBytes: 0,
                status: "uploading",
              },
            };
          }
          return {
            ...prev,
            currentItem: {
              id: item.id,
              name: item.name,
              localPath: item.localPath,
              remotePath: item.remotePath,
              size: item.size,
              isFolder: false,
              uploadedBytes: 0,
              status: "uploading",
            },
            status: "uploading",
          };
        });

        // Start file upload
        // For nested files (inside folders), always use "overwrite" to avoid duplicate dialogs
        // because folder-level conflict has already been resolved
        const fileResult = await electron.upload(item.localPath, item.remotePath, fileUploadId, "overwrite");

        if (!fileResult.success) {
          if (cancelUploadsRef.current || (fileResult.error && fileResult.error.includes("cancelled"))) {
            console.log("[Upload] Upload cancelled:", { fileName: item.name });
            // Clear currentItem when cancelled
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return { ...prev, currentItem: undefined };
            });
            return false;
          }

          // Mark as failed
          item.status = "failed";
          item.error = fileResult.error || "Unknown error";
          setActiveUpload((prev) => {
            if (!prev) return prev;
            return { ...prev, currentItem: undefined };
          });
        } else {
          // File upload completed successfully
          item.status = "completed";
          item.uploadedBytes = item.size;

          setActiveUpload((prev) => {
            if (!prev) return prev;

            const newUploadedBytes = prev.uploadedBytes + item.size;
            const newCompletedFiles = prev.completedFiles + 1;

            // Calculate session average speed
            const now = Date.now();
            const sessionElapsed = (now - sessionStartTime) / 1000; // seconds
            const sessionAvgSpeed = sessionElapsed > 0 ? newUploadedBytes / sessionElapsed : 0;

            // Add session average to speed samples for rolling average
            if (sessionAvgSpeed > 0) {
              speedSamples.push(sessionAvgSpeed);
              if (speedSamples.length > MAX_SPEED_SAMPLES) {
                speedSamples.shift(); // Remove oldest sample
              }
            }

            // Calculate rolling average from speed samples
            const rollingAvgSpeed =
              speedSamples.length > 0 ? speedSamples.reduce((sum, s) => sum + s, 0) / speedSamples.length : sessionAvgSpeed;

            console.log("[Upload Manager] File upload completed:", {
              name: item.name,
              size: item.size,
              uploadedBytes: newUploadedBytes,
              completedFiles: newCompletedFiles,
              sessionAvgSpeed,
              rollingAvgSpeed,
              speedSamples: speedSamples.length,
            });

            return {
              ...prev,
              uploadedBytes: newUploadedBytes,
              completedFiles: newCompletedFiles,
              speed: rollingAvgSpeed, // Use rolling average for stable ETA
              currentItem: undefined, // Clear currentItem after file completes
            };
          });
        }
      }

      return true; // Continue
    };

    // Process all first-level items
    for (const item of firstLevelItems) {
      // Check for cancellation
      if (cancelUploadsRef.current) {
        wasCancelled = true;
        break;
      }

      // Handle conflict resolution for first-level items ONLY
      // Read current state for conflict resolution
      setActiveUpload((prev) => {
        if (prev) {
          conflictResolution = prev.uploadConflictResolution;
          sessionConflictResolutionApplied = prev.sessionConflictResolutionApplied || false;
        }
        return prev;
      });

      const shouldShowDialog = (conflictResolution === "prompt" || conflictResolution === "ask") && !sessionConflictResolutionApplied;

      if (item.isFolder) {
        // Check for folder conflict (only for top-level folders)
        let folderRemotePath = item.remotePath;

        if (shouldShowDialog) {
          const folderExists = await electron.checkRemoteExists?.(item.remotePath);
          if (folderExists?.exists) {
            const duplicateResult: any = await electron.handleUploadDuplicate?.({
              remotePath: item.remotePath,
              fileName: item.name,
              duplicateAction: null,
              applyToAll: false,
              defaultConflictResolution: conflictResolution,
              showApplyToAll: firstLevelItems.length > 1, // Show "apply to all" only if multiple items in session
            });

            if (duplicateResult?.cancelled || duplicateResult?.dialogCancelled) {
              cancelUploadsRef.current = true;
              wasCancelled = true;
              setToast({ message: "Upload cancelled", type: "warning" });
              break;
            }

            if (duplicateResult?.skipped) {
              if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
                conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
                sessionConflictResolutionApplied = true;
                setActiveUpload((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    uploadConflictResolution: conflictResolution,
                    sessionConflictResolutionApplied: true,
                  };
                });
              }
              item.status = "skipped";
              continue;
            }

            if (duplicateResult?.remotePath) {
              folderRemotePath = duplicateResult.remotePath;
            }

            if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
              conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
              sessionConflictResolutionApplied = true;
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadConflictResolution: conflictResolution,
                  sessionConflictResolutionApplied: true,
                };
              });
            }
          }
        } else if (sessionConflictResolutionApplied) {
          // Apply session resolution
          if (conflictResolution === "skip") {
            const folderExists = await electron.checkRemoteExists?.(item.remotePath);
            if (folderExists?.exists) {
              item.status = "skipped";
              continue;
            }
          } else if (conflictResolution === "rename") {
            const folderExists = await electron.checkRemoteExists?.(item.remotePath);
            if (folderExists?.exists) {
              const renameResult: any = await electron.handleUploadDuplicate?.({
                remotePath: item.remotePath,
                fileName: item.name,
                duplicateAction: "rename",
                applyToAll: false,
                defaultConflictResolution: "rename",
                showApplyToAll: false,
              });
              if (renameResult?.remotePath) {
                folderRemotePath = renameResult.remotePath;
              }
            }
          }
          // For overwrite, continue with original path
        } else if (conflictResolution === "rename" || conflictResolution === "overwrite") {
          // Auto-apply rename or overwrite without dialog
          if (conflictResolution === "rename") {
            const folderExists = await electron.checkRemoteExists?.(item.remotePath);
            if (folderExists?.exists) {
              const renameResult: any = await electron.handleUploadDuplicate?.({
                remotePath: item.remotePath,
                fileName: item.name,
                duplicateAction: "rename",
                applyToAll: false,
                defaultConflictResolution: "rename",
                showApplyToAll: false,
              });
              if (renameResult?.remotePath) {
                folderRemotePath = renameResult.remotePath;
              }
            }
          }
          // For overwrite, continue with original path
        }

        // Update folder remote path and all sub-items if renamed
        if (folderRemotePath !== item.remotePath) {
          const oldRemotePath = item.remotePath;
          item.remotePath = folderRemotePath;

          // Update all sub-items' remote paths
          const updateSubItemPaths = (items: UploadListItem[], oldBase: string, newBase: string) => {
            for (const subItem of items) {
              subItem.remotePath = subItem.remotePath.replace(oldBase, newBase);
              if (subItem.items) {
                updateSubItemPaths(subItem.items, oldBase, newBase);
              }
            }
          };

          if (item.items) {
            updateSubItemPaths(item.items, oldRemotePath, folderRemotePath);
          }
        }
      } else {
        // File conflict resolution (only for top-level files)
        let fileRemotePath = item.remotePath;

        if (shouldShowDialog) {
          const duplicateResult: any = await electron.handleUploadDuplicate?.({
            remotePath: item.remotePath,
            fileName: item.name,
            duplicateAction: null,
            applyToAll: false,
            defaultConflictResolution: conflictResolution,
            showApplyToAll: firstLevelItems.length > 1, // Show "apply to all" only if multiple items in session
          });

          if (duplicateResult?.cancelled || duplicateResult?.dialogCancelled) {
            cancelUploadsRef.current = true;
            wasCancelled = true;
            setToast({ message: "Upload cancelled", type: "warning" });
            break;
          }

          if (duplicateResult?.skipped) {
            if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
              conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
              sessionConflictResolutionApplied = true;
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadConflictResolution: conflictResolution,
                  sessionConflictResolutionApplied: true,
                };
              });
            }
            item.status = "skipped";
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadedBytes: prev.uploadedBytes + item.size,
                completedFiles: prev.completedFiles + 1,
              };
            });
            continue;
          }

          if (duplicateResult?.remotePath) {
            fileRemotePath = duplicateResult.remotePath;
            item.remotePath = fileRemotePath;
          }

          if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
            conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
            sessionConflictResolutionApplied = true;
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadConflictResolution: conflictResolution,
                sessionConflictResolutionApplied: true,
              };
            });
          }
        } else if (sessionConflictResolutionApplied) {
          // Apply session resolution without showing dialog
          const existsResult = await electron.checkRemoteExists?.(item.remotePath);
          if (existsResult?.exists) {
            if (conflictResolution === "skip") {
              item.status = "skipped";
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadedBytes: prev.uploadedBytes + item.size,
                  completedFiles: prev.completedFiles + 1,
                };
              });
              continue;
            } else if (conflictResolution === "rename") {
              const renameResult: any = await electron.handleUploadDuplicate?.({
                remotePath: item.remotePath,
                fileName: item.name,
                duplicateAction: "rename",
                applyToAll: false,
                defaultConflictResolution: "rename",
                showApplyToAll: false,
              });
              if (renameResult?.remotePath) {
                item.remotePath = renameResult.remotePath;
              }
            }
            // For overwrite, continue with original path
          }
        } else if (conflictResolution === "rename" || conflictResolution === "overwrite") {
          // Auto-apply rename or overwrite without dialog
          const existsResult = await electron.checkRemoteExists?.(item.remotePath);
          if (existsResult?.exists) {
            if (conflictResolution === "rename") {
              const renameResult: any = await electron.handleUploadDuplicate?.({
                remotePath: item.remotePath,
                fileName: item.name,
                duplicateAction: "rename",
                applyToAll: false,
                defaultConflictResolution: "rename",
                showApplyToAll: false,
              });
              if (renameResult?.remotePath) {
                item.remotePath = renameResult.remotePath;
              }
            }
            // For overwrite, continue with original path
          }
        }
      }

      // Upload item using DFS (this will NOT check conflicts for nested items)
      const success = await uploadItemDFS(item);
      if (!success) {
        wasCancelled = true;
        break;
      }
    }

    // All items processed
    const allCompleted = firstLevelItems.every((item) => item.status === "completed" || item.status === "skipped");

    setActiveUpload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: wasCancelled ? "cancelled" : allCompleted ? "completed" : "failed",
        currentItem: undefined,
      };
    });

    // Show completion or cancellation toast with specific item names
    const getItemsDescription = (): string => {
      if (firstLevelItems.length === 1) return firstLevelItems[0].name;
      if (firstLevelItems.length === 2) return `${firstLevelItems[0].name}, ${firstLevelItems[1].name}`;
      if (firstLevelItems.length === 3) return `${firstLevelItems[0].name}, ${firstLevelItems[1].name}, ${firstLevelItems[2].name}`;
      return `${firstLevelItems[0].name}, ${firstLevelItems[1].name}, ... (${firstLevelItems.length} items)`;
    };

    const itemsDesc = getItemsDescription();

    if (wasCancelled) {
      setTimeout(() => {
        setToast({ message: `Upload cancelled: ${itemsDesc}`, type: "warning" });
      }, 0);
    } else if (allCompleted && !uploadCompletionToastShownRef.current) {
      uploadCompletionToastShownRef.current = true;
      setTimeout(() => {
        setToast({ message: `Upload completed: ${itemsDesc}`, type: "success" });
      }, 0);
    }
  } catch (error: any) {
    console.error("[Error] Upload session error:", error);
    setActiveUpload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: "failed",
      };
    });
    setToast({ message: `Upload failed: ${error.message || "Unknown error"}`, type: "error" });
  } finally {
    // Clean up after delay and refresh file list
    const wasCancelled = cancelUploadsRef.current;

    // Refresh file list for both success and cancellation
    await handleNavigate(currentPath);

    setTimeout(
      () => {
        setActiveUpload(() => null);
        cancelUploadsRef.current = false;
        currentFileUploadIdRef.current = null;
      },
      wasCancelled ? 1000 : 1500
    );
  }
};

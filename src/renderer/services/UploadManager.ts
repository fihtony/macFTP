// Unified Upload Manager
// Handles all upload types: single file, multiple files, folders, and mixed uploads

import React from 'react';
import { UploadTaskState, UploadListItem, ConflictResolution } from '../types/upload';

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
  setToast: (toast: { message: string; type: 'success' | 'error' | 'info' | 'warning' }) => void;
  handleNavigate: (path: string) => void;
  cancelUploadsRef: React.MutableRefObject<boolean>;
  uploadCompletionToastShownRef: React.MutableRefObject<boolean>;
  currentFileUploadIdRef: React.MutableRefObject<string | null>;
}

export const startUnifiedUpload = async (
  items: UploadItem[],
  options: UploadManagerOptions
): Promise<void> => {
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
    currentFileUploadIdRef
  } = options;

  if (items.length === 0) return;
  if (!electron) return;

  // Reset cancellation flag
  cancelUploadsRef.current = false;
  uploadCompletionToastShownRef.current = false;

  // Create uploadList
  const uploadList: UploadListItem[] = items.map((item, index) => ({
    id: `upload-item-${Date.now()}-${index}`,
    name: item.name,
    localPath: item.localPath,
    remotePath: item.remotePath,
    size: item.size,
    isFolder: item.isFolder,
    status: 'pending' as const,
    uploadedBytes: 0
  }));

  // Calculate total bytes (only files, folders count as 0)
  const totalBytes = uploadList.reduce((sum, item) => sum + (item.isFolder ? 0 : item.size), 0);

  // Create session ID
  const sessionId = `upload-session-${Date.now()}`;

  // Initialize upload state
  const initialUploadState: UploadTaskState = {
    id: sessionId,
    status: 'starting',
    uploadedBytes: 0,
    totalBytes,
    completedFiles: 0,
    totalFiles: uploadList.length,
    uploadList,
    currentItemIndex: undefined,
    currentFileUploaded: 0,
    currentFileSize: undefined,
    currentFileLocalPath: undefined,
    currentFileRemotePath: undefined,
    speed: 0,
    uploadConflictResolution: settings.defaultConflictResolution as ConflictResolution,
    siteName: currentSite?.name,
    siteHost: currentSite?.host,
    cancelRequested: false
  };

  setActiveUpload(() => initialUploadState);

  // Log initial upload state
  console.log('[Upload Manager] Initial upload state:', JSON.stringify({
    id: initialUploadState.id,
    status: initialUploadState.status,
    totalFiles: initialUploadState.totalFiles,
    totalBytes: initialUploadState.totalBytes,
    uploadList: initialUploadState.uploadList.map(item => ({
      name: item.name,
      isFolder: item.isFolder,
      size: item.size,
      status: item.status
    })),
    uploadConflictResolution: initialUploadState.uploadConflictResolution
  }, null, 2));

  // Start processing uploadList
  let uploadedBytes = 0;
  let completedFiles = 0;
  let wasCancelled = false;

  try {
    for (let i = 0; i < uploadList.length; i++) {
      // Check for cancellation
      if (cancelUploadsRef.current) {
        console.log('[Upload] Upload session cancelled, stopping at item:', { index: i, name: uploadList[i].name });
        wasCancelled = true;
        break;
      }

      const item = uploadList[i];

      console.log('[Upload Manager] Processing item:', {
        index: i,
        name: item.name,
        isFolder: item.isFolder,
        localPath: item.localPath,
        remotePath: item.remotePath
      });

      // Update current item index
      setActiveUpload((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          currentItemIndex: i,
          currentFileLocalPath: item.localPath,
          currentFileRemotePath: item.remotePath,
          currentFileSize: item.isFolder ? undefined : item.size,
          currentFileUploaded: 0
        };
      });

      // Mark item as uploading
      const updatedList = [...uploadList];
      updatedList[i] = { ...item, status: 'uploading' };
      setActiveUpload((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          uploadList: updatedList,
          status: 'uploading'
        };
      });

      // Get current conflict resolution from state - read it fresh each time
      // We need to read it from the actual state, not from a closure variable
      let conflictResolution: ConflictResolution = settings.defaultConflictResolution as ConflictResolution;
      
      // Read current conflict resolution from state - use a synchronous read
      // Since setActiveUpload is synchronous for reading, we can get the current value
      let currentState: UploadTaskState | null = null;
      setActiveUpload((prev) => {
        currentState = prev;
        return prev; // Don't modify, just read
      });
      
      if (currentState?.uploadConflictResolution) {
        conflictResolution = currentState.uploadConflictResolution;
      }
      
      // Log current conflict resolution
      console.log('[Upload Manager] Processing item with conflict resolution:', {
        itemIndex: i,
        itemName: item.name,
        conflictResolution,
        defaultConflictResolution: settings.defaultConflictResolution,
        sessionConflictResolution: currentState?.uploadConflictResolution
      });

      // Handle empty folders (they need to be created on the server)
      if (item.isFolder) {
        // This is an empty folder that needs to be created
        console.log('[Upload Manager] Creating empty folder:', { name: item.name, remotePath: item.remotePath });
        
        // Check for folder conflict
        const shouldShowDialog = conflictResolution === 'prompt' || conflictResolution === 'ask';
        let folderRemotePath = item.remotePath;
        
        if (shouldShowDialog) {
          const folderExists = await electron.checkRemoteExists?.(item.remotePath);
          if (folderExists?.exists) {
            const duplicateResult: any = await electron.handleUploadDuplicate?.({
              remotePath: item.remotePath,
              fileName: item.name,
              duplicateAction: null,
              applyToAll: false,
              defaultConflictResolution: conflictResolution
            });
            
            if (duplicateResult?.cancelled || duplicateResult?.dialogCancelled) {
              cancelUploadsRef.current = true;
              wasCancelled = true;
              setToast({ message: 'Upload cancelled', type: 'warning' });
              break;
            }
            
            if (duplicateResult?.skipped) {
              if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
                conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
                setActiveUpload((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    uploadConflictResolution: conflictResolution
                  };
                });
              }
              const skippedList = [...updatedList];
              skippedList[i] = { ...item, status: 'skipped' };
              completedFiles++;
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadList: skippedList,
                  completedFiles
                };
              });
              continue;
            }
            
            if (duplicateResult?.remotePath) {
              folderRemotePath = duplicateResult.remotePath;
            }
            
            if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
              conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadConflictResolution: conflictResolution
                };
              });
            }
          }
        } else if (conflictResolution === 'skip') {
          const folderExists = await electron.checkRemoteExists?.(item.remotePath);
          if (folderExists?.exists) {
            const skippedList = [...updatedList];
            skippedList[i] = { ...item, status: 'skipped' };
            completedFiles++;
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadList: skippedList,
                completedFiles
              };
            });
            continue;
          }
        } else if (conflictResolution === 'rename') {
          const folderExists = await electron.checkRemoteExists?.(item.remotePath);
          if (folderExists?.exists) {
            const renameResult: any = await electron.handleUploadDuplicate?.({
              remotePath: item.remotePath,
              fileName: item.name,
              duplicateAction: 'rename',
              applyToAll: false,
              defaultConflictResolution: 'rename'
            });
            if (renameResult?.remotePath) {
              folderRemotePath = renameResult.remotePath;
            }
          }
        }
        
        // Create the folder on the server
        try {
          const createResult = await electron.createDirectory(folderRemotePath);
          if (createResult.success) {
            const completedList = [...updatedList];
            completedList[i] = { ...item, status: 'completed', remotePath: folderRemotePath };
            completedFiles++;
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadList: completedList,
                completedFiles
              };
            });
          } else {
            const failedList = [...updatedList];
            failedList[i] = { ...item, status: 'failed', error: createResult.error || 'Unknown error' };
            completedFiles++;
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadList: failedList,
                completedFiles
              };
            });
          }
        } catch (err: any) {
          const failedList = [...updatedList];
          failedList[i] = { ...item, status: 'failed', error: err.message || 'Unknown error' };
          completedFiles++;
          setActiveUpload((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              uploadList: failedList,
              completedFiles
            };
          });
        }
        continue;
      }

      {
        // Handle file upload
        let remotePath = item.remotePath;

        // Handle duplicate file
        // Use the session conflict resolution if it's not 'prompt' or 'ask'
        const shouldShowDialog = conflictResolution === 'prompt' || conflictResolution === 'ask';
        const duplicateActionToUse = !shouldShowDialog ? conflictResolution : null;
        
        if (shouldShowDialog) {
          const duplicateResult: any = await electron.handleUploadDuplicate?.({
            remotePath: item.remotePath,
            fileName: item.name,
            duplicateAction: duplicateActionToUse,
            applyToAll: false,
            defaultConflictResolution: conflictResolution
          });

          if (duplicateResult?.cancelled || duplicateResult?.dialogCancelled) {
            cancelUploadsRef.current = true;
            wasCancelled = true;
            setToast({ message: 'Upload cancelled', type: 'warning' });
            break;
          }

          if (duplicateResult?.skipped) {
            // Update conflict resolution if "apply to all" was checked
            if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadConflictResolution: duplicateResult.duplicateAction as ConflictResolution
                };
              });
            }

            // Mark item as skipped
            const skippedList = [...updatedList];
            skippedList[i] = { ...item, status: 'skipped' };
            completedFiles++;
            uploadedBytes += item.size;
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadList: skippedList,
                completedFiles,
                uploadedBytes
              };
            });
            continue;
          }

          // Update remote path if renamed
          if (duplicateResult?.remotePath) {
            remotePath = duplicateResult.remotePath;
            updatedList[i] = { ...item, remotePath };
          }

          // Update conflict resolution if "apply to all" was checked
          if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
            conflictResolution = duplicateResult.duplicateAction as ConflictResolution;
            setActiveUpload((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                uploadConflictResolution: conflictResolution,
                uploadList: updatedList
              };
            });
            console.log('[Upload Manager] Updated conflict resolution (apply to all):', conflictResolution);
          }
        } else if (duplicateActionToUse) {
          // Use the session conflict resolution without showing dialog
          // Check if file exists and apply the resolution
          const existsResult = await electron.checkRemoteExists?.(item.remotePath);
          if (existsResult?.exists) {
            if (duplicateActionToUse === 'skip') {
              // Mark item as skipped
              const skippedList = [...updatedList];
              skippedList[i] = { ...item, status: 'skipped' };
              completedFiles++;
              uploadedBytes += item.size;
              setActiveUpload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  uploadList: skippedList,
                  completedFiles,
                  uploadedBytes
                };
              });
              continue;
            } else if (duplicateActionToUse === 'rename') {
              // Generate new name
              const pathParts = item.remotePath.split('/');
              const fileName = pathParts.pop() || item.name;
              const dirPath = pathParts.join('/') || '/';
              const newName = await electron.handleUploadDuplicate?.({
                remotePath: item.remotePath,
                fileName: item.name,
                duplicateAction: 'rename',
                applyToAll: false,
                defaultConflictResolution: 'rename'
              });
              if (newName?.remotePath) {
                remotePath = newName.remotePath;
                updatedList[i] = { ...item, remotePath };
              }
            }
            // For 'overwrite', just continue with the upload
          }
        }

        // Check for cancellation before starting upload
        if (cancelUploadsRef.current) {
          console.log('[Upload] Upload cancelled before starting file upload:', { fileName: item.name });
          wasCancelled = true;
          break;
        }

        // Create uploadId for this file
        const fileUploadId = `${sessionId}-${item.name}-${Math.random().toString(36).slice(2, 6)}`;
        currentFileUploadIdRef.current = fileUploadId;

        // Start file upload
        const fileResult = await electron.upload(item.localPath, remotePath, fileUploadId, conflictResolution);

        if (!fileResult.success) {
          if (cancelUploadsRef.current || (fileResult.error && fileResult.error.includes('cancelled'))) {
            console.log('[Upload] Upload cancelled:', { fileName: item.name });
            wasCancelled = true;
            break;
          }

          // Mark as failed
          const failedList = [...updatedList];
          failedList[i] = { ...item, status: 'failed', error: fileResult.error || 'Unknown error' };
          completedFiles++;
          setActiveUpload((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              uploadList: failedList,
              completedFiles
            };
          });
          continue;
        }

        // File upload completed successfully
        uploadedBytes += item.size;
        completedFiles++;

        // Mark item as completed
        const completedList = [...updatedList];
        completedList[i] = { ...item, status: 'completed', uploadedBytes: item.size };
        setActiveUpload((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            uploadList: completedList,
            uploadedBytes,
            completedFiles
          };
          // Log state after item completion
          console.log('[Upload Manager] Item completed, current state:', JSON.stringify({
            id: updated.id,
            status: updated.status,
            completedFiles: updated.completedFiles,
            totalFiles: updated.totalFiles,
            uploadedBytes: updated.uploadedBytes,
            totalBytes: updated.totalBytes,
            currentItemIndex: updated.currentItemIndex,
            uploadConflictResolution: updated.uploadConflictResolution,
            uploadList: updated.uploadList.map(item => ({
              name: item.name,
              isFolder: item.isFolder,
              status: item.status
            }))
          }, null, 2));
          return updated;
        });
      }

      // Check for cancellation after each item
      if (cancelUploadsRef.current) {
        wasCancelled = true;
        break;
      }
    }

    // All items processed
    const allCompleted = completedFiles === uploadList.length;

    setActiveUpload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: wasCancelled ? 'cancelled' : (allCompleted ? 'completed' : 'failed')
      };
    });

    // Show completion toast
    if (allCompleted && !wasCancelled) {
      setTimeout(() => {
        setToast({ message: 'Uploaded files successfully', type: 'success' });
      }, 0);
    }

  } catch (error: any) {
    console.error('[Error] Upload session error:', error);
    setActiveUpload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'failed'
      };
    });
    setToast({ message: `Upload failed: ${error.message || 'Unknown error'}`, type: 'error' });
  } finally {
    // Clean up after delay
    setTimeout(() => {
      setActiveUpload(null);
      cancelUploadsRef.current = false;
      currentFileUploadIdRef.current = null;
      handleNavigate(currentPath);
    }, wasCancelled ? 1000 : 1500);
  }
};


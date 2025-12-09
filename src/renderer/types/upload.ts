// Upload-related types

export type UploadStatus = 'starting' | 'uploading' | 'completed' | 'cancelled' | 'failed' | 'cancelling';
export type ConflictResolution = 'overwrite' | 'rename' | 'skip' | 'prompt' | 'ask';

export interface FolderUploadRequest {
  folderName: string;
  localPath: string;
  remotePath: string;
}

export interface UploadListItem {
  id: string; // Unique ID for this item
  name: string; // File or folder name
  localPath: string; // Original local path
  remotePath: string; // Target remote path (may be renamed after conflict resolution)
  size: number; // File size in bytes (0 for folders)
  isFolder: boolean; // true if this is a folder, false if file
  isTopLevel?: boolean; // true if this is a top-level file/folder (not inside a dragged folder)
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'skipped'; // Item-level status
  uploadedBytes?: number; // Bytes uploaded for this item (for folders, this is cumulative)
  error?: string; // Error message if failed
}

export interface UploadTaskState {
  id: string; // Session ID
  status: UploadStatus;
  uploadedBytes: number; // Total bytes uploaded across all items
  totalBytes: number; // Total bytes to upload (sum of all file sizes, folders count as 0)
  completedFiles: number; // Number of completed items
  totalFiles: number; // Total number of items (files + folders)
  uploadList: UploadListItem[]; // Array of all files/folders to upload
  currentItemIndex?: number; // Index of currently uploading item in uploadList
  currentFileUploaded?: number; // Bytes uploaded for current item
  currentFileSize?: number; // Size of current item
  currentFileLocalPath?: string; // Local path for current item
  currentFileRemotePath?: string; // Remote path for current item (may be renamed)
  speed?: number; // Upload speed in bytes per second
  uploadConflictResolution: ConflictResolution; // Current conflict resolution setting (can be updated by "apply to all")
  siteName?: string;
  siteHost?: string;
  cancelRequested?: boolean; // Whether cancellation has been requested
}

export const UPLOAD_FINAL_STATUSES: UploadStatus[] = ['completed', 'failed', 'cancelled'];


// Upload-related types

export type UploadStatus = "starting" | "uploading" | "completed" | "cancelled" | "failed" | "cancelling";
export type ConflictResolution = "overwrite" | "rename" | "skip" | "prompt" | "ask";

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
  size: number; // File size in bytes (total files size under this folder if folder)
  isFolder: boolean; // true if this is a folder, false if file
  items?: UploadListItem[]; // Array of all files and empty folder under this folder to upload, null for files or empty folders
  status: "pending" | "uploading" | "completed" | "failed" | "skipped"; // Item-level status
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
  items: UploadListItem[]; // Array of the first level of files and folders to upload
  currentItem?: UploadListItem; // currently uploading file item, not folder
  // the following four fields are moved to currentItem
  // currentFileUploaded?: number; // Bytes uploaded for current item
  // currentFileSize?: number; // Size of current item
  // currentFileLocalPath?: string; // Local path for current item
  // currentFileRemotePath?: string; // Remote path for current item (may be renamed)
  speed?: number; // Upload speed in bytes per second
  uploadConflictResolution: ConflictResolution; // Current conflict resolution setting (can be updated by "apply to all")
  sessionConflictResolutionApplied?: boolean; // Whether "apply to all" has been selected in this session
  siteName?: string;
  siteHost?: string;
  cancelRequested?: boolean; // Whether cancellation has been requested
}

export const UPLOAD_FINAL_STATUSES: UploadStatus[] = ["completed", "failed", "cancelled"];

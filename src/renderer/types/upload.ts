// Upload-related types

export type UploadStatus = 'starting' | 'uploading' | 'completed' | 'cancelled' | 'failed';

export interface FolderUploadRequest {
  folderName: string;
  localPath: string;
  remotePath: string;
}

export interface UploadTaskState {
  id: string;
  status: UploadStatus;
  uploadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentFile?: string;
  currentFileUploaded?: number;
  currentFileSize?: number;
  speed?: number;
  folderName?: string;
  cancelRequested?: boolean;
  isSingleUpload?: boolean;
}

export const UPLOAD_FINAL_STATUSES: UploadStatus[] = ['completed', 'failed', 'cancelled'];


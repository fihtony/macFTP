// Upload Progress Dialog Component
import React from 'react';
import { X } from 'lucide-react';
import { formatBytes } from '../utils/formatters';
import { UploadTaskState, UPLOAD_FINAL_STATUSES } from '../types/upload';

interface UploadProgressDialogProps {
  upload: UploadTaskState;
  onClose: () => void;
  onCancel: () => void;
}

export const UploadProgressDialog: React.FC<UploadProgressDialogProps> = ({
  upload,
  onClose,
  onCancel
}) => {
  // Backward compatibility: support both new structure (with uploadList) and old structure (with isSingleUpload)
  const hasUploadList = upload.uploadList && Array.isArray(upload.uploadList);
  const isSingleUpload = hasUploadList 
    ? upload.uploadList.length === 1 
    : (upload as any).isSingleUpload === true;
  const isCancelling = upload.status === 'cancelling' || (upload.cancelRequested && !UPLOAD_FINAL_STATUSES.includes(upload.status));
  const currentItem = hasUploadList && upload.currentItemIndex !== undefined 
    ? upload.uploadList[upload.currentItemIndex] 
    : null;

  const calculateETA = () => {
    if (!upload.speed || upload.speed === 0 || !upload.totalBytes) return null;
    const remainingBytes = upload.totalBytes - upload.uploadedBytes;
    const etaSeconds = remainingBytes / upload.speed;
    if (etaSeconds < 60) return `${Math.round(etaSeconds)}s`;
    if (etaSeconds < 3600) return `${Math.round(etaSeconds / 60)}m`;
    return `${Math.round(etaSeconds / 3600)}h`;
  };

  // Get display name for the upload
  const getUploadTitle = () => {
    if (isSingleUpload) {
      if (currentItem) {
        return `Uploading ${currentItem.name}`;
      }
      // Fallback for old structure
      const name = (upload as any).folderName || (upload as any).currentFile || 'file';
      return `Uploading ${name}`;
    }
    return `Uploading ${upload.completedFiles}/${upload.totalFiles} files`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[420px] max-w-full p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">
                {getUploadTitle()}
              </h2>
            </div>
            {!isSingleUpload && (
              <p className="text-xs text-muted-foreground">
                {UPLOAD_FINAL_STATUSES.includes(upload.status) ? `Upload ${upload.status}` : 'Uploading files'}
              </p>
            )}
          </div>
          {UPLOAD_FINAL_STATUSES.includes(upload.status) && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-accent rounded"
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="space-y-3 text-sm">
          {/* Site Information */}
          <div className="space-y-1">
            {upload.siteName && upload.siteHost && (
              <p className="text-xs text-muted-foreground truncate">
                Site: {upload.siteName} ({upload.siteHost})
              </p>
            )}
            {/* From/To information */}
            {currentItem ? (
              <>
                <p className="text-xs text-muted-foreground truncate">From: {currentItem.localPath}</p>
                <p className="text-xs text-muted-foreground truncate">To: {currentItem.remotePath}</p>
              </>
            ) : (
              // Fallback for old structure
              <>
                {upload.currentFileLocalPath && (
                  <p className="text-xs text-muted-foreground truncate">From: {upload.currentFileLocalPath}</p>
                )}
                {upload.currentFileRemotePath && (
                  <p className="text-xs text-muted-foreground truncate">To: {upload.currentFileRemotePath}</p>
                )}
                {!upload.currentFileLocalPath && (upload as any).localPath && (
                  <p className="text-xs text-muted-foreground truncate">From: {(upload as any).localPath}</p>
                )}
                {!upload.currentFileRemotePath && (upload as any).remotePath && (
                  <p className="text-xs text-muted-foreground truncate">To: {(upload as any).remotePath}</p>
                )}
              </>
            )}
          </div>

          {/* Total Progress Bar (hidden for single upload) */}
          {!isSingleUpload && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>
                  {formatBytes(upload.uploadedBytes)} / {formatBytes(upload.totalBytes || 0)}
                </span>
                <span>
                  {upload.totalBytes
                    ? `${Math.min(100, Math.round((upload.uploadedBytes / upload.totalBytes) * 100))}%`
                    : '0%'}
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: upload.totalBytes
                      ? `${Math.min(100, (upload.uploadedBytes / upload.totalBytes) * 100)}%`
                      : '0%'
                  }}
                />
              </div>
            </div>
          )}

          {/* Current File/Folder Progress Bar */}
          <div>
            {upload.currentFileSize ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>
                    {formatBytes(upload.currentFileUploaded || 0)} / {formatBytes(upload.currentFileSize)}
                  </span>
                  <span>
                    {Math.min(
                      100,
                      Math.round(((upload.currentFileUploaded || 0) / upload.currentFileSize) * 100)
                    )}%
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 transition-all duration-200"
                    style={{
                      width: `${Math.min(
                        100,
                        ((upload.currentFileUploaded || 0) / upload.currentFileSize) * 100
                      )}%`
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-muted-foreground/30 animate-pulse" style={{ width: '25%' }} />
              </div>
            )}
          </div>

          {/* Speed and ETA */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {!isSingleUpload && (
              <span className="whitespace-nowrap">
                Files: {upload.completedFiles}/{upload.totalFiles}
              </span>
            )}
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">Speed:</span>
              <span className="font-medium min-w-[80px] inline-block">
                {upload.speed ? `${formatBytes(upload.speed)}/s` : '--'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">ETA:</span>
              <span className="font-medium min-w-[60px] inline-block">
                {calculateETA() || '--'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={UPLOAD_FINAL_STATUSES.includes(upload.status) || isCancelling}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50 min-w-[100px] text-center"
          >
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
};

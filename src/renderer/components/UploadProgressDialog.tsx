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
  const calculateETA = () => {
    if (!upload.speed || upload.speed === 0 || !upload.totalBytes) return null;
    const remainingBytes = upload.totalBytes - upload.uploadedBytes;
    const etaSeconds = remainingBytes / upload.speed;
    if (etaSeconds < 60) return `${Math.round(etaSeconds)}s`;
    if (etaSeconds < 3600) return `${Math.round(etaSeconds / 60)}m`;
    return `${Math.round(etaSeconds / 3600)}h`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[420px] max-w-full p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">
                {upload.isSingleUpload
                  ? `Uploading ${upload.folderName || upload.currentFile || 'file'}`
                  : upload.folderName
                  ? `Uploading ${upload.folderName}`
                  : 'Uploading files'}
              </h2>
              {upload.cancelRequested && !UPLOAD_FINAL_STATUSES.includes(upload.status) && (
                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-yellow-500/20 text-yellow-500 rounded flex-shrink-0">
                  Cancelling
                </span>
              )}
            </div>
            {!upload.isSingleUpload && (
              <p className="text-xs text-muted-foreground">
                {UPLOAD_FINAL_STATUSES.includes(upload.status) ? `Upload ${upload.status}` : 'Uploading contents recursively'}
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
          {upload.isSingleUpload ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>
                  {formatBytes(upload.currentFileUploaded || upload.uploadedBytes)} / {formatBytes(upload.currentFileSize || upload.totalBytes || 0)}
                </span>
                <span>
                  {upload.currentFileSize || upload.totalBytes
                    ? `${Math.min(100, Math.round(((upload.currentFileUploaded || upload.uploadedBytes) / (upload.currentFileSize || upload.totalBytes || 1)) * 100))}%`
                    : '0%'}
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      ((upload.currentFileUploaded || upload.uploadedBytes) / Math.max(upload.currentFileSize || upload.totalBytes || 1, 1)) * 100
                    )}%`
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Speed: {upload.speed ? `${formatBytes(upload.speed)}/s` : '--'}</span>
                <span>ETA: {calculateETA() || '--'}</span>
              </div>
            </div>
          ) : (
            <>
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

              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Current file: {upload.currentFile || 'Preparing...'}
                </p>
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

              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  Files: {upload.completedFiles}/{upload.totalFiles}
                </span>
                <span>Speed: {upload.speed ? `${formatBytes(upload.speed)}/s` : '--'}</span>
                <span>ETA: {calculateETA() || '--'}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={UPLOAD_FINAL_STATUSES.includes(upload.status) || upload.cancelRequested}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};


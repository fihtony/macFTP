import React, { useEffect } from 'react';
import { X, Trash2, CheckCircle2 } from 'lucide-react';
import { formatBytes, formatTime, formatDuration } from '../utils';

export interface DownloadItem {
  id: string;
  fileName: string;
  remotePath: string;
  localPath: string;
  totalSize: number;
  downloadedSize: number;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  speed?: number; // bytes per second
  eta?: number; // estimated time remaining in seconds
  error?: string;
  startTime?: number;
  endTime?: number;
  siteName?: string; // FTP site name
  siteHost?: string; // FTP site host
  siteId?: string; // FTP site ID for updating site name
}

interface DownloadProgressDialogProps {
  download: DownloadItem;
  onCancel?: () => void;
  onRemove?: () => void;
  showInBackground?: () => void;
  isCancelling?: boolean;
}

const DownloadProgressDialog: React.FC<DownloadProgressDialogProps> = ({
  download,
  onCancel,
  onRemove,
  showInBackground,
  isCancelling = false
}) => {
  const progress = download.totalSize > 0 
    ? (download.downloadedSize / download.totalSize) * 100 
    : 0;

  const isCompleted = download.status === 'completed';
  const isCancelled = download.status === 'cancelled';
  const isFailed = download.status === 'failed';
  const isActive = download.status === 'downloading' || download.status === 'queued';
  const showCancelling = isCancelling && isActive;

  // Calculate average speed and total time for completed downloads
  const averageSpeed = React.useMemo(() => {
    if (!isCompleted || !download.startTime || !download.endTime) return null;
    const duration = (download.endTime - download.startTime) / 1000; // seconds
    if (duration <= 0 || download.totalSize === 0) return null;
    return download.totalSize / duration;
  }, [isCompleted, download.startTime, download.endTime, download.totalSize]);

  const totalDownloadTime = React.useMemo(() => {
    if (!isCompleted || !download.startTime || !download.endTime) return null;
    return (download.endTime - download.startTime) / 1000; // seconds
  }, [isCompleted, download.startTime, download.endTime]);

  const formatSpeed = (bytesPerSecond?: number) => {
    if (!bytesPerSecond) return '--';
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  // Auto-dismiss is handled by App.tsx, not here
  // Removed to prevent premature dismissal

  return (
    <div 
      className="fixed inset-0 z-[200] bg-background/80 backdrop-blur flex items-center justify-center"
      onClick={(e) => {
        // Close dialog when clicking outside (unless it's being cancelled)
        if (e.target === e.currentTarget && showInBackground && !showCancelling) {
          showInBackground();
        }
      }}
    >
      <div 
        className="bg-card border border-border rounded-lg shadow-xl p-6 w-[600px] max-w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="text-lg font-semibold truncate">{download.fileName}</h3>
              <div className="flex items-center gap-2">
                {isCompleted && (
                  <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-500 rounded flex items-center gap-1 flex-shrink-0">
                    <CheckCircle2 size={12} />
                    Downloaded
                  </span>
                )}
                {isCancelled && (
                  <span className="px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-500 rounded flex items-center gap-1 flex-shrink-0">
                    <X size={12} />
                    Cancelled
                  </span>
                )}
                {isFailed && (
                  <span className="px-2 py-1 text-xs font-medium bg-red-500/20 text-red-500 rounded flex items-center gap-1 flex-shrink-0">
                    <X size={12} />
                    Failed
                  </span>
                )}
                {onCancel && isActive && (
                  <button
                    onClick={() => {
                      if (onCancel) onCancel();
                    }}
                    disabled={showCancelling}
                    className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 flex-shrink-0 ${
                      showCancelling 
                        ? 'bg-yellow-500/30 text-yellow-500 cursor-not-allowed' 
                        : 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
                    }`}
                    title={showCancelling ? 'Cancelling...' : 'Cancel'}
                  >
                    <X size={12} />
                    {showCancelling ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
            </div>
            {download.siteName && download.siteHost && (
              <p className="text-xs text-muted-foreground truncate">
                Site: {download.siteName} ({download.siteHost})
              </p>
            )}
            <p className="text-xs text-muted-foreground truncate">From: {download.remotePath}</p>
            <p className="text-xs text-muted-foreground truncate">To: {download.localPath || '(determining...)'}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              {showCancelling || isCancelled || isFailed 
                ? '-- / --' 
                : `${formatBytes(download.downloadedSize)} / ${formatBytes(download.totalSize)}`
              }
            </span>
            <span>
              {showCancelling || isCancelled || isFailed 
                ? '--' 
                : `${progress.toFixed(1)}%`
              }
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden relative">
            {showCancelling ? (
              <div className="h-full bg-yellow-500 animate-pulse" style={{ 
                width: '100%',
                animation: 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite'
              }} />
            ) : (
              <div
                className={`h-full transition-all duration-300 ${
                  isCompleted ? 'bg-green-500' : 
                  isCancelled || isFailed ? 'bg-muted' : 
                  'bg-primary'
                }`}
                style={{ width: isCancelled || isFailed ? '0%' : `${progress}%` }}
              />
            )}
          </div>
        </div>

        {/* Stats */}
        {isCompleted ? (
          <div className="grid grid-cols-2 gap-4 text-xs mb-4">
            {averageSpeed && (
              <div>
                <span className="text-muted-foreground">Average Speed: </span>
                <span className="font-medium">{formatSpeed(averageSpeed)}</span>
              </div>
            )}
            {totalDownloadTime && (
              <div>
                <span className="text-muted-foreground">Total Time: </span>
                <span className="font-medium">{formatDuration(totalDownloadTime)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-xs mb-4">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">Speed:</span>
              <span className="font-medium min-w-[80px] inline-block">
                {showCancelling || isCancelled || isFailed ? '--' : formatSpeed(download.speed)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">ETA:</span>
              <span className="font-medium min-w-[60px] inline-block">
                {showCancelling || isCancelled || isFailed ? '--' : formatTime(download.eta)}
              </span>
            </div>
          </div>
        )}

        {/* Status and Actions */}
        {!isCompleted && !isCancelled && (
          <div className="flex items-center justify-between">
            <div className="text-xs">
              <span className={`font-medium ${
                download.status === 'failed' ? 'text-red-500' :
                download.status === 'downloading' ? 'text-primary' :
                download.status === 'queued' ? 'text-muted-foreground' :
                'text-muted-foreground'
              }`}>
                {download.status === 'queued' && 'Queued'}
                {download.status === 'downloading' && (showCancelling ? 'Cancelling...' : 'Downloading...')}
                {download.status === 'failed' && `Failed: ${download.error || 'Unknown error'}`}
              </span>
            </div>
          </div>
        )}
        
        {isCompleted && download.endTime && (
          <div className="text-xs text-muted-foreground">
            Downloaded at {new Date(download.endTime).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadProgressDialog;

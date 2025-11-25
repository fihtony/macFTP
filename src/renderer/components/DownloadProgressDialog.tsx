import React from 'react';
import { X, Pause, Play, Trash2, CheckCircle2 } from 'lucide-react';
import { formatBytes, formatTime, formatDuration } from '../utils';

export interface DownloadItem {
  id: string;
  fileName: string;
  remotePath: string;
  localPath: string;
  totalSize: number;
  downloadedSize: number;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
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
  onPause?: () => void;
  onResume?: () => void;
  onRemove?: () => void;
  showInBackground?: () => void;
}

const DownloadProgressDialog: React.FC<DownloadProgressDialogProps> = ({
  download,
  onCancel,
  onPause,
  onResume,
  onRemove,
  showInBackground
}) => {
  const progress = download.totalSize > 0 
    ? (download.downloadedSize / download.totalSize) * 100 
    : 0;

  const isCompleted = download.status === 'completed';
  const isActive = download.status === 'downloading' || download.status === 'paused' || download.status === 'queued';

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

  return (
    <div 
      className="fixed inset-0 z-[200] bg-background/80 backdrop-blur flex items-center justify-center"
      onClick={(e) => {
        // Close dialog when clicking outside
        if (e.target === e.currentTarget && showInBackground) {
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
            <h3 className="text-lg font-semibold mb-1 truncate">{download.fileName}</h3>
            {download.siteName && download.siteHost && (
              <p className="text-xs text-muted-foreground truncate">
                Site: {download.siteName} ({download.siteHost})
              </p>
            )}
            <p className="text-xs text-muted-foreground truncate">From: {download.remotePath}</p>
            <p className="text-xs text-muted-foreground truncate">To: {download.localPath}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {isCompleted && (
              <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-500 rounded flex items-center gap-1">
                <CheckCircle2 size={12} />
                Downloaded
              </span>
            )}
            {showInBackground && (
              <button
                onClick={showInBackground}
                className="p-1.5 hover:bg-accent rounded transition-colors"
                title="Close"
              >
                <X size={16} />
              </button>
            )}
            {onCancel && download.status === 'downloading' && (
              <button
                onClick={onCancel}
                className="p-1.5 hover:bg-accent rounded transition-colors"
                title="Cancel download"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{formatBytes(download.downloadedSize)} / {formatBytes(download.totalSize)}</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isCompleted ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${progress}%` }}
            />
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
            <div>
              <span className="text-muted-foreground">Speed: </span>
              <span className="font-medium">{formatSpeed(download.speed)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ETA: </span>
              <span className="font-medium">{formatTime(download.eta)}</span>
            </div>
          </div>
        )}

        {/* Status and Actions */}
        {!isCompleted && (
          <div className="flex items-center justify-between">
            <div className="text-xs">
              <span className={`font-medium ${
                download.status === 'failed' ? 'text-red-500' :
                download.status === 'paused' ? 'text-yellow-500' :
                download.status === 'downloading' ? 'text-primary' :
                'text-muted-foreground'
              }`}>
                {download.status === 'queued' && 'Queued'}
                {download.status === 'downloading' && 'Downloading...'}
                {download.status === 'paused' && 'Paused'}
                {download.status === 'failed' && `Failed: ${download.error || 'Unknown error'}`}
                {download.status === 'cancelled' && 'Cancelled'}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {download.status === 'downloading' && onPause && (
                <button
                  onClick={onPause}
                  className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors flex items-center gap-1"
                >
                  <Pause size={14} />
                  Pause
                </button>
              )}
              {download.status === 'paused' && onResume && (
                <button
                  onClick={onResume}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:opacity-90 rounded transition-colors flex items-center gap-1"
                >
                  <Play size={14} />
                  Resume
                </button>
              )}
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

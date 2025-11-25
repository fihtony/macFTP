import React, { useState } from 'react';
import { Download, Clock, CheckCircle2, XCircle, X, Play, Pause, Trash2, History } from 'lucide-react';
import { DownloadItem } from './DownloadProgressDialog';
import { formatBytes, formatRelativeTime, formatDate, formatTime } from '../utils';
import ConfirmDialog from './ConfirmDialog';
import clsx from 'clsx';

interface DownloadManagerProps {
  downloads: DownloadItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onClearHistory?: () => void;
  onShowDetails: (id: string) => void;
  showHistory?: boolean;
  onToggleHistory?: () => void;
}

const DownloadManager: React.FC<DownloadManagerProps> = ({
  downloads,
  onPause,
  onResume,
  onCancel,
  onRemove,
  onClearHistory,
  onShowDetails,
  showHistory = false,
  onToggleHistory
}) => {
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'clear' | 'delete';
    id?: string;
  } | null>(null);

  const activeDownloads = downloads.filter(d => 
    d.status === 'queued' || d.status === 'downloading' || d.status === 'paused'
  );
  // Sort history by endTime descending (most recent first)
  const historyDownloads = downloads
    .filter(d => d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled')
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0));

  const getStatusIcon = (status: DownloadItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={16} className="text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <XCircle size={16} className="text-red-500" />;
      case 'downloading':
        return <Download size={16} className="text-primary animate-pulse" />;
      case 'paused':
        return <Pause size={16} className="text-yellow-500" />;
      case 'queued':
        return <Clock size={16} className="text-muted-foreground" />;
      default:
        return <Download size={16} />;
    }
  };

  const getProgress = (download: DownloadItem) => {
    if (download.totalSize === 0) return 0;
    return (download.downloadedSize / download.totalSize) * 100;
  };

  const renderHistoryItem = (download: DownloadItem) => {
    const getStatusIcon = () => {
      switch (download.status) {
        case 'completed':
          return <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />;
        case 'failed':
          return <XCircle size={14} className="text-red-500 flex-shrink-0" />;
        case 'cancelled':
          return <XCircle size={14} className="text-muted-foreground flex-shrink-0" />;
        default:
          return <Download size={14} className="flex-shrink-0" />;
      }
    };

    return (
      <div
        key={download.id}
        className="group relative px-3 py-2 hover:bg-accent/50 transition-colors cursor-pointer border-b border-border/50"
        onClick={() => onShowDetails(download.id)}
        title={`File: ${download.fileName}\nFrom: ${download.remotePath}\nTo: ${download.localPath}\nSize: ${formatBytes(download.totalSize)}\n${download.siteName ? `Site: ${download.siteName} (${download.siteHost})\n` : ''}Time: ${download.endTime ? new Date(download.endTime).toLocaleString() : 'Unknown'}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <div className="mt-0.5">
              {getStatusIcon()}
            </div>
            <div className="flex-1 min-w-0">
              {/* First line: File name */}
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium truncate">
                  {download.fileName}
                </span>
              </div>
              {/* Second line: Size, time, site */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatBytes(download.totalSize)}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatRelativeTime(download.endTime)}
                </span>
                {download.siteName && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={`${download.siteName} (${download.siteHost})`}>
                    {download.siteName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDialog({ type: 'delete', id: download.id });
            }}
            className="p-1 hover:bg-destructive/20 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
            title="Delete this record"
          >
            <Trash2 size={12} className="text-destructive" />
          </button>
        </div>
      </div>
    );
  };

  const renderDownloadItem = (download: DownloadItem, showActions: boolean = true) => {
    const progress = getProgress(download);
    const isActive = download.status === 'downloading' || download.status === 'paused' || download.status === 'queued';

    return (
      <div
        key={download.id}
        className={clsx(
          "p-3 rounded-lg border transition-colors cursor-pointer hover:bg-accent/50",
          isActive && "bg-accent/30"
        )}
        onClick={() => onShowDetails(download.id)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5">
              {getStatusIcon(download.status)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium truncate">{download.fileName}</p>
                {isActive && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {progress.toFixed(0)}%
                  </span>
                )}
              </div>
              
              {isActive && (
                <div className="mb-2">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {download.status === 'downloading' && download.speed && (
                  <span>{formatBytes(download.speed)}/s</span>
                )}
                {download.status === 'downloading' && download.eta && (
                  <span>ETA: {formatTime(download.eta)}</span>
                )}
                {download.status === 'completed' && download.endTime && (
                  <span>{formatDate(download.endTime)}</span>
                )}
                {download.status === 'failed' && download.error && (
                  <span className="text-red-500 truncate max-w-xs">{download.error}</span>
                )}
              </div>

              {!isActive && (
                <>
                  {download.siteName && download.siteHost && (
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {download.siteName} ({download.siteHost})
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {download.localPath}
                  </p>
                </>
              )}
              
              {isActive && download.siteName && download.siteHost && (
                <p className="text-xs text-muted-foreground truncate mt-1">
                  From: {download.siteName} ({download.siteHost})
                </p>
              )}
            </div>
          </div>

          {showActions && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {download.status === 'downloading' && (
                <button
                  onClick={() => onPause(download.id)}
                  className="p-1.5 hover:bg-accent rounded transition-colors"
                  title="Pause"
                >
                  <Pause size={14} />
                </button>
              )}
              {download.status === 'paused' && (
                <button
                  onClick={() => onResume(download.id)}
                  className="p-1.5 hover:bg-accent rounded transition-colors"
                  title="Resume"
                >
                  <Play size={14} />
                </button>
              )}
              {(download.status === 'downloading' || download.status === 'paused' || download.status === 'queued') && (
                <button
                  onClick={() => onCancel(download.id)}
                  className="p-1.5 hover:bg-accent rounded transition-colors"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              )}
              {!isActive && (
                <button
                  onClick={() => onRemove(download.id)}
                  className="p-1.5 hover:bg-accent rounded transition-colors"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Download size={20} />
            Downloads
          </h2>
          {onToggleHistory && (
            <button
              onClick={onToggleHistory}
              className={clsx(
                "p-1.5 rounded transition-colors",
                showHistory ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
              title="Toggle history"
            >
              <History size={16} />
            </button>
          )}
        </div>
        {activeDownloads.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {activeDownloads.length} active download{activeDownloads.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Active Downloads */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {activeDownloads.length === 0 && !showHistory && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No active downloads
          </div>
        )}

        {!showHistory && activeDownloads.map(download => renderDownloadItem(download))}

        {/* History Section */}
        {showHistory && (
          <>
            {historyDownloads.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2 px-4 pt-2">
                  <h3 className="text-sm font-medium text-muted-foreground">History</h3>
                  {onClearHistory && (
                    <button
                      onClick={() => setConfirmDialog({ type: 'clear' })}
                      className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors border border-border"
                      title="Clear all history"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <div className="space-y-px">
                  {historyDownloads.map(download => renderHistoryItem(download))}
                </div>
              </div>
            )}

            {historyDownloads.length === 0 && activeDownloads.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-8">
                No download history
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Confirm Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={
            confirmDialog.type === 'clear'
              ? 'Clear All History'
              : 'Delete Download Record'
          }
          message={
            confirmDialog.type === 'clear'
              ? 'Are you sure you want to clear all download history? This action cannot be undone.'
              : 'Are you sure you want to delete this download record? This action cannot be undone.'
          }
          onConfirm={() => {
            if (confirmDialog.type === 'clear' && onClearHistory) {
              onClearHistory();
            } else if (confirmDialog.type === 'delete' && confirmDialog.id) {
              onRemove(confirmDialog.id);
            }
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
          confirmText={confirmDialog.type === 'clear' ? 'Clear All' : 'Delete'}
          variant="danger"
        />
      )}
    </div>
  );
};

export default DownloadManager;

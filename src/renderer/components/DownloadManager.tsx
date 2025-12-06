import React, { useState, useEffect, useRef } from 'react';
import { Download, Clock, CheckCircle2, XCircle, X, Trash2, History } from 'lucide-react';
import { DownloadItem } from './DownloadProgressDialog';
import { formatBytes, formatRelativeTime, formatDate, formatTime } from '../utils';
import ConfirmDialog from './ConfirmDialog';
import clsx from 'clsx';

interface DownloadManagerProps {
  downloads: DownloadItem[];
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onClearHistory?: () => void;
  onShowDetails: (id: string) => void;
  showHistory?: boolean;
  onToggleHistory?: () => void;
  cancellingDownloads?: Set<string>;
}

const DownloadManager: React.FC<DownloadManagerProps> = ({
  downloads,
  onCancel,
  onRemove,
  onClearHistory,
  onShowDetails,
  showHistory = false,
  onToggleHistory,
  cancellingDownloads = new Set()
}) => {
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'clear' | 'delete';
    id?: string;
    fileName?: string;
    status?: string;
    isFolder?: boolean;
  } | null>(null);
  
  const activeListRef = useRef<HTMLDivElement>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle scroll event to show/hide scrollbar
  useEffect(() => {
    const handleScroll = (element: HTMLDivElement) => {
      return () => {
        element.classList.add('scrolling');
        
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        
        scrollTimeoutRef.current = setTimeout(() => {
          element.classList.remove('scrolling');
        }, 1000);
      };
    };

    const activeList = activeListRef.current;
    const historyList = historyListRef.current;
    
    let activeScrollHandler: (() => void) | null = null;
    let historyScrollHandler: (() => void) | null = null;

    if (activeList) {
      activeScrollHandler = handleScroll(activeList);
      activeList.addEventListener('scroll', activeScrollHandler);
    }
    if (historyList) {
      historyScrollHandler = handleScroll(historyList);
      historyList.addEventListener('scroll', historyScrollHandler);
    }

    return () => {
      if (activeList && activeScrollHandler) {
        activeList.removeEventListener('scroll', activeScrollHandler);
      }
      if (historyList && historyScrollHandler) {
        historyList.removeEventListener('scroll', historyScrollHandler);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [showHistory]);

  const activeDownloads = downloads.filter(d => 
    d.status === 'queued' || d.status === 'downloading'
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
      case 'queued':
        return <Clock size={16} className="text-yellow-500" />;
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
                <span className={`text-xs font-medium truncate ${download.isFolder ? 'text-blue-400' : ''}`}>
                  {download.fileName}
                </span>
                {download.status === 'completed' && (
                  <span className="px-1.5 py-0.5 text-[9px] font-medium bg-green-500/20 text-green-500 rounded flex items-center gap-1 flex-shrink-0">
                    <CheckCircle2 size={10} />
                    Downloaded
                  </span>
                )}
                {download.status === 'cancelled' && (
                  <span className="px-1.5 py-0.5 text-[9px] font-medium bg-yellow-500/20 text-yellow-500 rounded flex items-center gap-1 flex-shrink-0">
                    <X size={10} />
                    Cancelled
                  </span>
                )}
                {download.status === 'failed' && (
                  <span className="px-1.5 py-0.5 text-[9px] font-medium bg-red-500/20 text-red-500 rounded flex items-center gap-1 flex-shrink-0">
                    <XCircle size={10} />
                    Failed
                  </span>
                )}
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
              console.log('[User Action] Delete download record from history:', { id: download.id, fileName: download.fileName, status: download.status });
              setConfirmDialog({ 
                type: 'delete', 
                id: download.id,
                fileName: download.fileName,
                status: download.status,
                isFolder: download.isFolder
              });
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
    const isActive = download.status === 'downloading' || download.status === 'queued';
    const isCancelling = cancellingDownloads.has(download.id);

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
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{download.fileName}</p>
                  {download.isFolder && (
                    <span className="px-1.5 py-0.5 text-[9px] font-medium bg-blue-500/20 text-blue-400 rounded flex-shrink-0">
                      Folder
                    </span>
                  )}
                </div>
                {isCancelling && (
                  <span className="px-1.5 py-0.5 text-[9px] font-medium bg-yellow-500/20 text-yellow-500 rounded flex-shrink-0">
                    Cancelling
                  </span>
                )}
                {isActive && !isCancelling && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {progress.toFixed(0)}%
                  </span>
                )}
              </div>
              
              {isActive && (
                <div className="mb-2">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden relative">
                    {isCancelling ? (
                      <div 
                        className="h-full bg-yellow-500 absolute"
                        style={{
                          animation: 'slide 1.5s ease-in-out infinite',
                          width: '20%',
                          left: '0%'
                        }}
                      />
                    ) : (
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
                    <span>
                      {isCancelling ? '-- / --' : `${formatBytes(download.downloadedSize || 0)} / ${formatBytes(download.totalSize || 0)}`}
                    </span>
                    {download.totalSize > 0 && !isCancelling && (
                      <span>{progress.toFixed(1)}%</span>
                    )}
                    {isCancelling && (
                      <span>--</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {download.status === 'downloading' && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="whitespace-nowrap">Speed:</span>
                      <span className="font-medium min-w-[90px] inline-block">
                        {isCancelling ? '--' : (download.speed ? `${formatBytes(download.speed)}/s` : '--')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="whitespace-nowrap">ETA:</span>
                      <span className="font-medium min-w-[55px] inline-block">
                        {isCancelling ? '--' : formatTime(download.eta)}
                      </span>
                    </div>
                  </>
                )}
                {download.status === 'completed' && download.endTime && (
                  <span>{formatDate(download.endTime)}</span>
                )}
                {download.status === 'failed' && download.error && (
                  <span className="text-red-500 truncate max-w-xs">{download.error}</span>
                )}
                {download.status === 'cancelled' && (
                  <span>Cancelled</span>
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
              {(download.status === 'downloading' || download.status === 'queued') && !isCancelling && (
                <button
                  onClick={() => {
                    console.log('[User Action] Cancel download from DownloadManager:', { id: download.id, fileName: download.fileName, isFolder: download.isFolder });
                    onCancel(download.id);
                  }}
                  className="p-1.5 rounded transition-colors hover:bg-accent"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              )}
              {isCancelling && (
                <div className="p-1.5 opacity-30 cursor-not-allowed">
                  <X size={14} />
                </div>
              )}
              {!isActive && (
                <button
                  onClick={() => {
                    console.log('[User Action] Remove download from DownloadManager:', { id: download.id, fileName: download.fileName, status: download.status });
                    onRemove(download.id);
                  }}
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
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
        {activeDownloads.length === 0 && !showHistory && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No active downloads
          </div>
        )}

        <div ref={activeListRef} className="custom-scrollbar flex-1 overflow-y-auto">
        {!showHistory && activeDownloads.map(download => renderDownloadItem(download))}
        </div>

        {/* History Section */}
        {showHistory && (
          <div ref={historyListRef} className="custom-scrollbar flex-1 overflow-y-auto">
            {historyDownloads.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2 px-4 pt-2">
                  <h3 className="text-sm font-medium text-muted-foreground">History</h3>
                  {onClearHistory && (
                    <button
                      onClick={() => {
                        console.log('[User Action] Clear history requested from DownloadManager');
                        setConfirmDialog({ type: 'clear' });
                      }}
                      className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors border border-border"
                      title="Clear all history"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <div className="space-y-px">
                  {historyDownloads.map(download => (
                    <div 
                      key={download.id}
                      className={download.isFolder ? 'bg-blue-500/5' : ''}
                    >
                      {renderHistoryItem(download)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {historyDownloads.length === 0 && activeDownloads.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-8">
                No download history
              </div>
            )}
          </div>
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
              : (() => {
                  const statusText = confirmDialog.status === 'completed' ? 'Downloaded' :
                                    confirmDialog.status === 'failed' ? 'Failed' :
                                    confirmDialog.status === 'cancelled' ? 'Cancelled' :
                                    confirmDialog.status || 'Unknown';
                  const itemType = confirmDialog.isFolder ? 'Folder' : 'File';
                  const itemName = confirmDialog.fileName || 'Unknown';
                  return `Are you sure you want to delete this download record?\n\n${itemType}: ${itemName}\nStatus: ${statusText}\n\nThe downloaded ${confirmDialog.isFolder ? 'folder' : 'file'} will not be deleted.`;
                })()
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

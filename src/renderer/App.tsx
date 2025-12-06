import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import FileExplorer from './components/FileExplorer';
import TitleBar from './components/TitleBar';
import DownloadManager from './components/DownloadManager';
import DownloadProgressDialog, { DownloadItem } from './components/DownloadProgressDialog';
import ResizablePanel from './components/ResizablePanel';
import Toast from './components/Toast';
import { useStore } from './store';

type DownloadProgressPayload = {
  id: string;
  status?: 'queued' | 'downloading' | 'cancelled' | 'failed' | 'completed';
  downloadedSize?: number;
  totalSize?: number;
  speed?: number;
  eta?: number;
  startTime?: number;
  endTime?: number;
  error?: string;
};

function App() {
  const loadSites = useStore((state) => state.loadSites);
  const loadDownloads = useStore((state) => state.loadDownloads);
  const downloads = useStore((state) => state.downloads);
  const updateDownload = useStore((state) => state.updateDownload);
  const removeDownload = useStore((state) => state.removeDownload);
  const clearHistory = useStore((state) => state.clearHistory);
  const cancelDownload = useStore((state) => state.cancelDownload);
  
  const showDownloadManager = useStore((state) => state.showDownloadManager);
  const setShowDownloadManager = useStore((state) => state.setShowDownloadManager);
  const downloadManagerWidth = useStore((state) => state.downloadManagerWidth);
  const setDownloadManagerWidth = useStore((state) => state.setDownloadManagerWidth);
  
  const [selectedDownloadId, setSelectedDownloadId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [cancellingDownloads, setCancellingDownloads] = useState<Set<string>>(new Set());
  const cancellingDownloadsRef = React.useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const processedCancellations = React.useRef<Set<string>>(new Set());
  const completedDownloadsRef = React.useRef<Set<string>>(new Set());
  const disconnectFailedDownloads = React.useRef<Set<string>>(new Set()); // Track downloads failed due to disconnect
  
  // Panel widths - use store for sidebar width so FileExplorer can access it
  const sidebarWidth = useStore((state) => state.sidebarWidth);
  const setSidebarWidth = useStore((state) => state.setSidebarWidth);

  const setTheme = useStore((state) => state.setTheme);

  useEffect(() => {
    // Load sites from database on app start
    loadSites();
    
    // Load download history from database on app start
    loadDownloads();
    
    // Load settings from database
    const loadSettings = useStore.getState().loadSettings;
    if (loadSettings) {
      loadSettings();
    }
    
    // Initialize theme from localStorage on mount
    const savedTheme = localStorage.getItem('macftp-theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      // Default to dark mode
      setTheme('dark');
    }
    
    // Listen for toast events from other components
    const handleToastEvent = (event: CustomEvent) => {
      setToast({ message: event.detail.message, type: event.detail.type });
    };
    
    window.addEventListener('show-toast', handleToastEvent as EventListener);
    
    return () => {
      window.removeEventListener('show-toast', handleToastEvent as EventListener);
    };
  }, [loadSites, loadDownloads, setTheme]);

  useEffect(() => {
    const electron = (window as any).electronAPI;
    if (!electron?.onDownloadProgress) {
      return;
    }

    const unsubscribe = electron.onDownloadProgress((payload: DownloadProgressPayload) => {
      if (!payload?.id) return;

      // Check if this download is already in a final state (cancelled/failed)
      const currentDownload = downloads.find(d => d.id === payload.id);
      if (currentDownload && (currentDownload.status === 'cancelled' || currentDownload.status === 'failed')) {
        console.log('[App] Ignoring update for already finished download:', payload.id, 'current status:', currentDownload.status, 'payload status:', payload.status);
        return;
      }
      
      // Track downloads failed due to disconnect (to suppress individual toasts)
      if (payload.status === 'failed' && (payload as any).error === 'Connection terminated by user') {
        disconnectFailedDownloads.current.add(payload.id);
      }

      // Check if this download is being cancelled - use ref for immediate access
      if (cancellingDownloadsRef.current.has(payload.id)) {
        console.log('[App] Blocking update for cancelling download, status:', payload.status);
        // Only allow final status updates to 'cancelled' or 'failed'
        if (payload.status === 'cancelled' || payload.status === 'failed') {
          console.log('[App] Allowing final status update:', payload.status);
          updateDownload(payload.id, { 
            status: payload.status, 
            downloadedSize: 0,
            speed: undefined,
            eta: undefined,
            error: payload.error || (payload as any).error,
            endTime: Date.now() 
          }, { persist: true });
        }
        // Block ALL other updates while cancelling (including localPath, fileName, etc.)
        return;
      }

      const updates: Partial<DownloadItem> = {
        downloadedSize: payload.downloadedSize ?? 0,
        speed: payload.speed,
        eta: payload.eta
      };

      if (payload.status) {
        updates.status = payload.status;
      }
      if (typeof payload.totalSize === 'number' && payload.totalSize > 0) {
        updates.totalSize = payload.totalSize;
      }
      if (payload.startTime) {
        updates.startTime = payload.startTime;
      }
      if (payload.endTime) {
        updates.endTime = payload.endTime;
      }
      if (payload.error !== undefined) {
        updates.error = payload.error;
      }
      if ((payload as any).actualFileName) {
        updates.fileName = (payload as any).actualFileName;
      }
      if ((payload as any).localPath) {
        updates.localPath = (payload as any).localPath;
      }
      if (typeof (payload as any).totalFiles === 'number') {
        updates.totalFiles = (payload as any).totalFiles;
      }
      if (typeof (payload as any).completedFiles === 'number') {
        updates.completedFiles = (payload as any).completedFiles;
      }

      updateDownload(payload.id, updates, { persist: false });
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [updateDownload]);

  const activeDownload = downloads.find(d => 
    d.status === 'downloading' || d.status === 'queued'
  );
  const selectedDownload = selectedDownloadId 
    ? downloads.find(d => d.id === selectedDownloadId)
    : null;

  // Track when downloads move to cancelled/failed state
  React.useEffect(() => {
    downloads.forEach(download => {
      // Check if this download just completed cancellation and we haven't processed it yet
      if ((download.status === 'cancelled' || download.status === 'failed') && 
          cancellingDownloadsRef.current.has(download.id) && 
          !processedCancellations.current.has(download.id)) {
        
        // Mark as processed to prevent duplicate handling
        processedCancellations.current.add(download.id);
        
        // Show toast notification (only once per cancellation)
        if (download.status === 'cancelled') {
          const message = download.isFolder 
            ? `Folder download cancelled: ${download.fileName}` 
            : `Download cancelled: ${download.fileName}`;
          setToast({ message, type: 'warning' });
        } else if (download.status === 'failed') {
          // Don't show individual toast for disconnect-related failures
          // A summary toast will be shown by Sidebar.tsx
          if (!disconnectFailedDownloads.current.has(download.id)) {
            const message = download.isFolder 
              ? `Folder download failed: ${download.fileName}` 
              : `Download failed: ${download.fileName}`;
            setToast({ message, type: 'error' });
          }
        }
        
        // Auto-dismiss dialog if this download is selected
        if (selectedDownloadId === download.id) {
          console.log('[App] Scheduling auto-dismiss for download:', download.id);
          const timer = setTimeout(() => {
            console.log('[App] Auto-dismissing dialog now');
            setSelectedDownloadId(null);
          }, 2000);
          // Store timer ref to prevent duplicate dismissals
          return () => clearTimeout(timer);
        }
        
        // Clean up cancelling state
        setTimeout(() => {
          cancellingDownloadsRef.current.delete(download.id);
          setCancellingDownloads(prev => {
            const next = new Set(prev);
            next.delete(download.id);
            return next;
          });
          // Clean up processed tracking after a delay
          setTimeout(() => {
            processedCancellations.current.delete(download.id);
          }, 5000);
        }, 2500);
      }
      
      // Show toast for completed downloads (including folders)
      if (download.status === 'completed' && download.endTime && !completedDownloadsRef.current.has(download.id)) {
        const now = Date.now();
        // Only show if completed within last 3 seconds (to avoid showing old completions on load)
        if (now - download.endTime < 3000) {
          completedDownloadsRef.current.add(download.id);
          const message = download.isFolder 
            ? `Folder downloaded: ${download.fileName} (${download.completedFiles || 0} files)` 
            : `Downloaded: ${download.fileName}`;
          setToast({ message, type: 'success' });
        }
      }
    });
  }, [downloads, selectedDownloadId]);

  const handleShowDetails = (id: string) => {
    setSelectedDownloadId(id);
  };

  const handleMinimizeToBackground = () => {
    setSelectedDownloadId(null);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
      <TitleBar 
        onToggleDownloadManager={() => setShowDownloadManager(!showDownloadManager)}
        showDownloadManager={showDownloadManager}
      />
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '32px' }}>
        <ResizablePanel
          defaultWidth={sidebarWidth}
          minWidth={150}
          maxWidth={600}
          position="left"
          onResize={setSidebarWidth}
          className="border-r border-border"
        >
          <Sidebar />
        </ResizablePanel>
        
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <FileExplorer />
        </div>
        
        {showDownloadManager && (
          <ResizablePanel
            defaultWidth={downloadManagerWidth}
            minWidth={200}
            maxWidth={800}
            position="right"
            onResize={setDownloadManagerWidth}
            className="border-l border-border"
          >
            <DownloadManager
              downloads={downloads}
              onCancel={(id) => {
                // Track that this download is being cancelled (use both state and ref)
                cancellingDownloadsRef.current.add(id);
                setCancellingDownloads(prev => new Set(prev).add(id));
                // Update download to show cancelling state immediately (keep localPath, only clear progress data)
                updateDownload(id, {
                  downloadedSize: 0,
                  speed: undefined,
                  eta: undefined
                  // DO NOT clear localPath - it should remain for the cancelled record
                }, { persist: false });
                // Use the store's cancelDownload which handles both files and folders
                cancelDownload(id);
              }}
              onRemove={removeDownload}
              onClearHistory={clearHistory}
              onShowDetails={handleShowDetails}
              showHistory={showHistory}
              onToggleHistory={() => setShowHistory(!showHistory)}
              cancellingDownloads={cancellingDownloads}
            />
          </ResizablePanel>
        )}
      </div>
      
      {/* Download Progress Dialog */}
      {selectedDownload && (
        <DownloadProgressDialog
          download={selectedDownload}
          onCancel={() => {
            // Track that this download is being cancelled (use both state and ref)
            cancellingDownloadsRef.current.add(selectedDownload.id);
            setCancellingDownloads(prev => new Set(prev).add(selectedDownload.id));
            // Update download to show cancelling state immediately (keep localPath, only clear progress data)
            updateDownload(selectedDownload.id, {
              downloadedSize: 0,
              speed: undefined,
              eta: undefined
              // DO NOT clear localPath - it should remain for the cancelled record
            }, { persist: false });
            // Use the store's cancelDownload which handles both files and folders
            cancelDownload(selectedDownload.id);
          }}
          onRemove={() => {
            removeDownload(selectedDownload.id);
            setSelectedDownloadId(null);
          }}
          showInBackground={handleMinimizeToBackground}
          isCancelling={cancellingDownloads.has(selectedDownload.id)}
        />
      )}
      
      {/* Show download manager button if there are active downloads */}
      {!showDownloadManager && activeDownload && (
        <button
          onClick={() => setShowDownloadManager(true)}
          className="fixed bottom-4 right-4 p-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:opacity-90 transition-opacity z-50"
          title="Show downloads"
        >
          <span className="text-sm font-medium">
            {downloads.filter(d => d.status === 'downloading' || d.status === 'queued').length}
          </span>
        </button>
      )}
      
      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          showDownloadManager={showDownloadManager}
          downloadManagerWidth={downloadManagerWidth}
        />
      )}
    </div>
  );
}

export default App;

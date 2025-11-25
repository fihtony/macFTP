import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import FileExplorer from './components/FileExplorer';
import TitleBar from './components/TitleBar';
import DownloadManager from './components/DownloadManager';
import DownloadProgressDialog from './components/DownloadProgressDialog';
import ResizablePanel from './components/ResizablePanel';
import { useStore } from './store';

function App() {
  const loadSites = useStore((state) => state.loadSites);
  const loadDownloads = useStore((state) => state.loadDownloads);
  const downloads = useStore((state) => state.downloads);
  const updateDownload = useStore((state) => state.updateDownload);
  const removeDownload = useStore((state) => state.removeDownload);
  const clearHistory = useStore((state) => state.clearHistory);
  const pauseDownload = useStore((state) => state.pauseDownload);
  const resumeDownload = useStore((state) => state.resumeDownload);
  const cancelDownload = useStore((state) => state.cancelDownload);
  
  const showDownloadManager = useStore((state) => state.showDownloadManager);
  const setShowDownloadManager = useStore((state) => state.setShowDownloadManager);
  const downloadManagerWidth = useStore((state) => state.downloadManagerWidth);
  const setDownloadManagerWidth = useStore((state) => state.setDownloadManagerWidth);
  
  const [selectedDownloadId, setSelectedDownloadId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  
  // Panel widths - use store for sidebar width so FileExplorer can access it
  const sidebarWidth = useStore((state) => state.sidebarWidth);
  const setSidebarWidth = useStore((state) => state.setSidebarWidth);

  const setTheme = useStore((state) => state.setTheme);

  useEffect(() => {
    // Load sites from database on app start
    loadSites();
    
    // Load download history from database on app start
    loadDownloads();
    
    // Initialize theme from localStorage on mount
    const savedTheme = localStorage.getItem('macftp-theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      // Default to dark mode
      setTheme('dark');
    }
  }, [loadSites, loadDownloads, setTheme]);

  const activeDownload = downloads.find(d => 
    d.status === 'downloading' || d.status === 'paused' || d.status === 'queued'
  );
  const selectedDownload = selectedDownloadId 
    ? downloads.find(d => d.id === selectedDownloadId)
    : null;

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
              onPause={pauseDownload}
              onResume={resumeDownload}
              onCancel={cancelDownload}
              onRemove={removeDownload}
              onClearHistory={clearHistory}
              onShowDetails={handleShowDetails}
              showHistory={showHistory}
              onToggleHistory={() => setShowHistory(!showHistory)}
            />
          </ResizablePanel>
        )}
      </div>
      
      {/* Download Progress Dialog */}
      {selectedDownload && (
        <DownloadProgressDialog
          download={selectedDownload}
          onCancel={() => cancelDownload(selectedDownload.id)}
          onPause={() => pauseDownload(selectedDownload.id)}
          onResume={() => resumeDownload(selectedDownload.id)}
          onRemove={() => {
            removeDownload(selectedDownload.id);
            setSelectedDownloadId(null);
          }}
          showInBackground={handleMinimizeToBackground}
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
            {downloads.filter(d => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused').length}
          </span>
        </button>
      )}
    </div>
  );
}

export default App;

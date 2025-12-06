import { create } from 'zustand';
import { DownloadItem } from './components/DownloadProgressDialog';

// Track previous download stats to avoid duplicate logs
let lastDownloadStats = { active: 0, queued: 0, downloading: 0 };

// Helper function to log download stats only when counts change
const logDownloadStatsIfChanged = (downloads: DownloadItem[]) => {
  const activeCount = downloads.filter(d => d.status === 'queued' || d.status === 'downloading').length;
  const queuedCount = downloads.filter(d => d.status === 'queued').length;
  const downloadingCount = downloads.filter(d => d.status === 'downloading').length;
  
  // Only log if any count changed
  if (activeCount !== lastDownloadStats.active || 
      queuedCount !== lastDownloadStats.queued || 
      downloadingCount !== lastDownloadStats.downloading) {
    // Only show "Downloading" if it's > 0 or if it changed from > 0
    const showDownloading = downloadingCount > 0 || lastDownloadStats.downloading > 0;
    if (showDownloading) {
      console.log('[Download Stats] Active:', activeCount, 'Queued:', queuedCount, 'Downloading:', downloadingCount);
    } else {
      console.log('[Download Stats] Active:', activeCount, 'Queued:', queuedCount);
    }
    lastDownloadStats = { active: activeCount, queued: queuedCount, downloading: downloadingCount };
  }
};

export interface Site {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyContent?: string; // SSH key content (alternative to path)
  protocol: 'ftp' | 'sftp';
  group?: string;
  initialPath?: string; // Initial folder path to navigate to after connection
  defaultDownloadPath?: string; // Default download path for this FTP server
}

export interface RemoteFile {
  name: string;
  type: 'd' | '-' | 'l';
  size: number;
  date: number;
  rights: any;
  owner: any;
  group: any;
}

interface UpdateOptions {
  persist?: boolean;
}

interface AppSettings {
  maxConcurrentDownloads: number;
  defaultConflictResolution: 'overwrite' | 'rename' | 'prompt';
  showHiddenFiles: boolean;
}

interface AppState {
  sites: Site[];
  addSite: (site: Site) => void;
  updateSite: (id: string, updates: Partial<Site>) => void;
  removeSite: (id: string) => void;
  loadSites: () => Promise<void>;
  saveSites: () => Promise<void>;
  
  isConnected: boolean;
  currentSite: Site | null; // Currently connected site
  currentPath: string;
  remoteFiles: RemoteFile[];
  isLoading: boolean;
  
  setConnected: (status: boolean) => void;
  setCurrentSite: (site: Site | null) => void;
  setCurrentPath: (path: string) => void;
  setRemoteFiles: (files: RemoteFile[]) => void;
  setLoading: (loading: boolean) => void;

  // Download queue and history
  downloads: DownloadItem[];
  addDownload: (download: DownloadItem) => void;
  updateDownload: (id: string, updates: Partial<DownloadItem>, options?: UpdateOptions) => void;
  removeDownload: (id: string) => void;
  clearHistory: () => void;
  cancelDownload: (id: string) => void;
  loadDownloads: () => Promise<void>;
  saveDownloads: () => Promise<void>;

  // Settings
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  loadSettings: () => Promise<void>;
  saveSettings: () => void;

  // Connection progress
  connectionProgress: {
    isConnecting: boolean;
    siteName?: string;
    host?: string;
  } | null;
  setConnectionProgress: (progress: AppState['connectionProgress']) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // Download Manager visibility (for Toast positioning)
  showDownloadManager: boolean;
  setShowDownloadManager: (show: boolean) => void;
  downloadManagerWidth: number;
  setDownloadManagerWidth: (width: number) => void;
  
  // Sidebar width (for preview positioning)
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  
  // Temporary preview file path (for cleanup on disconnect/quit)
  tempFilePath: string | null;
  setTempFilePath: (path: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  sites: [],
  addSite: (site) => {
    set((state) => ({ sites: [...state.sites, site] }));
    get().saveSites(); // Auto-save
  },
  updateSite: (id, updates) => {
    set((state) => {
      const updatedSites = state.sites.map(s => s.id === id ? { ...s, ...updates } : s);
      const updatedSite = updatedSites.find(s => s.id === id);
      
      // If site name or host was updated, update related downloads
      if (updatedSite && (updates.name !== undefined || updates.host !== undefined)) {
        const updatedDownloads = state.downloads.map(d => {
          if (d.siteId === id) {
            return {
              ...d,
              siteName: updatedSite.name,
              siteHost: updatedSite.host
            };
          }
          return d;
        });
        return {
          sites: updatedSites,
          downloads: updatedDownloads
        };
      }
      
      return { sites: updatedSites };
    });
    get().saveSites(); // Auto-save
    get().saveDownloads(); // Auto-save downloads if updated
  },
  removeSite: (id) => {
    set((state) => ({ sites: state.sites.filter(s => s.id !== id) }));
    get().saveSites(); // Auto-save
  },
  loadSites: async () => {
    const electron = (window as any).electronAPI;
    if (electron) {
      const result = await electron.loadSites();
      if (result.success) {
        set({ sites: result.sites || [] });
      }
    }
  },
  saveSites: async () => {
    const electron = (window as any).electronAPI;
    if (electron) {
      await electron.saveSites(get().sites);
    }
  },
  
  isConnected: false,
  currentSite: null,
  currentPath: '/',
  remoteFiles: [],
  isLoading: false,
  
  setConnected: (status) => set({ isConnected: status }),
  setCurrentSite: (site) => set({ currentSite: site }),
  setCurrentPath: (path) => set({ currentPath: path }),
  setRemoteFiles: (files) => set({ remoteFiles: files }),
  setLoading: (loading) => set({ isLoading: loading }),

  // Download management
  downloads: [],
  addDownload: (download) => {
    set((state) => {
      const exists = state.downloads.some(d => d.id === download.id);
      const isActive = download.status === 'queued' || download.status === 'downloading';
      const isHistory = download.status === 'completed' || download.status === 'failed' || download.status === 'cancelled';
      
      if (exists) {
        const existing = state.downloads.find(d => d.id === download.id);
        const wasActive = existing?.status === 'queued' || existing?.status === 'downloading';
        const wasHistory = existing?.status === 'completed' || existing?.status === 'failed' || existing?.status === 'cancelled';
        
        // Log if moving between active and history
        if (wasActive && !isActive) {
          console.log('[Download] Removed from active list:', { id: download.id, fileName: download.fileName, status: download.status });
        }
        if (!wasHistory && isHistory) {
          console.log('[Download] Added to history:', { id: download.id, fileName: download.fileName, status: download.status });
        }
        if (!wasActive && isActive) {
          console.log('[Download] Added to active list:', { id: download.id, fileName: download.fileName, status: download.status });
        }
      } else {
        if (isActive) {
          console.log('[Download] Added to active list:', { id: download.id, fileName: download.fileName, status: download.status, isFolder: download.isFolder });
        } else if (isHistory) {
          console.log('[Download] Added to history:', { id: download.id, fileName: download.fileName, status: download.status, isFolder: download.isFolder });
        }
      }
      
      const newDownloads = exists
        ? state.downloads.map(d => d.id === download.id ? { ...d, ...download } : d)
        : [...state.downloads, download];
      
      // Log stats only if counts changed
      logDownloadStatsIfChanged(newDownloads);
      
      return { downloads: newDownloads };
    });
    get().saveDownloads(); // Auto-save
  },
  updateDownload: (id, updates, options) => {
    set((state) => {
      const download = state.downloads.find(d => d.id === id);
      if (!download) return { downloads: state.downloads };
      
      const wasActive = download.status === 'queued' || download.status === 'downloading';
      const wasHistory = download.status === 'completed' || download.status === 'failed' || download.status === 'cancelled';
      
      const newDownloads = state.downloads.map(d => d.id === id ? { ...d, ...updates } : d);
      const updated = newDownloads.find(d => d.id === id)!;
      
      const isActive = updated.status === 'queued' || updated.status === 'downloading';
      const isHistory = updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled';
      
      // Log status changes
      if (updates.status && updates.status !== download.status) {
        // Moving from active to history
        if (wasActive && !isActive) {
          console.log('[Download] Removed from active list:', { id, fileName: updated.fileName, oldStatus: download.status, newStatus: updates.status });
        }
        // Moving to history
        if (!wasHistory && isHistory) {
          console.log('[Download] Added to history:', { id, fileName: updated.fileName, status: updates.status });
        }
        // Moving to active
        if (!wasActive && isActive) {
          console.log('[Download] Added to active list:', { id, fileName: updated.fileName, status: updates.status });
        }
      }
      
      // Log stats only when status changes (not on every progress update)
      if (updates.status && updates.status !== download.status) {
        logDownloadStatsIfChanged(newDownloads);
      }
      
      return { downloads: newDownloads };
    });
    if (options?.persist === false) {
      return;
    }
    get().saveDownloads(); // Auto-save
  },
  removeDownload: (id) => {
    set((state) => {
      const download = state.downloads.find(d => d.id === id);
      if (download) {
        const isActive = download.status === 'queued' || download.status === 'downloading';
        const isHistory = download.status === 'completed' || download.status === 'failed' || download.status === 'cancelled';
        
        if (isActive) {
          console.log('[Download] Removed from active list:', { id, fileName: download.fileName, status: download.status });
        } else if (isHistory) {
          console.log('[Download] Removed from history:', { id, fileName: download.fileName, status: download.status });
        }
      }
      
      const newDownloads = state.downloads.filter(d => d.id !== id);
      
      // Log stats only if counts changed
      logDownloadStatsIfChanged(newDownloads);
      
      return { downloads: newDownloads };
    });
    get().saveDownloads(); // Auto-save
  },
  cancelDownload: (id) => {
    const electron = (window as any).electronAPI;
    const download = get().downloads.find(d => d.id === id);
    
    if (download) {
      console.log('[User Action] Cancel download:', { id, fileName: download.fileName, isFolder: download.isFolder, status: download.status });
    }
    
    if (download?.isFolder) {
      // Use folder-specific cancel
      if (electron?.cancelDownloadFolder) {
        electron.cancelDownloadFolder(id);
      }
    } else {
      // Use regular file cancel
    if (electron?.cancelDownload) {
      electron.cancelDownload(id);
      }
    }
    
    // DON'T set status to cancelled immediately
    // Just clear the progress data and let the backend confirm the cancellation
    // This keeps the download in the active list while cancelling
    set((state) => ({
      downloads: state.downloads.map(d => 
        d.id === id && (d.status === 'downloading' || d.status === 'queued')
          ? { 
              ...d, 
              downloadedSize: 0,
              speed: undefined,
              eta: undefined
              // Status remains 'downloading' until backend confirms cancellation
            }
          : d
      )
    }));
    // Don't save yet - wait for backend confirmation
  },
  clearHistory: () => {
    set((state) => {
      const historyDownloads = state.downloads.filter(d => 
        d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled'
      );
      console.log('[User Action] Clear download history:', { count: historyDownloads.length });
      historyDownloads.forEach(d => {
        console.log('[Download] Removed from history:', { id: d.id, fileName: d.fileName, status: d.status });
      });
      
      const newDownloads = state.downloads.filter(d => 
        d.status === 'queued' || d.status === 'downloading'
      );
      
      // Log stats only if counts changed
      logDownloadStatsIfChanged(newDownloads);
      
      return { downloads: newDownloads };
    });
    get().saveDownloads(); // Auto-save
  },
  loadDownloads: async () => {
    const electron = (window as any).electronAPI;
    if (electron) {
      const result = await electron.loadDownloads();
      console.log('[Store] Loading downloads from database:', result);
      if (result.success && result.downloads) {
        console.log('[Store] Loaded', result.downloads.length, 'downloads from database');
        
        // Clean up any orphaned active downloads from previous session
        // (downloads that were active when app closed should be marked as failed)
        const cleanedDownloads = result.downloads.map((d: any) => {
          if (d.status === 'downloading' || d.status === 'queued') {
            console.log('[Store] Marking orphaned download as failed:', d.fileName);
            return {
              ...d,
              status: 'failed' as const,
              error: 'Download interrupted (app was closed)',
              downloadedSize: 0,
              speed: undefined,
              eta: undefined,
              endTime: Date.now()
            };
          }
          return d;
        });

        // De-duplicate by id (keep the last occurrence)
        const uniqueDownloads = Array.from(
          cleanedDownloads.reduce((map: Map<string, any>, d: any) => {
            map.set(d.id, d);
            return map;
          }, new Map<string, any>()).values()
        );
        
        set({ downloads: uniqueDownloads });
        
        // Save the cleaned downloads back to database
        if (cleanedDownloads.length !== uniqueDownloads.length ||
            cleanedDownloads.some((d: any, i: number) => d !== result.downloads[i])) {
          get().saveDownloads();
        }
      } else {
        console.warn('[Store] Failed to load downloads:', result.error);
      }
    }
  },
  saveDownloads: async () => {
    const electron = (window as any).electronAPI;
    if (electron) {
      const allDownloads = get().downloads;
      console.log('[Store] Saving', allDownloads.length, 'downloads to database');
      const result = await electron.saveDownloads(allDownloads);
      if (!result.success) {
        console.error('[Store] Failed to save downloads:', result.error);
      }
    }
  },

  // Connection progress
  connectionProgress: null,
  setConnectionProgress: (progress) => set({ connectionProgress: progress }),

  // Theme
  theme: 'dark', // Default to dark mode
  setTheme: (theme) => {
    set({ theme });
    // Apply theme to document root
    if (typeof window !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      // Save to localStorage
      localStorage.setItem('macftp-theme', theme);
    }
  },

  // Download Manager visibility (for Toast positioning)
  showDownloadManager: false,
  setShowDownloadManager: (show) => set({ showDownloadManager: show }),
  downloadManagerWidth: 320,
  setDownloadManagerWidth: (width) => set({ downloadManagerWidth: width }),
  
  // Sidebar width (for preview positioning)
  sidebarWidth: 256,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  
  // Temporary preview file path (for cleanup on disconnect/quit)
  tempFilePath: null,
  setTempFilePath: (path) => set({ tempFilePath: path }),
  
  // Settings
  settings: {
    maxConcurrentDownloads: 3,
    defaultConflictResolution: 'prompt',
    showHiddenFiles: false
  },
  
  updateSettings: (newSettings) => {
    set((state) => ({
      settings: { ...state.settings, ...newSettings }
    }));
    get().saveSettings();
    
    // If maxConcurrentDownloads changed, notify backend
    if (newSettings.maxConcurrentDownloads !== undefined) {
      const electron = (window as any).electronAPI;
      if (electron?.updateMaxDownloads) {
        electron.updateMaxDownloads(newSettings.maxConcurrentDownloads);
      }
    }
  },
  
  loadSettings: async () => {
    const electron = (window as any).electronAPI;
    if (electron?.loadSettings) {
      try {
        const settings = await electron.loadSettings();
        if (settings) {
          set({ settings });
          console.log('[Store] Loaded settings:', settings);
          
          // Update backend max downloads
          if (electron?.updateMaxDownloads) {
            electron.updateMaxDownloads(settings.maxConcurrentDownloads);
          }
        }
      } catch (err) {
        console.error('[Store] Failed to load settings:', err);
      }
    }
  },
  
  saveSettings: () => {
    const electron = (window as any).electronAPI;
    const settings = get().settings;
    console.log('[Store] Saving settings:', settings);
    if (electron?.saveSettings) {
      electron.saveSettings(settings);
    }
  }
}));


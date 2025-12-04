import { create } from 'zustand';
import { DownloadItem } from './components/DownloadProgressDialog';

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
    set((state) => ({ downloads: [...state.downloads, download] }));
    get().saveDownloads(); // Auto-save
  },
  updateDownload: (id, updates, options) => {
    set((state) => ({
      downloads: state.downloads.map(d => d.id === id ? { ...d, ...updates } : d)
    }));
    if (options?.persist === false) {
      return;
    }
    get().saveDownloads(); // Auto-save
  },
  removeDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.filter(d => d.id !== id)
    }));
    get().saveDownloads(); // Auto-save
  },
  cancelDownload: (id) => {
    const electron = (window as any).electronAPI;
    const download = get().downloads.find(d => d.id === id);
    
    if (download?.isFolder) {
      // Use folder-specific cancel
      if (electron?.cancelDownloadFolder) {
        console.log('[Store] Cancelling folder download:', id);
        electron.cancelDownloadFolder(id);
      }
    } else {
      // Use regular file cancel
      if (electron?.cancelDownload) {
        console.log('[Store] Cancelling file download:', id);
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
    set((state) => ({
      downloads: state.downloads.filter(d => 
        d.status === 'queued' || d.status === 'downloading'
      )
    }));
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
        
        set({ downloads: cleanedDownloads });
        
        // Save the cleaned downloads back to database
        if (cleanedDownloads.some((d: any, i: number) => d !== result.downloads[i])) {
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


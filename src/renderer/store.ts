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
  updateDownload: (id: string, updates: Partial<DownloadItem>) => void;
  removeDownload: (id: string) => void;
  clearHistory: () => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;

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
  updateDownload: (id, updates) => {
    set((state) => ({
      downloads: state.downloads.map(d => d.id === id ? { ...d, ...updates } : d)
    }));
    get().saveDownloads(); // Auto-save
  },
  removeDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.filter(d => d.id !== id)
    }));
    get().saveDownloads(); // Auto-save
  },
  pauseDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.map(d => 
        d.id === id && d.status === 'downloading' 
          ? { ...d, status: 'paused' as const }
          : d
      )
    }));
    get().saveDownloads(); // Auto-save
  },
  resumeDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.map(d => 
        d.id === id && d.status === 'paused' 
          ? { ...d, status: 'queued' as const }
          : d
      )
    }));
    get().saveDownloads(); // Auto-save
  },
  cancelDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.map(d => 
        d.id === id && (d.status === 'downloading' || d.status === 'paused' || d.status === 'queued')
          ? { ...d, status: 'cancelled' as const, endTime: Date.now() }
          : d
      )
    }));
    get().saveDownloads(); // Auto-save
  },
  clearHistory: () => {
    set((state) => ({
      downloads: state.downloads.filter(d => 
        d.status === 'queued' || d.status === 'downloading' || d.status === 'paused'
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
        set({ downloads: result.downloads || [] });
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
}));


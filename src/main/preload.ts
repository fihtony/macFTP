import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (config: any) => ipcRenderer.invoke('ftp:connect', config),
  disconnect: () => ipcRenderer.invoke('ftp:disconnect'),
  listDir: (path: string) => ipcRenderer.invoke('ftp:list', path),
  download: (remotePath: string, fileName: string) => ipcRenderer.invoke('ftp:download', { remotePath, fileName }),
  saveTempFile: (tempPath: string, fileName: string) => ipcRenderer.invoke('ftp:save-temp-file', { tempPath, fileName }),
  upload: (localPath: string, remotePath: string) => ipcRenderer.invoke('ftp:upload', { localPath, remotePath }),
  chmod: (path: string, mode: string) => ipcRenderer.invoke('ftp:chmod', { path, mode }),
  quickView: (remotePath: string) => ipcRenderer.invoke('ftp:quick-view', remotePath),
  previewFile: (remotePath: string, fileName: string) => ipcRenderer.invoke('ftp:preview-file', { remotePath, fileName }),
  cleanupTempFile: (tempPath: string) => ipcRenderer.invoke('ftp:cleanup-temp-file', tempPath),
  getPathSuggestions: (path: string) => ipcRenderer.invoke('ftp:get-path-suggestions', path),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  selectFile: (options: any) => ipcRenderer.invoke('dialog:selectFile', options),
  saveSites: (sites: any) => ipcRenderer.invoke('store:saveSites', sites),
  loadSites: () => ipcRenderer.invoke('store:loadSites'),
  saveDownloads: (downloads: any) => ipcRenderer.invoke('store:saveDownloads', downloads),
  loadDownloads: () => ipcRenderer.invoke('store:loadDownloads'),
});

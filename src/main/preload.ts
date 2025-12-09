import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (config: any) => ipcRenderer.invoke('ftp:connect', config),
  disconnect: () => ipcRenderer.invoke('ftp:disconnect'),
  listDir: (path: string) => ipcRenderer.invoke('ftp:list', path),
  download: (remotePath: string, fileName: string, downloadId?: string, totalSize?: number, defaultDownloadPath?: string, duplicateAction?: 'overwrite' | 'rename' | 'skip', applyToAll?: boolean, defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt') =>
    ipcRenderer.invoke('ftp:download', { remotePath, fileName, downloadId, totalSize, defaultDownloadPath, duplicateAction, applyToAll, defaultConflictResolution }),
  saveTempFile: (tempPath: string, fileName: string) => ipcRenderer.invoke('ftp:save-temp-file', { tempPath, fileName }),
  upload: (localPath: string, remotePath: string, uploadId?: string, defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt') => 
    ipcRenderer.invoke('ftp:upload', { localPath, remotePath, uploadId, defaultConflictResolution }),
  checkRemoteExists: (remotePath: string) => ipcRenderer.invoke('ftp:check-exists', remotePath),
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
  saveSettings: (settings: any) => ipcRenderer.invoke('store:saveSettings', settings),
  loadSettings: () => ipcRenderer.invoke('store:loadSettings'),
  updateMaxDownloads: (maxDownloads: number) => ipcRenderer.invoke('settings:update-max-downloads', maxDownloads),
  onDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  cancelDownload: (downloadId: string) => ipcRenderer.invoke('download:cancel', { downloadId }),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (err) {
      console.error('[preload] Failed to get path for file:', err);
      return undefined;
    }
  },
  deleteEntry: (targetPath: string, isDirectory: boolean) => ipcRenderer.invoke('ftp:delete-entry', { targetPath, isDirectory }),
  createDirectory: (targetPath: string) => ipcRenderer.invoke('ftp:create-directory', { targetPath }),
  getPathInfo: (targetPath: string) => ipcRenderer.invoke('fs:path-info', { targetPath }),
  collectFolderFiles: (folderPath: string, baseRemotePath: string) => ipcRenderer.invoke('fs:collect-folder-files', { folderPath, baseRemotePath }),
  uploadFolder: (localPath: string, remotePath: string, defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt') => 
    ipcRenderer.invoke('ftp:upload-folder', { localPath, remotePath, defaultConflictResolution }),
  downloadFolder: (remotePath: string, folderName: string, downloadId: string, defaultDownloadPath?: string, duplicateAction?: 'overwrite' | 'rename' | 'skip', applyToAll?: boolean, defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt') => 
    ipcRenderer.invoke('ftp:download-folder', { remotePath, folderName, downloadId, defaultDownloadPath, duplicateAction, applyToAll, defaultConflictResolution }),
  cancelDownloadFolder: (downloadId: string) => ipcRenderer.invoke('download-folder:cancel', { downloadId }),
  onUploadProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('upload:progress', handler);
    return () => ipcRenderer.removeListener('upload:progress', handler);
  },
  onDownloadFolderProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('download-folder:progress', handler);
    return () => ipcRenderer.removeListener('download-folder:progress', handler);
  },
  pauseUpload: (uploadId: string) => ipcRenderer.invoke('upload:pause', { uploadId }),
  resumeUpload: (uploadId: string) => ipcRenderer.invoke('upload:resume', { uploadId }),
  cancelUpload: (uploadId: string) => ipcRenderer.invoke('upload:cancel', { uploadId }),
  handleUploadDuplicate: (params: { remotePath: string; fileName: string; duplicateAction?: 'overwrite' | 'rename' | 'skip'; applyToAll?: boolean; defaultConflictResolution?: 'overwrite' | 'rename' | 'prompt' }) =>
    ipcRenderer.invoke('upload:handle-duplicate', params),
  
  // Open external links
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
});

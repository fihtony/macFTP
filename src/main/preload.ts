import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (config: any) => ipcRenderer.invoke('ftp:connect', config),
  disconnect: () => ipcRenderer.invoke('ftp:disconnect'),
  listDir: (path: string) => ipcRenderer.invoke('ftp:list', path),
  download: (remotePath: string, fileName: string, downloadId?: string, totalSize?: number, defaultDownloadPath?: string, duplicateAction?: 'overwrite' | 'rename' | 'skip', applyToAll?: boolean) =>
    ipcRenderer.invoke('ftp:download', { remotePath, fileName, downloadId, totalSize, defaultDownloadPath, duplicateAction, applyToAll }),
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
  uploadFolder: (localPath: string, remotePath: string) => ipcRenderer.invoke('ftp:upload-folder', { localPath, remotePath }),
  onUploadProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('upload:progress', handler);
    return () => ipcRenderer.removeListener('upload:progress', handler);
  },
  pauseUpload: (uploadId: string) => ipcRenderer.invoke('upload:pause', { uploadId }),
  resumeUpload: (uploadId: string) => ipcRenderer.invoke('upload:resume', { uploadId }),
  cancelUpload: (uploadId: string) => ipcRenderer.invoke('upload:cancel', { uploadId }),
});

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { File, Folder, ArrowUp, RefreshCw, Download, Eye, X, Upload, Info, Edit3, Loader2, Save, Search, ZoomIn, ZoomOut, Maximize2, Minimize2, Trash2, FolderPlus } from 'lucide-react';
import { useStore, RemoteFile } from '../store';
import { DownloadItem } from './DownloadProgressDialog';
import { format } from 'date-fns';
import clsx from 'clsx';
import Toast from './Toast';

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (timestamp: number) => {
  if (!timestamp) return 'Unknown';
  try {
    return format(new Date(timestamp), 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return 'Invalid date';
  }
};

const getFileType = (fileName: string, type: string) => {
  if (type === 'd') return 'Directory';
  const ext = fileName.split('.').pop()?.toUpperCase() || 'File';
  return ext + ' file';
};

type UploadStatus = 'starting' | 'uploading' | 'paused' | 'completed' | 'cancelled' | 'failed';

interface FolderUploadRequest {
  folderName: string;
  localPath: string;
  remotePath: string;
}

interface UploadTaskState {
  id: string;
  status: UploadStatus;
  uploadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentFile?: string;
  currentFileUploaded?: number;
  currentFileSize?: number;
  speed?: number;
  folderName?: string;
  cancelRequested?: boolean;
}

interface DeleteDialogState {
  file: RemoteFile | null;
  requireRecursiveConfirm: boolean;
  confirmChecked: boolean;
  loading: boolean;
  isDeleting: boolean;
}

const UPLOAD_FINAL_STATUSES: UploadStatus[] = ['completed', 'failed', 'cancelled'];

const FileExplorer = () => {
  const { currentPath, remoteFiles, isLoading, setCurrentPath, setRemoteFiles, setLoading, isConnected, currentSite } = useStore();
  const addDownload = useStore((state) => state.addDownload);
  const updateDownload = useStore((state) => state.updateDownload);
  const removeDownload = useStore((state) => state.removeDownload);
  const downloads = useStore((state) => state.downloads);
  const showDownloadManager = useStore((state) => state.showDownloadManager);
  const downloadManagerWidth = useStore((state) => state.downloadManagerWidth);
  const sidebarWidth = useStore((state) => state.sidebarWidth || 256);
  const tempFilePath = useStore((state) => state.tempFilePath);
  const setTempFilePath = useStore((state) => state.setTempFilePath);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [propertiesFile, setPropertiesFile] = useState<RemoteFile | null>(null);
  const [newPermissions, setNewPermissions] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState<string>('');
  const [showPathSuggestions, setShowPathSuggestions] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null); // Now stores base64 data URL
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const [previewRemotePath, setPreviewRemotePath] = useState<string | null>(null);
  const [previewFileInfo, setPreviewFileInfo] = useState<RemoteFile | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [searchText, setSearchText] = useState<string>('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [imageScale, setImageScale] = useState<'fit' | '1:1' | number>('fit');
  const [originalImageSize, setOriginalImageSize] = useState<{ width: number; height: number } | null>(null);
  const [folderUploadQueue, setFolderUploadQueue] = useState<FolderUploadRequest[]>([]);
  const [activeUpload, setActiveUpload] = useState<UploadTaskState | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<'overwrite' | 'rename' | 'skip' | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const deleteDialogInitialState: DeleteDialogState = {
    file: null,
    requireRecursiveConfirm: false,
    confirmChecked: false,
    loading: false,
    isDeleting: false
  };
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(deleteDialogInitialState);
  const textPreviewRef = useRef<HTMLPreElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const handleNavigate = useCallback(async (path: string) => {
    setLoading(true);
    const electron = (window as any).electronAPI;
    if (electron) {
        const result = await electron.listDir(path);
        setLoading(false);
        if (result.success) {
            setCurrentPath(path);
            setRemoteFiles(result.files);
            setSelectedFile(null); // Clear selection on navigate
        } else {
            alert('Error listing directory: ' + result.error);
        }
    }
  }, [setLoading, setCurrentPath, setRemoteFiles]);

  const handleClosePreview = useCallback((options?: { skipToast?: boolean; toastMessage?: string }) => {
    const { skipToast, toastMessage } = options || {};
    const fileType = previewImage ? 'image' : 'text';
    const electron = (window as any).electronAPI;
    const notify = (message: string, type: 'success' | 'info' = 'info') => {
      if (!skipToast) {
        setToast({ message: toastMessage || message, type });
      }
    };

    if (tempFilePath && electron) {
      electron.cleanupTempFile(tempFilePath).then(() => {
        notify(`Preview temporary ${fileType} file deleted`, 'success');
      }).catch((err: any) => {
        console.error('Failed to cleanup temp file:', err);
        notify(`Preview ${fileType} file closed`, 'info');
      });
    } else if (!skipToast) {
      notify(`Preview ${fileType} file closed`, 'info');
    }

    setPreviewImage(null);
    setPreviewContent(null);
    setPreviewFile(null);
    setTempFilePath(null);
    setPreviewFileName(null);
    setPreviewRemotePath(null);
    setPreviewFileInfo(null);
    setSearchText('');
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
    setImageScale('fit');
    setOriginalImageSize(null);
  }, [previewImage, tempFilePath, setToast]);

  const handleItemClick = (file: RemoteFile) => {
      setSelectedFile(file.name);
  };

  const previewFileHandler = useCallback(async (file: RemoteFile) => {
    if (file.type === 'd') {
      setLoading(true);
        const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        handleNavigate(newPath);
      return;
    }

    const fileName = file.name.toLowerCase();
    const textExtensions = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.log', '.conf', '.ini', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.gitignore'];
    const isTextFile = textExtensions.some(ext => fileName.endsWith(ext)) || file.name.startsWith('.');
    const isImageFile = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'].some(ext => fileName.endsWith(ext));

    const electron = (window as any).electronAPI;
    if (!electron) {
      console.error('Electron API not available');
      return;
    }

    const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    console.log('Attempting to preview file:', file.name, 'Path:', remotePath);
    console.log('File type check - isText:', isTextFile, 'isImage:', isImageFile);

    setLoading(true);
    try {
      const result = await electron.previewFile(remotePath, file.name);
      setLoading(false);

      if (result.success) {
        const fileRemotePath = remotePath;
        setPreviewFileInfo(file);
        if (result.imageDataUrl) {
          setPreviewImage(result.imageDataUrl);
          setTempFilePath(result.tempPath);
          setPreviewFileName(file.name);
          setPreviewRemotePath(fileRemotePath);
        } else if (result.data) {
          setPreviewFile(file.name);
          setPreviewContent(result.data);
          setPreviewFileName(file.name);
          setPreviewRemotePath(fileRemotePath);
          if (result.tempPath) {
            setTempFilePath(result.tempPath);
          }
          setSearchText('');
          setSearchMatches([]);
          setCurrentMatchIndex(-1);
        } else {
          console.error('Preview result mismatch - no imageDataUrl or data:', result);
          alert('Preview not available for this file type. File: ' + file.name + '. Check console for details.');
          handleClosePreview({ skipToast: true });
        }
      } else {
        console.error('Preview failed:', result.error);
        alert('Preview failed: ' + (result.error || 'Unknown error'));
        handleClosePreview({ skipToast: true });
      }
    } catch (err: any) {
      setLoading(false);
      console.error('Preview error:', err);
      alert('Preview error: ' + err.message);
      handleClosePreview({ skipToast: true });
    }
  }, [currentPath, handleNavigate, handleClosePreview, setLoading, setTempFilePath]);

  const handleItemDoubleClick = async (file: RemoteFile) => {
    previewFileHandler(file);
  };

  const buildRemotePath = (name: string) => currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;

  const enqueueFolderUpload = useCallback((request: FolderUploadRequest) => {
    setFolderUploadQueue((prev) => [...prev, request]);
  }, []);

  const handleFolderDownload = async (file: RemoteFile, remotePath: string) => {
    const electron = (window as any).electronAPI;
    if (!electron) return;

    // Get default download path from current site
    const defaultDownloadPath = currentSite?.defaultDownloadPath;
    const actionToUse = applyToAll ? duplicateAction : null;
    
    // Create download item first - MUST be 'queued' status to show clock icon
    const downloadId = `folder-download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const downloadItem: DownloadItem = {
      id: downloadId,
      fileName: file.name,
      remotePath: remotePath,
      localPath: '', // Will be set after path is determined
      totalSize: 0,
      downloadedSize: 0,
      status: 'queued', // Important: Start as queued to show yellow clock icon
      startTime: Date.now(),
      siteName: currentSite?.name,
      siteHost: currentSite?.host,
      siteId: currentSite?.id,
      isFolder: true,
      totalFiles: 0,
      completedFiles: 0
    };

    addDownload(downloadItem);
    
    // Start folder download (backend will handle duplicate detection and dialog)
    try {
      const response = await electron.downloadFolder(
        remotePath, 
        file.name, 
        downloadId,
        defaultDownloadPath,
        actionToUse || undefined,
        applyToAll
      );
      
      if (response?.dialogCancelled) {
        removeDownload(downloadId);
        return;
      }
      
      if (response?.skipped) {
        removeDownload(downloadId);
        setToast({ message: `Folder download skipped: ${file.name}`, type: 'info' });
        return;
      }
      
      if (!response?.success) {
        updateDownload(downloadId, {
          status: 'failed',
          error: response?.error || 'Unknown error',
          endTime: Date.now()
        });
        setToast({ message: `Failed to start folder download: ${response?.error || 'Unknown error'}`, type: 'error' });
        return;
      }
      
      // Update duplicate action preferences if user chose "apply to all"
      if (response.applyToAll && response.duplicateAction) {
        setDuplicateAction(response.duplicateAction);
        setApplyToAll(true);
      }
      
      // Update local path and actual folder name (might be renamed)
      // DO NOT change status to 'downloading' here - let the backend control status
      if (response.savedPath) {
        const updates: any = {
          localPath: response.savedPath
          // Status remains 'queued' - backend will update to 'downloading' when it actually starts
        };
        
        // Update folder name if it was renamed
        if (response.actualFileName && response.actualFileName !== file.name) {
          updates.fileName = response.actualFileName;
        }
        
        updateDownload(downloadId, updates);
      }
      
      console.log('[FileExplorer] Folder download started:', { 
        downloadId, 
        savedPath: response.savedPath,
        actualFileName: response.actualFileName 
      });
    } catch (err: any) {
      updateDownload(downloadId, {
        status: 'failed',
        error: err.message || 'Unknown error',
        endTime: Date.now()
      });
      setToast({ message: `Failed to start folder download: ${err.message || 'Unknown error'}`, type: 'error' });
    }
  };

  const initiateFolderUpload = useCallback(async (request: FolderUploadRequest) => {
    const electron = (window as any).electronAPI;
    if (!electron) return;
    try {
      const response = await electron.uploadFolder(request.localPath, request.remotePath);
      if (!response?.success) {
        setToast({ message: `Failed to start folder upload: ${response?.error || 'Unknown error'}`, type: 'error' });
        setActiveUpload(null);
        return;
      }
      setActiveUpload({
        id: response.uploadId,
        status: 'starting',
        uploadedBytes: 0,
        totalBytes: 0,
        completedFiles: 0,
        totalFiles: 0,
        currentFile: '',
        currentFileUploaded: 0,
        currentFileSize: 0,
        speed: 0,
        folderName: request.folderName
      });
    } catch (err: any) {
      setToast({ message: `Failed to start folder upload: ${err.message || 'Unknown error'}`, type: 'error' });
      setActiveUpload(null);
    }
  }, [setToast]);

  const submitCreateFolder = async () => {
    const sanitized = newFolderName.trim().replace(/[/\\]+/g, '');
    if (!sanitized) {
      setToast({ message: 'Folder name cannot be empty', type: 'error' });
      return;
    }
    setIsCreateFolderModalOpen(false);
    setNewFolderName('');
    const electron = (window as any).electronAPI;
    if (!electron) return;
    const targetPath = buildRemotePath(sanitized);
    setLoading(true);
    try {
      const result = await electron.createDirectory(targetPath);
      setLoading(false);
      if (result.success) {
        setToast({ message: `Folder "${sanitized}" created`, type: 'success' });
        handleNavigate(currentPath);
      } else {
        setToast({ message: `Failed to create folder: ${result.error || 'Unknown error'}`, type: 'error' });
      }
    } catch (err: any) {
      setLoading(false);
      setToast({ message: `Failed to create folder: ${err.message || 'Unknown error'}`, type: 'error' });
    }
  };
  const handleCreateFolder = () => {
    setNewFolderName('');
    setIsCreateFolderModalOpen(true);
  };

  const openDeleteDialog = async (file: RemoteFile) => {
    const electron = (window as any).electronAPI;
    if (file.type !== 'd') {
      setDeleteDialog({
        file,
        requireRecursiveConfirm: false,
        confirmChecked: true,
        loading: false,
        isDeleting: false
      });
      return;
    }

    setDeleteDialog({
      file,
      requireRecursiveConfirm: false,
      confirmChecked: false,
      loading: true,
      isDeleting: false
    });

    if (!electron) {
      setDeleteDialog({
        file,
        requireRecursiveConfirm: true,
        confirmChecked: false,
        loading: false,
        isDeleting: false
      });
      return;
    }

    try {
      const targetPath = buildRemotePath(file.name);
      const result = await electron.listDir(targetPath);
      const hasChildren = !(result.success && result.files.length === 0);
      setDeleteDialog({
        file,
        requireRecursiveConfirm: hasChildren,
        confirmChecked: !hasChildren,
        loading: false,
        isDeleting: false
      });
    } catch {
      setDeleteDialog({
        file,
        requireRecursiveConfirm: true,
        confirmChecked: false,
        loading: false,
        isDeleting: false
      });
    }
  };

  const closeDeleteDialog = () => {
    setDeleteDialog(deleteDialogInitialState);
  };

  const executeDelete = async () => {
    if (!deleteDialog.file) return;
    const electron = (window as any).electronAPI;
    if (!electron) return;
    const targetPath = buildRemotePath(deleteDialog.file.name);
    setDeleteDialog((prev) => ({ ...prev, isDeleting: true }));
    try {
      const result = await electron.deleteEntry(targetPath, deleteDialog.file.type === 'd');
      setDeleteDialog(deleteDialogInitialState);
      if (result.success) {
        setToast({ message: `"${deleteDialog.file.name}" deleted`, type: 'success' });
        handleNavigate(currentPath);
      } else {
        setToast({ message: `Failed to delete: ${result.error || 'Unknown error'}`, type: 'error' });
      }
    } catch (err: any) {
      setToast({ message: `Failed to delete: ${err.message || 'Unknown error'}`, type: 'error' });
      setDeleteDialog(deleteDialogInitialState);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedFile) {
      setToast({ message: 'Select a file or folder first', type: 'info' });
      return;
    }
    const file = remoteFiles.find(f => f.name === selectedFile);
    if (!file) return;
    openDeleteDialog(file);
  };

  const handlePauseUpload = async () => {
    if (!activeUpload || UPLOAD_FINAL_STATUSES.includes(activeUpload.status) || activeUpload.status === 'paused') return;
    const electron = (window as any).electronAPI;
    if (!electron) return;
    await electron.pauseUpload(activeUpload.id);
  };

  const handleResumeUpload = async () => {
    if (!activeUpload || UPLOAD_FINAL_STATUSES.includes(activeUpload.status) || activeUpload.status !== 'paused') return;
    const electron = (window as any).electronAPI;
    if (!electron) return;
    await electron.resumeUpload(activeUpload.id);
  };

  const handleCancelUpload = async () => {
    if (!activeUpload || UPLOAD_FINAL_STATUSES.includes(activeUpload.status)) return;
    setActiveUpload((prev) => (prev ? { ...prev, cancelRequested: true } : prev));
    setToast({ message: 'Cancelling upload…', type: 'warning' });
    const electron = (window as any).electronAPI;
    if (!electron) return;
    await electron.cancelUpload(activeUpload.id);
  };

  const handleUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const newPath = '/' + parts.join('/');
    handleNavigate(newPath);
  };

  // Search functionality for text preview
  const handleSearch = useCallback((text: string) => {
    if (!text || !previewContent) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches: number[] = [];
    let match;
    const content = previewContent;
    
    while ((match = regex.exec(content)) !== null) {
      matches.push(match.index);
    }
    
    setSearchMatches(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [previewContent]);

  // Image zoom functions
  const handleImageZoom = useCallback((action: 'fit' | '1:1' | 'in' | 'out') => {
    if (action === 'fit') {
      setImageScale('fit');
    } else if (action === '1:1') {
      setImageScale('1:1');
    } else if (action === 'in') {
      setImageScale(prev => {
        if (prev === 'fit' || prev === '1:1') return 1.5;
        return Math.min(prev as number * 1.2, 5); // Max 5x zoom
      });
    } else if (action === 'out') {
      setImageScale(prev => {
        if (prev === 'fit' || prev === '1:1') return 0.8;
        return Math.max(prev as number / 1.2, 0.1); // Min 0.1x zoom
      });
    }
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setOriginalImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    console.log('Image loaded successfully, original size:', img.naturalWidth, 'x', img.naturalHeight);
  }, []);

  useEffect(() => {
    handleSearch(searchText);
  }, [searchText, handleSearch]);

  useEffect(() => {
    if (folderUploadQueue.length === 0) return;
    if (activeUpload && !UPLOAD_FINAL_STATUSES.includes(activeUpload.status)) return;
    const [next, ...rest] = folderUploadQueue;
    if (!next) return;
    setFolderUploadQueue(rest);
    initiateFolderUpload(next);
  }, [folderUploadQueue, activeUpload, initiateFolderUpload]);

  useEffect(() => {
    const electron = (window as any).electronAPI;
    if (!electron?.onUploadProgress) return;
    const unsubscribe = electron.onUploadProgress((payload: any) => {
      setActiveUpload((prev) => {
        if (!prev || prev.id !== payload.uploadId) {
          return prev;
        }
        const next: UploadTaskState = {
          ...prev,
          status: payload.status as UploadStatus,
          uploadedBytes: typeof payload.uploadedBytes === 'number' ? payload.uploadedBytes : prev.uploadedBytes,
          totalBytes: typeof payload.totalBytes === 'number' ? payload.totalBytes : prev.totalBytes,
          completedFiles: typeof payload.completedFiles === 'number' ? payload.completedFiles : prev.completedFiles,
          totalFiles: typeof payload.totalFiles === 'number' ? payload.totalFiles : prev.totalFiles,
          currentFile: payload.currentFile ?? prev.currentFile,
          currentFileSize: typeof payload.currentFileSize === 'number' ? payload.currentFileSize : prev.currentFileSize,
          currentFileUploaded: typeof payload.currentFileUploaded === 'number' ? payload.currentFileUploaded : prev.currentFileUploaded,
          speed: typeof payload.speed === 'number' ? payload.speed : prev.speed,
          cancelRequested: prev.cancelRequested
        };

        if (['completed', 'failed', 'cancelled'].includes(payload.status)) {
          const status = payload.status as UploadStatus;
          if (status === 'completed') {
            setToast({ message: 'Folder upload completed', type: 'success' });
          } else if (status === 'failed') {
            setToast({ message: `Folder upload failed: ${payload.error || 'Unknown error'}`, type: 'error' });
          } else {
            setToast({ message: 'Folder upload cancelled', type: 'warning' });
          }
          handleNavigate(currentPath);
          setTimeout(() => {
            setActiveUpload(null);
          }, 2000);
        }

        return next;
      });
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [handleNavigate, currentPath, setToast]);


  const scrollToMatch = useCallback((index: number) => {
    if (index < 0 || index >= searchMatches.length || !previewContent || !searchText) return;
    
    // Use a timeout to ensure DOM is updated and highlighted matches are rendered
    setTimeout(() => {
      const contentElement = textPreviewRef.current;
      if (!contentElement) return;
      
      const matchPos = searchMatches[index];
      
      // Try to find the marked element for current match
      const marks = contentElement.querySelectorAll('mark');
      let targetMark: HTMLElement | null = null;
      let markIndex = 0;
      
      // Calculate which mark corresponds to the current match
      if (searchText && previewContent) {
        const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        let matchCount = 0;
        let match;
        let lastIndex = 0;
        
        while ((match = regex.exec(previewContent)) !== null) {
          if (match.index === matchPos) {
            // This is our match
            if (marks[markIndex]) {
              targetMark = marks[markIndex] as HTMLElement;
            }
            break;
          }
          markIndex++;
          matchCount++;
        }
      }
      
      if (targetMark) {
        // Scroll to the marked element
        const rect = targetMark.getBoundingClientRect();
        const containerRect = contentElement.getBoundingClientRect();
        
        // Calculate scroll position to bring match into view
        const offsetTop = rect.top - containerRect.top + contentElement.scrollTop;
        const scrollPosition = offsetTop - (containerRect.height / 2) + (rect.height / 2);
        
        contentElement.scrollTo({
          top: Math.max(0, scrollPosition),
          behavior: 'smooth'
        });
      } else {
        // Fallback: calculate based on text position
        const textBeforeMatch = previewContent.substring(0, matchPos);
        const lineNumber = (textBeforeMatch.match(/\n/g) || []).length;
        const lineHeight = 16; // Approximate line height for monospace font
        const scrollPosition = lineNumber * lineHeight - (contentElement.clientHeight / 2) + 50;
        
        contentElement.scrollTo({
          top: Math.max(0, scrollPosition),
          behavior: 'smooth'
        });
      }
    }, 200); // Increased timeout to ensure DOM is fully updated
  }, [searchMatches, previewContent, searchText]);

  const handleNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    scrollToMatch(nextIndex);
  }, [searchMatches.length, currentMatchIndex, scrollToMatch]);

  const handlePrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prevIndex = currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
    setCurrentMatchIndex(prevIndex);
    scrollToMatch(prevIndex);
  }, [searchMatches.length, currentMatchIndex, scrollToMatch]);

  // Scroll to current match when index changes
  useEffect(() => {
    if (currentMatchIndex >= 0 && searchMatches.length > 0) {
      scrollToMatch(currentMatchIndex);
    }
  }, [currentMatchIndex, searchMatches.length, scrollToMatch]);

  // Generate path suggestions asynchronously - supports multi-level paths
  const generatePathSuggestions = useCallback(async (inputPath: string) => {
    if (!inputPath || inputPath === '/') {
      setPathSuggestions([]);
      return;
    }

    setIsLoadingSuggestions(true);
    const suggestions: string[] = [];
    const endsWithSlash = inputPath.endsWith('/');
    const startsWithSlash = inputPath.startsWith('/');
    const parts = inputPath.split('/').filter(Boolean);
    
    try {
      // Only suggest from current directory if:
      // 1. Input doesn't start with '/' (relative path)
      // 2. Input is not a multi-level path
      // 3. Input doesn't end with '/' (which means we should show all folders in that directory)
      if (!startsWithSlash && !endsWithSlash && parts.length <= 1) {
        // First, suggest from current directory (for single-level relative paths)
        const currentDirLower = currentPath.toLowerCase();
        const inputLower = inputPath.toLowerCase();
        
        remoteFiles.forEach(file => {
          if (file.type === 'd') {
            const fileLower = file.name.toLowerCase();
            const currentDir = currentPath === '/' ? '' : currentPath;
            const suggestionPath = `${currentDir}/${file.name}`.replace('//', '/');
            
            // Check if matches current input
            if (inputLower.includes(fileLower) || fileLower.includes(inputLower.split('/').pop() || '')) {
              if (!suggestions.includes(suggestionPath)) {
                suggestions.push(suggestionPath);
              }
            }
          }
        });
      }

      // For absolute paths (starting with '/'), multi-level paths, or paths ending with '/', 
      // get suggestions from that directory using API
      if (startsWithSlash || endsWithSlash || parts.length > 1) {
        // Use dedicated suggestion API (non-blocking)
    const electron = (window as any).electronAPI;
    if (electron) {
          // Fetch suggestions asynchronously without blocking UI
          electron.getPathSuggestions(inputPath).then((result: any) => {
            if (result.success && result.suggestions) {
              // If path ends with '/' or starts with '/', use only API suggestions (don't merge with current dir)
              // Otherwise, merge with current suggestions
              const merged = (endsWithSlash || startsWithSlash)
                ? result.suggestions.slice(0, 8)
                : [...suggestions, ...result.suggestions]
                    .filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
                    .slice(0, 8);
              setPathSuggestions(merged);
            } else {
              // If API call failed but we have local suggestions, use them
              if (!startsWithSlash && !endsWithSlash && suggestions.length > 0) {
                setPathSuggestions(suggestions.slice(0, 8));
              } else {
                setPathSuggestions([]);
              }
            }
            setIsLoadingSuggestions(false);
          }).catch(() => {
            // Ignore errors, keep current suggestions if available
            if (!startsWithSlash && !endsWithSlash && suggestions.length > 0) {
              setPathSuggestions(suggestions.slice(0, 8));
            } else {
              setPathSuggestions([]);
            }
            setIsLoadingSuggestions(false);
          });
          // For paths starting with '/' or ending with '/', don't show local suggestions immediately
          // Wait for API response (loading state will be set in promise handlers)
          if (startsWithSlash || endsWithSlash) {
            return; // Return early, wait for API response
          }
        }
      }
      
      setPathSuggestions(suggestions.slice(0, 8));
    } catch (e) {
      // Error handling
      setPathSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [currentPath, remoteFiles]);
  
  // Debounce path suggestion generation
  React.useEffect(() => {
    if (!isEditingPath) return;
    
    const timer = setTimeout(() => {
      if (pathInput) {
        generatePathSuggestions(pathInput);
      } else {
        setPathSuggestions([]);
      }
    }, 200); // 200ms debounce
    
    return () => clearTimeout(timer);
  }, [pathInput, isEditingPath, generatePathSuggestions]);

  const handlePathSubmit = async (path: string) => {
    const normalizedPath = path.trim() || '/';
    if (normalizedPath !== currentPath) {
      await handleNavigate(normalizedPath);
    }
    setIsEditingPath(false);
    setPathInput('');
    setShowPathSuggestions(false);
  };

  const handlePathInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handlePathSubmit(pathInput);
    } else if (e.key === 'Escape') {
      setIsEditingPath(false);
      setPathInput('');
      setShowPathSuggestions(false);
    } else if (e.key === 'ArrowDown' && pathSuggestions.length > 0) {
      e.preventDefault();
      setPathInput(pathSuggestions[0]);
    }
  };

  const handleDownload = async (file: RemoteFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const electron = (window as any).electronAPI;
    if (!electron) {
      setToast({ message: 'Electron API not available', type: 'error' });
      return;
    }

    const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    
    // Handle folder download differently
    if (file.type === 'd') {
      handleFolderDownload(file, remotePath);
      return;
    }
    
    // Create download item first (localPath will be set after user selects save location)
    const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const downloadItem: DownloadItem = {
      id: downloadId,
      fileName: file.name,
      remotePath: remotePath,
      localPath: '', // Will be set after save dialog
      totalSize: file.size || 0,
      downloadedSize: 0,
      status: 'queued',
      startTime: Date.now(),
      siteName: currentSite?.name, // Add site name
      siteHost: currentSite?.host, // Add site host
      siteId: currentSite?.id // Add site ID for updates
    };

    addDownload(downloadItem);
    
    // Get default download path from current site
    const defaultDownloadPath = currentSite?.defaultDownloadPath;
    const actionToUse = applyToAll ? duplicateAction : null;
    
    // Start download (this will show save dialog in backend if no default path, or handle duplicates)
    let downloadPromise: Promise<any>;
    try {
      downloadPromise = electron.download(
        remotePath, 
        file.name, 
        downloadId, 
        file.size || 0,
        defaultDownloadPath,
        actionToUse || undefined,
        applyToAll
      );
    } catch (err: any) {
      updateDownload(downloadId, {
        status: 'failed',
        error: err.message || 'Unknown error',
        endTime: Date.now()
      });
      setToast({ message: `Download error: ${err.message || 'Unknown error'}`, type: 'error' });
      return;
    }

    // Don't update status here - let the backend control it
    // The backend will send status: 'downloading' along with actualFileName and localPath

    downloadPromise.then((result: any) => {
      console.log('[FileExplorer] Download promise resolved:', { 
        downloadId, 
        savedPath: result?.savedPath, 
        actualFileName: result?.actualFileName,
        cancelled: result?.cancelled,
        success: result?.success 
      });
      
      if (result?.dialogCancelled) {
        removeDownload(downloadId);
        return;
      }

      if (result?.skipped) {
        removeDownload(downloadId);
        setToast({ message: `Download skipped: ${file.name}`, type: 'info' });
        return;
      }

      // Always update file name and local path first (for all cases: success, cancelled, failed)
      const actualFileName = result?.actualFileName || file.name;
      const localPath = result?.savedPath || '';
      
      console.log('[FileExplorer] Updating download with:', { downloadId, actualFileName, localPath });
      
      if (actualFileName !== file.name || localPath) {
        updateDownload(downloadId, {
          fileName: actualFileName,
          localPath: localPath
        }, { persist: true });
      }

      if (result?.cancelled) {
        // Status will be set by backend notification, just ensure we have the path
        updateDownload(downloadId, {
          fileName: actualFileName,
          localPath: localPath,
          status: 'cancelled',
          downloadedSize: 0,
          speed: undefined,
          eta: undefined,
          endTime: Date.now()
        });
        // Toast will be shown from App.tsx when status changes
        return;
      }

      if (result && result.success) {
        // Update duplicate action preferences if user chose "apply to all"
        if (result.applyToAll && result.duplicateAction) {
          setDuplicateAction(result.duplicateAction);
          setApplyToAll(true);
        }

        // localPath should already be set from earlier update
        updateDownload(downloadId, {
          status: 'completed',
          downloadedSize: file.size || 0,
          endTime: Date.now()
        });
        setToast({ message: `Downloaded: ${result.savedPath || file.name}`, type: 'success' });
      } else {
        updateDownload(downloadId, {
          status: 'failed',
          error: result?.error || 'Unknown error',
          endTime: Date.now()
        });
        setToast({ message: `Download failed: ${result?.error || 'Unknown error'}`, type: 'error' });
      }
    }).catch((err: any) => {
      updateDownload(downloadId, {
        status: 'failed',
        error: err.message || 'Unknown error',
        endTime: Date.now()
      });
      setToast({ message: `Download error: ${err.message || 'Unknown error'}`, type: 'error' });
    });
  };

  const handleQuickView = (file: RemoteFile, e: React.MouseEvent) => {
    e.stopPropagation();
    previewFileHandler(file);
  };

  // Drag and Drop Handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isConnected) setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isConnected) return;

    const electron = (window as any).electronAPI;
    if (!electron) return;

    const files = Array.from(e.dataTransfer.files);
    const filePayloads = await Promise.all(files.map(async (file) => {
      let localPath = (file as any).path as string | undefined;
      if ((!localPath || localPath.length === 0) && electron?.getPathForFile) {
        try {
          localPath = await electron.getPathForFile(file);
        } catch (err) {
          console.error('getPathForFile failed for', file.name, err);
        }
      }

      let isDirectory = false;
      if (localPath && electron.getPathInfo) {
        const info = await electron.getPathInfo(localPath);
        if (info?.success) {
          isDirectory = info.isDirectory;
        }
      }

      const payload = {
        fileName: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        localPath,
        isDirectory
      };
      console.log('[Upload] Drag file payload:', payload);
      return payload;
    }));

    const directories = filePayloads.filter(p => p.isDirectory && p.localPath);
    const regularFiles = filePayloads.filter(p => !p.isDirectory && p.localPath);
    const missingPathEntries = filePayloads.filter(p => !p.localPath);

    missingPathEntries.forEach((entry) => {
      setToast({ message: `Cannot upload ${entry.fileName}: source path unavailable`, type: 'error' });
    });

    if (directories.length > 0) {
      directories.forEach((dir) => {
        enqueueFolderUpload({
          folderName: dir.fileName,
          localPath: dir.localPath as string,
          remotePath: buildRemotePath(dir.fileName)
        });
      });
      setToast({
        message: `Queued ${directories.length} folder upload${directories.length > 1 ? 's' : ''}`,
        type: 'info'
      });
    }

    if (regularFiles.length > 0) {
    setLoading(true);
      try {
        for (const file of regularFiles) {
          const localPath = file.localPath as string;
          const fileName = file.fileName;
          const remotePath = buildRemotePath(fileName);
        
        console.log('Uploading', localPath, 'to', remotePath);
        
        const result = await electron.upload(localPath, remotePath);
        if (!result.success) {
            alert(`Failed to upload ${fileName}: ${result.error}`);
        }
        }
      } finally {
        setLoading(false);
    }
    
      await handleNavigate(currentPath);
    }
  };

  const openProperties = (file: RemoteFile, e: React.MouseEvent) => {
      e.stopPropagation();
      setPropertiesFile(file);
      // Convert rights object to string if needed or just show raw
      let perms = file.rights;
      if (typeof perms === 'object') {
          perms = `${perms.user}${perms.group}${perms.other}`;
      }
      setNewPermissions(perms ? perms.toString() : '755');
  };

  const savePermissions = async () => {
      if (!propertiesFile) return;
      
      const electron = (window as any).electronAPI;
      if (electron) {
          const remotePath = currentPath === '/' ? `/${propertiesFile.name}` : `${currentPath}/${propertiesFile.name}`;
          setLoading(true);
          const result = await electron.chmod(remotePath, newPermissions);
          setLoading(false);
          
          if (result.success) {
              setPropertiesFile(null);
              handleNavigate(currentPath); // Refresh
          } else {
              alert('Failed to change permissions: ' + result.error);
          }
      }
  };

  if (!isConnected) {
    return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a site to connect
        </div>
    );
  }

  return (
    <div 
        className="flex-1 flex flex-col bg-background relative h-full"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
    >
        {isDragging && (
            <div className="absolute inset-0 z-40 bg-primary/20 backdrop-blur-sm flex items-center justify-center border-4 border-primary border-dashed m-4 rounded-xl">
                <div className="flex flex-col items-center gap-4 text-primary font-bold text-2xl animate-bounce">
                    <Upload size={48} />
                    <span>Drop files to Upload</span>
                </div>
            </div>
        )}

        {/* Loading Overlay */}
        {isLoading && (
            <div className="absolute inset-0 z-30 bg-background/50 backdrop-blur-[2px] flex items-center justify-center transition-opacity duration-200">
                <div className="bg-card border border-border shadow-lg rounded-full px-6 py-3 flex items-center gap-3 animate-in fade-in zoom-in duration-200">
                    <Loader2 size={20} className="animate-spin text-primary" />
                    <span className="text-sm font-medium">Loading...</span>
                </div>
            </div>
        )}

        {/* Preview Modal for Text Files */}
        {previewContent !== null && (
            <div className="fixed z-50 bg-background/95 backdrop-blur flex flex-col" 
                 style={{ 
                   top: '32px',
                   left: `${sidebarWidth}px`,
                   right: showDownloadManager ? `${downloadManagerWidth}px` : '0px',
                   bottom: '0px'
                 }}>
                {/* Top bar with buttons */}
                <div className="flex items-center justify-between px-4 py-2 bg-background/80 backdrop-blur border-b border-border">
                    <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">{previewFile}</h3>
                        {previewFileInfo && (
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                <span>Size: {formatBytes(previewFileInfo.size)}</span>
                                <span>Type: {getFileType(previewFileInfo.name, previewFileInfo.type)}</span>
                                {previewFileInfo.date && <span>Modified: {formatDate(previewFileInfo.date)}</span>}
                                {previewFileInfo.owner && <span>Owner: {typeof previewFileInfo.owner === 'object' ? previewFileInfo.owner.user || 'N/A' : previewFileInfo.owner}</span>}
                                {previewFileInfo.group && <span>Group: {typeof previewFileInfo.group === 'object' ? previewFileInfo.group.name || 'N/A' : previewFileInfo.group}</span>}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {(previewRemotePath || tempFilePath) && previewFileName && (
                            <button
                                onClick={async () => {
                                    const electron = (window as any).electronAPI;
                                    if (electron) {
                                        setLoading(true);
                                        let result;
                                        
                                        // If we have temp file, use it directly (faster)
                                        if (tempFilePath) {
                                            result = await electron.saveTempFile(tempFilePath, previewFileName);
                                        } else if (previewRemotePath) {
                                            // Otherwise download from server
                                            result = await electron.download(previewRemotePath, previewFileName);
                                        }
                                        
                                        setLoading(false);
                                        if (result && result.success) {
                                            setToast({ message: 'File saved successfully', type: 'success' });
                                        } else if (result && !result.cancelled) {
                                            setToast({ message: 'Failed to save file: ' + (result.error || 'Unknown error'), type: 'error' });
                                        }
                                    }
                                }}
                                className="p-2 hover:bg-accent rounded-lg transition-colors relative group"
                                title="Save file"
                            >
                                <Save size={20} />
                                <span className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    Save file
                                </span>
                            </button>
                        )}
                        <button 
                            onClick={() => { 
                                handleClosePreview();
                            }} 
                            className="p-2 hover:bg-accent rounded-lg transition-colors relative group"
                            title="Close preview"
                        >
                        <X size={20} />
                            <span className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                Close preview
                            </span>
                    </button>
                </div>
                </div>
                
                {/* Search bar for text files */}
                <div className="px-4 py-2 bg-background/60 border-b border-border flex items-center gap-2">
                    <Search size={16} className="text-muted-foreground" />
                    <input
                        type="text"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Search in file..."
                        className="flex-1 px-3 py-1.5 bg-input rounded border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.shiftKey) {
                                e.preventDefault();
                                handlePrevMatch();
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                handleNextMatch();
                            }
                        }}
                    />
                    {searchMatches.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{currentMatchIndex + 1} / {searchMatches.length}</span>
                            <button
                                onClick={handlePrevMatch}
                                className="px-2 py-1 hover:bg-accent rounded"
                                title="Previous match (Shift+Enter)"
                            >
                                ↑
                            </button>
                            <button
                                onClick={handleNextMatch}
                                className="px-2 py-1 hover:bg-accent rounded"
                                title="Next match (Enter)"
                            >
                                ↓
                            </button>
                        </div>
                    )}
                </div>
                
                <pre 
                    ref={textPreviewRef}
                    className="text-preview-content flex-1 overflow-auto custom-scrollbar p-4 bg-muted/50 text-xs font-mono whitespace-pre-wrap relative"
                >
                    {previewContent && searchText ? (
                        (() => {
                            const parts: React.ReactNode[] = [];
                            const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                            let lastIndex = 0;
                            let match;
                            let matchCount = 0;
                            
                            while ((match = regex.exec(previewContent)) !== null) {
                                // Add text before match
                                if (match.index > lastIndex) {
                                    parts.push(previewContent.substring(lastIndex, match.index));
                                }
                                
                                // Add highlighted match
                                const isCurrentMatch = matchCount === currentMatchIndex;
                                parts.push(
                                    <mark
                                        key={`match-${matchCount}`}
                                        className={isCurrentMatch ? 'bg-yellow-400 text-black font-semibold' : 'bg-yellow-200/50'}
                                    >
                                        {match[0]}
                                    </mark>
                                );
                                
                                lastIndex = regex.lastIndex;
                                matchCount++;
                            }
                            
                            // Add remaining text
                            if (lastIndex < previewContent.length) {
                                parts.push(previewContent.substring(lastIndex));
                            }
                            
                            return parts;
                        })()
                    ) : (
                        previewContent
                    )}
                </pre>
            </div>
        )}
        {isCreateFolderModalOpen && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-card border border-border rounded-lg shadow-lg w-[320px] max-w-full p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Create New Folder</h2>
                <p className="text-xs text-muted-foreground">
                  Enter a name for the new folder in {currentPath}
                </p>
              </div>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreateFolder();
                  if (e.key === 'Escape') setIsCreateFolderModalOpen(false);
                }}
                className="w-full px-3 py-2 bg-input border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="Folder name"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsCreateFolderModalOpen(false)}
                  className="px-3 py-1.5 text-sm hover:bg-accent rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={submitCreateFolder}
                  className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
                  disabled={newFolderName.trim().length === 0}
                >
                  Create
                </button>
              </div>
            </div>
            </div>
        )}
        {deleteDialog.file && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-card border border-border rounded-lg shadow-lg w-[360px] max-w-full p-5 space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Delete {deleteDialog.file.type === 'd' ? 'Folder' : 'File'}</h2>
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to delete "{deleteDialog.file.name}"?
                </p>
                {deleteDialog.file.type === 'd' && (
                  <div className="mt-2 space-y-2">
                    {deleteDialog.loading ? (
                      <p className="text-xs text-muted-foreground">Checking folder contents...</p>
                    ) : (
                      <>
                        <p className="text-xs text-red-500">
                          This action cannot be undone. Any files and subfolders will be permanently removed.
                        </p>
                        {deleteDialog.requireRecursiveConfirm && (
                          <label className="flex items-start gap-2 text-xs text-red-500">
                            <input
                              type="checkbox"
                              checked={deleteDialog.confirmChecked}
                              onChange={(e) =>
                                setDeleteDialog((prev) => ({ ...prev, confirmChecked: e.target.checked }))
                              }
                            />
                            <span>I understand that all files and subfolders will be deleted.</span>
                          </label>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={closeDeleteDialog}
                  className="px-3 py-1.5 text-sm hover:bg-accent rounded disabled:opacity-50"
                  disabled={deleteDialog.isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={executeDelete}
                  disabled={
                    deleteDialog.isDeleting ||
                    (deleteDialog.file.type === 'd' &&
                      deleteDialog.requireRecursiveConfirm &&
                      !deleteDialog.confirmChecked)
                  }
                  className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50"
                >
                  {deleteDialog.isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
        {activeUpload && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-card border border-border rounded-lg shadow-lg w-[420px] max-w-full p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Uploading {activeUpload.folderName || 'folder'}</h2>
                  <p className="text-xs text-muted-foreground">
                    {activeUpload.status === 'paused'
                      ? 'Upload paused'
                      : UPLOAD_FINAL_STATUSES.includes(activeUpload.status)
                        ? `Upload ${activeUpload.status}`
                        : 'Uploading contents recursively'}
                  </p>
                </div>
                {UPLOAD_FINAL_STATUSES.includes(activeUpload.status) && (
                  <button
                    onClick={() => setActiveUpload(null)}
                    className="p-1.5 hover:bg-accent rounded"
                    title="Close"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

                <div className="space-y-3 text-sm">
                  {activeUpload.cancelRequested && !UPLOAD_FINAL_STATUSES.includes(activeUpload.status) && (
                    <div className="p-2 rounded bg-amber-100 text-amber-700 text-xs flex items-center gap-2 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                      <span>Cancelling upload… this may take a few seconds.</span>
                    </div>
                  )}
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>
                      {formatBytes(activeUpload.uploadedBytes)} / {formatBytes(activeUpload.totalBytes || 0)}
                    </span>
                    <span>
                      {activeUpload.totalBytes
                        ? `${Math.min(100, Math.round((activeUpload.uploadedBytes / activeUpload.totalBytes) * 100))}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{
                        width: activeUpload.totalBytes
                          ? `${Math.min(100, (activeUpload.uploadedBytes / activeUpload.totalBytes) * 100)}%`
                          : '0%'
                      }}
                    />
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Current file: {activeUpload.currentFile || 'Preparing...'}
                  </p>
                  {activeUpload.currentFileSize ? (
                    <>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>
                          {formatBytes(activeUpload.currentFileUploaded || 0)} / {formatBytes(activeUpload.currentFileSize)}
                        </span>
                        <span>
                          {Math.min(
                            100,
                            Math.round(((activeUpload.currentFileUploaded || 0) / activeUpload.currentFileSize) * 100)
                          )}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/70 transition-all duration-200"
                          style={{
                            width: `${Math.min(
                              100,
                              ((activeUpload.currentFileUploaded || 0) / activeUpload.currentFileSize) * 100
                            )}%`
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-muted-foreground/30 animate-pulse" style={{ width: '25%' }} />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>
                    Files: {activeUpload.completedFiles}/{activeUpload.totalFiles}
                  </span>
                  <span>Speed: {activeUpload.speed ? `${formatBytes(activeUpload.speed)}/s` : '--'}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={
                    activeUpload.status === 'paused' ? handleResumeUpload : handlePauseUpload
                  }
                  disabled={UPLOAD_FINAL_STATUSES.includes(activeUpload.status) || activeUpload.cancelRequested}
                  className="px-3 py-1.5 text-sm rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
                >
                  {activeUpload.status === 'paused' ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={handleCancelUpload}
                  disabled={UPLOAD_FINAL_STATUSES.includes(activeUpload.status) || activeUpload.cancelRequested}
                  className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal for Images */}
        {previewImage !== null && (
            <div 
                className="fixed z-50 bg-background/95 backdrop-blur flex flex-col" 
                style={{ 
                  top: '32px',
                  left: `${sidebarWidth}px`,
                  right: showDownloadManager ? `${downloadManagerWidth}px` : '0px',
                  bottom: '0px'
                }}
                onClick={(e) => {
                    // Only close if clicking on backdrop, not on the image or controls
                    if (e.target === e.currentTarget) {
                        handleClosePreview();
                    }
                }}
            >
                {/* Top bar with buttons */}
                <div className="flex items-center justify-between px-4 py-2 bg-background/80 backdrop-blur border-b border-border">
                    <div className="flex-1">
                        <div className="text-sm font-medium text-foreground mb-1">{previewFileName}</div>
                        {previewFileInfo && (
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                <span>Size: {formatBytes(previewFileInfo.size)}</span>
                                <span>Type: {getFileType(previewFileInfo.name, previewFileInfo.type)}</span>
                                {previewFileInfo.date && <span>Modified: {formatDate(previewFileInfo.date)}</span>}
                                {previewFileInfo.owner && <span>Owner: {typeof previewFileInfo.owner === 'object' ? previewFileInfo.owner.user || 'N/A' : previewFileInfo.owner}</span>}
                                {previewFileInfo.group && <span>Group: {typeof previewFileInfo.group === 'object' ? previewFileInfo.group.name || 'N/A' : previewFileInfo.group}</span>}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {(previewRemotePath || tempFilePath) && previewFileName && (
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    const electron = (window as any).electronAPI;
                                    if (electron) {
                                        setLoading(true);
                                        let result;
                                        
                                        // If we have temp file, use it directly (faster)
                                        if (tempFilePath) {
                                            result = await electron.saveTempFile(tempFilePath, previewFileName);
                                        } else if (previewRemotePath) {
                                            // Otherwise download from server
                                            result = await electron.download(previewRemotePath, previewFileName);
                                        }
                                        
                                        setLoading(false);
                                        if (result && result.success) {
                                            setToast({ message: 'File saved successfully', type: 'success' });
                                        } else if (result && !result.cancelled) {
                                            setToast({ message: 'Failed to save file: ' + (result.error || 'Unknown error'), type: 'error' });
                                        }
                                    }
                                }}
                                className="p-2 hover:bg-accent rounded-lg transition-colors relative group"
                                title="Save file"
                            >
                                <Save size={20} />
                                <span className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                    Save file
                                </span>
                            </button>
                        )}
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClosePreview();
                            }} 
                            className="p-2 hover:bg-accent rounded-lg transition-colors relative group"
                            title="Close preview"
                        >
                            <X size={20} />
                            <span className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                Close preview
                            </span>
                        </button>
                    </div>
                </div>
                
                {/* Image container with zoom controls */}
                <div 
                    ref={imageContainerRef}
                    className="flex-1 flex items-center justify-center p-8 overflow-auto custom-scrollbar relative"
                >
                    <img 
                        src={previewImage || ''}
                        alt="Preview" 
                        style={{
                            width: imageScale === 'fit' ? 'auto' : 
                                   imageScale === '1:1' && originalImageSize ? `${originalImageSize.width}px` :
                                   typeof imageScale === 'number' && originalImageSize ? `${originalImageSize.width * imageScale}px` : 'auto',
                            height: imageScale === 'fit' ? 'auto' :
                                    imageScale === '1:1' && originalImageSize ? `${originalImageSize.height}px` :
                                    typeof imageScale === 'number' && originalImageSize ? `${originalImageSize.height * imageScale}px` : 'auto',
                            maxWidth: imageScale === 'fit' ? '100%' : 'none',
                            maxHeight: imageScale === 'fit' ? '100%' : 'none',
                            objectFit: 'contain',
                        }}
                        className="rounded shadow-xl"
                        onError={(e) => {
                            console.error('Failed to load image preview');
                            const errorMsg = 'Failed to load image preview. The file may be corrupted or in an unsupported format.';
                            setToast({ message: errorMsg, type: 'error' });
                            // Don't auto-close, let user close manually
                        }}
                        onLoad={handleImageLoad}
                    />
                </div>
                
                {/* Zoom controls - fixed position, bottom right, vertical */}
                <div className="fixed bottom-4 right-4 flex flex-col gap-1 bg-background/50 backdrop-blur-sm border border-border/50 rounded-md p-1 shadow-lg z-[60]">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleImageZoom('1:1');
                        }}
                        className={`px-2 py-1 hover:bg-accent/50 rounded transition-colors text-[10px] font-mono ${imageScale === '1:1' ? 'bg-accent/50' : ''}`}
                        title="1:1 - Original size"
                    >
                        1:1
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleImageZoom('fit');
                        }}
                        className={`px-2 py-1 hover:bg-accent/50 rounded transition-colors text-[10px] font-mono ${imageScale === 'fit' ? 'bg-accent/50' : ''}`}
                        title="Fit to window"
                    >
                        Fit
                    </button>
                    <div className="h-px bg-border/50 my-0.5" />
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleImageZoom('in');
                        }}
                        className="px-2 py-1 hover:bg-accent/50 rounded transition-colors"
                        title="Zoom in"
                    >
                        <ZoomIn size={14} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleImageZoom('out');
                        }}
                        className="px-2 py-1 hover:bg-accent/50 rounded transition-colors"
                        title="Zoom out"
                    >
                        <ZoomOut size={14} />
                    </button>
                </div>
            </div>
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

        {/* Properties Modal */}
        {propertiesFile && (
            <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4">
                <div className="bg-card border border-border shadow-xl rounded-lg w-96 max-w-full p-6 space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <Info size={18} />
                            Properties
                        </h3>
                        <button onClick={() => setPropertiesFile(null)}><X size={18} /></button>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-3 gap-2">
                            <span className="text-muted-foreground">Name:</span>
                            <span className="col-span-2 font-mono truncate">{propertiesFile.name}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <span className="text-muted-foreground">Size:</span>
                            <span className="col-span-2">{formatBytes(propertiesFile.size)}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <span className="text-muted-foreground">Type:</span>
                            <span className="col-span-2">{propertiesFile.type === 'd' ? 'Directory' : 'File'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <span className="text-muted-foreground">Owner/Group:</span>
                            <span className="col-span-2">{propertiesFile.owner} / {propertiesFile.group}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 items-center">
                            <span className="text-muted-foreground">Permissions:</span>
                            <div className="col-span-2 flex gap-2">
                                <input 
                                    className="bg-input border border-border rounded px-2 py-1 w-full font-mono"
                                    value={newPermissions}
                                    onChange={(e) => setNewPermissions(e.target.value)}
                                    placeholder="e.g. 755 or -rw-r--r--"
                                />
                            </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground italic">
                            Enter octal (e.g. 755) or modification depends on server support.
                        </p>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setPropertiesFile(null)} className="px-3 py-1.5 text-sm hover:bg-accent rounded">Cancel</button>
                        <button onClick={savePermissions} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded">Save Changes</button>
                    </div>
                </div>
            </div>
        )}

        {/* Toolbar / Address Bar */}
        <div className="h-12 border-b border-border flex items-center px-4 gap-2 bg-card/50 relative">
            <button onClick={handleUp} disabled={currentPath === '/'} className="p-1.5 hover:bg-accent rounded disabled:opacity-50">
                <ArrowUp size={16} />
            </button>
            <div className="flex-1 relative">
                {isEditingPath ? (
                    <>
                        <input
                            type="text"
                            value={pathInput || currentPath}
                            onChange={(e) => {
                                const value = e.target.value;
                                setPathInput(value);
                                if (value && value !== '/') {
                                    setShowPathSuggestions(true);
                                } else {
                                    setShowPathSuggestions(false);
                                }
                            }}
                            onKeyDown={handlePathInputKeyDown}
                            onBlur={() => {
                                // Delay to allow clicking on suggestions
                                setTimeout(() => {
                                    setShowPathSuggestions(false);
                                    // Only exit edit mode if not clicking on suggestion
                                    if (!document.activeElement?.closest('.path-suggestions-container')) {
                                        setIsEditingPath(false);
                                    }
                                }, 200);
                            }}
                            autoFocus
                            className="w-full px-3 py-1.5 bg-input rounded text-sm font-mono border border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Enter path..."
                        />
                        {showPathSuggestions && (pathSuggestions.length > 0 || isLoadingSuggestions) && (
                            <div 
                                className="path-suggestions-container absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-lg z-50 max-h-48 overflow-y-auto custom-scrollbar"
                                onMouseDown={(e) => e.preventDefault()} // Prevent input blur when clicking suggestions
                            >
                                {isLoadingSuggestions && pathSuggestions.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                                        Loading suggestions...
                                    </div>
                                )}
                                {pathSuggestions.map((suggestion, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => handlePathSubmit(suggestion)}
                                        className="px-3 py-2 hover:bg-accent cursor-pointer text-sm font-mono border-b border-border last:border-b-0"
                                    >
                                        {suggestion}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div 
                        onClick={() => {
                            setIsEditingPath(true);
                            setPathInput(currentPath);
                        }}
                        className="px-3 py-1.5 bg-input rounded text-sm font-mono cursor-text hover:bg-input/80 transition-colors"
                        title="Click to edit path"
                    >
                {currentPath}
                    </div>
                )}
            </div>
            <button onClick={() => handleNavigate(currentPath)} className="p-1.5 hover:bg-accent rounded">
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleCreateFolder}
              className="p-1.5 hover:bg-accent rounded"
              title="New folder"
            >
              <FolderPlus size={16} />
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={!selectedFile}
              className="p-1.5 hover:bg-accent rounded disabled:opacity-50"
              title={selectedFile ? `Delete ${selectedFile}` : 'Select an item to delete'}
            >
              <Trash2 size={16} />
            </button>
        </div>

        {/* File List Header */}
        <div className="grid grid-cols-12 px-4 py-2 border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground">
            <div className="col-span-6">Name</div>
            <div className="col-span-2 text-right">Size</div>
            <div className="col-span-2 text-right">Modified</div>
            <div className="col-span-2 text-center">Actions</div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {remoteFiles.map((file, idx) => (
                <div 
                    key={idx}
                    style={{ animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}
                    onClick={() => handleItemClick(file)}
                    onDoubleClick={() => handleItemDoubleClick(file)}
                    className={clsx(
                        "grid grid-cols-12 px-4 py-2 cursor-default items-center group text-sm border-b border-border/50 transition-colors opacity-0 animate-slide-in",
                        selectedFile === file.name 
                            ? (file.type === 'd' ? "bg-blue-500/20" : "bg-accent") 
                            : "hover:bg-accent/50"
                    )}
                >
                    <div className="col-span-6 flex items-center gap-2 overflow-hidden">
                        {file.type === 'd' ? (
                            <Folder size={16} className="text-blue-400 fill-blue-400/20" />
                        ) : (
                            <File size={16} className="text-slate-400" />
                        )}
                        <span className="truncate">{file.name}</span>
                    </div>
                    <div className="col-span-2 text-right text-muted-foreground text-xs">
                        {file.type === 'd' ? '-' : formatBytes(file.size)}
                    </div>
                    <div className="col-span-2 text-right text-muted-foreground text-xs">
                        {format(file.date, 'MMM d, HH:mm')}
                    </div>
                    <div className={clsx(
                        "col-span-2 flex items-center justify-center gap-1 transition-opacity",
                        selectedFile === file.name ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}>
                         <button 
                            onClick={(e) => openProperties(file, e)} 
                            className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all" 
                            title="Properties"
                         >
                             <Info size={14} />
                         </button>
                        {file.type !== 'd' ? (
                            <>
                                <button 
                                    onClick={(e) => handleQuickView(file, e)} 
                                    className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all" 
                                    title="Quick View"
                                >
                                    <Eye size={14} />
                                </button>
                                <button 
                                    onClick={(e) => handleDownload(file, e)} 
                                    className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all" 
                                    title="Download"
                                >
                                    <Download size={14} />
                                </button>
                            </>
                        ) : (
                            <button 
                                onClick={(e) => handleDownload(file, e)} 
                                className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all" 
                                title="Download Folder"
                            >
                                <Download size={14} />
                            </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteDialog(file);
                          }}
                          className="p-1 hover:bg-red-500/20 hover:text-red-400 hover:scale-110 rounded transition-all"
                          title={`Delete ${file.type === 'd' ? 'folder' : 'file'}`}
                        >
                          <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};

export default FileExplorer;

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { File, Folder, ArrowUp, RefreshCw, Download, Eye, X, Upload, Info, Edit3, Loader2, Save, Search, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react';
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

const FileExplorer = () => {
  const { currentPath, remoteFiles, isLoading, setCurrentPath, setRemoteFiles, setLoading, isConnected, currentSite } = useStore();
  const addDownload = useStore((state) => state.addDownload);
  const updateDownload = useStore((state) => state.updateDownload);
  const removeDownload = useStore((state) => state.removeDownload);
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [searchText, setSearchText] = useState<string>('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [imageScale, setImageScale] = useState<'fit' | '1:1' | number>('fit');
  const [originalImageSize, setOriginalImageSize] = useState<{ width: number; height: number } | null>(null);
  const textPreviewRef = useRef<HTMLPreElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const handleNavigate = async (path: string) => {
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
  };

  const handleItemClick = (file: RemoteFile) => {
      setSelectedFile(file.name);
  };

  const handleItemDoubleClick = async (file: RemoteFile) => {
    if (file.type === 'd') {
        setLoading(true); // Trigger loading state immediately for transition
        const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        handleNavigate(newPath);
    } else {
        // Preview file if it's a text or image file
        const fileName = file.name.toLowerCase();
        const isTextFile = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.log', '.conf', '.ini', '.yaml', '.yml', '.sh', '.bash', '.zsh'].some(ext => fileName.endsWith(ext));
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
          console.log('Preview result:', { 
            success: result.success, 
            hasImageDataUrl: !!result.imageDataUrl, 
            hasTextData: !!result.data,
            hasTempPath: !!result.tempPath,
            error: result.error,
            isImage: result.isImage,
            isText: result.isText
          });
          console.log('Preview result full object:', result);
          console.log('Preview result keys:', Object.keys(result || {}));
          console.log('Preview result imageDataUrl type:', typeof result?.imageDataUrl);
          console.log('Preview result imageDataUrl length:', result?.imageDataUrl?.length);
          
          setLoading(false);
          
          if (result.success) {
            const fileRemotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            // Store file info for display
            setPreviewFileInfo(file);
            // Check for image data URL first
            if (result.imageDataUrl) {
              // For images, use base64 data URL for preview (Electron security)
              console.log('Setting image preview');
              setPreviewImage(result.imageDataUrl);
              setTempFilePath(result.tempPath); // Keep temp path for save functionality
              setPreviewFileName(file.name);
              setPreviewRemotePath(fileRemotePath);
            } else if (result.data) {
              // For text files, show in preview modal
              console.log('Setting text preview');
              setPreviewFile(file.name);
              setPreviewContent(result.data);
              setPreviewFileName(file.name);
              setPreviewRemotePath(fileRemotePath);
              // Store temp path for text files too (for save functionality)
              if (result.tempPath) {
                setTempFilePath(result.tempPath);
              }
              // Reset search when opening new file
              setSearchText('');
              setSearchMatches([]);
              setCurrentMatchIndex(-1);
            } else {
              console.error('Preview result mismatch - no imageDataUrl or data:', {
                fileName: file.name,
                isImageFile,
                isTextFile,
                hasImageDataUrl: !!result.imageDataUrl,
                hasTextData: !!result.data,
                resultIsImage: result.isImage,
                resultIsText: result.isText,
                fullResult: result
              });
              alert('Preview not available for this file type. File: ' + file.name + '. Check console for details.');
            }
          } else {
            console.error('Preview failed:', result.error);
            alert('Preview failed: ' + (result.error || 'Unknown error'));
          }
        } catch (err: any) {
          setLoading(false);
          console.error('Preview error:', err);
          alert('Preview error: ' + err.message);
        }
    }
  };

  const handleUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const newPath = '/' + parts.join('/');
    handleNavigate(newPath);
  };

  const handleClosePreview = () => {
    // Cleanup temp file when closing preview (for both text and image)
    const fileType = previewImage ? 'image' : 'text';
    if (tempFilePath) {
      const electron = (window as any).electronAPI;
      if (electron) {
        electron.cleanupTempFile(tempFilePath).then(() => {
          setToast({ message: `Preview temporary ${fileType} file deleted`, type: 'success' });
        }).catch((err: any) => {
          console.error('Failed to cleanup temp file:', err);
          // Still show toast even if cleanup fails
          setToast({ message: `Preview ${fileType} file closed`, type: 'info' });
        });
      }
    } else {
      // Even if no temp file, show toast to confirm preview closed
      setToast({ message: `Preview ${fileType} file closed`, type: 'info' });
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
    
    // Start download (this will show save dialog in backend)
    setLoading(true);
    try {
      const result = await electron.download(remotePath, file.name);
      setLoading(false);
      
      if (result && (result.cancelled === true || result.canceled === true)) {
        removeDownload(downloadId);
        return;
      }
      
      if (result && result.success) {
        // Update download item with saved path and mark as completed
        updateDownload(downloadId, {
          localPath: result.savedPath || '',
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
    } catch (err: any) {
      setLoading(false);
      updateDownload(downloadId, {
        status: 'failed',
        error: err.message || 'Unknown error',
        endTime: Date.now()
      });
      setToast({ message: `Download error: ${err.message || 'Unknown error'}`, type: 'error' });
    }
  };

  const handleQuickView = async (file: RemoteFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const electron = (window as any).electronAPI;
    if (electron) {
        const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        setLoading(true);
        const result = await electron.quickView(remotePath);
        setLoading(false);
        if (result.success) {
            setPreviewFile(file.name);
            setPreviewContent(result.data);
        } else {
            alert('Preview failed: ' + result.error);
        }
    }
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

    // In Electron, e.dataTransfer.files has a 'path' property!
    const files = Array.from(e.dataTransfer.files);
    
    setLoading(true);
    for (const file of files) {
        const localPath = (file as any).path; // Electron specific
        const fileName = file.name;
        const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
        
        console.log('Uploading', localPath, 'to', remotePath);
        
        const result = await electron.upload(localPath, remotePath);
        if (!result.success) {
            alert(`Failed to upload ${fileName}: ${result.error}`);
        }
    }
    
    // Refresh
    handleNavigate(currentPath);
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
                    className="text-preview-content flex-1 overflow-auto p-4 bg-muted/50 text-xs font-mono whitespace-pre-wrap relative"
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
                    className="flex-1 flex items-center justify-center p-8 overflow-auto relative"
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
                                className="path-suggestions-container absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-lg z-50 max-h-48 overflow-y-auto"
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
        </div>

        {/* File List Header */}
        <div className="grid grid-cols-12 px-4 py-2 border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground">
            <div className="col-span-6">Name</div>
            <div className="col-span-2 text-right">Size</div>
            <div className="col-span-2 text-right">Modified</div>
            <div className="col-span-2 text-center">Actions</div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto">
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
                        "col-span-2 flex items-center justify-center gap-2 transition-opacity",
                        selectedFile === file.name ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}>
                         <button onClick={(e) => openProperties(file, e)} className="p-1 hover:text-primary" title="Properties">
                             <Info size={14} />
                         </button>
                        {file.type !== 'd' && (
                            <>
                                <button onClick={(e) => handleQuickView(file, e)} className="p-1 hover:text-primary" title="Quick View">
                                    <Eye size={14} />
                                </button>
                                <button onClick={(e) => handleDownload(file, e)} className="p-1 hover:text-primary" title="Download">
                                    <Download size={14} />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};

export default FileExplorer;

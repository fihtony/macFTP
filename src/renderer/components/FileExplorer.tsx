import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  File,
  Folder,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Download,
  Eye,
  Upload,
  Info,
  Trash2,
  FolderPlus,
  X,
  Save,
  Search,
  ZoomIn,
  ZoomOut,
  Loader2,
  Edit,
} from "lucide-react";
import { useStore, RemoteFile } from "../store";
import { DownloadItem } from "./DownloadProgressDialog";
import { format } from "date-fns";
import clsx from "clsx";
import Toast from "./Toast";
import { UploadProgressDialog } from "./UploadProgressDialog";
import { FileDialogs, DeleteDialogState } from "./FileDialogs";
import FileContextMenu from "./FileContextMenu";
import MultiSelectBanner from "./MultiSelectBanner";
import ConfirmDialog from "./ConfirmDialog";
import { FilePreview } from "./FilePreview";
import { formatBytes, formatDate, getFileType } from "../utils/formatters";
import { isPreviewableFile, truncateFileName } from "../utils";
import {
  UploadStatus,
  UploadTaskState,
  UPLOAD_FINAL_STATUSES,
  FolderUploadRequest,
  UploadListItem,
  ConflictResolution,
} from "../types/upload";
import { startUnifiedUpload } from "../services/UploadManager";

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
  const settings = useStore((state) => state.settings);

  // Sort state
  const [sortColumn, setSortColumn] = useState<"name" | "size" | "modified" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Filter hidden files based on settings
  const visibleFiles = settings.showHiddenFiles ? remoteFiles : remoteFiles.filter((file) => !file.name.startsWith("."));

  // Sort files based on sortColumn and sortDirection
  const sortedFiles = useMemo(() => {
    if (!sortColumn) return visibleFiles;

    const sorted = [...visibleFiles].sort((a, b) => {
      let comparison = 0;

      if (sortColumn === "name") {
        // Sort folders first, then files, then alphabetically
        if (a.type === "d" && b.type !== "d") return -1;
        if (a.type !== "d" && b.type === "d") return 1;
        comparison = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      } else if (sortColumn === "size") {
        // Folders have size -1 or 0, treat them as 0 for sorting
        const sizeA = a.type === "d" ? 0 : a.size;
        const sizeB = b.type === "d" ? 0 : b.size;
        comparison = sizeA - sizeB;
      } else if (sortColumn === "modified") {
        comparison = a.date - b.date;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [visibleFiles, sortColumn, sortDirection]);

  // Handle column header click for sorting
  // Cycle through: ascending -> descending -> no sorting
  const handleSort = useCallback(
    (column: "name" | "size" | "modified") => {
      if (sortColumn === column) {
        // Clicking the same column: cycle through asc -> desc -> null
        if (sortDirection === "asc") {
          // Currently ascending, change to descending
          setSortDirection("desc");
        } else {
          // Currently descending, remove sorting
          setSortColumn(null);
          setSortDirection("asc");
        }
      } else {
        // Clicking a different column: set to ascending
        setSortColumn(column);
        setSortDirection("asc");
      }
    },
    [sortColumn, sortDirection]
  );

  // Reset sort state when connecting to a new site
  const prevSiteIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Only reset when connecting to a new site (site ID changes)
    if (isConnected && currentSite?.id && prevSiteIdRef.current !== currentSite.id) {
      setSortColumn(null);
      setSortDirection("asc");
      prevSiteIdRef.current = currentSite.id;
    } else if (!isConnected) {
      // Reset ref when disconnected
      prevSiteIdRef.current = null;
      // Clear all dialogs and temporary states when disconnected
      setBatchDeleteConfirm(null);
      setDeleteDialog(deleteDialogInitialState);
      setRenameDialog(null);
      setContextMenu(null);
    }
  }, [isConnected, currentSite?.id]);

  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [propertiesFile, setPropertiesFile] = useState<RemoteFile | null>(null);
  const [newPermissions, setNewPermissions] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set()); // Multi-selection for files only
  const [pathInput, setPathInput] = useState<string>("");
  const [showPathSuggestions, setShowPathSuggestions] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null); // Now stores base64 data URL
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const [previewRemotePath, setPreviewRemotePath] = useState<string | null>(null);
  const [previewFileInfo, setPreviewFileInfo] = useState<RemoteFile | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" | "warning" } | null>(null);
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [searchText, setSearchText] = useState<string>("");
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [imageScale, setImageScale] = useState<"fit" | "1:1" | number>("fit");
  const [originalImageSize, setOriginalImageSize] = useState<{ width: number; height: number } | null>(null);
  const [folderUploadQueue, setFolderUploadQueue] = useState<FolderUploadRequest[]>([]);
  const [activeUpload, setActiveUpload] = useState<UploadTaskState | null>(null);
  const currentFileUploadIdRef = useRef<string | null>(null);
  const baseUploadedRef = useRef<number>(0);
  const completedFilesRef = useRef<number>(0);
  const totalBytesRef = useRef<number>(0);
  const cancelUploadsRef = useRef<boolean>(false);
  const uploadCompletionToastShownRef = useRef<boolean>(false); // Track if completion toast has been shown
  const [duplicateAction, setDuplicateAction] = useState<"overwrite" | "rename" | "skip" | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const deleteDialogInitialState: DeleteDialogState = {
    file: null,
    requireRecursiveConfirm: false,
    confirmChecked: false,
    loading: false,
    isDeleting: false,
  };
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(deleteDialogInitialState);
  const [renameDialog, setRenameDialog] = useState<{ file: RemoteFile; newName: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ file: RemoteFile; x: number; y: number } | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState<{ fileNames: string[] } | null>(null);
  const textPreviewRef = useRef<HTMLPreElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const handleNavigate = useCallback(
    async (path: string) => {
      setLoading(true);
      const electron = (window as any).electronAPI;
      if (electron) {
        const result = await electron.listDir(path);
        setLoading(false);
        if (result.success) {
          setCurrentPath(path);
          setRemoteFiles(result.files);
          setSelectedFile(null); // Clear selection on navigate
          setSelectedFiles(new Set()); // Clear multi-selection on navigate
        } else {
          alert("Error listing directory: " + result.error);
        }
      }
    },
    [setLoading, setCurrentPath, setRemoteFiles]
  );

  const handleClosePreview = useCallback(
    (options?: { skipToast?: boolean; toastMessage?: string }) => {
      const { skipToast, toastMessage } = options || {};
      const fileType = previewImage ? "image" : "text";
      const electron = (window as any).electronAPI;

      // Show toast first (before cleanup)
      if (!skipToast) {
        if (tempFilePath && electron) {
          setToast({ message: toastMessage || `Preview temporary ${fileType} file will be deleted`, type: "success" });
          // Cleanup in background
          electron.cleanupTempFile(tempFilePath).catch((err: any) => {
            console.error("Failed to cleanup temp file:", err);
          });
        } else {
          setToast({ message: toastMessage || `Preview ${fileType} file closed`, type: "info" });
        }
      }

      // Clear preview state
      setPreviewImage(null);
      setPreviewContent(null);
      setPreviewFile(null);
      setTempFilePath(null);
      setPreviewFileName(null);
      setPreviewRemotePath(null);
      setPreviewFileInfo(null);
      setSearchText("");
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      setImageScale("fit");
      setOriginalImageSize(null);
    },
    [previewImage, tempFilePath, setToast]
  );

  const handleItemClick = (file: RemoteFile) => {
    // Folders can always be entered, regardless of multi-select mode
    if (file.type === "d") {
      previewFileHandler(file);
      // Exit multi-select mode when entering a folder
      if (selectedFiles.size > 0) {
        setSelectedFiles(new Set());
        setSelectedFile(null);
      }
      return;
    }

    // File handling
    if (selectedFiles.size > 0) {
      // In multi-select mode, toggle selection
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(file.name)) {
        newSelected.delete(file.name);
      } else {
        newSelected.add(file.name);
      }
      setSelectedFiles(newSelected);
      // Exit multi-select mode if no files selected
      if (newSelected.size === 0) {
        setSelectedFile(null);
      }
    } else {
      // Single selection mode - just highlight
      setSelectedFile(file.name);
    }
  };

  const previewFileHandler = useCallback(
    async (file: RemoteFile) => {
      if (file.type === "d") {
        setLoading(true);
        const newPath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
        handleNavigate(newPath);
        return;
      }

      const fileName = file.name.toLowerCase();
      const isTextFile = isPreviewableFile(file.name) || file.name.startsWith(".");
      const isImageFile = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico"].some((ext) => fileName.endsWith(ext));

      const electron = (window as any).electronAPI;
      if (!electron) {
        console.error("Electron API not available");
        return;
      }

      const remotePath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
      console.log("Attempting to preview file:", file.name, "Path:", remotePath);
      console.log("File type check - isText:", isTextFile, "isImage:", isImageFile);

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
            setSearchText("");
            setSearchMatches([]);
            setCurrentMatchIndex(-1);
          } else {
            console.error("Preview result mismatch - no imageDataUrl or data:", result);
            alert("Preview not available for this file type. File: " + file.name + ". Check console for details.");
            handleClosePreview({ skipToast: true });
          }
        } else {
          console.error("Preview failed:", result.error);
          alert("Preview failed: " + (result.error || "Unknown error"));
          handleClosePreview({ skipToast: true });
        }
      } catch (err: any) {
        setLoading(false);
        console.error("Preview error:", err);
        alert("Preview error: " + err.message);
        handleClosePreview({ skipToast: true });
      }
    },
    [currentPath, handleNavigate, handleClosePreview, setLoading, setTempFilePath]
  );

  const handleItemDoubleClick = async (file: RemoteFile) => {
    // Double-click does nothing - single click handles navigation for folders
  };

  const buildRemotePath = (name: string) => (currentPath === "/" ? `/${name}` : `${currentPath}/${name}`);

  const enqueueFolderUpload = useCallback((request: FolderUploadRequest) => {
    setFolderUploadQueue((prev) => [...prev, request]);
  }, []);

  const handleFolderDownload = async (file: RemoteFile, remotePath: string) => {
    console.log("[User Action] Download folder:", { fileName: file.name, remotePath, siteName: currentSite?.name });
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
      localPath: "", // Will be set after path is determined
      totalSize: 0,
      downloadedSize: 0,
      status: "queued", // Important: Start as queued to show yellow clock icon
      startTime: Date.now(),
      siteName: currentSite?.name,
      siteHost: currentSite?.host,
      siteId: currentSite?.id,
      isFolder: true,
      totalFiles: 0,
      completedFiles: 0,
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
        applyToAll,
        settings.defaultConflictResolution
      );

      if (response?.dialogCancelled) {
        console.log("[Download] Folder download dialog cancelled by user:", { downloadId, fileName: file.name });
        // Cancel the backend job that's waiting for dialog resolution
        const electron = (window as any).electronAPI;
        if (electron?.cancelDownloadFolder) {
          electron.cancelDownloadFolder(downloadId);
        }
        removeDownload(downloadId);
        return;
      }

      if (response?.skipped) {
        console.log("[Download] Folder download skipped by user:", { downloadId, fileName: file.name });
        removeDownload(downloadId);
        setToast({ message: `Folder download skipped: ${file.name}`, type: "info" });
        return;
      }

      if (!response?.success) {
        console.error("[Error] Folder download failed to start:", { downloadId, fileName: file.name, error: response?.error });
        updateDownload(downloadId, {
          status: "failed",
          error: response?.error || "Unknown error",
          endTime: Date.now(),
        });
        setToast({ message: `Failed to start folder download: ${response?.error || "Unknown error"}`, type: "error" });
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
          localPath: response.savedPath,
          // Status remains 'queued' - backend will update to 'downloading' when it actually starts
        };

        // Update folder name if it was renamed
        if (response.actualFileName && response.actualFileName !== file.name) {
          updates.fileName = response.actualFileName;
        }

        updateDownload(downloadId, updates);
      }

      console.log("[FileExplorer] Folder download started:", {
        downloadId,
        savedPath: response.savedPath,
        actualFileName: response.actualFileName,
      });
    } catch (err: any) {
      console.error("[Error] Folder download exception:", { downloadId, fileName: file.name, error: err.message });
      updateDownload(downloadId, {
        status: "failed",
        error: err.message || "Unknown error",
        endTime: Date.now(),
      });
      setToast({ message: `Failed to start folder download: ${err.message || "Unknown error"}`, type: "error" });
    }
  };

  // Wrapper for unified upload manager
  const startUnifiedUploadWrapper = useCallback(
    async (items: Array<{ name: string; localPath: string; remotePath: string; size: number; isFolder: boolean }>) => {
      const electron = (window as any).electronAPI;
      if (!electron) return;

      await startUnifiedUpload(items, {
        electron,
        settings,
        currentSite,
        currentPath,
        setActiveUpload,
        setToast,
        handleNavigate,
        cancelUploadsRef,
        uploadCompletionToastShownRef,
        currentFileUploadIdRef,
      });
    },
    [settings, currentSite, currentPath, setToast, handleNavigate]
  );

  const initiateFolderUpload = useCallback(
    async (request: FolderUploadRequest) => {
      console.log("[Upload] Starting folder upload:", {
        folderName: request.folderName,
        localPath: request.localPath,
        remotePath: request.remotePath,
        siteName: currentSite?.name,
        defaultConflictResolution: settings.defaultConflictResolution,
      });
      const electron = (window as any).electronAPI;
      if (!electron) return;

      // Reset cancellation flag for new upload session
      cancelUploadsRef.current = false;

      try {
        const response = await electron.uploadFolder(request.localPath, request.remotePath, settings.defaultConflictResolution);
        if (!response?.success) {
          console.error("[Error] Folder upload failed to start:", { folderName: request.folderName, error: response?.error });
          setToast({ message: `Failed to start folder upload: ${response?.error || "Unknown error"}`, type: "error" });
          setActiveUpload(null);
          cancelUploadsRef.current = false; // Reset cancellation flag
          return;
        }
        setActiveUpload({
          id: response.uploadId,
          status: "starting",
          uploadedBytes: 0,
          totalBytes: 0,
          completedFiles: 0,
          totalFiles: 0,
          currentFile: "",
          currentFileUploaded: 0,
          currentFileSize: 0,
          speed: 0,
          folderName: request.folderName,
          isSingleUpload: false, // Explicitly mark as folder upload
          siteName: currentSite?.name,
          siteHost: currentSite?.host,
          localPath: request.localPath,
          remotePath: request.remotePath,
        });
      } catch (err: any) {
        console.error("[Error] Folder upload exception:", { folderName: request.folderName, error: err.message });
        setToast({ message: `Failed to start folder upload: ${err.message || "Unknown error"}`, type: "error" });
        setActiveUpload(null);
        cancelUploadsRef.current = false; // Reset cancellation flag
      }
    },
    [setToast, currentSite]
  );

  const submitCreateFolder = async () => {
    const sanitized = newFolderName.trim().replace(/[/\\]+/g, "");
    if (!sanitized) {
      console.warn("[Warning] Create folder: Empty folder name");
      setToast({ message: "Folder name cannot be empty", type: "error" });
      return;
    }
    console.log("[User Action] Create folder:", {
      folderName: sanitized,
      remotePath: buildRemotePath(sanitized),
      siteName: currentSite?.name,
    });
    setIsCreateFolderModalOpen(false);
    setNewFolderName("");
    const electron = (window as any).electronAPI;
    if (!electron) return;
    const targetPath = buildRemotePath(sanitized);
    setLoading(true);
    try {
      const result = await electron.createDirectory(targetPath);
      setLoading(false);
      if (result.success) {
        console.log("[Success] Folder created:", sanitized);
        setToast({ message: `Folder "${sanitized}" created`, type: "success" });
        handleNavigate(currentPath);
      } else {
        console.error("[Error] Failed to create folder:", { folderName: sanitized, error: result.error });
        setToast({ message: `Failed to create folder: ${result.error || "Unknown error"}`, type: "error" });
      }
    } catch (err: any) {
      setLoading(false);
      console.error("[Error] Create folder exception:", { folderName: sanitized, error: err.message });
      setToast({ message: `Failed to create folder: ${err.message || "Unknown error"}`, type: "error" });
    }
  };
  const handleCreateFolder = () => {
    console.log("[User Action] Create folder dialog opened");
    setNewFolderName("");
    setIsCreateFolderModalOpen(true);
  };

  const openDeleteDialog = async (file: RemoteFile) => {
    const electron = (window as any).electronAPI;
    if (file.type !== "d") {
      setDeleteDialog({
        file,
        requireRecursiveConfirm: false,
        confirmChecked: true,
        loading: false,
        isDeleting: false,
      });
      return;
    }

    // For folders, start with Delete button disabled (safer)
    // Only enable after checking folder contents
    setDeleteDialog({
      file,
      requireRecursiveConfirm: true, // Start disabled for safety
      confirmChecked: false, // Button disabled until we check contents
      loading: true,
      isDeleting: false,
    });

    if (!electron) {
      // If no electron API, assume folder has contents (safer)
      setDeleteDialog({
        file,
        requireRecursiveConfirm: true,
        confirmChecked: false,
        loading: false,
        isDeleting: false,
      });
      return;
    }

    try {
      const targetPath = buildRemotePath(file.name);
      const result = await electron.listDir(targetPath);
      const hasChildren = !(result.success && result.files.length === 0);

      // If folder has children, require confirmation checkbox
      // If folder is empty, enable Delete button immediately (no confirmation needed)
      setDeleteDialog({
        file,
        requireRecursiveConfirm: hasChildren, // Only require confirmation if folder has contents
        confirmChecked: !hasChildren, // Auto-check if empty (enables button), unchecked if has contents (keeps disabled)
        loading: false,
        isDeleting: false,
      });
    } catch {
      // On error, assume folder has contents (safer - keep button disabled)
      setDeleteDialog({
        file,
        requireRecursiveConfirm: true,
        confirmChecked: false,
        loading: false,
        isDeleting: false,
      });
    }
  };

  const closeDeleteDialog = () => {
    setDeleteDialog(deleteDialogInitialState);
  };

  const executeDelete = async () => {
    if (!deleteDialog.file) return;
    const file = deleteDialog.file;
    console.log("[User Action] Delete confirmed:", {
      fileName: file.name,
      type: file.type === "d" ? "folder" : "file",
      siteName: currentSite?.name,
    });
    const electron = (window as any).electronAPI;
    if (!electron) return;
    const targetPath = buildRemotePath(file.name);
    setDeleteDialog((prev) => ({ ...prev, isDeleting: true }));
    try {
      const result = await electron.deleteEntry(targetPath, file.type === "d");
      setDeleteDialog(deleteDialogInitialState);
      if (result.success) {
        console.log("[Success] File/folder deleted:", file.name);
        setToast({ message: `"${file.name}" deleted`, type: "success" });
        handleNavigate(currentPath);
      } else {
        console.error("[Error] Failed to delete:", { fileName: file.name, error: result.error });
        setToast({ message: `Failed to delete: ${result.error || "Unknown error"}`, type: "error" });
      }
    } catch (err: any) {
      console.error("[Error] Delete exception:", { fileName: file.name, error: err.message });
      setToast({ message: `Failed to delete: ${err.message || "Unknown error"}`, type: "error" });
      setDeleteDialog(deleteDialogInitialState);
    }
  };

  const handleDeleteSelected = async () => {
    // Handle multi-selection delete
    if (selectedFiles.size > 0) {
      console.log("[User Action] Batch delete files:", {
        count: selectedFiles.size,
        files: Array.from(selectedFiles),
        siteName: currentSite?.name,
      });

      const fileNames = Array.from(selectedFiles);
      setBatchDeleteConfirm({ fileNames });
      return;
    }

    // Handle single file delete
    if (!selectedFile) {
      console.log("[User Action] Delete: No file selected");
      setToast({ message: "Select a file or folder first", type: "info" });
      return;
    }
    const file = remoteFiles.find((f) => f.name === selectedFile);
    if (!file) return;
    console.log("[User Action] Delete file/folder:", {
      fileName: file.name,
      type: file.type === "d" ? "folder" : "file",
      siteName: currentSite?.name,
    });
    openDeleteDialog(file);
  };

  const executeBatchDelete = async () => {
    if (!batchDeleteConfirm) return;

    const { fileNames } = batchDeleteConfirm;
    const electron = (window as any).electronAPI;
    if (!electron) return;

    const filePaths = fileNames.map((name) => buildRemotePath(name));

    try {
      const result = await electron.deleteMultiple(filePaths);

      if (result.success) {
        const successNames = result.results
          .filter((r: any) => r.success)
          .map((r: any) => {
            const parts = r.path.split("/");
            return parts[parts.length - 1];
          });

        const displaySuccessNames = successNames.slice(0, 3);
        const remainingSuccess = successNames.length - displaySuccessNames.length;
        const toastMsg = `Deleted successfully: ${displaySuccessNames.join(", ")}${
          remainingSuccess > 0 ? `, ... (${successNames.length} total)` : ""
        }`;

        setToast({ message: toastMsg, type: "success" });
        setSelectedFiles(new Set());
        setBatchDeleteConfirm(null);
        handleNavigate(currentPath);
      } else {
        const failedCount = result.summary?.failed || 0;
        setToast({ message: `Failed to delete ${failedCount} file(s)`, type: "error" });
        setBatchDeleteConfirm(null);
      }
    } catch (err: any) {
      setToast({ message: `Failed to delete: ${err.message}`, type: "error" });
      setBatchDeleteConfirm(null);
    }
  };

  const handleCancelUpload = async () => {
    if (!activeUpload || UPLOAD_FINAL_STATUSES.includes(activeUpload.status)) return;
    console.log("[User Action] Cancel upload:", {
      uploadId: activeUpload.id,
      status: activeUpload.status,
      currentFile: activeUpload.currentFile,
      currentFileUploadId: currentFileUploadIdRef.current,
      isSingleUpload: activeUpload.isSingleUpload,
    });
    cancelUploadsRef.current = true;
    setActiveUpload((prev) => (prev ? { ...prev, status: "cancelling", cancelRequested: true } : prev));
    const electron = (window as any).electronAPI;
    if (!electron) return;

    // For folder uploads (isSingleUpload === false), always use activeUpload.id (which is the folder uploadId)
    // For single/multiple file uploads, try to cancel the current file's uploadId first, fallback to activeUpload.id
    const isFolderUpload = activeUpload.isSingleUpload === false;
    const targetId = isFolderUpload ? activeUpload.id : currentFileUploadIdRef.current || activeUpload.id;
    if (targetId) {
      try {
        await electron.cancelUpload(targetId);
      } catch (err: any) {
        // If cancellation fails (e.g., uploadId not found), that's okay
        // The cancelRequested flag is already set, so the upload loop will stop
        console.log("[Upload] Cancel request for uploadId not found (may have already completed):", {
          uploadId: targetId,
          error: err.message,
        });
      }
    }
  };

  const handleRename = async () => {
    if (!renameDialog) return;

    const { file, newName } = renameDialog;

    if (!newName || newName.trim() === "") {
      setToast({ message: "Name cannot be empty", type: "error" });
      return;
    }

    if (newName === file.name) {
      setRenameDialog(null);
      return;
    }

    // Check if name already exists
    const nameExists = remoteFiles.some((f) => f.name === newName);
    if (nameExists) {
      setToast({ message: `Name "${newName}" already exists`, type: "error" });
      return;
    }

    const electron = (window as any).electronAPI;
    if (!electron) return;

    const oldPath = buildRemotePath(file.name);
    const newPath = currentPath === "/" ? `/${newName}` : `${currentPath}/${newName}`;

    try {
      const result = await electron.renameEntry(oldPath, newPath);

      if (result.success) {
        console.log("[Success] Renamed:", { from: file.name, to: newName });
        setToast({ message: `Renamed "${file.name}" to "${newName}"`, type: "success" });
        setRenameDialog(null);
        handleNavigate(currentPath);
      } else {
        console.error("[Error] Failed to rename:", result.error);
        setToast({ message: `Failed to rename: ${result.error}`, type: "error" });
      }
    } catch (err: any) {
      console.error("[Error] Rename exception:", err.message);
      setToast({ message: `Failed to rename: ${err.message}`, type: "error" });
    }
  };

  const handleUp = () => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const newPath = "/" + parts.join("/");
    handleNavigate(newPath);
  };

  // Search functionality for text preview
  const handleSearch = useCallback(
    (text: string) => {
      if (!text || !previewContent) {
        setSearchMatches([]);
        setCurrentMatchIndex(-1);
        return;
      }

      const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
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
    },
    [previewContent]
  );

  // Image zoom functions
  const handleImageZoom = useCallback((action: "fit" | "1:1" | "in" | "out") => {
    if (action === "fit") {
      setImageScale("fit");
    } else if (action === "1:1") {
      setImageScale("1:1");
    } else if (action === "in") {
      setImageScale((prev) => {
        if (prev === "fit" || prev === "1:1") return 1.5;
        return Math.min((prev as number) * 1.2, 5); // Max 5x zoom
      });
    } else if (action === "out") {
      setImageScale((prev) => {
        if (prev === "fit" || prev === "1:1") return 0.8;
        return Math.max((prev as number) / 1.2, 0.1); // Min 0.1x zoom
      });
    }
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setOriginalImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    console.log("Image loaded successfully, original size:", img.naturalWidth, "x", img.naturalHeight);
  }, []);

  const handleSavePreviewFile = useCallback(async () => {
    const electron = (window as any).electronAPI;
    if (!electron) return;

    setLoading(true);
    let result;

    if (tempFilePath && previewFileName) {
      result = await electron.saveTempFile(tempFilePath, previewFileName);
    } else if (previewRemotePath && previewFileName) {
      result = await electron.download(previewRemotePath, previewFileName);
    }

    setLoading(false);
    if (result && result.success) {
      setToast({ message: "File saved successfully", type: "success" });
    } else if (result && !result.cancelled) {
      setToast({ message: "Failed to save file: " + (result.error || "Unknown error"), type: "error" });
    }
  }, [tempFilePath, previewFileName, previewRemotePath, setLoading, setToast]);

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
        if (!prev) return prev;

        // NEW UNIFIED UPLOAD MANAGER: Selective progress update
        // The unified upload manager (with items field) manages completedFiles and uploadedBytes
        // But we still need real-time progress from backend for current file upload progress and speed
        if (prev.items && Array.isArray(prev.items)) {
          // Only update real-time progress fields, don't touch completedFiles/uploadedBytes
          // These are managed by UploadManager.ts
          const updatedCurrentItem = prev.currentItem
            ? {
                ...prev.currentItem,
                uploadedBytes:
                  typeof payload.currentFileUploaded === "number" ? payload.currentFileUploaded : prev.currentItem.uploadedBytes || 0,
              }
            : prev.currentItem;

          // Use backend speed but smooth it with previous speed to avoid jumps
          let smoothedSpeed = prev.speed || 0;
          if (typeof payload.speed === "number" && payload.speed > 0) {
            // Apply exponential moving average: 70% new, 30% old
            smoothedSpeed = prev.speed ? payload.speed * 0.7 + prev.speed * 0.3 : payload.speed;
          }

          return {
            ...prev,
            currentItem: updatedCurrentItem,
            speed: smoothedSpeed,
          };
        }

        // Folder upload (IDs match)
        if (prev.id === payload.uploadId) {
          // Always preserve cancellation state from ref
          const nextCancelRequested = prev.cancelRequested || cancelUploadsRef.current;

          if (nextCancelRequested && !UPLOAD_FINAL_STATUSES.includes(payload.status)) {
            // If cancellation was requested but backend hasn't confirmed yet, close dialog after short delay
            setTimeout(() => {
              const targetName = prev.folderName || prev.currentFile || "upload";
              setToast({ message: `Upload "${targetName}" cancelled`, type: "warning" });
              setActiveUpload(null);
              cancelUploadsRef.current = false; // Reset cancellation flag
            }, 500); // Close dialog quickly when cancellation is requested
            return { ...prev, cancelRequested: true }; // Ensure cancelRequested is set
          }

          const next: UploadTaskState = {
            ...prev,
            status: payload.status as UploadStatus,
            uploadedBytes: typeof payload.uploadedBytes === "number" ? payload.uploadedBytes : prev.uploadedBytes,
            totalBytes: typeof payload.totalBytes === "number" ? payload.totalBytes : prev.totalBytes,
            completedFiles: typeof payload.completedFiles === "number" ? payload.completedFiles : prev.completedFiles,
            totalFiles: typeof payload.totalFiles === "number" ? payload.totalFiles : prev.totalFiles,
            currentFile: payload.currentFile ?? prev.currentFile,
            currentFileSize: typeof payload.currentFileSize === "number" ? payload.currentFileSize : prev.currentFileSize,
            currentFileUploaded: typeof payload.currentFileUploaded === "number" ? payload.currentFileUploaded : prev.currentFileUploaded,
            currentFileLocalPath: (payload as any).currentFileLocalPath ?? prev.currentFileLocalPath,
            speed: typeof payload.speed === "number" ? payload.speed : prev.speed,
            cancelRequested: nextCancelRequested, // Preserve cancellation state from ref
            currentFileRemotePath: (payload as any).currentFileRemotePath ?? prev.currentFileRemotePath,
          };

          // Don't call setToast or handleNavigate inside the updater - defer to avoid React warnings
          if (["completed", "failed", "cancelled"].includes(payload.status)) {
            const status = payload.status as UploadStatus | "cancelled";
            const targetName = prev.folderName || prev.currentFile || "upload";
            const isSingleUpload = prev.isSingleUpload;
            const wasCancelled = prev.cancelRequested || payload.status === "cancelled";
            // Defer toast and navigation to avoid updating components during render
            setTimeout(() => {
              if (status === "completed" && !wasCancelled) {
                // Only show success if not cancelled
                if (isSingleUpload && targetName) {
                  setToast({ message: `Upload completed: ${targetName}`, type: "success" });
                } else {
                  setToast({ message: "Uploaded files successfully", type: "success" });
                }
              } else if (status === "failed") {
                setToast({ message: `Folder upload failed: ${payload.error || "Unknown error"}`, type: "error" });
              } else if (wasCancelled || payload.status === "cancelled") {
                setToast({ message: `Upload "${targetName}" cancelled`, type: "warning" });
              }
              handleNavigate(currentPath);
              setTimeout(() => {
                setActiveUpload(null);
                // Reset cancellation flag when upload session ends
                cancelUploadsRef.current = false;
              }, 1000); // Reduced delay for faster closing
            }, 0);
          }

          return next;
        }

        // Single/multi file session (per-file uploadId) - for new unified upload manager
        // Check if this is a unified upload session (has uploadList)
        if (prev.uploadList && prev.uploadList.length > 0) {
          // This is a unified upload session - update from progress payload
          // Calculate total uploaded bytes: sum of completed items + current file progress
          let totalUploadedBytes = 0;
          let totalCompletedFiles = 0;

          if (prev.uploadList) {
            // Sum up bytes from completed items
            for (const listItem of prev.uploadList) {
              if (listItem.status === "completed" || listItem.status === "skipped") {
                totalUploadedBytes += listItem.size;
                totalCompletedFiles++;
              }
            }

            // Add current file progress if it's being uploaded
            if (prev.currentItemIndex !== undefined && prev.uploadList[prev.currentItemIndex]) {
              const currentItem = prev.uploadList[prev.currentItemIndex];
              if (currentItem.status === "uploading" || currentItem.status === "pending") {
                // Add current file uploaded bytes
                const currentFileUploaded =
                  typeof payload.currentFileUploaded === "number"
                    ? payload.currentFileUploaded
                    : typeof payload.uploadedBytes === "number"
                    ? payload.uploadedBytes
                    : 0;
                totalUploadedBytes += currentFileUploaded;
              }
            }
          }

          const next: UploadTaskState = {
            ...prev,
            status: payload.status as UploadStatus,
            uploadedBytes: totalUploadedBytes, // Use calculated total
            totalBytes: prev.totalBytes, // Keep total bytes from initial state
            completedFiles: totalCompletedFiles, // Use calculated total
            totalFiles: prev.totalFiles, // Keep total files from initial state
            currentFile: payload.currentFile ?? prev.currentFile,
            currentFileSize: typeof payload.currentFileSize === "number" ? payload.currentFileSize : prev.currentFileSize,
            currentFileUploaded: typeof payload.currentFileUploaded === "number" ? payload.currentFileUploaded : prev.currentFileUploaded,
            currentFileLocalPath: (payload as any).currentFileLocalPath ?? prev.currentFileLocalPath,
            speed: typeof payload.speed === "number" ? payload.speed : prev.speed,
            cancelRequested: prev.cancelRequested || cancelUploadsRef.current,
            currentFileRemotePath: (payload as any).currentFileRemotePath ?? prev.currentFileRemotePath,
          };

          // Update uploadList item status if we have currentItemIndex
          if (next.currentItemIndex !== undefined && next.uploadList && next.uploadList[next.currentItemIndex]) {
            const updatedList = [...next.uploadList];
            const currentItem = updatedList[next.currentItemIndex];

            if (payload.status === "uploading") {
              // Update current file progress
              updatedList[next.currentItemIndex] = {
                ...currentItem,
                status: "uploading",
                uploadedBytes:
                  typeof payload.currentFileUploaded === "number"
                    ? payload.currentFileUploaded
                    : typeof payload.uploadedBytes === "number"
                    ? payload.uploadedBytes
                    : currentItem.uploadedBytes,
              };
            } else if (payload.status === "completed") {
              updatedList[next.currentItemIndex] = { ...currentItem, status: "completed", uploadedBytes: currentItem.size };
            } else if (payload.status === "failed") {
              updatedList[next.currentItemIndex] = { ...currentItem, status: "failed", error: (payload as any).error };
            }
            next.uploadList = updatedList;
          }

          // Handle final status - only close dialog when ALL files are completed
          // For unified upload sessions, we need to check if all files are done
          const allFilesCompleted = next.completedFiles >= (next.totalFiles || 1);

          if (["failed", "cancelled"].includes(payload.status)) {
            // Failed or cancelled - close immediately
            const status = payload.status as UploadStatus | "cancelled";
            const wasCancelled = prev.cancelRequested || payload.status === "cancelled";
            setTimeout(() => {
              if (status === "failed") {
                setToast({ message: `Upload failed: ${(payload as any).error || "Unknown error"}`, type: "error" });
              } else if (wasCancelled || payload.status === "cancelled") {
                setToast({ message: "Upload cancelled", type: "warning" });
              }
              handleNavigate(currentPath);
              setTimeout(() => {
                setActiveUpload(null);
                cancelUploadsRef.current = false;
              }, 1000);
            }, 0);
          } else if (payload.status === "completed" && allFilesCompleted) {
            // Only close when ALL files are completed
            const wasCancelled = prev.cancelRequested;
            setTimeout(() => {
              if (!wasCancelled) {
                setToast({ message: "Uploaded files successfully", type: "success" });
              }
              handleNavigate(currentPath);
              setTimeout(() => {
                setActiveUpload(null);
                cancelUploadsRef.current = false;
              }, 1000);
            }, 0);
          }
          // For 'completed' status but not all files done, just update progress, don't close dialog

          return next;
        }

        // Legacy: Single/multi file session (per-file uploadId) - old code path
        if (payload.uploadId && payload.uploadId === currentFileUploadIdRef.current) {
          // If cancellation was requested, close dialog immediately
          if (prev.cancelRequested && !UPLOAD_FINAL_STATUSES.includes(payload.status)) {
            setTimeout(() => {
              const targetName = prev.folderName || prev.currentFile || "upload";
              setToast({ message: `Upload "${targetName}" cancelled`, type: "warning" });
              setActiveUpload(null);
              cancelUploadsRef.current = false; // Reset cancellation flag
            }, 500); // Close dialog quickly when cancellation is requested
            return prev;
          }

          const uploaded = baseUploadedRef.current + (payload.currentFileUploaded ?? payload.uploadedBytes ?? 0);
          const total = totalBytesRef.current || prev.totalBytes;
          // Use completedFiles from ref (which includes skipped files) instead of incrementing here
          // The upload loop handles incrementing completedFiles for both uploaded and skipped files
          const completedFiles =
            payload.status === "completed" ? Math.max(completedFilesRef.current, prev.completedFiles + 1) : completedFilesRef.current;

          const next: UploadTaskState = {
            ...prev,
            status: payload.status as UploadStatus,
            uploadedBytes: uploaded,
            totalBytes: total,
            completedFiles,
            totalFiles: prev.totalFiles || completedFilesRef.current || 1,
            currentFile: payload.currentFile ?? prev.currentFile,
            currentFileSize: typeof payload.currentFileSize === "number" ? payload.currentFileSize : prev.currentFileSize,
            currentFileUploaded: typeof payload.currentFileUploaded === "number" ? payload.currentFileUploaded : prev.currentFileUploaded,
            currentFileLocalPath: (payload as any).currentFileLocalPath ?? prev.currentFileLocalPath,
            speed: typeof payload.speed === "number" ? payload.speed : prev.speed,
            cancelRequested: prev.cancelRequested || cancelUploadsRef.current, // Preserve cancellation state from ref
            currentFileRemotePath: (payload as any).currentFileRemotePath ?? prev.currentFileRemotePath,
          };

          // Only show toast when ALL files are completed (not after each individual file)
          // Check if this is the final completion (all files done)
          const allFilesCompleted = next.completedFiles >= (next.totalFiles || 1);
          const wasAllCompleted = prev.completedFiles >= (prev.totalFiles || 1);

          // IMPORTANT: Only show toast for 'completed' status if ALL files are done AND we haven't shown it yet
          // The backend may send 'completed' status for each file, so we must check allFilesCompleted
          if (["failed", "cancelled"].includes(payload.status)) {
            const status = payload.status as UploadStatus;
            const targetName = prev.folderName || prev.currentFile || "upload";
            uploadCompletionToastShownRef.current = false; // Reset on failure/cancellation
            // Defer toast calls to avoid updating components during render
            setTimeout(() => {
              if (status === "failed") {
                setToast({ message: `Upload failed: ${payload.error || "Unknown error"}`, type: "error" });
              } else if (status === "cancelled") {
                setToast({ message: `Upload "${targetName}" cancelled`, type: "warning" });
              }
              if (status === "cancelled" || status === "failed") {
                setTimeout(() => {
                  setActiveUpload(null);
                  // Reset cancellation flag when upload session ends
                  cancelUploadsRef.current = false;
                }, 1000); // Reduced delay
              }
            }, 0);
          } else if (
            payload.status === "completed" &&
            allFilesCompleted &&
            !wasAllCompleted &&
            !uploadCompletionToastShownRef.current &&
            !prev.cancelRequested
          ) {
            // Only show success toast when transitioning to all-completed state (first time) and not cancelled
            uploadCompletionToastShownRef.current = true;
            const targetName = prev.folderName || prev.currentFile || "upload";
            const isSingleUpload = prev.isSingleUpload;
            // Defer toast call to avoid updating components during render
            setTimeout(() => {
              if (isSingleUpload && targetName) {
                setToast({ message: `Upload completed: ${targetName}`, type: "success" });
              } else {
                setToast({ message: "Uploaded files successfully", type: "success" });
              }
            }, 0);
          }
          // Don't show toast for intermediate file completions (status === 'completed' but not allFilesCompleted)

          return next;
        }

        return prev;
      });
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [handleNavigate, currentPath, setToast]);

  const scrollToMatch = useCallback(
    (index: number) => {
      if (index < 0 || index >= searchMatches.length || !previewContent || !searchText) return;

      // Use a timeout to ensure DOM is updated and highlighted matches are rendered
      setTimeout(() => {
        const contentElement = textPreviewRef.current;
        if (!contentElement) return;

        const matchPos = searchMatches[index];

        // Try to find the marked element for current match
        const marks = contentElement.querySelectorAll("mark");
        let targetMark: HTMLElement | null = null;
        let markIndex = 0;

        // Calculate which mark corresponds to the current match
        if (searchText && previewContent) {
          const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
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
          const scrollPosition = offsetTop - containerRect.height / 2 + rect.height / 2;

          contentElement.scrollTo({
            top: Math.max(0, scrollPosition),
            behavior: "smooth",
          });
        } else {
          // Fallback: calculate based on text position
          const textBeforeMatch = previewContent.substring(0, matchPos);
          const lineNumber = (textBeforeMatch.match(/\n/g) || []).length;
          const lineHeight = 16; // Approximate line height for monospace font
          const scrollPosition = lineNumber * lineHeight - contentElement.clientHeight / 2 + 50;

          contentElement.scrollTo({
            top: Math.max(0, scrollPosition),
            behavior: "smooth",
          });
        }
      }, 200); // Increased timeout to ensure DOM is fully updated
    },
    [searchMatches, previewContent, searchText]
  );

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
  const generatePathSuggestions = useCallback(
    async (inputPath: string) => {
      if (!inputPath || inputPath === "/") {
        setPathSuggestions([]);
        return;
      }

      setIsLoadingSuggestions(true);
      const suggestions: string[] = [];
      const endsWithSlash = inputPath.endsWith("/");
      const startsWithSlash = inputPath.startsWith("/");
      const parts = inputPath.split("/").filter(Boolean);

      try {
        // Only suggest from current directory if:
        // 1. Input doesn't start with '/' (relative path)
        // 2. Input is not a multi-level path
        // 3. Input doesn't end with '/' (which means we should show all folders in that directory)
        if (!startsWithSlash && !endsWithSlash && parts.length <= 1) {
          // First, suggest from current directory (for single-level relative paths)
          const currentDirLower = currentPath.toLowerCase();
          const inputLower = inputPath.toLowerCase();

          visibleFiles.forEach((file) => {
            if (file.type === "d") {
              const fileLower = file.name.toLowerCase();
              const currentDir = currentPath === "/" ? "" : currentPath;
              const suggestionPath = `${currentDir}/${file.name}`.replace("//", "/");

              // Check if matches current input
              if (inputLower.includes(fileLower) || fileLower.includes(inputLower.split("/").pop() || "")) {
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
            electron
              .getPathSuggestions(inputPath)
              .then((result: any) => {
                if (result.success && result.suggestions) {
                  // If path ends with '/' or starts with '/', use only API suggestions (don't merge with current dir)
                  // Otherwise, merge with current suggestions
                  const merged =
                    endsWithSlash || startsWithSlash
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
              })
              .catch(() => {
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
    },
    [currentPath, remoteFiles]
  );

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
    const normalizedPath = path.trim() || "/";
    if (normalizedPath !== currentPath) {
      await handleNavigate(normalizedPath);
    }
    setIsEditingPath(false);
    setPathInput("");
    setShowPathSuggestions(false);
  };

  const handlePathInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handlePathSubmit(pathInput);
    } else if (e.key === "Escape") {
      setIsEditingPath(false);
      setPathInput("");
      setShowPathSuggestions(false);
    } else if (e.key === "ArrowDown" && pathSuggestions.length > 0) {
      e.preventDefault();
      setPathInput(pathSuggestions[0]);
    }
  };

  const handleDownload = async (file: RemoteFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    console.log("[User Action] Download file:", {
      fileName: file.name,
      remotePath: currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`,
      siteName: currentSite?.name,
    });
    const electron = (window as any).electronAPI;
    if (!electron) {
      console.error("[Error] Electron API not available for download");
      setToast({ message: "Electron API not available", type: "error" });
      return;
    }

    const remotePath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;

    // Handle folder download differently
    if (file.type === "d") {
      handleFolderDownload(file, remotePath);
      return;
    }

    // Create download item first (localPath will be set after user selects save location)
    const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const downloadItem: DownloadItem = {
      id: downloadId,
      fileName: file.name,
      remotePath: remotePath,
      localPath: "", // Will be set after save dialog
      totalSize: file.size || 0,
      downloadedSize: 0,
      status: "queued",
      startTime: Date.now(),
      siteName: currentSite?.name, // Add site name
      siteHost: currentSite?.host, // Add site host
      siteId: currentSite?.id, // Add site ID for updates
    };

    addDownload(downloadItem);

    // Get default download path from current site
    const defaultDownloadPath = currentSite?.defaultDownloadPath;
    const actionToUse = applyToAll ? duplicateAction : null;

    // Start download (this will show save dialog in backend if no default path, or handle duplicates)
    // The backend returns immediately with actualFileName, even though the download is queued
    let downloadPromise: Promise<any>;
    try {
      console.log("[FileExplorer] Calling electron.download:", {
        downloadId,
        fileName: file.name,
        remotePath,
        defaultDownloadPath,
        defaultConflictResolution: settings.defaultConflictResolution,
      });

      downloadPromise = electron.download(
        remotePath,
        file.name,
        downloadId,
        file.size || 0,
        defaultDownloadPath,
        actionToUse || undefined,
        applyToAll,
        settings.defaultConflictResolution
      );

      console.log("[FileExplorer] electron.download called, promise created");

      // Update filename/localPath immediately when backend returns (for queued downloads)
      // The backend returns immediately with actualFileName even while queued
      // Don't update status here - it's already 'queued' and backend will update it via IPC
      downloadPromise
        .then((initialResponse: any) => {
          console.log("[FileExplorer] Download IPC response:", {
            downloadId,
            response: initialResponse,
            success: initialResponse?.success,
            error: initialResponse?.error,
            savedPath: initialResponse?.savedPath,
            actualFileName: initialResponse?.actualFileName,
          });
          if (!initialResponse) return;

          // If dialog was cancelled, remove the download (handled in main promise handler)
          if (initialResponse.dialogCancelled || initialResponse.cancelled) {
            return;
          }

          const actualFileName = initialResponse.actualFileName || file.name;
          const localPath = initialResponse.savedPath || "";
          // Only update fileName and localPath, not status (status is managed by backend IPC)
          if (actualFileName !== file.name || localPath) {
            updateDownload(
              downloadId,
              {
                fileName: actualFileName,
                localPath,
              },
              { persist: true }
            );
          }
        })
        .catch((err) => {
          // Ignore errors here - they're handled in the main catch block
          console.error("[FileExplorer] Error in download promise then handler:", { downloadId, error: err });
        });
    } catch (err: any) {
      console.error("[Error] Download failed to start:", { downloadId, fileName: file.name, error: err.message, stack: err.stack });
      updateDownload(downloadId, {
        status: "failed",
        error: err.message || "Unknown error",
        endTime: Date.now(),
      });
      setToast({ message: `Download error: ${err.message || "Unknown error"}`, type: "error" });
      return;
    }

    // Don't update status here - let the backend control it
    // The backend will send status: 'downloading' along with actualFileName and localPath
    // The promise resolves immediately even for queued downloads, so we only handle
    // immediate responses (dialog cancelled, skipped) and let backend IPC handle status updates

    downloadPromise
      .then((result: any) => {
        console.log("[FileExplorer] Download promise resolved:", {
          downloadId,
          savedPath: result?.savedPath,
          actualFileName: result?.actualFileName,
          cancelled: result?.cancelled,
          success: result?.success,
        });

        if (result?.dialogCancelled || result?.cancelled) {
          console.log("[Download] Dialog cancelled by user:", { downloadId, fileName: file.name });
          removeDownload(downloadId);
          return;
        }

        if (result?.skipped) {
          console.log("[Download] Download skipped by user:", { downloadId, fileName: file.name });
          removeDownload(downloadId);
          setToast({ message: `Download skipped: ${file.name}`, type: "info" });
          return;
        }

        // Update duplicate action preferences if user chose "apply to all"
        if (result?.applyToAll && result?.duplicateAction) {
          setDuplicateAction(result.duplicateAction);
          setApplyToAll(true);
        }

        // Don't set status here - backend IPC notifications will handle all status updates
        // (queued -> downloading -> completed/failed/cancelled)
        // The promise resolves immediately even for queued downloads, so status updates
        // must come from backend progress notifications, not from the promise resolution
        // Toast will be shown by App.tsx when status actually becomes 'completed'
      })
      .catch((err: any) => {
        // Check if this is a cancellation error - don't mark as failed if it was cancelled
        const isCancelled = err?.code === "DOWNLOAD_CANCELLED" || err?.code === "DOWNLOAD_PAUSED";
        const status: "cancelled" | "failed" = isCancelled ? "cancelled" : "failed";

        updateDownload(
          downloadId,
          {
            status,
            error: isCancelled ? undefined : err.message || "Unknown error",
            endTime: Date.now(),
          },
          { persist: true }
        );

        if (!isCancelled) {
          console.error("[Error] Download exception:", { downloadId, fileName: file.name, error: err.message });
          setToast({ message: `Download error: ${err.message || "Unknown error"}`, type: "error" });
        } else {
          console.log("[Download] Download cancelled:", { downloadId, fileName: file.name });
        }
        // Toast for cancelled will be shown from App.tsx when status changes
      });
  };

  const handleQuickView = (file: RemoteFile, e: React.MouseEvent) => {
    e.stopPropagation();
    previewFileHandler(file);
  };

  // Drag and Drop Handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // Disable drag and drop if there's an active upload
    if (isConnected && !activeUpload) setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isConnected) return;
    // Disable drag and drop if there's an active upload
    if (activeUpload) {
      setToast({ message: "Please wait for the current upload to finish", type: "warning" });
      return;
    }

    const electron = (window as any).electronAPI;
    if (!electron) return;

    const files = Array.from(e.dataTransfer.files);
    console.log("[User Action] Upload files/folders (drag & drop):", { fileCount: files.length, siteName: currentSite?.name });
    const filePayloads = await Promise.all(
      files.map(async (file) => {
        let localPath = (file as any).path as string | undefined;
        if ((!localPath || localPath.length === 0) && electron?.getPathForFile) {
          try {
            localPath = await electron.getPathForFile(file);
          } catch (err) {
            console.error("getPathForFile failed for", file.name, err);
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
          isDirectory,
        };
        console.log("[Upload] Drag file payload:", payload);
        return payload;
      })
    );

    const directories = filePayloads.filter((p) => p.isDirectory && p.localPath);
    const regularFiles = filePayloads.filter((p) => !p.isDirectory && p.localPath);
    const missingPathEntries = filePayloads.filter((p) => !p.localPath);

    missingPathEntries.forEach((entry) => {
      setToast({ message: `Cannot upload ${entry.fileName}: source path unavailable`, type: "error" });
    });

    // Recursively collect all files from folders using Electron IPC
    const collectFilesFromFolder = async (
      folderPath: string,
      folderName: string,
      baseRemotePath: string
    ): Promise<Array<{ name: string; localPath: string; remotePath: string; size: number; isFolder: boolean }>> => {
      const items: Array<{ name: string; localPath: string; remotePath: string; size: number; isFolder: boolean }> = [];

      if (!electron?.collectFolderFiles) {
        console.error("[Upload] collectFolderFiles API not available");
        return items;
      }

      try {
        const result = await electron.collectFolderFiles(folderPath, baseRemotePath);
        if (result.success) {
          // Add files
          if (result.files) {
            result.files.forEach((file: any) => {
              items.push({
                name: file.name,
                localPath: file.localPath,
                remotePath: file.remotePath,
                size: file.size,
                isFolder: false,
              });
            });
          }

          // Add empty folders (they need to be created on the server)
          if (result.emptyFolders) {
            result.emptyFolders.forEach((folder: any) => {
              items.push({
                name: folder.name,
                localPath: folder.localPath,
                remotePath: folder.remotePath,
                size: 0,
                isFolder: true, // Mark as folder so we can create it
              });
            });
          }
        } else {
          console.error(`[Upload] Failed to collect files from folder ${folderPath}:`, result.error);
        }
      } catch (err: any) {
        console.error(`[Upload] Failed to collect files from folder ${folderPath}:`, err);
      }

      return items;
    };

    // Combine all files and folders into a single upload session
    const allItems: Array<{ name: string; localPath: string; remotePath: string; size: number; isFolder: boolean }> = [];

    // Add regular files first (these are top-level)
    for (const file of regularFiles) {
      allItems.push({
        name: file.fileName,
        localPath: file.localPath as string,
        remotePath: buildRemotePath(file.fileName),
        size: file.size || 0,
        isFolder: false,
      });
    }

    // Add folders as top-level items
    // Each folder will be passed to UploadManager which will handle collecting contents and conflict resolution
    for (const dir of directories) {
      const folderLocalPath = dir.localPath as string;
      const folderRemotePath = buildRemotePath(dir.fileName);

      allItems.push({
        name: dir.fileName,
        localPath: folderLocalPath,
        remotePath: folderRemotePath,
        size: 0, // Size will be calculated by UploadManager
        isFolder: true,
      });
    }

    if (allItems.length > 0) {
      const uploadType =
        allItems.length === 1
          ? allItems[0].isFolder
            ? "single folder"
            : "single file"
          : directories.length > 0 && regularFiles.length > 0
          ? "mixed (files + folders)"
          : directories.length > 0
          ? "multiple folders"
          : "multiple files";

      console.log("[Upload] Starting unified upload session:", {
        type: uploadType,
        totalItems: allItems.length,
        fileCount: regularFiles.length,
        folderCount: directories.length,
        items: allItems.map((i) => ({ name: i.name, isFolder: i.isFolder })),
        siteName: currentSite?.name,
      });

      // Use unified upload manager for all items
      await startUnifiedUploadWrapper(allItems);
    }

    // Legacy code below - will be removed after migration is complete
    if (false && regularFiles.length > 0) {
      const totalBytes = regularFiles.reduce((sum, f) => sum + (f.size || 0), 0);
      const sessionId = `upload-session-${Date.now()}`;
      const totalFiles = regularFiles.length;
      const isSingleFile = totalFiles === 1 && directories.length === 0;
      const uploadType = isSingleFile ? "single file" : directories.length > 0 ? "mixed (files + folders)" : "multiple files";
      console.log("[Upload] Starting file upload:", {
        type: uploadType,
        fileCount: totalFiles,
        folderCount: directories.length,
        totalBytes,
        files: regularFiles.map((f) => f.fileName),
        siteName: currentSite?.name,
      });
      let completedFiles = 0;
      let baseUploaded = 0;
      baseUploadedRef.current = 0;
      completedFilesRef.current = 0;
      totalBytesRef.current = totalBytes;
      cancelUploadsRef.current = false;
      uploadCompletionToastShownRef.current = false; // Reset toast tracking for new upload session

      // Get the first file's paths for display
      const firstFile = regularFiles[0];
      const firstLocalPath = firstFile.localPath as string;
      const firstRemotePath = buildRemotePath(firstFile.fileName);

      setActiveUpload({
        id: sessionId,
        status: "starting",
        uploadedBytes: 0,
        totalBytes,
        completedFiles: 0,
        totalFiles,
        currentFile: "",
        currentFileUploaded: 0,
        currentFileSize: 0,
        speed: 0,
        folderName: isSingleFile ? regularFiles[0].fileName : directories.length > 0 ? "files" : "files",
        isSingleUpload: isSingleFile,
        siteName: currentSite?.name,
        siteHost: currentSite?.host,
        localPath: isSingleFile ? firstLocalPath : undefined, // For single file, show the file path
        remotePath: isSingleFile ? firstRemotePath : buildRemotePath(""), // For single file, show the remote path
      });

      try {
        let uploadDuplicateAction: "overwrite" | "rename" | "skip" | null = null;
        let uploadApplyToAll = false;

        for (const file of regularFiles) {
          if (cancelUploadsRef.current) break;
          const localPath = file.localPath as string;
          const fileName = file.fileName;
          let remotePath = buildRemotePath(fileName);

          // Handle duplicate using same logic as downloads
          // If "apply to all" is checked, pass the action to backend to handle without showing dialog
          console.log("[Duplicate Upload] Duplicate file detected:", {
            fileName,
            defaultConflictResolution: settings.defaultConflictResolution,
            sessionConflictResolution: uploadApplyToAll ? uploadDuplicateAction : null,
            applyToAll: uploadApplyToAll,
          });

          const duplicateResult: any = await electron.handleUploadDuplicate?.({
            remotePath,
            fileName,
            duplicateAction: uploadApplyToAll ? uploadDuplicateAction : null,
            applyToAll: uploadApplyToAll,
            defaultConflictResolution: settings.defaultConflictResolution,
          });

          // Check for cancellation first (even if success is true, cancellation takes precedence)
          if (duplicateResult?.cancelled || duplicateResult?.dialogCancelled) {
            // User cancelled duplicate dialog, stop upload and show warning toast
            cancelUploadsRef.current = true;
            setToast({ message: "Upload cancelled", type: "warning" });
            break;
          }

          if (!duplicateResult?.success) {
            // Error (but not cancelled - that's handled above)
            // Skip this file - count it as completed
            completedFiles += 1;
            completedFilesRef.current = completedFiles;
            setActiveUpload((prev) =>
              prev
                ? {
                    ...prev,
                    completedFiles,
                    totalFiles,
                  }
                : prev
            );
            continue;
          }

          if (duplicateResult.skipped) {
            // Skip this file - count it as completed
            completedFiles += 1;
            completedFilesRef.current = completedFiles;
            setActiveUpload((prev) =>
              prev
                ? {
                    ...prev,
                    completedFiles,
                    totalFiles,
                  }
                : prev
            );
            // Update duplicate action preferences if user chose "apply to all"
            if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
              uploadDuplicateAction = duplicateResult.duplicateAction;
              uploadApplyToAll = true;
            }
            continue;
          }

          // Update duplicate action preferences if user chose "apply to all"
          if (duplicateResult.applyToAll && duplicateResult.duplicateAction) {
            uploadDuplicateAction = duplicateResult.duplicateAction;
            uploadApplyToAll = true;
          }

          // Check if upload was cancelled before attempting upload
          if (cancelUploadsRef.current) {
            console.log("[Upload] Upload cancelled before starting:", { fileName });
            break;
          }

          // Use the resolved remote path (may be renamed)
          remotePath = duplicateResult.remotePath;

          // Validate remotePath before attempting upload
          if (!remotePath || remotePath === "") {
            console.error("[Error] Invalid remote path after duplicate resolution:", { fileName, remotePath });
            setToast({ message: `Failed to upload ${fileName}: Invalid remote path`, type: "error" });
            break;
          }

          const uploadId = `${sessionId}-${fileName}-${Math.random().toString(36).slice(2, 6)}`;
          currentFileUploadIdRef.current = uploadId;
          completedFilesRef.current = completedFiles;
          baseUploadedRef.current = baseUploaded;

          setActiveUpload((prev) =>
            prev
              ? {
                  ...prev,
                  status: "uploading",
                  currentFile: fileName,
                  currentFileSize: file.size,
                  currentFileUploaded: 0,
                  currentFileLocalPath: localPath, // Store local path for current file
                  uploadedBytes: baseUploaded,
                  completedFiles,
                  totalFiles,
                  currentFileRemotePath: remotePath, // Store final remote path (may be renamed)
                  remotePath: isSingleFile ? remotePath : prev.remotePath, // Update remotePath for single file uploads
                  cancelRequested: prev.cancelRequested || cancelUploadsRef.current, // Preserve cancellation state
                }
              : prev
          );

          // Check for cancellation again before starting upload (in case it was cancelled during duplicate dialog)
          if (cancelUploadsRef.current) {
            console.log("[Upload] Upload cancelled before starting file upload:", { fileName });
            break;
          }

          // Before starting upload, check if cancellation was requested and cancel the current file's upload
          if (cancelUploadsRef.current && currentFileUploadIdRef.current) {
            console.log("[Upload] Cancellation requested, cancelling current file upload:", {
              fileName,
              uploadId: currentFileUploadIdRef.current,
            });
            try {
              await electron.cancelUpload(currentFileUploadIdRef.current);
            } catch (err: any) {
              console.log("[Upload] Cancel request for current file uploadId not found:", {
                uploadId: currentFileUploadIdRef.current,
                error: err.message,
              });
            }
            break;
          }

          const result = await electron.upload(localPath, remotePath, uploadId, settings.defaultConflictResolution);

          // Check for cancellation after upload completes (in case it was cancelled during upload)
          if (cancelUploadsRef.current) {
            console.log("[Upload] Upload cancelled during file upload:", { fileName, uploadId });
            break;
          }
          if (!result.success) {
            // Check if upload was cancelled (either by user or due to duplicate dialog cancellation)
            if (cancelUploadsRef.current || (result.error && result.error.includes("cancelled"))) {
              console.log("[Upload] Upload cancelled:", { fileName, uploadId });
              // Don't show toast here if we already showed it for duplicate dialog cancellation
              if (!cancelUploadsRef.current) {
                setToast({ message: "Upload cancelled", type: "warning" });
              }
            } else {
              console.error("[Error] Upload failed:", { fileName, error: result.error, uploadId });
              setToast({ message: `Failed to upload ${fileName}: ${result.error}`, type: "error" });
            }
            break;
          }

          // Wait for final progress update to mark completion
          baseUploaded += file.size;
          completedFiles += 1;
          baseUploadedRef.current = baseUploaded;
          completedFilesRef.current = completedFiles;

          // Only show toast when all files are completed (not after each file)
          const allFilesCompleted = completedFiles === totalFiles;

          setActiveUpload((prev) => {
            if (!prev) return prev;
            const wasAllCompleted = prev.completedFiles >= (prev.totalFiles || 1);
            const updated = {
              ...prev,
              status: allFilesCompleted ? "completed" : ("uploading" as UploadStatus),
              uploadedBytes: baseUploaded,
              completedFiles,
              cancelRequested: prev.cancelRequested || cancelUploadsRef.current, // Preserve cancellation state
              currentFileUploaded: file.size,
              currentFile: fileName,
              currentFileLocalPath: localPath, // Store local path for current file
              currentFileRemotePath: remotePath, // Store final remote path (may be renamed)
            };

            // Only show toast when transitioning to all-completed state (first time)
            if (allFilesCompleted && !wasAllCompleted && !uploadCompletionToastShownRef.current) {
              uploadCompletionToastShownRef.current = true;
              const targetName = updated.folderName || updated.currentFile || "upload";
              const isSingleUpload = updated.isSingleUpload;
              if (isSingleUpload && targetName) {
                setToast({ message: `Upload completed: ${targetName}`, type: "success" });
              } else {
                setToast({ message: "Uploaded files successfully", type: "success" });
              }
            }

            return updated;
          });
        }
      } finally {
        const finalStatus = completedFiles === totalFiles ? "completed" : "cancelled";
        console.log("[Upload] Upload session finished:", {
          sessionId,
          status: finalStatus,
          completedFiles,
          totalFiles,
          totalBytes,
        });
        setTimeout(() => {
          setActiveUpload(null);
          // Reset cancellation flag when upload session ends
          cancelUploadsRef.current = false;
        }, 1500);
        await handleNavigate(currentPath);
      }
    }
  };

  const openProperties = (file: RemoteFile, e: React.MouseEvent) => {
    e.stopPropagation();
    setPropertiesFile(file);
    // Convert rights object to string if needed or just show raw
    let perms = file.rights;
    if (typeof perms === "object") {
      perms = `${perms.user}${perms.group}${perms.other}`;
    }
    setNewPermissions(perms ? perms.toString() : "755");
  };

  const savePermissions = async () => {
    if (!propertiesFile) return;
    console.log("[User Action] Change permissions:", {
      fileName: propertiesFile.name,
      permissions: newPermissions,
      siteName: currentSite?.name,
    });
    const electron = (window as any).electronAPI;
    if (electron) {
      const remotePath = currentPath === "/" ? `/${propertiesFile.name}` : `${currentPath}/${propertiesFile.name}`;
      setLoading(true);
      try {
        const result = await electron.chmod(remotePath, newPermissions);
        setLoading(false);

        if (result.success) {
          console.log("[Success] Permissions changed:", { fileName: propertiesFile.name, permissions: newPermissions });
          setPropertiesFile(null);
          handleNavigate(currentPath); // Refresh
        } else {
          console.error("[Error] Failed to change permissions:", { fileName: propertiesFile.name, error: result.error });
          alert("Failed to change permissions: " + result.error);
        }
      } catch (err: any) {
        setLoading(false);
        console.error("[Error] Change permissions exception:", { fileName: propertiesFile.name, error: err.message });
        alert("Failed to change permissions: " + err.message);
      }
    }
  };

  if (!isConnected) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Select a site to connect</div>;
  }

  return (
    <div className="flex-1 flex flex-col bg-background relative h-full" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
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

      {/* File Preview (Image & Text) */}
      {(previewImage || previewContent) && (
        <FilePreview
          previewImage={previewImage}
          previewContent={previewContent}
          previewFileName={previewFileName}
          previewRemotePath={previewRemotePath}
          previewFileInfo={previewFileInfo}
          tempFilePath={tempFilePath}
          imageScale={imageScale}
          originalImageSize={originalImageSize}
          searchText={searchText}
          searchMatches={searchMatches}
          currentMatchIndex={currentMatchIndex}
          textPreviewRef={textPreviewRef}
          imageContainerRef={imageContainerRef}
          sidebarWidth={sidebarWidth}
          downloadManagerWidth={downloadManagerWidth}
          showDownloadManager={showDownloadManager}
          onImageLoad={handleImageLoad}
          onImageZoom={handleImageZoom}
          onSearchChange={setSearchText}
          onPrevMatch={handlePrevMatch}
          onNextMatch={handleNextMatch}
          onClose={handleClosePreview}
          onSaveFile={handleSavePreviewFile}
          setToast={setToast}
        />
      )}
      <FileDialogs
        deleteDialog={deleteDialog}
        onCloseDeleteDialog={closeDeleteDialog}
        onExecuteDelete={executeDelete}
        onDeleteConfirmChange={(checked) => setDeleteDialog((prev) => ({ ...prev, confirmChecked: checked }))}
        propertiesFile={propertiesFile}
        currentPath={currentPath}
        onCloseProperties={() => setPropertiesFile(null)}
        isCreateFolderOpen={isCreateFolderModalOpen}
        newFolderName={newFolderName}
        onFolderNameChange={setNewFolderName}
        onCloseCreateFolder={() => setIsCreateFolderModalOpen(false)}
        onSubmitCreateFolder={submitCreateFolder}
      />

      {/* Rename Dialog */}
      {renameDialog && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card border border-border rounded-lg shadow-lg w-[320px] max-w-full p-4 space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-1">Rename {renameDialog.file.type === "d" ? "Folder" : "File"}</h2>
              <p className="text-xs text-muted-foreground">Enter a new name for "{renameDialog.file.name}"</p>
            </div>
            <input
              type="text"
              value={renameDialog.newName}
              onChange={(e) => setRenameDialog({ ...renameDialog, newName: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenameDialog(null);
              }}
              className="w-full px-3 py-2 bg-input border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              placeholder="New name"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenameDialog(null)} className="px-3 py-1.5 text-sm hover:bg-accent rounded">
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
                disabled={renameDialog.newName.trim().length === 0}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Dialog */}
      {batchDeleteConfirm &&
        (() => {
          const { fileNames } = batchDeleteConfirm;
          const maxDisplay = 10;
          const displayNames = fileNames.slice(0, maxDisplay).map((name) => truncateFileName(name, 36));
          const remaining = fileNames.length - maxDisplay;
          const message = displayNames.join("\n") + (remaining > 0 ? `\n... and ${remaining} more` : "");

          return (
            <ConfirmDialog
              title="Delete Multiple Files"
              message={`Are you sure you want to delete ${fileNames.length} file${fileNames.length > 1 ? "s" : ""}?\n\n${message}`}
              onConfirm={executeBatchDelete}
              onCancel={() => setBatchDeleteConfirm(null)}
              confirmText="Delete"
              cancelText="Cancel"
              variant="danger"
            />
          );
        })()}

      {/* File Context Menu */}
      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onDownload={() => {
            handleDownload(contextMenu.file);
            setContextMenu(null);
          }}
          onPreview={() => {
            previewFileHandler(contextMenu.file);
            setContextMenu(null);
          }}
          onInfo={() => {
            setPropertiesFile(contextMenu.file);
            setContextMenu(null);
          }}
          onRename={() => {
            setRenameDialog({ file: contextMenu.file, newName: contextMenu.file.name });
            setContextMenu(null);
          }}
          onDelete={() => {
            openDeleteDialog(contextMenu.file);
            setContextMenu(null);
          }}
          onSelect={() => {
            if (contextMenu.file.type !== "d") {
              const newSelected = new Set(selectedFiles);
              if (newSelected.has(contextMenu.file.name)) {
                newSelected.delete(contextMenu.file.name);
              } else {
                newSelected.add(contextMenu.file.name);
              }
              setSelectedFiles(newSelected);
            }
          }}
          isInMultiSelectMode={selectedFiles.size > 0}
          isSelected={selectedFiles.has(contextMenu.file.name)}
        />
      )}

      {activeUpload && (
        <UploadProgressDialog
          upload={activeUpload}
          onClose={() => {
            setActiveUpload(null);
            cancelUploadsRef.current = false; // Reset cancellation flag
          }}
          onCancel={handleCancelUpload}
        />
      )}

      {/* Preview Modal for Images */}
      {/* Properties Modal */}
      {/* Toolbar / Address Bar */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-2 bg-card/50 relative">
        <button onClick={handleUp} disabled={currentPath === "/"} className="p-1.5 hover:bg-accent rounded disabled:opacity-50">
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
                  if (value && value !== "/") {
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
                    if (!document.activeElement?.closest(".path-suggestions-container")) {
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
                    <div className="px-3 py-2 text-xs text-muted-foreground text-center">Loading suggestions...</div>
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
          <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
        </button>
        <button onClick={handleCreateFolder} className="p-1.5 hover:bg-accent rounded" title="New folder">
          <FolderPlus size={16} />
        </button>
        <button
          onClick={() => {
            if (selectedFiles.size > 0) {
              // Download multiple files
              const fileNames = Array.from(selectedFiles);
              fileNames.forEach((name) => {
                const file = remoteFiles.find((f) => f.name === name);
                if (file) handleDownload(file);
              });
              // Exit multi-select mode after starting downloads
              setSelectedFiles(new Set());
            }
          }}
          disabled={selectedFiles.size === 0}
          className="p-1.5 hover:bg-accent rounded disabled:opacity-50"
          title={
            selectedFiles.size > 0
              ? `Download ${selectedFiles.size} selected file${selectedFiles.size > 1 ? "s" : ""}`
              : "Select files to download"
          }
        >
          <Download size={16} />
        </button>
        <button
          onClick={handleDeleteSelected}
          disabled={selectedFiles.size === 0}
          className="p-1.5 hover:bg-accent rounded disabled:opacity-50"
          title={
            selectedFiles.size > 0
              ? `Delete ${selectedFiles.size} selected file${selectedFiles.size > 1 ? "s" : ""}`
              : "Select files to delete"
          }
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* File List Header */}
      <div className="grid grid-cols-12 px-4 py-2 border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground">
        <div
          className="col-span-6 flex items-center gap-1 cursor-pointer hover:text-foreground select-none transition-colors"
          onClick={() => handleSort("name")}
        >
          Name
          {sortColumn === "name" && (sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </div>
        <div
          className="col-span-2 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-foreground select-none transition-colors"
          onClick={() => handleSort("size")}
        >
          Size
          {sortColumn === "size" && (sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </div>
        <div
          className="col-span-2 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-foreground select-none transition-colors"
          onClick={() => handleSort("modified")}
        >
          Modified
          {sortColumn === "modified" && (sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </div>
        <div className="col-span-2 text-center">Actions</div>
      </div>

      {/* File List Container with Banner */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* File List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {sortedFiles.map((file, idx) => (
            <div
              key={idx}
              style={{ animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}
              onClick={() => handleItemClick(file)}
              onDoubleClick={() => handleItemDoubleClick(file)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ file, x: e.clientX, y: e.clientY });
              }}
              className={clsx(
                "grid grid-cols-12 px-4 py-2 items-center group text-sm border-b border-border/50 transition-colors opacity-0 animate-slide-in",
                file.type === "d" ? "cursor-pointer" : "cursor-default",
                selectedFile === file.name
                  ? file.type === "d"
                    ? "bg-blue-500/20"
                    : "bg-accent"
                  : selectedFiles.has(file.name)
                  ? "bg-primary/20"
                  : "hover:bg-accent/50"
              )}
            >
              <div className="col-span-6 flex items-center gap-2 overflow-hidden">
                {selectedFiles.size > 0 && file.type !== "d" && (
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.name)}
                    onChange={() => handleItemClick(file)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-border cursor-pointer"
                  />
                )}
                {file.type === "d" ? (
                  <Folder size={16} className="text-blue-400 fill-blue-400/20" />
                ) : (
                  <File size={16} className="text-slate-400" />
                )}
                <span className={`truncate ${file.name.startsWith(".") ? "text-muted-foreground/60 italic" : ""}`}>{file.name}</span>
                {file.name.startsWith(".") && (
                  <span className="text-[9px] px-1 py-0.5 bg-muted/40 text-muted-foreground rounded flex-shrink-0">Hidden</span>
                )}
              </div>
              <div className="col-span-2 text-right text-muted-foreground text-xs">{file.type === "d" ? "-" : formatBytes(file.size)}</div>
              <div className="col-span-2 text-right text-muted-foreground text-xs">{format(file.date, "MMM d, yy HH:mm")}</div>
              <div
                className={clsx(
                  "col-span-2 flex items-center justify-center gap-1 transition-opacity",
                  selectedFile === file.name ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <button
                  onClick={(e) => openProperties(file, e)}
                  className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all"
                  title="Properties"
                >
                  <Info size={14} />
                </button>
                {file.type !== "d" ? (
                  <>
                    {isPreviewableFile(file.name) && (
                      <button
                        onClick={(e) => handleQuickView(file, e)}
                        className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all"
                        title="Quick View"
                      >
                        <Eye size={14} />
                      </button>
                    )}
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
                    setRenameDialog({ file, newName: file.name });
                  }}
                  className="p-1 hover:bg-accent/80 hover:text-primary hover:scale-110 rounded transition-all"
                  title="Rename"
                >
                  <Edit size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDeleteDialog(file);
                  }}
                  className="p-1 hover:bg-red-500/20 hover:text-red-400 hover:scale-110 rounded transition-all"
                  title={`Delete ${file.type === "d" ? "folder" : "file"}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Multi-Select Banner */}
        {selectedFiles.size > 0 && <MultiSelectBanner selectedCount={selectedFiles.size} onCancel={() => setSelectedFiles(new Set())} />}
      </div>

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
};

export default FileExplorer;

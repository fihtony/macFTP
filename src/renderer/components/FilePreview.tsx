// File Preview Component - Image and Text preview with controls
import React, { useCallback, useEffect } from 'react';
import { X, Save, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { RemoteFile } from '../store';
import { formatBytes, formatDate, getFileType } from '../utils/formatters';

interface FilePreviewProps {
  // Image preview
  previewImage: string | null;
  previewFileName: string | null;
  previewRemotePath: string | null;
  previewFileInfo: RemoteFile | null;
  tempFilePath: string | null;
  imageScale: 'fit' | '1:1' | number;
  originalImageSize: { width: number; height: number } | null;
  onImageLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onImageZoom: (action: 'fit' | '1:1' | 'in' | 'out') => void;
  
  // Text preview
  previewContent: string | null;
  searchText: string;
  searchMatches: number[];
  currentMatchIndex: number;
  onSearchChange: (text: string) => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  textPreviewRef: React.RefObject<HTMLPreElement | null>;
  imageContainerRef: React.RefObject<HTMLDivElement | null>;
  
  // Common
  sidebarWidth: number;
  downloadManagerWidth: number;
  showDownloadManager: boolean;
  onClose: (options?: { skipToast?: boolean; toastMessage?: string }) => void;
  onSaveFile: () => Promise<void>;
  setToast: (toast: { message: string; type: 'success' | 'error' | 'info' | 'warning' } | null) => void;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  previewImage,
  previewFileName,
  previewRemotePath,
  previewFileInfo,
  tempFilePath,
  imageScale,
  originalImageSize,
  onImageLoad,
  onImageZoom,
  imageContainerRef,
  previewContent,
  searchText,
  searchMatches,
  currentMatchIndex,
  onSearchChange,
  onPrevMatch,
  onNextMatch,
  textPreviewRef,
  sidebarWidth,
  downloadManagerWidth,
  showDownloadManager,
  onClose,
  onSaveFile,
  setToast
}) => {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (previewContent && e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        // Focus search input
      } else if (previewContent && searchText && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onPrevMatch();
        } else {
          onNextMatch();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, previewContent, searchText, onPrevMatch, onNextMatch]);

  // Text Preview
  if (previewContent !== null) {
    return (
      <div
        className="fixed z-50 bg-background/95 backdrop-blur flex flex-col"
        style={{
          top: '32px',
          left: `${sidebarWidth}px`,
          right: showDownloadManager ? `${downloadManagerWidth}px` : '0px',
          bottom: '0px'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground mb-1">{previewFileName}</div>
            {previewFileInfo && (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Size: {formatBytes(previewFileInfo.size)}</span>
                <span>Type: {getFileType(previewFileInfo.name, previewFileInfo.type)}</span>
                {previewFileInfo.date && <span>Modified: {formatDate(previewFileInfo.date)}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(previewRemotePath || tempFilePath) && previewFileName && (
              <button
                onClick={onSaveFile}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
                title="Save file"
              >
                <Save size={20} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
              title="Close preview"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-4 py-2 bg-background/60 border-b border-border flex items-center gap-2">
          <Search size={16} className="text-muted-foreground" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search in file..."
            className="flex-1 bg-input border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchMatches.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>
                {currentMatchIndex + 1} / {searchMatches.length}
              </span>
              <button
                onClick={onPrevMatch}
                className="px-2 py-1 hover:bg-accent rounded"
                title="Previous match (Shift+Enter)"
              >
                ↑
              </button>
              <button
                onClick={onNextMatch}
                className="px-2 py-1 hover:bg-accent rounded"
                title="Next match (Enter)"
              >
                ↓
              </button>
            </div>
          )}
        </div>

        {/* Text content */}
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
                if (match.index > lastIndex) {
                  parts.push(previewContent.substring(lastIndex, match.index));
                }

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
    );
  }

  // Image Preview
  if (previewImage !== null) {
    return (
      <div
        className="fixed z-50 bg-background/95 backdrop-blur flex flex-col"
        style={{
          top: '32px',
          left: `${sidebarWidth}px`,
          right: showDownloadManager ? `${downloadManagerWidth}px` : '0px',
          bottom: '0px'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground mb-1">{previewFileName}</div>
            {previewFileInfo && (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Size: {formatBytes(previewFileInfo.size)}</span>
                <span>Type: {getFileType(previewFileInfo.name, previewFileInfo.type)}</span>
                {previewFileInfo.date && <span>Modified: {formatDate(previewFileInfo.date)}</span>}
                {previewFileInfo.owner && (
                  <span>Owner: {typeof previewFileInfo.owner === 'object' ? (previewFileInfo.owner as any).user || 'N/A' : previewFileInfo.owner}</span>
                )}
                {previewFileInfo.group && (
                  <span>Group: {typeof previewFileInfo.group === 'object' ? (previewFileInfo.group as any).name || 'N/A' : previewFileInfo.group}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(previewRemotePath || tempFilePath) && previewFileName && (
              <button
                onClick={onSaveFile}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
                title="Save file"
              >
                <Save size={20} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
              title="Close preview"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Image container */}
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
              setToast({ message: 'Failed to load image preview. The file may be corrupted or in an unsupported format.', type: 'error' });
            }}
            onLoad={onImageLoad}
          />
        </div>

        {/* Zoom controls */}
        <div className="fixed bottom-4 right-4 flex flex-col gap-1 bg-background/50 backdrop-blur-sm border border-border/50 rounded-md p-1 shadow-lg z-[60]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImageZoom('1:1');
            }}
            className={`px-2 py-1 hover:bg-accent/50 rounded transition-colors text-[10px] font-mono ${imageScale === '1:1' ? 'bg-accent/50' : ''}`}
            title="1:1 - Original size"
          >
            1:1
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImageZoom('fit');
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
              onImageZoom('in');
            }}
            className="px-2 py-1 hover:bg-accent/50 rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImageZoom('out');
            }}
            className="px-2 py-1 hover:bg-accent/50 rounded transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
        </div>
      </div>
    );
  }

  return null;
};


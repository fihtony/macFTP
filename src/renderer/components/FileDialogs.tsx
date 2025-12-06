// File Dialogs Component - Delete, Properties, Create Folder
import React from 'react';
import { X } from 'lucide-react';
import { RemoteFile } from '../store';
import { formatBytes, formatDate, getFileType } from '../utils/formatters';

// ============================================================================
// Types
// ============================================================================

export interface DeleteDialogState {
  file: RemoteFile | null;
  requireRecursiveConfirm: boolean;
  confirmChecked: boolean;
  loading: boolean;
  isDeleting: boolean;
}

interface FileDialogsProps {
  // Delete Dialog
  deleteDialog: DeleteDialogState;
  onCloseDeleteDialog: () => void;
  onExecuteDelete: () => void;
  onDeleteConfirmChange: (checked: boolean) => void;

  // Properties Dialog
  propertiesFile: RemoteFile | null;
  currentPath: string;
  onCloseProperties: () => void;

  // Create Folder Dialog
  isCreateFolderOpen: boolean;
  newFolderName: string;
  onFolderNameChange: (name: string) => void;
  onCloseCreateFolder: () => void;
  onSubmitCreateFolder: () => void;
}

export const FileDialogs: React.FC<FileDialogsProps> = ({
  deleteDialog,
  onCloseDeleteDialog,
  onExecuteDelete,
  onDeleteConfirmChange,
  propertiesFile,
  currentPath,
  onCloseProperties,
  isCreateFolderOpen,
  newFolderName,
  onFolderNameChange,
  onCloseCreateFolder,
  onSubmitCreateFolder
}) => {
  return (
    <>
      {/* Delete Dialog */}
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
                            onChange={(e) => onDeleteConfirmChange(e.target.checked)}
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
                onClick={onCloseDeleteDialog}
                className="px-3 py-1.5 text-sm hover:bg-accent rounded disabled:opacity-50"
                disabled={deleteDialog.isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={onExecuteDelete}
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

      {/* Properties Dialog */}
      {propertiesFile && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
          onClick={onCloseProperties}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-lg w-[400px] max-w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">File Properties</h2>
              <button
                onClick={onCloseProperties}
                className="p-1.5 hover:bg-accent rounded"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Name:</span>
                <span className="col-span-2 break-all">{propertiesFile.name}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Type:</span>
                <span className="col-span-2">
                  {propertiesFile.type === 'd' ? 'Directory' : 'File'}
                  {propertiesFile.name.startsWith('.') && (
                    <span className="ml-2 text-xs text-muted-foreground/70">(Hidden)</span>
                  )}
                </span>
              </div>
              {propertiesFile.type !== 'd' && (
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">Size:</span>
                  <span className="col-span-2">{formatBytes(propertiesFile.size)}</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Modified:</span>
                <span className="col-span-2">{formatDate(propertiesFile.date)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Path:</span>
                <span className="col-span-2 text-xs break-all font-mono">
                  {currentPath === '/' ? `/${propertiesFile.name}` : `${currentPath}/${propertiesFile.name}`}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Owner:</span>
                <span className="col-span-2">
                  {typeof propertiesFile.owner === 'object'
                    ? (propertiesFile.owner as any).user || 'N/A'
                    : propertiesFile.owner || 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Group:</span>
                <span className="col-span-2">
                  {typeof propertiesFile.group === 'object'
                    ? (propertiesFile.group as any).name || 'N/A'
                    : propertiesFile.group || 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground">Permissions:</span>
                <span className="col-span-2 font-mono text-xs">
                  {typeof propertiesFile.rights === 'object'
                    ? `${(propertiesFile.rights as any).user || ''}${(propertiesFile.rights as any).group || ''}${(propertiesFile.rights as any).other || ''}`
                    : propertiesFile.rights || 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Dialog */}
      {isCreateFolderOpen && (
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
              onChange={(e) => onFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmitCreateFolder();
                if (e.key === 'Escape') onCloseCreateFolder();
              }}
              className="w-full px-3 py-2 bg-input border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              placeholder="Folder name"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={onCloseCreateFolder}
                className="px-3 py-1.5 text-sm hover:bg-accent rounded"
              >
                Cancel
              </button>
              <button
                onClick={onSubmitCreateFolder}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
                disabled={newFolderName.trim().length === 0}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};


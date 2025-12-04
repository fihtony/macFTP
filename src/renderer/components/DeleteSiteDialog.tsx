import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Site } from '../store';

interface DeleteSiteDialogProps {
  isOpen: boolean;
  site: Site | null;
  onClose: () => void;
  onConfirm: () => void;
}

const DeleteSiteDialog: React.FC<DeleteSiteDialogProps> = ({ isOpen, site, onClose, onConfirm }) => {
  if (!isOpen || !site) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-destructive" />
            <h2 className="text-lg font-semibold">Delete Site</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-foreground">
            Are you sure you want to delete this site? This action cannot be undone.
          </p>

          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Site Name:</span>
              <span className="text-sm font-semibold">{site.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Host:</span>
              <span className="text-sm font-mono">{site.host}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">User:</span>
              <span className="text-sm">{site.user}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Protocol:</span>
              <span className="text-sm uppercase">{site.protocol}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 hover:bg-accent rounded text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="px-4 py-2 bg-destructive text-destructive-foreground rounded text-sm hover:opacity-90 transition-opacity"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteSiteDialog;


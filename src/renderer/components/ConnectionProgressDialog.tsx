import React from 'react';
import { Loader2, X } from 'lucide-react';

interface ConnectionProgressDialogProps {
  siteName: string;
  host: string;
  onCancel?: () => void;
}

const ConnectionProgressDialog: React.FC<ConnectionProgressDialogProps> = ({ 
  siteName, 
  host,
  onCancel 
}) => {
  return (
    <div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur flex items-center justify-center">
      <div className="bg-card border border-border rounded-lg shadow-xl p-6 w-96 max-w-full">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Connecting...</h3>
            <p className="text-sm font-medium text-foreground">{siteName}</p>
            <p className="text-xs text-muted-foreground mt-1">{host}</p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-1 hover:bg-accent rounded transition-colors"
              title="Cancel connection"
            >
              <X size={18} />
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Establishing connection...</span>
        </div>
      </div>
    </div>
  );
};

export default ConnectionProgressDialog;

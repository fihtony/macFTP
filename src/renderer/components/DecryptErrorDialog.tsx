import React from "react";
import { AlertCircle, X } from "lucide-react";

interface DecryptErrorDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
}

const DecryptErrorDialog: React.FC<DecryptErrorDialogProps> = ({ isOpen, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-2xl p-6 w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} className="text-destructive" />
            <h2 className="text-lg font-semibold">Decryption Failed</h2>
          </div>
          <button onClick={onConfirm} title="Close dialog" className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Message */}
        <p className="text-sm text-muted-foreground mb-6">Failed to decrypt the site configuration. This could happen if:</p>

        {/* Error Reasons */}
        <ul className="text-sm text-muted-foreground space-y-2 mb-6 ml-4">
          <li className="list-disc">The password you entered is incorrect</li>
          <li className="list-disc">The export file has been corrupted or modified</li>
          <li className="list-disc">The file was exported with a different version</li>
        </ul>

        {/* Action */}
        <div className="flex justify-end">
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90 rounded transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default DecryptErrorDialog;

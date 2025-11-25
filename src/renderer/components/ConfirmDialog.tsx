import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning'
}) => {
  return (
    <div className="fixed inset-0 z-[300] bg-background/80 backdrop-blur flex items-center justify-center">
      <div className="bg-card border border-border rounded-lg shadow-xl p-6 w-96 max-w-full">
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-2 rounded-full ${
            variant === 'danger' ? 'bg-red-500/20' :
            variant === 'warning' ? 'bg-yellow-500/20' :
            'bg-blue-500/20'
          }`}>
            <AlertTriangle size={24} className={
              variant === 'danger' ? 'text-red-500' :
              variant === 'warning' ? 'text-yellow-500' :
              'text-blue-500'
            } />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded transition-colors ${
              variant === 'danger'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : variant === 'warning'
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

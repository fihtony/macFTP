import React, { useEffect } from 'react';
import { X, CheckCircle2 } from 'lucide-react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
  showDownloadManager?: boolean;
  downloadManagerWidth?: number;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info', duration = 3000, onClose, showDownloadManager = false, downloadManagerWidth = 320 }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  // Calculate right offset based on download manager visibility
  const rightOffset = showDownloadManager ? `${downloadManagerWidth}px` : '0px';
  
  return (
    <div 
      className="fixed bottom-0 left-64 z-[100]"
      style={{ 
        right: rightOffset,
        animation: 'slideInUpBanner 0.3s ease-out forwards'
      }}
    >
      <div 
        className={`
          flex items-center justify-between gap-3 px-4 h-[22px] border-t
          ${
            type === 'success' 
              ? 'bg-green-500/95 text-white border-green-600' 
              : type === 'error'
              ? 'bg-red-500/95 text-white border-red-600'
              : 'bg-background/95 text-foreground border-border'
          }
        `}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {type === 'success' && <CheckCircle2 size={12} className="flex-shrink-0" />}
          {type === 'error' && <X size={12} className="flex-shrink-0" />}
          <span className="text-[11px] font-medium truncate">{message}</span>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 p-0.5 hover:bg-black/20 rounded transition-colors"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

export default Toast;


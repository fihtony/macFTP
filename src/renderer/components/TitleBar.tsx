import React from 'react';
import { Minus, Square, X, Moon, Sun, Download } from 'lucide-react';
import { useStore } from '../store';

interface TitleBarProps {
  onToggleDownloadManager?: () => void;
  showDownloadManager?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({ onToggleDownloadManager, showDownloadManager }) => {
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);

  const handleMinimize = () => {
    const electron = (window as any).electronAPI;
    if (electron) electron.minimizeWindow();
  };

  const handleMaximize = () => {
    const electron = (window as any).electronAPI;
    if (electron) electron.maximizeWindow();
  };

  const handleClose = () => {
    const electron = (window as any).electronAPI;
    if (electron) electron.closeWindow();
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  return (
    <div 
      className="h-8 bg-background/80 backdrop-blur-sm border-b border-border flex items-center justify-between px-2 fixed top-0 left-0 right-0 z-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left side - Mac traffic lights or empty on other platforms */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {isMac ? (
          <>
            <button
              onClick={handleClose}
              className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center group"
              title="Close"
            >
              <X size={8} className="text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              onClick={handleMinimize}
              className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors flex items-center justify-center group"
              title="Minimize"
            >
              <Minus size={8} className="text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              onClick={handleMaximize}
              className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors flex items-center justify-center group"
              title="Maximize"
            >
              <Square size={8} className="text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleClose}
              className="w-6 h-6 hover:bg-destructive/20 rounded flex items-center justify-center transition-colors"
              title="Close"
            >
              <X size={14} />
            </button>
            <button
              onClick={handleMinimize}
              className="w-6 h-6 hover:bg-accent rounded flex items-center justify-center transition-colors"
              title="Minimize"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={handleMaximize}
              className="w-6 h-6 hover:bg-accent rounded flex items-center justify-center transition-colors"
              title="Maximize"
            >
              <Square size={12} />
            </button>
          </>
        )}
      </div>

      {/* Center - App title */}
      <div className="flex-1 text-center text-xs font-medium text-muted-foreground pointer-events-none">
        MacFTP
      </div>

      {/* Right side - Action buttons */}
      <div 
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Theme toggle button */}
        <button
          onClick={toggleTheme}
          className="w-6 h-6 hover:bg-accent rounded flex items-center justify-center transition-colors relative group"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <Sun size={14} className="text-foreground" />
          ) : (
            <Moon size={14} className="text-foreground" />
          )}
        </button>

        {/* Download manager toggle button */}
        {onToggleDownloadManager && (
          <button
            onClick={onToggleDownloadManager}
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors relative group ${
              showDownloadManager 
                ? 'bg-primary text-primary-foreground' 
                : 'hover:bg-accent'
            }`}
            title={showDownloadManager ? 'Hide download manager' : 'Show download manager'}
          >
            <Download size={14} className={showDownloadManager ? 'text-primary-foreground' : 'text-foreground'} />
          </button>
        )}
      </div>
    </div>
  );
};

export default TitleBar;

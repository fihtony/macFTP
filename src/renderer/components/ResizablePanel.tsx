import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (width: number) => void;
  position?: 'left' | 'right';
  className?: string;
}

const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  defaultWidth = 256,
  minWidth = 150,
  maxWidth = 800,
  onResize,
  position = 'left',
  className = ''
}) => {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const delta = position === 'right' 
        ? startXRef.current - e.clientX  // Reverse for right panel
        : e.clientX - startXRef.current;
      
      let newWidth = startWidthRef.current + delta;
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      setWidth(newWidth);
      if (onResize) {
        onResize(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, minWidth, maxWidth, position, onResize]);

  return (
    <div
      ref={panelRef}
      className={`relative ${className}`}
      style={{ width: `${width}px`, flexShrink: 0 }}
    >
      {children}
      <div
        className={`absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors z-10 ${
          position === 'right' ? 'left-0' : 'right-0'
        }`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

export default ResizablePanel;

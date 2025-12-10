import React from "react";
import { X } from "lucide-react";

interface MultiSelectBannerProps {
  selectedCount: number;
  onCancel: () => void;
}

const MultiSelectBanner: React.FC<MultiSelectBannerProps> = ({ selectedCount, onCancel }) => {
  return (
    <div className="w-full h-[22px] px-4 border-t border-primary/30 bg-primary/10 flex items-center justify-between gap-3 z-20">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium">
          {selectedCount} file{selectedCount !== 1 ? "s" : ""} selected
        </span>
      </div>
      <button onClick={onCancel} className="flex-shrink-0 p-0.5 hover:bg-primary/20 rounded transition-colors" title="Exit selection mode">
        <X size={12} />
      </button>
    </div>
  );
};

export default MultiSelectBanner;

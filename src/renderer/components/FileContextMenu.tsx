import React, { useEffect, useRef } from "react";
import { Download, Eye, Info, Edit, Trash2, CheckSquare } from "lucide-react";
import { RemoteFile } from "../store";
import { isPreviewableFile } from "../utils";

interface FileContextMenuProps {
  file: RemoteFile;
  position: { x: number; y: number };
  onClose: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onInfo: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSelect: () => void;
  isInMultiSelectMode: boolean;
  isSelected: boolean;
}

const FileContextMenu: React.FC<FileContextMenuProps> = ({
  file,
  position,
  onClose,
  onDownload,
  onPreview,
  onInfo,
  onRename,
  onDelete,
  onSelect,
  isInMultiSelectMode,
  isSelected,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Determine if file is previewable (text or image)
  const isPreviewable = () => {
    if (file.type === "d") return false;
    return isPreviewableFile(file.name);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const menuItems = [
    {
      icon: Download,
      label: "Download",
      onClick: () => {
        onDownload();
        onClose();
      },
      disabled: false,
    },
    {
      icon: CheckSquare,
      label: isInMultiSelectMode ? (isSelected ? "Unselect" : "Select") : "Select",
      onClick: () => {
        onSelect();
        onClose();
      },
      disabled: file.type === "d", // Folders don't support multi-selection
    },
    {
      icon: Eye,
      label: "Preview",
      onClick: () => {
        onPreview();
        onClose();
      },
      disabled: !isPreviewable(),
    },
    {
      icon: Info,
      label: "Info",
      onClick: () => {
        onInfo();
        onClose();
      },
      disabled: false,
    },
    {
      icon: Edit,
      label: "Rename",
      onClick: () => {
        onRename();
        onClose();
      },
      disabled: false,
    },
    {
      icon: Trash2,
      label: "Delete",
      onClick: () => {
        onDelete();
        onClose();
      },
      disabled: false,
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px]"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {menuItems.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={index}
            onClick={item.onClick}
            disabled={item.disabled}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
              item.disabled ? "text-muted-foreground/50 cursor-not-allowed" : "hover:bg-accent text-foreground cursor-pointer"
            }`}
          >
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default FileContextMenu;

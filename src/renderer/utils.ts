export const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatDate = (timestamp: number) => {
  if (!timestamp) return "Unknown";
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch (e) {
    return "Invalid date";
  }
};

export const formatTime = (seconds?: number) => {
  if (!seconds || seconds < 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const formatDuration = (seconds: number) => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
};

export const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) return "Unknown";
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
};

// Import file extension constants from shared module
import { isPreviewableFile as checkIsPreviewableFile } from "../shared/fileExtensions";

export const isPreviewableFile = checkIsPreviewableFile;

export const truncateFileName = (fileName: string, maxLength: number = 50): string => {
  if (fileName.length <= maxLength) {
    return fileName;
  }

  // Find the last dot to separate name and extension
  const lastDotIndex = fileName.lastIndexOf(".");

  if (lastDotIndex === -1) {
    // No extension, just truncate with ellipsis
    return fileName.substring(0, maxLength - 3) + "...";
  }

  const extension = fileName.substring(lastDotIndex); // includes the dot
  const nameWithoutExt = fileName.substring(0, lastDotIndex);

  // Calculate available space: maxLength - extension length - 3 (for "...")
  const ellipsis = "...";
  const availableForName = maxLength - extension.length - ellipsis.length;

  if (availableForName < 1) {
    // If very little space, just truncate everything
    return fileName.substring(0, Math.max(maxLength - ellipsis.length, 1)) + ellipsis;
  }

  // Truncate the name, keep the extension and add ellipsis
  const truncatedName = nameWithoutExt.substring(0, availableForName);
  return truncatedName + ellipsis + extension;
};

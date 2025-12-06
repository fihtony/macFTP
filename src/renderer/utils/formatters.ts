// Shared formatting utilities
import { format } from 'date-fns';

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatDate = (timestamp: number) => {
  if (!timestamp) return 'Unknown';
  try {
    return format(new Date(timestamp), 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return 'Invalid date';
  }
};

export const getFileType = (fileName: string, type: string) => {
  if (type === 'd') return 'Directory';
  const ext = fileName.split('.').pop()?.toUpperCase() || 'File';
  return ext + ' file';
};


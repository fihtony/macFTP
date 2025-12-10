/**
 * Shared file extension constants used across frontend and backend
 * This ensures consistent file type detection throughout the application
 */

export const TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".log",
  ".conf",
  ".ini",
  ".yaml",
  ".yml",
  ".csv",
  ".java",
  ".properties",
  ".gradle",
  ".py",
  ".c",
  ".cpp",
  ".h",
  ".sh",
  ".cfg",
] as const;

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico"] as const;

export const ALL_PREVIEWABLE_EXTENSIONS = [...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS] as const;

/**
 * Check if a file is previewable based on its extension
 */
export const isPreviewableFile = (fileName: string): boolean => {
  const lowerName = fileName.toLowerCase();
  return ALL_PREVIEWABLE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
};

/**
 * Check if a file is a text file
 */
export const isTextFile = (fileName: string): boolean => {
  const lowerName = fileName.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
};

/**
 * Check if a file is an image file
 */
export const isImageFile = (fileName: string): boolean => {
  const lowerName = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
};

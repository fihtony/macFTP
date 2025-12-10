// Icon utility functions for Electron main process
import * as fs from "fs";
import * as path from "path";

/**
 * Possible icon paths to try, in order of preference
 * Tries multiple paths to work in both development and production environments
 */
export const ICON_POSSIBLE_PATHS: string[] = [
  // Production paths (from dist-electron/main/utils/)
  path.join(__dirname, "../../assets/icons/icon.icns"),
  path.join(__dirname, "../../assets/icons/icon.png"),
  // Alternative production paths
  path.join(__dirname, "../../../assets/icons/icon.icns"),
  path.join(__dirname, "../../../assets/icons/icon.png"),
  // Development paths (from src/main/utils/)
  path.join(__dirname, "../../../assets/icons/icon.icns"),
  path.join(__dirname, "../../../assets/icons/icon.png"),
  // Fallback paths
  path.join(__dirname, "../assets/icons/icon.icns"),
  path.join(__dirname, "../assets/icons/icon.png"),
];

/**
 * Get the application icon path
 * Tries multiple possible paths and returns the first one that exists
 * @param preferIcns If true, prefers .icns files over .png (for macOS About panel)
 * @returns Absolute icon path if found, undefined otherwise
 */
export const getIconPath = (preferIcns: boolean = false): string | undefined => {
  // If preferIcns is true, prioritize .icns files
  if (preferIcns) {
    const icnsPaths = ICON_POSSIBLE_PATHS.filter(p => p.endsWith('.icns'));
    const pngPaths = ICON_POSSIBLE_PATHS.filter(p => p.endsWith('.png'));
    const allPaths = [...icnsPaths, ...pngPaths];
    
    for (const iconPath of allPaths) {
      const absolutePath = path.resolve(iconPath);
      if (fs.existsSync(absolutePath)) {
        return absolutePath;
      }
    }
  } else {
    // Default: try all paths in order
    for (const iconPath of ICON_POSSIBLE_PATHS) {
      const absolutePath = path.resolve(iconPath);
      if (fs.existsSync(absolutePath)) {
        return absolutePath;
      }
    }
  }
  return undefined;
};


// Main FTP Handlers - Entry point
// The original monolithic file has been refactored into smaller, focused modules:
// - commonHandler.ts: Connection management, shared utilities, file operations
// - downloadFileHandler.ts: Single file downloads with queue management
// - downloadFolderHandler.ts: Folder downloads with recursive logic
// - uploadFileHandler.ts: Single file uploads (cancel only, no pause/resume)
// - uploadFolderHandler.ts: Folder uploads (cancel only, no pause/resume)

import './commonHandler';
import './downloadFileHandler';
import './downloadFolderHandler';
import './uploadFileHandler';
import './uploadFolderHandler';

// Re-export public API
export { registerFtpHandlers, cleanupAllTempFiles } from './commonHandler';
export type { ConnectionConfig } from './commonHandler';
export { cancelAllDownloads } from './downloadFileHandler';

console.log('[FTP Handlers] All modules loaded');

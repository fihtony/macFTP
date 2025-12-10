// Upload Progress Dialog Component
import React from "react";
import { X } from "lucide-react";
import { formatBytes } from "../utils/formatters";
import { UploadTaskState, UPLOAD_FINAL_STATUSES } from "../types/upload";

interface UploadProgressDialogProps {
  upload: UploadTaskState;
  onClose: () => void;
  onCancel: () => void;
}

// Helper function to generate upload items description
const getUploadItemsDescription = (items: any[]): string => {
  if (!items || items.length === 0) return "files";
  if (items.length === 1) return items[0].name;
  if (items.length === 2) return `${items[0].name}, ${items[1].name}`;
  if (items.length === 3) return `${items[0].name}, ${items[1].name}, ${items[2].name}`;
  return `${items[0].name}, ${items[1].name}, ... (${items.length} items)`;
};

export const UploadProgressDialog: React.FC<UploadProgressDialogProps> = ({ upload, onClose, onCancel }) => {
  // NEW: Support unified upload manager with items array
  const hasItems = upload.items && Array.isArray(upload.items);
  const currentItem = upload.currentItem;

  // For backward compatibility with old upload structure
  const hasUploadList = (upload as any).uploadList && Array.isArray((upload as any).uploadList);
  const isSingleUpload = hasUploadList ? (upload as any).uploadList.length === 1 : (upload as any).isSingleUpload === true;
  const isCancelling = upload.status === "cancelling" || (upload.cancelRequested && !UPLOAD_FINAL_STATUSES.includes(upload.status));
  const legacyCurrentItem =
    hasUploadList && (upload as any).currentItemIndex !== undefined ? (upload as any).uploadList[(upload as any).currentItemIndex] : null;

  const calculateETA = () => {
    if (!upload.speed || upload.speed === 0 || !upload.totalBytes) return null;
    // Include current file's uploaded bytes in calculation
    const totalUploaded = upload.uploadedBytes + (currentItem?.uploadedBytes || 0);
    const remainingBytes = upload.totalBytes - totalUploaded;
    const etaSeconds = Math.round(remainingBytes / upload.speed);

    if (etaSeconds < 60) {
      return `00:${String(etaSeconds).padStart(2, "0")}`;
    }

    if (etaSeconds < 3600) {
      const minutes = Math.floor(etaSeconds / 60);
      const seconds = etaSeconds % 60;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    const hours = Math.floor(etaSeconds / 3600);
    const minutes = Math.floor((etaSeconds % 3600) / 60);
    const seconds = etaSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  // Get display name for the upload
  const getUploadTitle = () => {
    // NEW unified upload manager
    if (hasItems) {
      const itemsDesc = getUploadItemsDescription(upload.items);
      if (upload.totalFiles === 1) {
        return `Uploading ${itemsDesc}`;
      }
      return `Uploading ${itemsDesc}`;
    }

    // Legacy support
    if (isSingleUpload) {
      if (legacyCurrentItem) {
        return `Uploading ${legacyCurrentItem.name}`;
      }
      // Fallback for old structure
      const name = (upload as any).folderName || (upload as any).currentFile || "file";
      return `Uploading ${name}`;
    }
    return `Uploading ${upload.completedFiles}/${upload.totalFiles} files`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[600px] max-w-[90vw] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{getUploadTitle()}</h2>
            </div>
            {!isSingleUpload && (
              <p className="text-xs text-muted-foreground">
                {UPLOAD_FINAL_STATUSES.includes(upload.status) ? `Upload ${upload.status}` : "Uploading files"}
              </p>
            )}
          </div>
          {UPLOAD_FINAL_STATUSES.includes(upload.status) && (
            <button onClick={onClose} className="p-1.5 hover:bg-accent rounded" title="Close">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="space-y-3 text-sm">
          {/* Site Information */}
          <div className="space-y-1">
            {upload.siteName && upload.siteHost && (
              <p className="text-xs text-muted-foreground truncate">
                Site: {upload.siteName} ({upload.siteHost})
              </p>
            )}
            {/* From/To information - always shown */}
            {/* NEW unified upload manager */}
            {hasItems ? (
              currentItem ? (
                <>
                  <p className="text-xs text-muted-foreground truncate" title={currentItem.localPath}>
                    From: {currentItem.localPath}
                  </p>
                  <p className="text-xs text-muted-foreground truncate" title={currentItem.remotePath}>
                    To: {currentItem.remotePath}
                  </p>
                </>
              ) : upload.items && upload.items.length > 0 ? (
                /* Show first item info when no current item (e.g., all completed) */
                <>
                  <p className="text-xs text-muted-foreground truncate" title={upload.items[0].localPath}>
                    From: {upload.items[0].localPath}
                  </p>
                  <p className="text-xs text-muted-foreground truncate" title={upload.items[0].remotePath}>
                    To: {upload.items[0].remotePath}
                  </p>
                </>
              ) : null
            ) : legacyCurrentItem ? (
              /* Legacy support for uploadList structure */
              <>
                <p className="text-xs text-muted-foreground truncate">From: {legacyCurrentItem.localPath}</p>
                <p className="text-xs text-muted-foreground truncate">To: {legacyCurrentItem.remotePath}</p>
              </>
            ) : (
              /* Fallback for old structure */
              <>
                {(upload as any).currentFileLocalPath && (
                  <p className="text-xs text-muted-foreground truncate">From: {(upload as any).currentFileLocalPath}</p>
                )}
                {(upload as any).currentFileRemotePath && (
                  <p className="text-xs text-muted-foreground truncate">To: {(upload as any).currentFileRemotePath}</p>
                )}
                {!(upload as any).currentFileLocalPath && (upload as any).localPath && (
                  <p className="text-xs text-muted-foreground truncate">From: {(upload as any).localPath}</p>
                )}
                {!(upload as any).currentFileRemotePath && (upload as any).remotePath && (
                  <p className="text-xs text-muted-foreground truncate">To: {(upload as any).remotePath}</p>
                )}
              </>
            )}
          </div>

          {/* Total Progress Bar (hidden for single upload) */}
          {/* NEW: For unified upload manager, show if totalFiles > 1 */}
          {((hasItems && upload.totalFiles > 1) || (!hasItems && !isSingleUpload)) && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>
                  {/* Include current file's real-time progress in total */}
                  {formatBytes(upload.uploadedBytes + (currentItem?.uploadedBytes || 0))} / {formatBytes(upload.totalBytes || 0)}
                </span>
                <span>
                  {upload.totalBytes
                    ? `${Math.min(
                        100,
                        Math.round(((upload.uploadedBytes + (currentItem?.uploadedBytes || 0)) / upload.totalBytes) * 100)
                      )}%`
                    : "0%"}
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: upload.totalBytes
                      ? `${Math.min(100, ((upload.uploadedBytes + (currentItem?.uploadedBytes || 0)) / upload.totalBytes) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Current File/Folder Progress Bar - always shown */}
          <div>
            {/* NEW unified upload manager - use currentItem or last completed item */}
            {hasItems && currentItem && currentItem.size ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>
                    {formatBytes(currentItem.uploadedBytes || 0)} / {formatBytes(currentItem.size)}
                  </span>
                  <span>{Math.min(100, Math.round(((currentItem.uploadedBytes || 0) / currentItem.size) * 100))}%</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 transition-all duration-200"
                    style={{
                      width: `${Math.min(100, ((currentItem.uploadedBytes || 0) / currentItem.size) * 100)}%`,
                    }}
                  />
                </div>
              </>
            ) : hasItems && upload.items && upload.items.length > 0 ? (
              /* Show completed/summary state when no current item */
              <>
                {upload.status === "completed" && (
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Completed</span>
                    <span>100%</span>
                  </div>
                )}
                {upload.status === "cancelled" && (
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Cancelled</span>
                    <span>0%</span>
                  </div>
                )}
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 transition-all duration-200"
                    style={{ width: upload.status === "cancelled" ? "0%" : "100%" }}
                  />
                </div>
              </>
            ) : (upload as any).currentFileSize ? (
              /* Legacy support for old upload structure */
              <>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>
                    {formatBytes((upload as any).currentFileUploaded || 0)} / {formatBytes((upload as any).currentFileSize)}
                  </span>
                  <span>
                    {Math.min(100, Math.round((((upload as any).currentFileUploaded || 0) / (upload as any).currentFileSize) * 100))}%
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 transition-all duration-200"
                    style={{
                      width: `${Math.min(100, (((upload as any).currentFileUploaded || 0) / (upload as any).currentFileSize) * 100)}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-muted-foreground/30 animate-pulse" style={{ width: "25%" }} />
              </div>
            )}
          </div>

          {/* Speed and ETA */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {/* Show files counter for multi-file uploads */}
            {((hasItems && upload.totalFiles > 1) || (!hasItems && !isSingleUpload)) && (
              <span className="whitespace-nowrap">
                Files: {upload.completedFiles}/{upload.totalFiles}
              </span>
            )}
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">Speed:</span>
              <span className="font-medium min-w-[80px] inline-block">{upload.speed ? `${formatBytes(upload.speed)}/s` : "--"}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">ETA:</span>
              <span className="font-medium min-w-[60px] inline-block">{calculateETA() || "--"}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={UPLOAD_FINAL_STATUSES.includes(upload.status) || isCancelling}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white disabled:opacity-50 min-w-[100px] text-center"
          >
            {isCancelling ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
};

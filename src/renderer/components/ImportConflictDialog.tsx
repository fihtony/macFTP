import React, { useState } from "react";
import { AlertTriangle, Check, AlertCircle, CheckCircle } from "lucide-react";

export interface ImportSiteRecord {
  name: string;
  host: string;
  hasConflict: boolean;
  resolution?: "overwrite" | "rename";
  selected?: boolean;
}

interface ImportConflictDialogProps {
  records: ImportSiteRecord[];
  onConfirm: (records: ImportSiteRecord[]) => void;
  onCancel: () => void;
}

const ImportConflictDialog: React.FC<ImportConflictDialogProps> = ({ records, onConfirm, onCancel }) => {
  const [selectedRecords, setSelectedRecords] = useState<ImportSiteRecord[]>(
    records.map((r) => ({ ...r, selected: r.selected !== false, resolution: r.resolution || "rename" }))
  );

  const toggleRecord = (index: number) => {
    setSelectedRecords((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], selected: !updated[index].selected };
      return updated;
    });
  };

  const setResolution = (index: number, resolution: "overwrite" | "rename") => {
    setSelectedRecords((prev) => {
      const updated = [...prev];
      updated[index].resolution = resolution;
      return updated;
    });
  };

  const handleConfirm = () => {
    const toImport = selectedRecords.filter((r) => r.selected);
    if (toImport.length === 0) {
      alert("Please select at least one site to import");
      return;
    }
    onConfirm(toImport);
  };

  const conflictCount = selectedRecords.filter((r) => r.hasConflict).length;
  const selectedCount = selectedRecords.filter((r) => r.selected).length;
  const hasAnyConflicts = conflictCount > 0;

  return (
    <div className="fixed inset-0 z-[300] bg-background/80 backdrop-blur flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-start gap-4 mb-4 pb-4 border-b border-border">
          <div className={`p-2 rounded-full flex-shrink-0 ${hasAnyConflicts ? "bg-yellow-500/20" : "bg-green-500/20"}`}>
            {hasAnyConflicts ? (
              <AlertTriangle size={24} className="text-yellow-500" />
            ) : (
              <CheckCircle size={24} className="text-green-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold mb-1">Import Sites</h3>
            <p className="text-sm text-muted-foreground">
              {hasAnyConflicts
                ? `${conflictCount} site${conflictCount !== 1 ? "s" : ""} with conflict found. Please review and choose resolution.`
                : "All sites are ready to import - no conflicts detected."}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto mb-4 space-y-2">
          {selectedRecords.map((record, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-secondary/30 rounded hover:bg-secondary/50 transition-colors">
              <input
                type="checkbox"
                checked={record.selected || false}
                onChange={() => toggleRecord(index)}
                className="w-4 h-4 rounded border-border cursor-pointer flex-shrink-0"
              />

              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{record.name}</div>
                <div className="text-xs text-muted-foreground">{record.host}</div>
              </div>

              {record.hasConflict ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <AlertCircle size={14} className="text-yellow-500" />
                    <span className="text-xs text-yellow-600">Conflict</span>
                  </div>
                  <select
                    value={record.resolution || "rename"}
                    onChange={(e) => setResolution(index, e.target.value as "overwrite" | "rename")}
                    className="px-2 py-0.5 bg-input border border-border rounded text-xs"
                  >
                    <option value="rename">Rename</option>
                    <option value="overwrite">Overwrite</option>
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Check size={14} className="text-green-500" />
                  <span className="text-xs text-green-600">No conflict</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {selectedCount > 0 ? `${selectedCount} site${selectedCount !== 1 ? "s" : ""} selected` : "No sites selected"}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedCount === 0}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Import ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportConflictDialog;

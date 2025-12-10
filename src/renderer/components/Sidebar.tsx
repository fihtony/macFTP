import React, { useState, useMemo } from "react";
import {
  Folder,
  Server,
  Plus,
  Trash2,
  Settings,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Edit2,
  Play,
  Power,
  Network,
  Lock,
  FileDown,
  FileUp,
} from "lucide-react";
import { Site, useStore } from "../store";
import { v4 as uuidv4 } from "uuid";
import ConnectionProgressDialog from "./ConnectionProgressDialog";
import FtpServerModal from "./FtpServerModal";
import ContextMenu from "./ContextMenu";
import DeleteSiteDialog from "./DeleteSiteDialog";
import ConfirmDialog from "./ConfirmDialog";
import ImportConflictDialog, { ImportSiteRecord } from "./ImportConflictDialog";
import PasswordDialog from "./PasswordDialog";
import DecryptErrorDialog from "./DecryptErrorDialog";

const Sidebar = () => {
  const { sites, addSite, updateSite, removeSite, isConnected, currentSite, settings, updateSettings } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ General: true });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; site: Site } | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [importConflictRecords, setImportConflictRecords] = useState<ImportSiteRecord[] | null>(null);
  const [importSitesData, setImportSitesData] = useState<any[] | null>(null);

  // Encryption/Decryption states
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordDialogMode, setPasswordDialogMode] = useState<"export" | "import">("export");
  const [exportPassword, setExportPassword] = useState("");
  const [showDecryptErrorDialog, setShowDecryptErrorDialog] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);

  const handleAdd = () => {
    setEditingSite(null);
    setShowModal(true);
  };

  const handleEdit = (site: Site) => {
    setEditingSite(site);
    setShowModal(true);
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, site: Site) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, site });
  };

  const handleSave = (siteData: Omit<Site, "id">) => {
    if (editingSite) {
      updateSite(editingSite.id, siteData);
    } else {
      const id = uuidv4();
      const newSite: Site = { ...siteData, id };
      addSite(newSite);
      if (newSite.group) {
        setExpandedGroups((prev) => ({ ...prev, [newSite.group!]: true }));
      }
    }
  };

  const connectionProgress = useStore((state) => state.connectionProgress);
  const setConnectionProgress = useStore((state) => state.setConnectionProgress);

  const handleConnect = async (site: Site, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    console.log("[User Action] Connect to site:", { siteName: site.name, host: site.host, protocol: site.protocol });
    const electron = (window as any).electronAPI;
    if (!electron) {
      alert("Electron API not available");
      return;
    }

    // Show connection progress dialog
    setConnectionProgress({
      isConnecting: true,
      siteName: site.name,
      host: site.host,
    });

    try {
      const result = await electron.connect(site);

      if (result.success) {
        console.log("[Success] Connected to site:", { siteName: site.name, host: site.host });
        useStore.getState().setConnected(true);
        useStore.getState().setCurrentSite(site); // Save current site
        // Navigate to initial path if specified, otherwise use root
        const initialPath = site.initialPath || "/";
        useStore.getState().setCurrentPath(initialPath);
        const files = await electron.listDir(initialPath);
        if (files.success) {
          useStore.getState().setRemoteFiles(files.files);
        } else {
          // If initial path fails, try root
          const rootFiles = await electron.listDir("/");
          if (rootFiles.success) {
            useStore.getState().setCurrentPath("/");
            useStore.getState().setRemoteFiles(rootFiles.files);
          }
        }
      } else {
        console.error("[Error] Connection failed:", { siteName: site.name, host: site.host, error: result.error });
        alert("Connection failed: " + result.error);
      }
    } catch (err: any) {
      console.error("[Error] Connection exception:", { siteName: site.name, host: site.host, error: err.message });
      alert("Connection error: " + err.message);
    } finally {
      // Hide connection progress dialog
      setConnectionProgress(null);
    }
  };

  const handleCancelConnection = () => {
    // Note: Actual cancellation would require abort controller or similar
    // For now, just hide the dialog
    setConnectionProgress(null);
  };

  const handleDisconnect = async () => {
    console.log("[User Action] Disconnect requested");
    // Check if there are active downloads
    const downloads = useStore.getState().downloads;
    const activeDownloads = downloads.filter((d) => d.status === "downloading" || d.status === "queued");

    if (activeDownloads.length > 0) {
      console.log("[Warning] Disconnect with active downloads:", { activeDownloadCount: activeDownloads.length });
      // Show confirmation dialog
      setShowDisconnectConfirm(true);
      return;
    }

    // No active downloads, proceed with disconnect
    performDisconnect();
  };

  const performDisconnect = async () => {
    const electron = (window as any).electronAPI;
    if (electron) {
      // Get count of active downloads before disconnect
      const downloads = useStore.getState().downloads;
      const activeDownloads = downloads.filter((d) => d.status === "downloading" || d.status === "queued");
      const activeCount = activeDownloads.length;

      if (activeCount > 0) {
        console.log("[Disconnect] Terminating active downloads:", { count: activeCount });
      }

      // Close any open previews and clear temp file path
      useStore.getState().setTempFilePath(null);

      // Disconnect will cancel all downloads and clean up all temp files
      // Backend handles all cancellations and sends failure notifications
      await electron.disconnect();
      console.log("[Success] Disconnected from site");
      useStore.getState().setConnected(false);
      useStore.getState().setCurrentSite(null); // Clear current site
      useStore.getState().setRemoteFiles([]);
      useStore.getState().setCurrentPath("/");

      // Wait for backend to send all failure notifications, then show toast
      if (activeCount > 0) {
        setTimeout(() => {
          // Check how many downloads actually failed
          const currentDownloads = useStore.getState().downloads;
          const failedCount = currentDownloads.filter(
            (d) => d.status === "failed" && d.error === "Connection terminated by user" && d.endTime && Date.now() - d.endTime < 2000 // Failed within last 2 seconds
          ).length;

          if (failedCount > 0) {
            const message = `${failedCount} download task${failedCount !== 1 ? "s" : ""} failed due to connection terminated`;
            // Use window event to show toast (App.tsx will handle it)
            window.dispatchEvent(
              new CustomEvent("show-toast", {
                detail: { message, type: "error" },
              })
            );
          }
        }, 300); // Wait 300ms for all notifications to arrive
      }
    }
  };

  const handleExportSites = async () => {
    if (sites.length === 0) {
      alert("No sites to export");
      return;
    }

    // Show password dialog for encryption
    setPasswordDialogMode("export");
    setShowPasswordDialog(true);
  };

  const handleExportWithPassword = async (password: string) => {
    setShowPasswordDialog(false);
    setExportPassword(password);

    try {
      const electron = (window as any).electronAPI;
      if (!electron) {
        alert("Electron API not available");
        return;
      }

      // Prepare export data with metadata
      const version = "1.0";
      const exportDate = new Date().toISOString();

      // Derive encryption key from password
      const keyResult = await electron.deriveKeyFromPassword(password, version, exportDate);
      if (!keyResult.success) {
        alert("Failed to derive encryption key: " + keyResult.error);
        return;
      }

      // Encrypt each site
      const encryptedSites = [];
      for (const site of sites) {
        const siteData = {
          name: site.name,
          host: site.host,
          port: site.port,
          user: site.user,
          password: site.password || "",
          protocol: site.protocol,
          group: site.group || "General",
          privateKeyPath: site.privateKeyPath || "",
          privateKeyContent: site.privateKeyContent || "",
          initialPath: site.initialPath || "/",
          defaultDownloadPath: site.defaultDownloadPath || "",
        };

        const encryptResult = await electron.encryptSite(siteData, keyResult.keyHex);
        if (!encryptResult.success) {
          alert("Failed to encrypt site: " + encryptResult.error);
          return;
        }
        encryptedSites.push(encryptResult.site);
      }

      const exportData = {
        version,
        exportDate,
        sites: encryptedSites,
      };

      // Create JSON string
      const jsonString = JSON.stringify(exportData, null, 2);

      // Create blob and download
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `macftp-sites-${new Date().getTime()}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // Show success message after a delay to ensure download dialog is shown and file is being processed
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("show-toast", {
            detail: { message: `Exported ${sites.length} site${sites.length !== 1 ? "s" : ""} successfully`, type: "success" },
          })
        );
      }, 500);
    } catch (err: any) {
      console.error("Export error:", err);
      alert("Failed to export sites: " + err.message);
    }
  };

  const handleImportSites = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = async (e: any) => {
        try {
          const file = e.target.files[0];
          if (!file) return;

          const text = await file.text();
          const data = JSON.parse(text);

          if (!data.sites || !Array.isArray(data.sites)) {
            alert('Invalid import file format. Expected JSON with "sites" array.');
            return;
          }

          // Store file and show password dialog for decryption
          setPendingImportFile(file);
          setPasswordDialogMode("import");
          setShowPasswordDialog(true);
        } catch (err: any) {
          console.error("Import parse error:", err);
          alert("Failed to parse import file: " + err.message);
        }
      };
      input.click();
    } catch (err: any) {
      console.error("Import error:", err);
      alert("Failed to import sites: " + err.message);
    }
  };

  const handleImportWithPassword = async (password: string) => {
    setShowPasswordDialog(false);

    if (!pendingImportFile) {
      alert("Import file lost. Please try again.");
      return;
    }

    try {
      const electron = (window as any).electronAPI;
      if (!electron) {
        alert("Electron API not available");
        return;
      }

      const text = await pendingImportFile.text();
      const data = JSON.parse(text);

      if (!data.sites || !Array.isArray(data.sites) || !data.version || !data.exportDate) {
        alert("Invalid import file format.");
        return;
      }

      // Derive decryption key from password
      const keyResult = await electron.deriveKeyFromPassword(password, data.version, data.exportDate);
      if (!keyResult.success) {
        alert("Failed to derive decryption key: " + keyResult.error);
        setPendingImportFile(null);
        return;
      }

      // Try to decrypt the sites
      let decryptedSites: any[] = [];
      let allDecryptedSuccessfully = true;

      for (const encryptedSite of data.sites) {
        try {
          const decryptResult = await electron.decryptSite(encryptedSite, keyResult.keyHex);

          if (!decryptResult.success) {
            allDecryptedSuccessfully = false;
            break;
          }

          const decryptedSite = decryptResult.site;
          // Verify decryption was successful by checking essential fields
          if (decryptedSite.host && decryptedSite.user) {
            decryptedSites.push(decryptedSite);
          } else {
            allDecryptedSuccessfully = false;
            break;
          }
        } catch (err) {
          allDecryptedSuccessfully = false;
          break;
        }
      }

      if (!allDecryptedSuccessfully) {
        setShowDecryptErrorDialog(true);
        setPendingImportFile(null);
        return;
      }

      // Build conflict records for valid decrypted sites
      const records: ImportSiteRecord[] = decryptedSites.map((siteData: any) => {
        const hasConflict = sites.some((s) => s.name === siteData.name);
        return {
          name: siteData.name,
          host: siteData.host,
          hasConflict,
          resolution: hasConflict ? "rename" : undefined,
          selected: true,
        };
      });

      // Store the decrypted sites data and show conflict dialog
      setImportSitesData(decryptedSites);
      setImportConflictRecords(records);
      setPendingImportFile(null);
    } catch (err: any) {
      console.error("Import error:", err);
      alert("Failed to import sites: " + err.message);
      setPendingImportFile(null);
    }
  };

  const handleImportConflictConfirm = async (selectedRecords: ImportSiteRecord[]) => {
    if (!importSitesData) {
      alert("Import data lost. Please try again.");
      setImportConflictRecords(null);
      return;
    }

    setImportConflictRecords(null);
    setImportSitesData(null);

    let importedCount = 0;
    const errors: string[] = [];

    for (const record of selectedRecords) {
      try {
        // Find the original site data
        const siteData = importSitesData.find((s: any) => s.name === record.name);
        if (!siteData) {
          errors.push(`"${record.name}": Source data not found`);
          continue;
        }

        if (!siteData.host || !siteData.user) {
          errors.push(`"${record.name}": Missing required fields`);
          continue;
        }

        let finalName = record.name;
        const resolution = record.resolution || "rename";

        if (resolution === "rename" && record.hasConflict) {
          // Generate a unique name
          let counter = 1;
          let newName = `${record.name} (${counter})`;
          while (sites.some((s) => s.name === newName)) {
            counter++;
            newName = `${record.name} (${counter})`;
          }
          finalName = newName;
        } else if (resolution === "overwrite" && record.hasConflict) {
          // Find and delete the existing site first
          const existingSite = sites.find((s) => s.name === record.name);
          if (existingSite) {
            removeSite(existingSite.id);
          }
        }

        const id = Math.random().toString(36).slice(2, 11);
        const newSite: Site = {
          id,
          name: finalName,
          host: siteData.host,
          port: siteData.port || 22,
          user: siteData.user,
          password: siteData.password || undefined,
          protocol: siteData.protocol || "sftp",
          group: siteData.group || "General",
          privateKeyPath: siteData.privateKeyPath || undefined,
          privateKeyContent: siteData.privateKeyContent || undefined,
          initialPath: siteData.initialPath || "/",
          defaultDownloadPath: siteData.defaultDownloadPath || undefined,
        };

        addSite(newSite);
        importedCount++;

        // Expand the group
        if (siteData.group) {
          setExpandedGroups((prev) => ({ ...prev, [siteData.group]: true }));
        }
      } catch (err: any) {
        errors.push(`Error importing "${record.name}": ${err.message}`);
      }
    }

    if (importedCount > 0) {
      window.dispatchEvent(
        new CustomEvent("show-toast", {
          detail: {
            message: `Imported ${importedCount} site${importedCount !== 1 ? "s" : ""} successfully`,
            type: "success",
          },
        })
      );
    }

    if (errors.length > 0) {
      console.warn("Import warnings:", errors);
      alert("Some items could not be imported:\n" + errors.join("\n"));
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const groupedSites = useMemo(() => {
    const groups: Record<string, Site[]> = {};
    sites.forEach((site) => {
      const g = site.group || "General";
      if (!groups[g]) groups[g] = [];
      groups[g].push(site);
    });
    return groups;
  }, [sites]);

  const isSiteConnected = (site: Site) => {
    return isConnected && currentSite?.id === site.id;
  };

  const usesSshKey = (site: Site) => {
    return !!(site.privateKeyPath || site.privateKeyContent);
  };

  const handleDeleteSite = (site: Site) => {
    setSiteToDelete(site);
    setContextMenu(null);
  };

  const confirmDeleteSite = () => {
    if (siteToDelete) {
      console.log("[User Action] Delete site:", { siteName: siteToDelete.name, siteId: siteToDelete.id });
      removeSite(siteToDelete.id);
      setSiteToDelete(null);
    }
  };

  return (
    <>
      {connectionProgress?.isConnecting && (
        <ConnectionProgressDialog
          siteName={connectionProgress.siteName || "Unknown"}
          host={connectionProgress.host || ""}
          onCancel={handleCancelConnection}
        />
      )}

      <FtpServerModal
        isOpen={showModal}
        site={editingSite}
        onClose={() => {
          setShowModal(false);
          setEditingSite(null);
        }}
        onSave={handleSave}
      />

      <DeleteSiteDialog isOpen={!!siteToDelete} site={siteToDelete} onClose={() => setSiteToDelete(null)} onConfirm={confirmDeleteSite} />

      <PasswordDialog
        isOpen={showPasswordDialog}
        title={passwordDialogMode === "export" ? "Export Sites" : "Import Sites"}
        message={
          passwordDialogMode === "export"
            ? "Enter a password to encrypt sensitive information (host, user, password, SSH keys) in the export file."
            : "Enter the password to decrypt the site configuration."
        }
        onConfirm={passwordDialogMode === "export" ? handleExportWithPassword : handleImportWithPassword}
        onCancel={() => {
          setShowPasswordDialog(false);
          setPendingImportFile(null);
        }}
        showStrengthIndicator={passwordDialogMode === "export"}
      />

      <DecryptErrorDialog isOpen={showDecryptErrorDialog} onConfirm={() => setShowDecryptErrorDialog(false)} />

      {importConflictRecords && (
        <ImportConflictDialog
          records={importConflictRecords}
          onConfirm={handleImportConflictConfirm}
          onCancel={() => {
            setImportConflictRecords(null);
            setImportSitesData(null);
          }}
        />
      )}

      {showDisconnectConfirm && (
        <ConfirmDialog
          title="Active Downloads in Progress"
          message={`${
            useStore.getState().downloads.filter((d) => d.status === "downloading" || d.status === "queued").length
          } download(s) are currently in progress. Disconnecting will terminate all active downloads. Do you want to continue?`}
          onConfirm={() => {
            setShowDisconnectConfirm(false);
            performDisconnect();
          }}
          onCancel={() => setShowDisconnectConfirm(false)}
          confirmText="Disconnect"
          variant="danger"
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            ...(isSiteConnected(contextMenu.site)
              ? [
                  {
                    label: "Disconnect",
                    icon: <Power size={14} />,
                    onClick: () => handleDisconnect(),
                    disabled: false,
                  },
                  { separator: true },
                  {
                    label: "Edit",
                    icon: <Edit2 size={14} />,
                    onClick: () => handleEdit(contextMenu.site),
                    disabled: true,
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 size={14} />,
                    onClick: () => handleDeleteSite(contextMenu.site),
                    disabled: true,
                  },
                ]
              : [
                  {
                    label: "Connect",
                    icon: <Play size={14} />,
                    onClick: () => handleConnect(contextMenu.site),
                    disabled: isConnected,
                  },
                  { separator: true },
                  {
                    label: "Edit",
                    icon: <Edit2 size={14} />,
                    onClick: () => handleEdit(contextMenu.site),
                    disabled: false,
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 size={14} />,
                    onClick: () => handleDeleteSite(contextMenu.site),
                    disabled: false,
                  },
                ]),
          ]}
        />
      )}

      <div className="h-full w-full bg-secondary/30 flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between gap-1">
          <span className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Sites</span>
          <div className="flex gap-1">
            <button onClick={handleImportSites} className="p-1 hover:bg-accent rounded" title="Import sites from JSON">
              <FileDown size={16} />
            </button>
            <button onClick={handleExportSites} className="p-1 hover:bg-accent rounded" title="Export sites as JSON">
              <FileUp size={16} />
            </button>
            <button onClick={handleAdd} className="p-1 hover:bg-accent rounded" title="Add new site">
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {sites.length === 0 && !showModal && (
            <div className="text-center p-4 text-xs text-muted-foreground">
              No sites saved. <br />
              <br />
              <strong>Demo Server:</strong>
              <br />
              Host: test.rebex.net
              <br />
              Port: 22
              <br />
              User: demo
              <br />
              Pass: password
            </div>
          )}

          {Object.entries(groupedSites).map(([group, groupSites]) => (
            <div key={group} className="mb-2">
              <div
                className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                onClick={() => toggleGroup(group)}
              >
                {expandedGroups[group] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <FolderOpen size={12} />
                <span>{group}</span>
              </div>

              {expandedGroups[group] && (
                <div className="pl-2 mt-1 space-y-1">
                  {groupSites.map((site) => {
                    const connected = isSiteConnected(site);
                    const hasSshKey = usesSshKey(site);
                    const IconComponent = site.protocol === "sftp" ? Lock : Network;

                    return (
                      <div
                        key={site.id}
                        className={`
                          group relative p-2.5 rounded border transition-colors cursor-pointer
                          ${connected ? "bg-primary/10 border-primary/30" : "border-border/50 hover:bg-accent/30"}
                        `}
                        onContextMenu={(e) => handleContextMenu(e, site)}
                        onClick={() => !isConnected && !connected && handleConnect(site)}
                        title={
                          connected
                            ? "Connected - Right-click for menu"
                            : !isConnected
                            ? "Click to connect or right-click for menu"
                            : currentSite
                            ? `${currentSite.name} is connected - Right-click for menu`
                            : "Another FTP is connected - Right-click for menu"
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <IconComponent
                            size={16}
                            className={`flex-shrink-0 ${site.protocol === "sftp" ? "text-blue-400" : "text-orange-400"}`}
                          />
                          <div className="flex flex-col overflow-hidden min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">{site.name}</span>
                              {hasSshKey && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded border border-blue-500/30 flex-shrink-0 ml-auto">
                                  SSH
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-muted-foreground truncate">
                                {site.user}@{site.host}
                              </span>
                              {connected && <span className="text-[9px] font-medium text-green-500 flex-shrink-0">Connected</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Connection Status & Settings */}
        <div className="border-t border-border">
          {isConnected && (
            <div className="p-2 border-b border-border">
              <button
                onClick={handleDisconnect}
                className="w-full px-3 py-2 bg-destructive text-destructive-foreground rounded text-sm flex items-center justify-center gap-2 hover:opacity-90"
              >
                <Power size={14} />
                Disconnect
              </button>
            </div>
          )}

          <div className="p-4">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings size={16} />
              <span>Settings</span>
            </button>

            {showSettings && (
              <div className="mt-3 p-3 bg-background/50 rounded text-xs space-y-2 border border-border">
                {/* Max Concurrent Downloads */}
                <div className="flex items-center justify-between">
                  <label className="text-muted-foreground">Max Concurrent Downloads:</label>
                  <select
                    value={settings.maxConcurrentDownloads}
                    onChange={(e) => {
                      const newValue = parseInt(e.target.value);
                      console.log("[User Action] Change setting: maxConcurrentDownloads", {
                        oldValue: settings.maxConcurrentDownloads,
                        newValue,
                      });
                      updateSettings({ maxConcurrentDownloads: newValue });
                    }}
                    className="px-2 py-0.5 bg-input border border-border rounded text-xs w-16"
                  >
                    {[1, 2, 3, 4, 5].map((num) => (
                      <option key={num} value={num}>
                        {num}
                      </option>
                    ))}
                  </select>
                </div>

                {/* File Conflict Resolution */}
                <div className="flex items-center justify-between">
                  <label className="text-muted-foreground">When File Exists:</label>
                  <select
                    value={settings.defaultConflictResolution}
                    onChange={(e) => {
                      const newValue = e.target.value as any;
                      console.log("[User Action] Change setting: defaultConflictResolution", {
                        oldValue: settings.defaultConflictResolution,
                        newValue,
                      });
                      updateSettings({ defaultConflictResolution: newValue });
                    }}
                    className="px-2 py-0.5 bg-input border border-border rounded text-xs"
                  >
                    <option value="prompt">Ask</option>
                    <option value="rename">Rename</option>
                    <option value="overwrite">Overwrite</option>
                  </select>
                </div>

                {/* Show Hidden Files */}
                <div className="flex items-center justify-between">
                  <label className="text-muted-foreground">Show Hidden Files:</label>
                  <input
                    type="checkbox"
                    checked={settings.showHiddenFiles}
                    onChange={(e) => {
                      const newValue = e.target.checked;
                      console.log("[User Action] Change setting: showHiddenFiles", { oldValue: settings.showHiddenFiles, newValue });
                      updateSettings({ showHiddenFiles: newValue });
                    }}
                    className="w-4 h-4"
                  />
                </div>

                <div className="pt-2 border-t border-border text-[10px] text-muted-foreground">
                  <span>Support: </span>
                  <a
                    href="mailto:fihtony@gmail.com?subject=MacFTP Support"
                    className="text-primary hover:text-primary/80 transition-colors cursor-pointer underline decoration-dotted"
                    title="fihtony@gmail.com"
                    onClick={(e) => {
                      e.preventDefault();
                      const electron = (window as any).electronAPI;
                      if (electron?.openExternal) {
                        electron.openExternal("mailto:fihtony@gmail.com?subject=MacFTP Support");
                      } else {
                        window.open("mailto:fihtony@gmail.com?subject=MacFTP Support", "_blank");
                      }
                    }}
                  >
                    Tony Xu
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;

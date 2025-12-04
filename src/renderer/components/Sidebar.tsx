import React, { useState, useMemo } from 'react';
import { Folder, Server, Plus, Trash2, Settings, ChevronRight, ChevronDown, FolderOpen, Edit2, Play, Power, Network, Lock } from 'lucide-react';
import { Site, useStore } from '../store';
import { v4 as uuidv4 } from 'uuid';
import ConnectionProgressDialog from './ConnectionProgressDialog';
import FtpServerModal from './FtpServerModal';
import ContextMenu from './ContextMenu';
import DeleteSiteDialog from './DeleteSiteDialog';
import ConfirmDialog from './ConfirmDialog';

const Sidebar = () => {
  const { sites, addSite, updateSite, removeSite, isConnected, currentSite } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'General': true });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; site: Site } | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

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

  const handleSave = (siteData: Omit<Site, 'id'>) => {
    if (editingSite) {
      updateSite(editingSite.id, siteData);
    } else {
      const id = uuidv4();
      const newSite: Site = { ...siteData, id };
      addSite(newSite);
      if (newSite.group) {
        setExpandedGroups(prev => ({ ...prev, [newSite.group!]: true }));
      }
    }
  };

  const connectionProgress = useStore((state) => state.connectionProgress);
  const setConnectionProgress = useStore((state) => state.setConnectionProgress);

  const handleConnect = async (site: Site, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    console.log('Connecting to', site.name);
    const electron = (window as any).electronAPI;
    if (!electron) {
      alert('Electron API not available');
      return;
    }

    // Show connection progress dialog
    setConnectionProgress({
      isConnecting: true,
      siteName: site.name,
      host: site.host
    });

    try {
      const result = await electron.connect(site);
      
      if (result.success) {
        useStore.getState().setConnected(true);
        useStore.getState().setCurrentSite(site); // Save current site
        // Navigate to initial path if specified, otherwise use root
        const initialPath = site.initialPath || '/';
        useStore.getState().setCurrentPath(initialPath);
        const files = await electron.listDir(initialPath);
        if (files.success) {
          useStore.getState().setRemoteFiles(files.files);
        } else {
          // If initial path fails, try root
          const rootFiles = await electron.listDir('/');
          if (rootFiles.success) {
            useStore.getState().setCurrentPath('/');
            useStore.getState().setRemoteFiles(rootFiles.files);
          }
        }
      } else {
        alert('Connection failed: ' + result.error);
      }
    } catch (err: any) {
      alert('Connection error: ' + err.message);
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
    // Check if there are active downloads
    const downloads = useStore.getState().downloads;
    const activeDownloads = downloads.filter(d => 
      d.status === 'downloading' || d.status === 'queued'
    );
    
    if (activeDownloads.length > 0) {
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
      // Cancel all active downloads first
      const downloads = useStore.getState().downloads;
      const activeDownloads = downloads.filter(d => 
        d.status === 'downloading' || d.status === 'queued'
      );
      
      // Mark all active downloads as failed
      activeDownloads.forEach(download => {
        useStore.getState().updateDownload(download.id, {
          status: 'failed',
          error: 'Connection terminated by user',
          downloadedSize: 0,
          speed: undefined,
          eta: undefined,
          endTime: Date.now()
        });
      });
      
      // Close any open previews and clear temp file path
      useStore.getState().setTempFilePath(null);
      
      // Disconnect will automatically clean up all temp files
      await electron.disconnect();
      useStore.getState().setConnected(false);
      useStore.getState().setCurrentSite(null); // Clear current site
      useStore.getState().setRemoteFiles([]);
      useStore.getState().setCurrentPath('/');
    }
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const groupedSites = useMemo(() => {
    const groups: Record<string, Site[]> = {};
    sites.forEach(site => {
      const g = site.group || 'General';
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
      removeSite(siteToDelete.id);
      setSiteToDelete(null);
    }
  };

  return (
    <>
      {connectionProgress?.isConnecting && (
        <ConnectionProgressDialog
          siteName={connectionProgress.siteName || 'Unknown'}
          host={connectionProgress.host || ''}
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

      <DeleteSiteDialog
        isOpen={!!siteToDelete}
        site={siteToDelete}
        onClose={() => setSiteToDelete(null)}
        onConfirm={confirmDeleteSite}
      />

      {showDisconnectConfirm && (
        <ConfirmDialog
          title="Active Downloads in Progress"
          message={`${useStore.getState().downloads.filter(d => d.status === 'downloading' || d.status === 'queued').length} download(s) are currently in progress. Disconnecting will terminate all active downloads. Do you want to continue?`}
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
                    label: 'Disconnect',
                    icon: <Power size={14} />,
                    onClick: () => handleDisconnect(),
                    disabled: false
                  },
                  { separator: true },
                  {
                    label: 'Edit',
                    icon: <Edit2 size={14} />,
                    onClick: () => handleEdit(contextMenu.site),
                    disabled: true
                  },
                  {
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onClick: () => handleDeleteSite(contextMenu.site),
                    disabled: true
                  }
                ]
              : [
                  {
                    label: 'Connect',
                    icon: <Play size={14} />,
                    onClick: () => handleConnect(contextMenu.site),
                    disabled: isConnected
                  },
                  { separator: true },
                  {
                    label: 'Edit',
                    icon: <Edit2 size={14} />,
                    onClick: () => handleEdit(contextMenu.site),
                    disabled: false
                  },
                  {
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onClick: () => handleDeleteSite(contextMenu.site),
                    disabled: false
                  }
                ])
          ]}
        />
      )}

      <div className="h-full w-full bg-secondary/30 flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Sites</span>
          <button 
            onClick={handleAdd} 
            className="p-1 hover:bg-accent rounded"
            title="Add new site"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sites.length === 0 && !showModal && (
            <div className="text-center p-4 text-xs text-muted-foreground">
              No sites saved. <br/><br/>
              <strong>Demo Server:</strong><br/>
              Host: test.rebex.net<br/>
              Port: 22<br/>
              User: demo<br/>
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
                  {groupSites.map(site => {
                    const connected = isSiteConnected(site);
                    const hasSshKey = usesSshKey(site);
                    const IconComponent = site.protocol === 'sftp' ? Lock : Network;
                    
                    return (
                      <div 
                        key={site.id} 
                        className={`
                          group relative p-2.5 rounded border transition-colors cursor-pointer
                          ${connected 
                            ? 'bg-primary/10 border-primary/30' 
                            : 'border-border/50 hover:bg-accent/30'
                          }
                        `}
                        onContextMenu={(e) => handleContextMenu(e, site)}
                        onClick={() => !isConnected && !connected && handleConnect(site)}
                        title={connected 
                          ? 'Connected - Right-click for menu' 
                          : !isConnected 
                            ? 'Click to connect or right-click for menu' 
                            : currentSite 
                              ? `${currentSite.name} is connected - Right-click for menu`
                              : 'Another FTP is connected - Right-click for menu'}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <IconComponent 
                            size={16} 
                            className={`flex-shrink-0 ${site.protocol === 'sftp' ? 'text-blue-400' : 'text-orange-400'}`} 
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
                              <span className="text-[10px] text-muted-foreground truncate">{site.user}@{site.host}</span>
                              {connected && (
                                <span className="text-[9px] font-medium text-green-500 flex-shrink-0">
                                  Connected
                                </span>
                              )}
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
              <div className="font-semibold mb-2">Application Settings</div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>Sites Count:</span>
                  <span className="font-mono">{sites.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Status:</span>
                  <span className={isConnected ? 'text-green-400' : 'text-muted-foreground'}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-border text-[10px] text-muted-foreground">
                MacFTP v1.0.0<br/>
                Data is stored locally
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

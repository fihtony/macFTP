import React, { useState, useMemo, useEffect } from 'react';
import { Folder, Server, Plus, Trash2, Settings, X, Save, ChevronRight, ChevronDown, FolderOpen, Edit2, Play, Power, Key } from 'lucide-react';
import { Site, useStore } from '../store';
import { v4 as uuidv4 } from 'uuid';
import ConnectionProgressDialog from './ConnectionProgressDialog';

const Sidebar = () => {
  const { sites, addSite, updateSite, removeSite, isConnected } = useStore();
  const [isAdding, setIsAdding] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'General': true });
  
  const [formData, setFormData] = useState<Partial<Site>>({
    name: 'My Site',
    host: '',
    port: 22,
    user: '',
    password: '',
    protocol: 'sftp',
    group: 'General',
    privateKeyPath: '',
    privateKeyContent: '',
    initialPath: '/'
  });

  const [showKeyContent, setShowKeyContent] = useState(false);

  const resetForm = () => {
    setFormData({ name: '', host: '', port: 22, user: '', password: '', protocol: 'sftp', group: 'General', privateKeyPath: '', privateKeyContent: '', initialPath: '/' });
    setShowKeyContent(false);
  };

  const handleAdd = () => {
    if (!formData.host || !formData.user) {
      alert('Please fill in Host and User fields');
      return;
    }

    const id = uuidv4();
    const newSite: Site = {
      id,
      name: formData.name || formData.host,
      host: formData.host,
      port: formData.port || 22,
      user: formData.user,
      password: formData.password,
      privateKeyPath: formData.privateKeyPath,
      privateKeyContent: formData.privateKeyContent,
      protocol: formData.protocol as 'ftp' | 'sftp',
      group: formData.group || 'General',
      initialPath: formData.initialPath || '/'
    };

    addSite(newSite);
    
    if (newSite.group) {
        setExpandedGroups(prev => ({ ...prev, [newSite.group!]: true }));
    }

    setIsAdding(false);
    resetForm();
  };

  const handleEdit = (site: Site, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSite(site);
    setFormData({
      name: site.name,
      host: site.host,
      port: site.port,
      user: site.user,
      password: site.password || '',
      protocol: site.protocol,
      group: site.group || 'General',
      privateKeyPath: site.privateKeyPath || '',
      privateKeyContent: site.privateKeyContent || '',
      initialPath: site.initialPath || '/'
    });
    setShowKeyContent(!!site.privateKeyContent);
    setIsAdding(false);
  };

  const handleSaveEdit = () => {
    if (!editingSite || !formData.host || !formData.user) {
      alert('Please fill in Host and User fields');
      return;
    }

    updateSite(editingSite.id, {
      name: formData.name || formData.host,
      host: formData.host,
      port: formData.port || 22,
      user: formData.user,
      password: formData.password,
      privateKeyPath: formData.privateKeyPath,
      privateKeyContent: formData.privateKeyContent,
      protocol: formData.protocol as 'ftp' | 'sftp',
      group: formData.group || 'General',
      initialPath: formData.initialPath || '/'
    });

    setEditingSite(null);
    resetForm();
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
    const electron = (window as any).electronAPI;
    if (electron) {
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

  return (
    <>
      {connectionProgress?.isConnecting && (
        <ConnectionProgressDialog
          siteName={connectionProgress.siteName || 'Unknown'}
          host={connectionProgress.host || ''}
          onCancel={handleCancelConnection}
        />
      )}
    <div className="h-full w-full bg-secondary/30 flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <span className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Sites</span>
        <button 
          onClick={() => {
            setIsAdding(true);
            setEditingSite(null);
            resetForm();
          }} 
          className="p-1 hover:bg-accent rounded"
        >
            <Plus size={16} />
        </button>
      </div>

      {(isAdding || editingSite) && (
          <div className="p-4 bg-background/50 border-b border-border space-y-2 text-xs">
              <div className="font-semibold text-sm mb-2">{editingSite ? 'Edit Site' : 'Add New Site'}</div>
              <input 
                className="w-full p-1.5 bg-input rounded border border-border" 
                placeholder="Name" 
                value={formData.name} 
                onChange={e => setFormData({...formData, name: e.target.value})} 
              />
              <div className="flex gap-2">
                  <select 
                    className="bg-input rounded p-1.5 border border-border" 
                    value={formData.protocol} 
                    onChange={e => setFormData({...formData, protocol: e.target.value as any})}
                  >
                      <option value="sftp">SFTP</option>
                      <option value="ftp">FTP</option>
                  </select>
                  <input 
                    className="flex-1 p-1.5 bg-input rounded border border-border" 
                    placeholder="Host" 
                    value={formData.host} 
                    onChange={e => setFormData({...formData, host: e.target.value})} 
                  />
              </div>
              <input 
                className="w-full p-1.5 bg-input rounded border border-border" 
                placeholder="Port" 
                type="number" 
                value={formData.port} 
                onChange={e => setFormData({...formData, port: parseInt(e.target.value) || 22})} 
              />
              <input 
                className="w-full p-1.5 bg-input rounded border border-border" 
                placeholder="User" 
                value={formData.user} 
                onChange={e => setFormData({...formData, user: e.target.value})} 
              />
              <input 
                className="w-full p-1.5 bg-input rounded border border-border" 
                placeholder="Password" 
                type="password" 
                value={formData.password} 
                onChange={e => setFormData({...formData, password: e.target.value})} 
              />
              <input 
                className="w-full p-1.5 bg-input rounded border border-border" 
                placeholder="Group" 
                value={formData.group} 
                onChange={e => setFormData({...formData, group: e.target.value})} 
              />
              <input 
                className="w-full p-1.5 bg-input rounded border border-border text-xs font-mono" 
                placeholder="Initial Path (e.g. /home/user/docs)" 
                value={formData.initialPath || '/'} 
                onChange={e => setFormData({...formData, initialPath: e.target.value || '/'})} 
              />
              
              {/* SSH Key Authentication (SFTP only) */}
              {formData.protocol === 'sftp' && (
                <div className="space-y-2 pt-1 border-t border-border">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Key size={12} />
                    <span>SSH Key Authentication (Optional)</span>
                  </div>
                  
                  {/* Key Path */}
                  <div className="flex gap-2">
                    <input 
                      className="flex-1 p-1.5 bg-input rounded border border-border text-xs" 
                      placeholder="Private Key Path" 
                      value={formData.privateKeyPath || ''} 
                      onChange={e => setFormData({...formData, privateKeyPath: e.target.value, privateKeyContent: ''})} 
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const electron = (window as any).electronAPI;
                        if (electron) {
                          const result = await electron.selectFile({
                            filters: [
                              { name: 'SSH Keys', extensions: ['pem', 'key', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'] },
                              { name: 'All Files', extensions: ['*'] }
                            ]
                          });
                          if (!result.cancelled && result.filePaths && result.filePaths[0]) {
                            setFormData({...formData, privateKeyPath: result.filePaths[0], privateKeyContent: ''});
                            setShowKeyContent(false);
                          }
                        }
                      }}
                      className="px-2 py-1.5 bg-accent hover:bg-accent/80 rounded text-xs flex items-center gap-1"
                      title="Browse for SSH key file"
                    >
                      <FolderOpen size={12} />
                    </button>
                  </div>
                  
                  {/* Or paste key content */}
                  <div className="text-[10px] text-muted-foreground text-center">OR</div>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setShowKeyContent(!showKeyContent);
                      if (!showKeyContent) {
                        setFormData({...formData, privateKeyPath: ''}); // Clear path when using content
                      }
                    }}
                    className="w-full px-2 py-1.5 bg-accent/50 hover:bg-accent rounded text-xs flex items-center justify-center gap-1"
                  >
                    <Key size={12} />
                    {showKeyContent ? 'Hide' : 'Paste'} SSH Key Content
                  </button>
                  
                  {showKeyContent && (
                    <textarea
                      className="w-full p-1.5 bg-input rounded border border-border text-xs font-mono resize-none"
                      placeholder="Paste your SSH private key here (starts with -----BEGIN...)"
                      rows={4}
                      value={formData.privateKeyContent || ''}
                      onChange={e => setFormData({...formData, privateKeyContent: e.target.value, privateKeyPath: ''})}
                    />
                  )}
                </div>
              )}
              
              <div className="flex justify-end gap-2 mt-2">
                  <button 
                    onClick={() => {
                      setIsAdding(false);
                      setEditingSite(null);
                      resetForm();
                    }} 
                    className="px-3 py-1.5 hover:bg-accent rounded text-sm"
                  >
                    <X size={14} className="inline mr-1" />
                    Cancel
                  </button>
                  <button 
                    onClick={editingSite ? handleSaveEdit : handleAdd} 
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm"
                  >
                    <Save size={14} className="inline mr-1" />
                    {editingSite ? 'Save' : 'Add'}
                  </button>
              </div>
          </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sites.length === 0 && !isAdding && !editingSite && (
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
                        {groupSites.map(site => (
                            <div 
                              key={site.id} 
                              className={`
                                group flex flex-col gap-1 p-2 rounded border border-border/50
                                ${isConnected ? 'bg-accent/30' : 'hover:bg-accent/50'}
                                transition-colors
                              `}
                            >
                              <div className="flex items-center justify-between">
                                <div 
                                  className="flex items-center gap-2 overflow-hidden flex-1 cursor-pointer"
                                  onClick={() => handleConnect(site)}
                                >
                                  <Server size={16} className="text-primary flex-shrink-0" />
                                  <div className="flex flex-col overflow-hidden min-w-0">
                                    <span className="text-sm font-medium truncate">{site.name}</span>
                                    <span className="text-[10px] text-muted-foreground truncate">{site.user}@{site.host}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={(e) => handleEdit(site, e)} 
                                    className="p-1 hover:text-primary rounded"
                                    title="Edit"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); removeSite(site.id); }} 
                                    className="p-1 hover:text-destructive rounded"
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                              
                              <div className="flex gap-1">
                                <button
                                  onClick={(e) => handleConnect(site, e)}
                                  className={`
                                    flex-1 px-2 py-1 text-xs rounded flex items-center justify-center gap-1
                                    ${isConnected 
                                      ? 'bg-secondary text-secondary-foreground cursor-not-allowed' 
                                      : 'bg-primary text-primary-foreground hover:opacity-90'
                                    }
                                  `}
                                  disabled={isConnected}
                                  title={isConnected ? 'Disconnect first' : 'Connect'}
                                >
                                  <Play size={12} />
                                  Connect
                                </button>
                              </div>
                            </div>
                        ))}
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

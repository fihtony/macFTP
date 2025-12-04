import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Key, FolderOpen } from 'lucide-react';
import { Site, useStore } from '../store';

interface FtpServerModalProps {
  isOpen: boolean;
  site: Site | null;
  onClose: () => void;
  onSave: (site: Omit<Site, 'id'>) => void;
}

const FtpServerModal: React.FC<FtpServerModalProps> = ({ isOpen, site, onClose, onSave }) => {
  const sites = useStore((state) => state.sites);
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
    initialPath: '/',
    defaultDownloadPath: ''
  });

  const [showKeyContent, setShowKeyContent] = useState(false);
  const [isCreatingNewGroup, setIsCreatingNewGroup] = useState(false);

  const availableGroups = useMemo(() => {
    const groups = new Set<string>(['General']);
    sites.forEach(s => {
      if (s.group) groups.add(s.group);
    });
    return Array.from(groups).sort();
  }, [sites]);

  useEffect(() => {
    if (isOpen) {
      if (site) {
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
          initialPath: site.initialPath || '/',
          defaultDownloadPath: site.defaultDownloadPath || ''
        });
        setShowKeyContent(!!site.privateKeyContent);
      } else {
        setFormData({
          name: 'My Site',
          host: '',
          port: 22,
          user: '',
          password: '',
          protocol: 'sftp',
          group: 'General',
          privateKeyPath: '',
          privateKeyContent: '',
          initialPath: '/',
          defaultDownloadPath: ''
        });
        setShowKeyContent(false);
      }
    }
  }, [isOpen, site]);

  const handleSave = () => {
    if (!formData.host || !formData.user) {
      alert('Please fill in Host and User fields');
      return;
    }

    const siteName = formData.name || formData.host;
    
    // Check for duplicate site names (excluding current site if editing)
    const duplicateSite = sites.find(s => 
      s.name === siteName && (site ? s.id !== site.id : true)
    );
    
    if (duplicateSite) {
      alert(`A site with the name "${siteName}" already exists. Please use a different name.`);
      return;
    }

    const siteData: Omit<Site, 'id'> = {
      name: siteName,
      host: formData.host,
      port: formData.port || 22,
      user: formData.user,
      password: formData.password,
      privateKeyPath: formData.privateKeyPath,
      privateKeyContent: formData.privateKeyContent,
      protocol: formData.protocol as 'ftp' | 'sftp',
      group: formData.group || 'General',
      initialPath: formData.initialPath || '/',
      defaultDownloadPath: formData.defaultDownloadPath || undefined
    };

    onSave(siteData);
    onClose();
  };

  const handleGroupChange = (value: string) => {
    if (value === '__CREATE_NEW__') {
      setIsCreatingNewGroup(true);
      setFormData({ ...formData, group: '' });
    } else {
      setFormData({ ...formData, group: value });
      setIsCreatingNewGroup(false);
    }
  };

  const handleGroupInputChange = (value: string) => {
    setFormData({ ...formData, group: value });
    // If the value matches an existing group, switch back to select mode
    if (availableGroups.includes(value)) {
      setIsCreatingNewGroup(false);
    } else {
      setIsCreatingNewGroup(true);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">{site ? 'Edit Site' : 'Add New Site'}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Group and Name in one row */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">Group</label>
              {isCreatingNewGroup ? (
                <input
                  className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="Type new group name"
                  value={formData.group || ''}
                  onChange={e => handleGroupInputChange(e.target.value)}
                  onBlur={() => {
                    // If empty or matches existing group, switch back to select
                    if (!formData.group || availableGroups.includes(formData.group || '')) {
                      setIsCreatingNewGroup(false);
                      if (!formData.group) {
                        setFormData({ ...formData, group: 'General' });
                      }
                    }
                  }}
                  autoFocus
                />
              ) : (
                <select
                  className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  value={formData.group || 'General'}
                  onChange={e => handleGroupChange(e.target.value)}
                >
                  {availableGroups.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                  <option value="__CREATE_NEW__" className="text-muted-foreground italic">
                    &lt;create new group&gt;
                  </option>
                </select>
              )}
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">Name</label>
              <input
                className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="My Site"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
          </div>

          {/* Protocol, Host, Port in one row */}
          <div className="flex gap-2">
            <div className="w-24">
              <label className="block text-xs font-medium mb-1.5">Protocol</label>
              <select
                className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                value={formData.protocol}
                onChange={e => {
                  const newProtocol = e.target.value as 'ftp' | 'sftp';
                  const defaultPort = newProtocol === 'sftp' ? 22 : 21;
                  setFormData({ ...formData, protocol: newProtocol, port: defaultPort });
                }}
              >
                <option value="sftp">SFTP</option>
                <option value="ftp">FTP</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">Host</label>
              <input
                className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="example.com"
                value={formData.host}
                onChange={e => setFormData({ ...formData, host: e.target.value })}
              />
            </div>
            <div className="w-20">
              <label className="block text-xs font-medium mb-1.5">Port</label>
              <input
                className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                type="number"
                placeholder="22"
                value={formData.port}
                onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) || 22 })}
              />
            </div>
          </div>

          {/* User and Password in one row */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">User</label>
              <input
                className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                placeholder="username"
                value={formData.user}
                onChange={e => setFormData({ ...formData, user: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">Password</label>
              <input
                className="w-full px-3 py-2 bg-input rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                type="password"
                placeholder="password"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
          </div>

          {/* Initial Path and Default Download Path */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">Initial Path</label>
              <input
                className="w-full px-3 py-2 bg-input rounded border border-border text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="/home/user/docs"
                value={formData.initialPath || '/'}
                onChange={e => setFormData({ ...formData, initialPath: e.target.value || '/' })}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1.5">Default Download Folder (Optional)</label>
              <div className="flex gap-1">
                <input
                  className="flex-1 px-3 py-2 bg-input rounded border border-border text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Leave empty to prompt each time"
                  value={formData.defaultDownloadPath || ''}
                  onChange={e => setFormData({ ...formData, defaultDownloadPath: e.target.value })}
                />
                <button
                  type="button"
                  onClick={async () => {
                    const electron = (window as any).electronAPI;
                    if (electron) {
                      const result = await electron.selectFile({
                        properties: ['openDirectory']
                      });
                      if (!result.cancelled && result.filePaths && result.filePaths[0]) {
                        setFormData({ ...formData, defaultDownloadPath: result.filePaths[0] });
                      }
                    }
                  }}
                  className="px-2 py-2 bg-accent hover:bg-accent/80 rounded flex items-center"
                  title="Browse for download folder"
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* SSH Key Authentication (SFTP only) */}
          {formData.protocol === 'sftp' && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Key size={12} />
                <span>SSH Key Authentication (Optional)</span>
              </div>

              {/* Key Path */}
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 bg-input rounded border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Private Key Path"
                  value={formData.privateKeyPath || ''}
                  onChange={e => setFormData({ ...formData, privateKeyPath: e.target.value, privateKeyContent: '' })}
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
                        setFormData({ ...formData, privateKeyPath: result.filePaths[0], privateKeyContent: '' });
                        setShowKeyContent(false);
                      }
                    }
                  }}
                  className="px-3 py-2 bg-accent hover:bg-accent/80 rounded text-xs flex items-center gap-1"
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
                    setFormData({ ...formData, privateKeyPath: '' });
                  }
                }}
                className="w-full px-3 py-2 bg-accent/50 hover:bg-accent rounded text-xs flex items-center justify-center gap-1"
              >
                <Key size={12} />
                {showKeyContent ? 'Hide' : 'Paste'} SSH Key Content
              </button>

              {showKeyContent && (
                <textarea
                  className="w-full px-3 py-2 bg-input rounded border border-border text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Paste your SSH private key here (starts with -----BEGIN...)"
                  rows={4}
                  value={formData.privateKeyContent || ''}
                  onChange={e => setFormData({ ...formData, privateKeyContent: e.target.value, privateKeyPath: '' })}
                />
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 hover:bg-accent rounded text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm hover:opacity-90 transition-opacity"
            >
              <Save size={14} className="inline mr-1.5" />
              {site ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FtpServerModal;


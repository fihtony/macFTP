import ElectronStore from 'electron-store';
import crypto from 'crypto';
import { app, ipcMain } from 'electron';
import path from 'path';
import os from 'os';
import * as keytar from 'keytar';

interface Site {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyContent?: string; // Encrypted
  protocol: 'ftp' | 'sftp';
  group?: string;
  initialPath?: string; // Initial folder path
}

// Encryption key derivation - using app-specific data + machine-specific data
// This makes it harder for third parties to reproduce the key even if they know the algorithm
// Salt is stored in macOS Keychain for enhanced security
const getEncryptionKey = async (): Promise<Buffer> => {
  // Base material: app-specific data
  const appData = app.getPath('userData') + app.getName();
  
  // Add machine-specific data to make key harder to reproduce
  const machineData = [
    os.homedir(), // User home directory
    os.hostname(), // Machine hostname
    os.type(), // OS type (Darwin, Linux, etc.)
    process.platform, // Platform (darwin, linux, win32)
  ].join('');
  
  // Combine all materials
  const keyMaterial = appData + machineData;
  
  // Use PBKDF2 for key derivation (slower but more secure, adds computational cost)
  // Store salt in macOS Keychain for better security
  const SERVICE_NAME = 'com.macftp.app';
  const ACCOUNT_NAME = 'encryption-salt';
  let salt: Buffer;
  
  try {
    // Try to get salt from Keychain first
    const keychainSalt = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    
    if (keychainSalt) {
      salt = Buffer.from(keychainSalt, 'hex');
    } else {
      // No salt in Keychain, check old electron-store location (migration)
      const keyStore = new ElectronStore({ name: 'macftp-key' });
      const existingSalt = (keyStore as any).get('encryptionSalt') as string | undefined;
      
      if (existingSalt) {
        // Migrate salt from electron-store to Keychain
        salt = Buffer.from(existingSalt, 'hex');
        await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, existingSalt);
        // Remove from old location
        (keyStore as any).delete('encryptionSalt');
        console.log('[Database] Migrated encryption salt to Keychain');
      } else {
        // Generate new random salt and store in Keychain
        salt = crypto.randomBytes(32); // 256-bit salt
        await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, salt.toString('hex'));
        console.log('[Database] Generated new encryption salt and stored in Keychain');
      }
    }
  } catch (error) {
    // Fallback to electron-store if Keychain is unavailable (e.g., Linux)
    console.warn('[Database] Keychain unavailable, falling back to electron-store:', error);
    const keyStore = new ElectronStore({ name: 'macftp-key' });
    const existingSalt = (keyStore as any).get('encryptionSalt') as string | undefined;
    
    if (existingSalt) {
      salt = Buffer.from(existingSalt, 'hex');
    } else {
      salt = crypto.randomBytes(32);
      (keyStore as any).set('encryptionSalt', salt.toString('hex'));
    }
  }
  
  // Use PBKDF2 with 100,000 iterations for key derivation
  // This makes brute-force attacks much more expensive
  const key = crypto.pbkdf2Sync(keyMaterial, salt, 100000, 32, 'sha256');
  
  return key;
};

// Cache encryption key to avoid repeated Keychain access and PBKDF2 computation
let cachedKey: Buffer | null = null;

const getEncryptionKeySync = (): Buffer => {
  // For synchronous operations, use cached key if available
  // Otherwise compute it synchronously (fallback)
  if (cachedKey) {
    return cachedKey;
  }
  
  // Fallback: compute synchronously without Keychain
  const appData = app.getPath('userData') + app.getName();
  const machineData = [
    os.homedir(),
    os.hostname(),
    os.type(),
    process.platform,
  ].join('');
  const keyMaterial = appData + machineData;
  
  const keyStore = new ElectronStore({ name: 'macftp-key' });
  let salt: Buffer;
  const existingSalt = (keyStore as any).get('encryptionSalt') as string | undefined;
  
  if (existingSalt) {
    salt = Buffer.from(existingSalt, 'hex');
  } else {
    salt = crypto.randomBytes(32);
    (keyStore as any).set('encryptionSalt', salt.toString('hex'));
  }
  
  const key = crypto.pbkdf2Sync(keyMaterial, salt, 100000, 32, 'sha256');
  cachedKey = key;
  return key;
};

// Initialize encryption key asynchronously on startup
export const initializeEncryptionKey = async (): Promise<void> => {
  try {
    cachedKey = await getEncryptionKey();
    console.log('[Database] Encryption key initialized from Keychain');
  } catch (error) {
    console.warn('[Database] Failed to initialize key from Keychain, using fallback:', error);
    // Use sync fallback
    getEncryptionKeySync();
  }
};

const encrypt = (text: string): string => {
  if (!text) return '';
  const key = cachedKey || getEncryptionKeySync();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

const decrypt = (encryptedText: string): string => {
  if (!encryptedText) return '';
  try {
    const key = cachedKey || getEncryptionKeySync();
    const parts = encryptedText.split(':');
    if (parts.length !== 2) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return '';
  }
};

interface DownloadHistoryItem {
  id: string;
  fileName: string;
  remotePath: string;
  localPath: string;
  totalSize: number;
  downloadedSize: number;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  speed?: number;
  eta?: number;
  error?: string;
  startTime?: number;
  endTime?: number;
  siteName?: string;
  siteHost?: string;
  siteId?: string; // Site ID for updating site name
}

// Initialize electron-store with proper typing
interface StoreSchema {
  sites: Site[];
  downloadHistory: DownloadHistoryItem[];
  appSettings: {
    maxConcurrentDownloads: number;
    defaultConflictResolution: 'overwrite' | 'rename' | 'prompt';
    showHiddenFiles: boolean;
  };
}

// Create store instance
const store = new ElectronStore<StoreSchema>({
  name: 'macftp-data',
  defaults: {
    sites: [],
    downloadHistory: [],
  },
});

export const saveSites = (sites: Site[]): void => {
  // Encrypt sensitive fields: host, username, password, and private key
  // Note: site name is not encrypted as it's just an identifier
  const encryptedSites = sites.map(site => ({
    ...site,
    host: site.host ? encrypt(site.host) : undefined,
    user: site.user ? encrypt(site.user) : undefined,
    password: site.password ? encrypt(site.password) : undefined,
    privateKeyContent: site.privateKeyContent ? encrypt(site.privateKeyContent) : undefined,
  }));
  
  // Access methods through type assertion - ElectronStore extends Conf which has these methods
  (store as any).set('sites', encryptedSites);
};

export const loadSites = (): Site[] => {
  // Access methods through type assertion
  const encryptedSites = (store as any).get('sites', []) as any[];
  
  // Decrypt sensitive fields, handle decryption errors gracefully
  // Note: site name is not encrypted, so it's returned as-is
  return encryptedSites.map((site: any) => {
    let decryptedHost = site.host;
    let decryptedUser = site.user;
    let decryptedPassword = site.password;
    let decryptedPrivateKey = site.privateKeyContent;
    
    // Helper function to decrypt if encrypted (contains ':')
    const tryDecrypt = (value: string | undefined, fieldName: string): string | undefined => {
      if (!value || typeof value !== 'string' || !value.includes(':')) {
        return value; // Not encrypted, return as-is (for backward compatibility)
      }
      const decrypted = decrypt(value);
      if (!decrypted && value) {
        console.warn(`Failed to decrypt ${fieldName} for site ID:`, site.id || 'unknown');
        return ''; // Clear invalid encrypted value
      }
      return decrypted || undefined;
    };
    
    // Decrypt all sensitive fields (host, user, password, privateKeyContent)
    decryptedHost = tryDecrypt(site.host, 'host');
    decryptedUser = tryDecrypt(site.user, 'user');
    decryptedPassword = tryDecrypt(site.password, 'password');
    decryptedPrivateKey = tryDecrypt(site.privateKeyContent, 'privateKeyContent');
    
    return {
      ...site,
      // name is kept as-is (not encrypted)
      host: decryptedHost || undefined,
      user: decryptedUser || undefined,
      password: decryptedPassword || undefined,
      privateKeyContent: decryptedPrivateKey || undefined,
    };
  });
};

export const clearDatabase = (): void => {
  // Access methods through type assertion
  (store as any).clear();
};

// Helper to clean up corrupted encrypted data
export const cleanupCorruptedData = (): void => {
  const encryptedSites = (store as any).get('sites', []) as any[];
  const cleanedSites = encryptedSites.map((site: any) => {
    // Clear encrypted fields that fail decryption
    let cleanSite = { ...site };
    
    // Helper function to check and clean corrupted encrypted data
    const checkAndClean = (field: string | undefined, fieldName: string) => {
      if (field && typeof field === 'string' && field.includes(':')) {
        const decrypted = decrypt(field);
        if (!decrypted) {
          cleanSite[fieldName] = undefined; // Remove corrupted encrypted field
        }
      }
    };
    
    // Check all encrypted fields (host, user, password, privateKeyContent)
    // Note: site name is not encrypted, so no need to check/clean it
    checkAndClean(site.host, 'host');
    checkAndClean(site.user, 'user');
    checkAndClean(site.password, 'password');
    checkAndClean(site.privateKeyContent, 'privateKeyContent');
    
    return cleanSite;
  });
  
  // Save cleaned data
  (store as any).set('sites', cleanedSites);
};

// Download history functions
export const saveDownloadHistory = (downloads: DownloadHistoryItem[]): void => {
  // Keep only completed, failed, or cancelled downloads in history (limit to last 1000)
  const historyItems = downloads
    .filter(d => d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled')
    .slice(-1000); // Keep last 1000 items
  
  (store as any).set('downloadHistory', historyItems);
};

export const loadDownloadHistory = (): DownloadHistoryItem[] => {
  return (store as any).get('downloadHistory', []) as DownloadHistoryItem[];
};

export const saveAllDownloads = (downloads: DownloadHistoryItem[]): void => {
  // Save all downloads (active + history)
  // Keep last 1000 history items, but preserve all active downloads
  const activeDownloads = downloads.filter(d => 
    d.status === 'queued' || d.status === 'downloading' || d.status === 'paused'
  );
  const historyDownloads = downloads.filter(d => 
    d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled'
  );
  
  // Sort history by endTime descending (newest first) and take last 1000
  // slice(-1000) keeps the most recent 1000 items
  const sortedHistory = historyDownloads
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
    .slice(-1000);
  
  // Combine active + history (preserve all active, limit history to 1000)
  const allToSave = [...activeDownloads, ...sortedHistory];
  
  // Encrypt sensitive fields in download history (siteHost)
  const encryptedDownloads = allToSave.map(download => ({
    ...download,
    siteHost: download.siteHost ? encrypt(download.siteHost) : undefined
  }));
  
  console.log('[Database] Saving downloads:', {
    active: activeDownloads.length,
    history: sortedHistory.length,
    totalToSave: allToSave.length,
    totalReceived: downloads.length
  });
  
  try {
    (store as any).set('downloadHistory', encryptedDownloads);
    console.log('[Database] Successfully saved downloads to database (with encrypted hosts)');
  } catch (error) {
    console.error('[Database] Error saving downloads:', error);
    throw error;
  }
};

export const loadAllDownloads = (): DownloadHistoryItem[] => {
  try {
    const encryptedDownloads = (store as any).get('downloadHistory', []) as any[];
    
    // Decrypt sensitive fields in download history (siteHost)
    const downloads = encryptedDownloads.map((download: any) => {
      let decryptedHost = download.siteHost;
      
      // Helper function to decrypt if encrypted (contains ':')
      if (decryptedHost && typeof decryptedHost === 'string' && decryptedHost.includes(':')) {
        const decrypted = decrypt(decryptedHost);
        if (!decrypted && decryptedHost) {
          console.warn('[Database] Failed to decrypt siteHost for download:', download.id);
          decryptedHost = ''; // Clear invalid encrypted value
        } else {
          decryptedHost = decrypted || undefined;
        }
      }
      
      return {
        ...download,
        siteHost: decryptedHost || download.siteHost // Use decrypted or original if not encrypted
      };
    });
    
    const activeCount = downloads.filter(d => 
      d.status === 'queued' || d.status === 'downloading' || d.status === 'paused'
    ).length;
    const historyCount = downloads.filter(d => 
      d.status === 'completed' || d.status === 'failed' || d.status === 'cancelled'
    ).length;
    console.log('[Database] Loading downloads from database:', {
      total: downloads.length,
      active: activeCount,
      history: historyCount
    });
    return downloads as DownloadHistoryItem[];
  } catch (error) {
    console.error('[Database] Error loading downloads:', error);
    return [];
  }
};

// Settings handlers
ipcMain.handle('store:saveSettings', async (_event, settings: any) => {
  console.log('[IPC] Saving settings:', settings);
  (store as any).set('appSettings', settings);
  return { success: true };
});

ipcMain.handle('store:loadSettings', async () => {
  console.log('[IPC] Loading settings from database...');
  const settings = (store as any).get('appSettings', {
    maxConcurrentDownloads: 3,
    defaultConflictResolution: 'prompt',
    showHiddenFiles: false
  });
  console.log('[IPC] Loaded settings:', settings);
  return settings;
});

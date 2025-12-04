# MacFTP

A modern, native-feeling FTP/SFTP client for macOS (and other platforms), built with Electron, React, and TypeScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-fihtony%2FmacFTP-blue.svg)](https://github.com/fihtony/macFTP)

## Features

### 🎨 User Interface
- **Modern macOS Design**: Native-feeling interface with custom title bar
- **Dark/Light Mode**: Toggle between themes with a single click
- **Resizable Panels**: Adjustable widths for site manager, file explorer, and download manager
- **Responsive Layout**: Optimized for different window sizes

### 🔐 Authentication & Security
- **Multiple Protocols**: Support for both FTP and SFTP (SSH)
- **SSH Key Authentication**: 
  - Private key file selection
  - Direct key content paste (alternative to file path)
  - Automatic password fallback
- **Encrypted Storage**: Sensitive data (host addresses, usernames, passwords, SSH private keys) are encrypted using AES-256-CBC with PBKDF2 key derivation
- **Local Storage**: JSON-based persistent storage with automatic data persistence (not SQLite)

### 📁 Site Management
- **Site Manager**: Save and manage multiple connection profiles
- **Group Management**: Organize sites by groups with collapsible sections
- **Initial Path**: Set a default directory to navigate to after connection
- **Connection Progress**: Visual feedback during connection process

### 🔍 File Browser
- **Browse Remote Directories**: Navigate through remote file systems
- **Address Bar**: Direct path input with multi-level autocomplete
  - Auto-complete suggestions for folders
  - Root-level path suggestions
  - Real-time path association
- **File Details**: View comprehensive file information (size, permissions, dates, owner)
- **Navigation**: Double-click folders, use breadcrumbs, or navigation buttons

### 📥 Download Management
- **Download Queue**: Queue multiple downloads with progress tracking
- **Download Progress**: Real-time progress with:
  - Total size and downloaded size
  - Transfer speed (current and average)
  - Estimated time remaining (ETA)
  - Source and destination paths
- **Download History**: 
  - Persistent download history (survives app restarts)
  - Compact two-line display with icons
  - Filter by status (completed, failed, cancelled)
  - Site name and host information
  - Automatic site name updates when site is renamed
- **Download Controls**: Pause, resume, cancel, and remove downloads
- **Background Downloads**: Minimize download dialogs to background

### 👁️ File Preview
- **Text Preview**: 
  - Full text file preview with syntax highlighting
  - Search functionality within preview
  - File information display
- **Image Preview**: 
  - Full image preview with zoom controls
  - Zoom modes: Fit, 1:1, custom zoom levels
  - Zoom controls: Fit, 1:1, Zoom In (+), Zoom Out (-)
  - Fixed toolbar that doesn't scroll with image
  - File information display
- **Automatic Cleanup**: Temporary preview files are automatically deleted after preview

### 📤 File Operations
- **Download**: Download files to local machine with save dialog
- **Upload**: Drag & drop files to upload (coming soon)
- **Properties & Chmod**: View file properties and modify permissions
- **File Actions**: Context menu with various file operations

### 🔔 Notifications
- **Toast Notifications**: Elegant banner-style notifications at the bottom
  - Success notifications (green)
  - Error notifications (red)
  - Info notifications
  - Auto-dismiss with configurable duration

## Demo FTP Servers

Here are some public test servers you can use to test the application:

### 1. Rebex Test Server (Recommended)
- **Host**: `test.rebex.net`
- **Port**: `21` (FTP) or `22` (SFTP)
- **Username**: `demo`
- **Password**: `password`
- **Protocol**: Both FTP and SFTP supported
- **Note**: Read-only server, suitable for testing browsing and download features

**Quick Start**:
1. Click the "+" button in the sidebar
2. Enter the details above
3. Click "Save" and then click on the site to connect

### 2. DLP Test FTP Server (Read/Write)
- **Host**: `ftp.dlptest.com`
- **Port**: `21`
- **Username**: `dlpuser@dlptest.com`
- **Password**: `rNrKYTX9g7z3RgJRmxWuGHbeu` (check [this page](https://dlptest.com/ftp-test/) for updates)
- **Protocol**: FTP
- **Note**: Allows upload and download, files auto-delete after 2 minutes

### 3. Other Test Servers
- **SpeedTest FTP**: `speedtest.tele2.net` (Anonymous login)
- **FileZilla Test Server**: `demo.wftpserver.com` (Username: `demo-user`, Password: `demo-user`)

### 4. Local SFTP Sandbox (Docker)
- **Folder**: `testserver/`
- **Host**: `localhost`
- **Port**: `2222`
- **Protocol**: SFTP
- **Username**: `testuser`
- **Password**: `testpass`
- **Start**: `cd testserver && docker compose up -d --build`
- **Stop**: `cd testserver && docker compose down`
- **Data**: Files persist under `testserver/data/upload/` on your host
- **Throttle**: `cd testserver && ./limit_bandwidth.sh 1600kbit` (≈200 KB/s); run `./remove_bandwidth_limit.sh` to reset

Use this when you need guaranteed upload/create/download permissions or want
to experiment without depending on public demo servers.

## Tech Stack

- **Runtime**: [Electron](https://www.electronjs.org/) v39
- **Frontend**: [React](https://react.dev/) v19 + [Vite](https://vitejs.dev/) v7
- **Language**: [TypeScript](https://www.typescriptlang.org/) v5
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) v5
- **FTP/SFTP Libraries**: 
  - `basic-ftp` v5 - FTP client
  - `ssh2-sftp-client` v12 - SFTP client
- **Storage**: `electron-store` v11 - Encrypted local storage
- **Icons**: [Lucide React](https://lucide.dev/) - Modern icon library
- **Date Formatting**: `date-fns` v4 - Date utility library

## Development

### Prerequisites

- Node.js (v16 or higher)
- npm

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server (concurrently runs Electron and Vite):
   ```bash
   npm run dev
   ```

### Build

To build the application for production:

```bash
npm run build
```

The output will be in the `dist` and `dist-electron` directories.

### Build for macOS Installation

To build a distributable macOS application (.dmg or .app):

```bash
# Build DMG installer (recommended)
npm run build:dmg

# Or build both DMG and ZIP
npm run build:mac

# Or build for all platforms
npm run build:app
```

The built application will be in the `release` directory:
- **DMG file**: `release/MacFTP-1.0.0.dmg` - Double-click to mount and drag to Applications
- **ZIP file**: `release/MacFTP-1.0.0-mac.zip` - Extract and run the .app file
- **APP bundle**: `release/mac/MacFTP.app` - The actual application bundle

### Installing the Built App

1. **From DMG**:
   - Double-click the `.dmg` file
   - Drag `MacFTP.app` to the Applications folder
   - Open Applications and launch MacFTP

2. **From ZIP**:
   - Extract the `.zip` file
   - Move `MacFTP.app` to `/Applications`
   - Launch from Applications or Spotlight

3. **First Launch**:
   - macOS may show a security warning because the app is not code-signed
   - Go to System Preferences → Security & Privacy
   - Click "Open Anyway" next to the MacFTP message
   - Or right-click the app and select "Open", then click "Open" in the dialog

**Note**: For distribution, you'll want to code-sign and notarize the app. The current build is unsigned and suitable for personal use.

### Development Mode

In development mode, the app runs with:
- Hot module replacement (HMR) for React components
- TypeScript compilation for main process
- DevTools available (toggle with `Cmd+Option+I` or `F12`)
- Console logging for debugging

### Keyboard Shortcuts

- `Cmd+Option+I` / `Ctrl+Shift+I` / `F12`: Toggle DevTools
- `Cmd+Q`: Quit application (macOS)
- `Cmd+H`: Hide application (macOS)
- `Escape`: Close preview dialogs

## Usage Guide

### Adding a New Site

1. Click the **"+"** button in the sidebar
2. Fill in the connection details:
   - **Name**: A friendly name for the site
   - **Protocol**: Choose FTP or SFTP
   - **Host**: Server address
   - **Port**: Usually 21 for FTP, 22 for SFTP
   - **User**: Your username
   - **Password**: Your password (optional if using SSH key)
   - **Group**: Optional group name (e.g., "Work", "Personal")
   - **Initial Path**: Optional default directory to navigate to after connection (e.g., `/www/public`)
   - **Private Key**: For SFTP key-based authentication:
     - **Option 1**: Select a private key file using the folder icon
     - **Option 2**: Click the key icon to paste private key content directly
3. Click the **Save** button

### Connecting to a Site

- Click on any site in the sidebar to connect
- A connection progress dialog will show the connection status
- Once connected, the app will navigate to the initial path (if set) or root directory
- You can browse the remote file system immediately

### Navigation

- **Address Bar**: 
  - Type a path directly to navigate
  - Use autocomplete suggestions (type `/pub/` to see folders under `/pub/`)
  - Supports root-level path suggestions
- **Enter Folder**: Double-click on a folder
- **Go Up**: Click the up arrow button in the toolbar
- **Refresh**: Click the refresh button to reload the current directory
- **Breadcrumbs**: Click on any path segment in the breadcrumb to jump to that directory

### File Preview

- **Text Files**: Double-click any text file to preview it
  - Full file content is shown
  - Use the search bar to find text within the file
  - View file information (size, type, dates, owner)
- **Image Files**: Double-click any image file to preview it
  - Full image is displayed
  - Use zoom controls (Fit, 1:1, +, -) at the bottom right
  - Scroll to navigate zoomed images
  - View file information
- **Close Preview**: Click the X button or press Escape to close

### Download Management

- **Start Download**: 
  - Click the download icon on any file
  - Choose the save location in the dialog
  - Download will start immediately
- **View Downloads**: 
  - Click the download icon in the title bar to toggle the download manager
  - View active downloads and progress
  - View download history
- **Download History**: 
  - Click the history icon in the download manager
  - View all completed, failed, or cancelled downloads
  - History persists across app restarts
  - Clear all history or delete individual items
- **Download Controls**: 
  - Pause, resume, or cancel active downloads
  - View detailed progress in download dialog
  - Minimize download dialog to background
  - Remove completed downloads from history

### Theme Switching

- Click the theme toggle button in the title bar (sun/moon icon)
- Switch between dark and light modes instantly
- Theme preference is saved and persists across app restarts

### File Operations

- **Download**: Click the download icon on any file
- **Preview**: Double-click text or image files to preview
- **Properties**: Click the info icon to view file details and modify permissions
- **Upload**: Drag and drop files from your computer into the file list area (coming soon)

## Project Structure

```
macftp/
├── src/
│   ├── main/                          # Electron main process (Node.js)
│   │   ├── main.ts                    # Main entry point, window management
│   │   ├── preload.ts                 # IPC bridge between main and renderer
│   │   └── services/
│   │       ├── database.ts            # Encrypted data storage (electron-store)
│   │       └── ftpHandlers.ts         # FTP/SFTP connection and file operations
│   └── renderer/                      # React frontend
│       ├── App.tsx                    # Main application component
│       ├── store.ts                   # Zustand state management
│       ├── utils.ts                   # Utility functions (formatting, etc.)
│       ├── index.css                  # Global styles and theme variables
│       └── components/
│           ├── TitleBar.tsx           # Custom title bar with controls
│           ├── Sidebar.tsx            # Site manager sidebar
│           ├── FileExplorer.tsx       # Main file browser
│           ├── DownloadManager.tsx    # Download queue and history
│           ├── DownloadProgressDialog.tsx  # Individual download progress
│           ├── ConnectionProgressDialog.tsx  # Connection status dialog
│           ├── ResizablePanel.tsx     # Resizable panel component
│           ├── Toast.tsx              # Toast notification component
│           └── ConfirmDialog.tsx      # Confirmation dialog component
├── assets/
│   └── icons/                         # Application icons
├── dist/                              # Vite build output (renderer)
├── dist-electron/                     # TypeScript build output (main process)
└── package.json                       # Project configuration
```

### Key Components

- **Main Process** (`src/main/`): Handles window creation, IPC communication, FTP/SFTP connections, file operations, and database storage.
- **Renderer Process** (`src/renderer/`): React UI components, state management, and user interactions.
- **Database** (`src/main/services/database.ts`): Encrypted storage for sites (host, username, password, SSH keys) and download history using `electron-store` (JSON-based) with AES-256-CBC encryption. Site names are stored in plain text as they are identifiers only.
- **FTP Handlers** (`src/main/services/ftpHandlers.ts`): All FTP/SFTP operations including connection, file listing, download, upload, and preview.

## Data Storage

All application data is stored locally using `electron-store` (JSON-based storage, not SQLite):

- **Location**: 
  - macOS: `~/Library/Application Support/MacFTP/macftp-data.json`
  - Windows: `%APPDATA%\MacFTP\macftp-data.json`
  - Linux: `~/.config/MacFTP/macftp-data.json`
- **Storage Format**: JSON file (not SQLite database)
- **Encryption**: Sensitive fields are encrypted using AES-256-CBC with PBKDF2 key derivation
- **Stored Data**:
  - Site configurations (encrypted host, username, password, SSH private keys; plain text site name, port, protocol, etc.)
  - Download history (persists across app restarts)

### Data Security

**Encrypted Fields** (stored with AES-256-CBC encryption):
- **Host** - FTP/SFTP server address
- **User** - Username/account name
- **Password** - Login password
- **Private Key Content** - SSH private key content (if using key-based authentication)

**Unencrypted Fields** (stored in plain text):
- **Site Name** - Display name for the site (identifier only, not sensitive)
- **Port** - Connection port number
- **Protocol** - FTP or SFTP
- **Group** - Site grouping/category
- **Initial Path** - Default directory path
- **Private Key Path** - File path to SSH key (if using file-based authentication)

**Security Features**:
- Encryption key is derived using PBKDF2 with 100,000 iterations from app-specific and machine-specific data
- Random 256-bit salt is stored securely in macOS Keychain (or fallback to encrypted storage)
- Site names are not encrypted as they are just identifiers for display purposes
- Data corruption is automatically handled with cleanup mechanisms

## Known Limitations

- File upload via drag & drop is planned but not yet implemented
- Download history is limited to the last 1000 items
- Image preview supports common formats (PNG, JPEG, GIF, WebP, etc.)
- Text preview supports UTF-8 encoded files

## Troubleshooting

### Connection Issues
- Verify host, port, and credentials are correct
- For SFTP, ensure the SSH key format is correct (OpenSSH format)
- Check if the server requires specific connection settings

### Preview Not Working
- Ensure file is a supported text or image format
- Check file size (very large files may take time to download)
- Verify you have read permissions for the file

### Download History Missing
- History is saved automatically after each download completes
- History persists in the encrypted database
- If history disappears, check console logs for database errors

## Contributing

This is a personal project, but suggestions and bug reports are welcome!

## License

MIT License

Copyright (c) 2025 Tony Xu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Author

**Tony Xu**

- Email: fihtony@gmail.com
- GitHub: [@fihtony](https://github.com/fihtony)
- Repository: [https://github.com/fihtony/macFTP](https://github.com/fihtony/macFTP)

## Security Notes

⚠️ **Important**: 
- When using public test servers, avoid uploading sensitive or confidential data. Test servers may log activity and files may be publicly accessible.
- All stored credentials are encrypted, but keep your local machine secure.
- SSH private keys are stored encrypted, but handle them with care.

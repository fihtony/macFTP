// Script to generate application icon
// This creates a simple icon using SVG and converts it to PNG/ICNS

const fs = require('fs');
const path = require('path');

// Create icons directory
const iconsDir = path.join(__dirname, 'assets', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate SVG icon (FTP/Server icon design)
const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4F46E5;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#7C3AED;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background circle -->
  <circle cx="256" cy="256" r="240" fill="url(#grad1)"/>
  
  <!-- Server/Network icon -->
  <rect x="160" y="140" width="192" height="120" rx="8" fill="white" opacity="0.95"/>
  <rect x="160" y="260" width="192" height="120" rx="8" fill="white" opacity="0.85"/>
  
  <!-- Server indicator lights -->
  <circle cx="190" cy="180" r="6" fill="#10B981"/>
  <circle cx="190" cy="300" r="6" fill="#10B981"/>
  
  <!-- Connection lines -->
  <line x1="256" y1="120" x2="256" y2="140" stroke="white" stroke-width="8" stroke-linecap="round"/>
  <line x1="140" y1="200" x2="160" y2="200" stroke="white" stroke-width="6" stroke-linecap="round"/>
  <line x1="140" y1="320" x2="160" y2="320" stroke="white" stroke-width="6" stroke-linecap="round"/>
  <line x1="352" y1="200" x2="372" y2="200" stroke="white" stroke-width="6" stroke-linecap="round"/>
  <line x1="352" y1="320" x2="372" y2="320" stroke="white" stroke-width="6" stroke-linecap="round"/>
  
  <!-- Arrow indicators -->
  <path d="M 372 190 L 390 200 L 372 210 Z" fill="white"/>
  <path d="M 372 310 L 390 320 L 372 330 Z" fill="white"/>
  
  <!-- Text "FTP" -->
  <text x="256" y="460" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">MacFTP</text>
</svg>`;

// Save SVG
const svgPath = path.join(iconsDir, 'icon.svg');
fs.writeFileSync(svgPath, svgIcon);

console.log('✅ SVG icon created at:', svgPath);
console.log('');
console.log('Note: To create PNG/ICNS icons, you can:');
console.log('1. Use online tools like: https://cloudconvert.com/svg-to-icns');
console.log('2. Use ImageMagick: convert icon.svg -resize 512x512 icon.png');
console.log('3. Use iconutil on macOS for .icns files');
console.log('');
console.log('For development, Electron will use the SVG or you can create a simple PNG.');


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
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="solidBG" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2B66F0"/>
      <stop offset="100%" stop-color="#2B66F0"/>
    </linearGradient>
    <clipPath id="squircleClip">
      <rect x="120" y="120" width="784" height="784" rx="170" />
    </clipPath>
  </defs>

  <!-- Transparent canvas -->
  <rect width="1024" height="1024" fill="none"/>

  <!-- Clipped background -->
  <g clip-path="url(#squircleClip)">
    <rect x="120" y="120" width="784" height="784" rx="170" fill="url(#solidBG)"/>
  </g>

  <!-- Bold transfer motif (large, no rings) -->
  <g transform="translate(512 512) scale(1.05) translate(-512 -512)">
    <!-- Up arrow (upload) -->
    <g transform="translate(360 512)">
      <line x1="0" y1="170" x2="0" y2="-170" stroke="#FFFFFF" stroke-width="78" stroke-linecap="round"/>
      <path d="M -100 -70 L 0 -170 L 100 -70" fill="none" stroke="#FFFFFF" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    
    <!-- Down arrow (download) -->
    <g transform="translate(664 512)">
      <line x1="0" y1="-170" x2="0" y2="170" stroke="#FFFFFF" stroke-width="78" stroke-linecap="round"/>
      <path d="M -100 70 L 0 170 L 100 70" fill="none" stroke="#FFFFFF" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    
    <!-- Small hub dot -->
    <circle cx="512" cy="512" r="32" fill="#FFFFFF" opacity="0.98"/>
  </g>
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

# Icon Files

## Current Status
- icon.svg - SVG icon created

## To Create PNG Icons:

### Option 1: Using macOS sips (if SVG conversion works)
```bash
sips -s format png icon.svg --out icon.png
sips -Z 512 icon.png --out icon-512.png
sips -Z 256 icon.png --out icon-256.png
sips -Z 128 icon.png --out icon-128.png
sips -Z 64 icon.png --out icon-64.png
sips -Z 32 icon.png --out icon-32.png
sips -Z 16 icon.png --out icon-16.png
```

### Option 2: Using online converter
1. Go to https://cloudconvert.com/svg-to-png
2. Upload icon.svg
3. Download and rename to icon.png

### Option 3: Using ImageMagick
```bash
convert -background none -density 300 icon.svg -resize 512x512 icon-512.png
convert -background none -density 300 icon.svg -resize 256x256 icon-256.png
convert -background none -density 300 icon.svg -resize 128x128 icon-128.png
```

## For macOS .icns file:
```bash
# Create iconset directory
mkdir icon.iconset

# Generate different sizes
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png

# Convert to .icns
iconutil -c icns icon.iconset -o icon.icns
```

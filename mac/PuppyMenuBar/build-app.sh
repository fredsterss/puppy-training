#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:a:h}
APP_NAME="Daphne Menu Bar.app"
APP_PATH="$SCRIPT_DIR/dist/$APP_NAME"
ICON_SOURCE="$SCRIPT_DIR/../../app/public/daphne-icon-512.png"
ICONSET="$SCRIPT_DIR/.build/AppIcon.iconset"

cd "$SCRIPT_DIR"
swift build -c release
BIN_PATH=$(swift build -c release --show-bin-path)

rm -rf "$APP_PATH" "$ICONSET"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources" "$ICONSET"
cp "$BIN_PATH/PuppyMenuBar" "$APP_PATH/Contents/MacOS/PuppyMenuBar"
cp Info.plist "$APP_PATH/Contents/Info.plist"

for size in 16 32 64 128 256 512 1024; do
    sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon-$size.png" >/dev/null
done
cp "$ICONSET/icon-16.png" "$ICONSET/icon_16x16.png"
cp "$ICONSET/icon-32.png" "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon-32.png" "$ICONSET/icon_32x32.png"
cp "$ICONSET/icon-64.png" "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/icon-128.png" "$ICONSET/icon_128x128.png"
cp "$ICONSET/icon-256.png" "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon-256.png" "$ICONSET/icon_256x256.png"
cp "$ICONSET/icon-512.png" "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon-512.png" "$ICONSET/icon_512x512.png"
cp "$ICONSET/icon-1024.png" "$ICONSET/icon_512x512@2x.png"
rm "$ICONSET"/icon-[0-9]*.png
iconutil -c icns "$ICONSET" -o "$APP_PATH/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$APP_PATH"
echo "$APP_PATH"

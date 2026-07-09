#!/bin/bash
set -e
cd "$(dirname "$0")"

APP_NAME="세션매니저"
OUT="release/mac-manual"
APP="$OUT/$APP_NAME.app"
RES="$APP/Contents/Resources"

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R node_modules/electron/dist/Electron.app "$APP"

mkdir -p "$RES/app"
cp main.js preload.js package.json "$RES/app/"
cp -R lib renderer "$RES/app/"

ICONSET="$OUT/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) build/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/electron.icns"
rm -rf "$ICONSET"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "kr.cnsa.sessionManager" "$PLIST"

codesign --force --deep --sign - "$APP"

echo "built: $APP"

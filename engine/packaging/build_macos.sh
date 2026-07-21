#!/bin/bash
# Build the macOS .app + .dmg for Drug Design Studio.
# Run from the engine/ directory with the venv active (or it will activate it).
set -e
cd "$(dirname "$0")/.."          # -> engine/
ROOT="$(cd .. && pwd)"           # -> project root

echo "==> building frontend"
( cd "$ROOT" && npx vite build )
rm -rf webdist && cp -R "$ROOT/dist" webdist

echo "==> activating venv"
source .venv/bin/activate

echo "==> PyInstaller"
rm -rf build dist_pkg
pyinstaller --clean --noconfirm --distpath dist_pkg dds.spec

echo "==> fixing OpenBabel bundle paths"
python packaging/fix_bundle.py "dist_pkg/Drug Design Studio.app"

echo "==> creating .dmg"
rm -rf dist_dmg "Drug Design Studio.dmg"
mkdir -p dist_dmg
cp -R "dist_pkg/Drug Design Studio.app" dist_dmg/
ln -s /Applications dist_dmg/Applications
hdiutil create -volname "Drug Design Studio" -srcfolder dist_dmg \
  -ov -format UDZO "Drug Design Studio.dmg"
rm -rf dist_dmg

echo "==> done: $(pwd)/Drug Design Studio.dmg"

#!/bin/sh
# Build an ad-hoc-signed disk image of the BoomBigNose window.
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose-desktop.
# codesign --sign - is not a paid Developer ID signature. Opening can require Open Anyway.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/boombignose-desktop
test -s "$bin"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$bin" "$stage/BoomBigNose"
chmod 755 "$stage/BoomBigNose"
codesign --force --sign - "$stage/BoomBigNose"
hdiutil create \
  -volname "BoomBigNose" \
  -srcfolder "$stage" \
  -ov \
  -format UDZO \
  "$root/dist/BoomBigNose-macos-arm64.dmg"
echo "wrote $root/dist/BoomBigNose-macos-arm64.dmg"

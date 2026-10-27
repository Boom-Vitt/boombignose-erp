#!/bin/sh
# Build an unsigned, ad-hoc-signed disk image of the BoomBigNose harness command.
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/boombignose
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$bin" "$stage/boombignose"
chmod 755 "$stage/boombignose"
codesign --force --sign - "$stage/boombignose"
hdiutil create \
  -volname "BoomBigNose" \
  -srcfolder "$stage" \
  -ov \
  -format UDZO \
  "$root/dist/BoomBigNose-macos-arm64.dmg"
echo "wrote $root/dist/BoomBigNose-macos-arm64.dmg"

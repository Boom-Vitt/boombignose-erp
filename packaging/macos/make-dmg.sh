#!/bin/sh
# Build an ad-hoc-signed disk image of the BoomBigNose window and dist/bundle.
# Run on a macOS arm64 runner after `go build` produces ./dist/boombignose-desktop.
# codesign --sign - is not a paid Developer ID signature. Opening can require Open Anyway.
# The mounted check looks for the files. It does not boot the server from the read-only image.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/boombignose-desktop
bundle=$root/dist/bundle
test -s "$bin"
test -s "$bundle/node"
test -s "$bundle/erp/server.js"
test -s "$bundle/postgres/bin/postgres"
test -d "$bundle/erp/.next/static"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$bin" "$stage/BoomBigNose"
chmod 755 "$stage/BoomBigNose"
codesign --force --sign - "$stage/BoomBigNose"
cp -a "$bundle" "$stage/bundle"
dmg=$root/dist/BoomBigNose-macos-arm64.dmg
hdiutil create \
  -volname "BoomBigNose" \
  -srcfolder "$stage" \
  -ov \
  -format UDZO \
  "$dmg"
mount=$(hdiutil attach -nobrowse -readonly "$dmg" | sed -n 's/.*\(\/Volumes\/[^ ]*\).*/\1/p' | head -1)
if [ -z "$mount" ]; then
  echo "dmg did not mount" >&2
  exit 1
fi
cleanup_mount() {
  hdiutil detach "$mount" >/dev/null 2>&1 || hdiutil detach -force "$mount" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup_mount EXIT
test -s "$mount/BoomBigNose"
test -s "$mount/bundle/node"
test -s "$mount/bundle/erp/server.js"
test -s "$mount/bundle/postgres/bin/postgres"
test -d "$mount/bundle/erp/.next/static"
echo "wrote $dmg"

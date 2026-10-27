#!/bin/sh
# Build an unsigned, ad-hoc-signed disk image of the Bumik harness command.
# Run on a macOS arm64 runner after `go build` produces ./bumik.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bin=$root/dist/bumik
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$bin" "$stage/bumik"
chmod 755 "$stage/bumik"
codesign --force --sign - "$stage/bumik"
hdiutil create \
  -volname "Bumik Node ERP harness AI" \
  -srcfolder "$stage" \
  -ov \
  -format UDZO \
  "$root/dist/BumikNodeERP-macos-arm64.dmg"
echo "wrote $root/dist/BumikNodeERP-macos-arm64.dmg"

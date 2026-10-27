#!/bin/sh
# Upstream Auth v2.197.0 publishes Linux and macOS archives and does not
# publish a Windows archive. Build the pinned commit for windows/amd64.
# The harness module stays on its own Go version; this step uses Go 1.27.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
expected=4eee58f296d9698a1c2c0ae14d7a0b379c7622d3
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 --branch v2.197.0 https://github.com/supabase/auth.git "$tmp/auth"
got=$(git -C "$tmp/auth" rev-parse HEAD)
if [ "$got" != "$expected" ]; then
  echo "auth commit is $got, expected $expected" >&2
  exit 1
fi
out=$root/dist/auth-windows
rm -rf "$out"
mkdir -p "$out"
(
  cd "$tmp/auth"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o "$out/auth.exe" .
  cp -a migrations "$out/migrations"
)
test -s "$out/auth.exe"
test -s "$out/migrations/00_init_auth_schema.up.sql"
echo "built $out/auth.exe from $expected"

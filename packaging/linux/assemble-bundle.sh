#!/bin/sh
# Build dist/bundle for Linux amd64: pinned Node, standalone Next server,
# and portable Postgres 16.10. Checksums are verified before anything is packed.
# The Node process is not given the Postgres OpenSSL 1.1 library path.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

NODE_VERSION=22.21.1
NODE_SHA=680d3f30b24a7ff24b98db5e96f294c0070f8f9078df658da1bce1b9c9873c88
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
PG_SHA=17a8ded28bde97fe66247387806af30ee26190fc96503c47c3eaa4fcbdcff8b6
PG_URL="https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/16.10.0/embedded-postgres-binaries-linux-amd64-16.10.0.jar"

dist=$root/dist/bundle
rm -rf "$dist"
mkdir -p "$dist"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/node.tar.xz" "$NODE_URL"
echo "$NODE_SHA  $tmp/node.tar.xz" | sha256sum -c -
tar -xJf "$tmp/node.tar.xz" -C "$tmp"
node_dir=$tmp/node-v${NODE_VERSION}-linux-x64
cp "$node_dir/bin/node" "$dist/node"
chmod 755 "$dist/node"
cp "$node_dir/LICENSE" "$dist/NODE_LICENSE"

curl -fsSL -o "$tmp/pg.jar" "$PG_URL"
echo "$PG_SHA  $tmp/pg.jar" | sha256sum -c -
python3 - "$tmp/pg.jar" "$tmp/postgres.txz" << 'PY'
import sys, zipfile
jar, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(jar) as zf:
    name = "postgres-linux-x86_64.txz"
    if name not in zf.namelist():
        raise SystemExit("postgres archive missing from jar: " + ",".join(zf.namelist()))
    with zf.open(name) as src, open(dest, "wb") as out:
        out.write(src.read())
PY
mkdir -p "$dist/postgres"
tar -xJf "$tmp/postgres.txz" -C "$dist/postgres"
chmod 755 "$dist/postgres/bin/initdb" "$dist/postgres/bin/pg_ctl" "$dist/postgres/bin/postgres"
cp packaging/postgres/prelude.sql "$dist/postgres/prelude.sql"
cp packaging/postgres/POSTGRESQL_LICENSE.txt "$dist/postgres/POSTGRESQL_LICENSE.txt"
mkdir -p "$dist/postgres/migrations"
cp supabase/migrations/*.sql "$dist/postgres/migrations/"

cat > "$dist/PROVENANCE" << EOF
platform=linux-amd64
node=v${NODE_VERSION}
node_url=${NODE_URL}
node_sha256=${NODE_SHA}
node_license=MIT (NODE_LICENSE)
postgres=16.10.0
postgres_url=${PG_URL}
postgres_sha256=${PG_SHA}
postgres_license=PostgreSQL License (postgres/POSTGRESQL_LICENSE.txt)
EOF

export PATH="$node_dir/bin:$PATH"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-local-anon-not-a-secret}"
export BBN_EDITION="${BBN_EDITION:-community}"
unset LD_LIBRARY_PATH
hash -r
node -v
npm install
npx next build
rm -rf "$dist/erp"
mkdir -p "$dist/erp"
cp -a .next/standalone/. "$dist/erp/"
mkdir -p "$dist/erp/.next"
if [ ! -d .next/static ]; then
  echo "next build did not produce .next/static" >&2
  exit 1
fi
cp -a .next/static "$dist/erp/.next/static"
if [ -d public ]; then
  cp -a public "$dist/erp/public"
fi
if [ ! -s "$dist/erp/server.js" ]; then
  find "$dist/erp" -name server.js -print >&2
  echo "standalone server.js was not at the bundle root" >&2
  exit 1
fi
test -x "$dist/node"
test -x "$dist/postgres/bin/postgres"
test -s "$dist/postgres/prelude.sql"
echo "wrote $dist"

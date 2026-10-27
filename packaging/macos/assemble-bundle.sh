#!/bin/sh
# Add pinned Node and portable Postgres to an existing standalone server.
# The Next.js server is built once on Linux (no native runtime addons) and
# downloaded into dist/bundle/erp before this script runs. This script does
# not run npm or next build, and it does not delete that server.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

NODE_VERSION=22.21.1
NODE_SHA=c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
PG_SHA=8b1933ae6912399902ac901f2633f22c5e92ca81585297ba0e2b835e25208459
PG_URL="https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/16.10.0/embedded-postgres-binaries-darwin-arm64v8-16.10.0.jar"
PG_INNER=postgres-darwin-arm_64.txz

dist=$root/dist/bundle
test -s "$dist/erp/server.js"
rm -f "$dist/node"
rm -rf "$dist/postgres"
mkdir -p "$dist"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/node.tar.gz" "$NODE_URL"
echo "$NODE_SHA  $tmp/node.tar.gz" | shasum -a 256 -c -
tar -xzf "$tmp/node.tar.gz" -C "$tmp"
node_dir=$tmp/node-v${NODE_VERSION}-darwin-arm64
cp "$node_dir/bin/node" "$dist/node"
chmod 755 "$dist/node"
cp "$node_dir/LICENSE" "$dist/NODE_LICENSE"

curl -fsSL -o "$tmp/pg.jar" "$PG_URL"
echo "$PG_SHA  $tmp/pg.jar" | shasum -a 256 -c -
python3 - "$tmp/pg.jar" "$tmp/postgres.txz" "$PG_INNER" << 'PY'
import sys, zipfile
jar, dest, inner = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(jar) as zf:
    if inner not in zf.namelist():
        raise SystemExit("postgres archive missing from jar: " + ",".join(zf.namelist()))
    with zf.open(inner) as src, open(dest, "wb") as out:
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
platform=darwin-arm64
node=v${NODE_VERSION}
node_url=${NODE_URL}
node_sha256=${NODE_SHA}
node_license=MIT (NODE_LICENSE)
postgres=16.10.0
postgres_url=${PG_URL}
postgres_sha256=${PG_SHA}
postgres_archive=${PG_INNER}
postgres_license=PostgreSQL License (postgres/POSTGRESQL_LICENSE.txt)
erp=linux-built Next.js standalone server.js
EOF

# curl marks the download with quarantine. Clear it and ad-hoc sign the
# binaries the smoke executes. This is not a Developer ID signature.
xattr -cr "$dist" || true
codesign --force --sign - \
  "$dist/node" \
  "$dist/postgres/bin/initdb" \
  "$dist/postgres/bin/pg_ctl" \
  "$dist/postgres/bin/postgres"
test -x "$dist/node"
test -x "$dist/postgres/bin/postgres"
test -s "$dist/postgres/prelude.sql"
test -d "$dist/postgres/share/postgresql"
echo "wrote $dist"

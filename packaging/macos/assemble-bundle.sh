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
cp packaging/postgres/prelude-after-auth.sql "$dist/postgres/prelude-after-auth.sql"
cp packaging/postgres/POSTGRESQL_LICENSE.txt "$dist/postgres/POSTGRESQL_LICENSE.txt"
mkdir -p "$dist/postgres/migrations"
cp supabase/migrations/*.sql "$dist/postgres/migrations/"

AUTH_SHA=3fb7998e7061e2c14f3f9555b1d94d447358c965395728e0d81eac82e0e5868b
AUTH_URL="https://github.com/supabase/auth/releases/download/v2.197.0/auth-v2.197.0-darwin-arm64.tar.gz"
PGRST_SHA=d8095cb439de0a3151036df542139e7afca5cebb109ce7f1bae52b3a97e9846a
PGRST_URL="https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-macos-aarch64.tar.xz"

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
auth=v2.197.0
auth_url=${AUTH_URL}
auth_sha256=${AUTH_SHA}
auth_license=MIT (auth/AUTH_LICENSE.txt)
postgrest=v16.5
postgrest_url=${PGRST_URL}
postgrest_sha256=${PGRST_SHA}
postgrest_license=MIT (postgrest/POSTGREST_LICENSE.txt)
ollama=v0.40.11
ollama_url=https://github.com/ollama/ollama/releases/download/v0.40.11/ollama-darwin.tgz
ollama_sha256=aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291
ollama_license=MIT (ollama/OLLAMA_LICENSE.txt)
ollama_omitted=none
ollama_note=The universal darwin archive is packed in full, including Metal runners. The model is not packed.
EOF

curl -fsSL -o "$tmp/auth.tgz" "$AUTH_URL"
echo "$AUTH_SHA  $tmp/auth.tgz" | shasum -a 256 -c -
mkdir -p "$dist/auth"
tar -xzf "$tmp/auth.tgz" -C "$dist/auth"
chmod 755 "$dist/auth/auth"
cp packaging/auth/AUTH_LICENSE.txt "$dist/auth/AUTH_LICENSE.txt"
test -d "$dist/auth/migrations"
curl -fsSL -o "$tmp/postgrest.txz" "$PGRST_URL"
echo "$PGRST_SHA  $tmp/postgrest.txz" | shasum -a 256 -c -
mkdir -p "$dist/postgrest"
tar -xJf "$tmp/postgrest.txz" -C "$dist/postgrest"
chmod 755 "$dist/postgrest/postgrest"
cp packaging/postgrest/POSTGREST_LICENSE.txt "$dist/postgrest/POSTGREST_LICENSE.txt"

OLLAMA_VERSION=0.40.11
OLLAMA_SHA=aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291
OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin.tgz"
OLLAMA_LICENSE_SHA=5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226
echo "$OLLAMA_LICENSE_SHA  packaging/ollama/OLLAMA_LICENSE.txt" | shasum -a 256 -c -
curl -fsSL -o "$tmp/ollama.tgz" "$OLLAMA_URL"
echo "$OLLAMA_SHA  $tmp/ollama.tgz" | shasum -a 256 -c -
mkdir -p "$tmp/ollama-src"
tar -xzf "$tmp/ollama.tgz" -C "$tmp/ollama-src"
rm -rf "$dist/ollama"
stage_out=$(python3 packaging/ollama/stage.py "$tmp/ollama-src" "$dist/ollama")
printf '%s\n' "$stage_out"
printf '%s\n' "$stage_out" | grep -Fx 'omitted=none'
cp packaging/ollama/OLLAMA_LICENSE.txt "$dist/ollama/OLLAMA_LICENSE.txt"
test -s "$dist/ollama/ollama"

# curl marks the download with quarantine. Clear it and ad-hoc sign the
# binaries the smoke executes. This is not a Developer ID signature.
xattr -cr "$dist" || true
codesign --force --sign - \
  "$dist/node" \
  "$dist/postgres/bin/initdb" \
  "$dist/postgres/bin/pg_ctl" \
  "$dist/postgres/bin/postgres" \
  "$dist/auth/auth" \
  "$dist/postgrest/postgrest" \
  "$dist/ollama/ollama"
find "$dist/ollama" -type f \( -name '*.dylib' -o -name '*.so' \) -print | while IFS= read -r lib; do
  if file "$lib" | grep -q 'Mach-O'; then
    codesign --force --sign - "$lib"
  fi
done
# --version may warn that no daemon is listening. It must not pull a model.
"$dist/ollama/ollama" --version | grep -F "0.40.11"
test -x "$dist/node"
test -x "$dist/postgres/bin/postgres"
test -s "$dist/postgres/prelude.sql"
test -d "$dist/postgres/share/postgresql"
echo "wrote $dist"

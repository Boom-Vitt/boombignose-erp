#!/bin/sh
# Boot the Linux or macOS bundle and require GET http://127.0.0.1:3100/api/health.
# This uses the harness serve command, not a click of the AppImage or DMG.
# Windows uses packaging/windows/smoke-bundle.ps1 (node.exe / postgres.exe).
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
test -x dist/bundle/node
test -s dist/bundle/erp/server.js
test -x dist/bundle/postgres/bin/postgres
test -s dist/bundle/postgres/prelude.sql

python3 - << 'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.3)
try:
    s.connect(("127.0.0.1", 3100))
except OSError:
    sys.exit(0)
sys.stderr.write("127.0.0.1:3100 is already in use\n")
sys.exit(1)
PY

pg_port=54329
python3 - "$pg_port" << 'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.stderr.write("127.0.0.1:%s is already in use\n" % port)
    sys.exit(1)
finally:
    s.close()
PY

data=$(mktemp -d)
pgdata=$data/pg
mkdir -p "$pgdata"
trap 'rm -rf "$data"' EXIT
unset OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY RESEND_API_KEY OPENROUTER_MODEL || true
export BOOMBIGNOSE_BUNDLE="$root/dist/bundle"
export BOOMBIGNOSE_DATA="$pgdata"
export BOOMBIGNOSE_PG_PORT="$pg_port"
export BOOMBIGNOSE_ERP_URL="http://127.0.0.1:3100"
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-local-anon-not-a-secret}"
unset LD_LIBRARY_PATH || true

( cd "$root/boombignose" && go build -o "$data/boombignose" ./cmd/boombignose )
pid=""
cleanup() {
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
trap 'cleanup; rm -rf "$data"' EXIT
"$data/boombignose" serve > "$data/serve.log" 2>&1 &
pid=$!

ok=0
i=0
while [ "$i" -lt 150 ]; do
  i=$((i + 1))
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "serve exited before the health check" >&2
    cat "$data/serve.log" >&2 || true
    exit 1
  fi
  if body=$(curl -fsS --max-time 2 http://127.0.0.1:3100/api/health 2>/dev/null); then
    case "$body" in
      *'"ok":true'*) ok=1; break ;;
    esac
  fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "health check failed" >&2
  cat "$data/serve.log" >&2 || true
  exit 1
fi
test -s "$pgdata/PG_VERSION"
echo "health ok"
kill -TERM "$pid"
wait "$pid" || true
pid=""

closed=0
i=0
while [ "$i" -lt 30 ]; do
  i=$((i + 1))
  if python3 - "$pg_port" << 'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(0)
sys.exit(1)
PY
  then
    closed=1
    break
  fi
  sleep 1
done
if [ "$closed" != 1 ]; then
  echo "postgres stayed up on 127.0.0.1:$pg_port" >&2
  cat "$data/serve.log" >&2 || true
  exit 1
fi
echo "postgres stopped"

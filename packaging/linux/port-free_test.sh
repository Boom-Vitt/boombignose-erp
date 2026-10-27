#!/bin/sh
# The probe must see a live listener and a closed port. It does not boot Postgres.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
# shellcheck disable=SC1091
. "$root/packaging/linux/port-free.sh"

port=$(python3 - << 'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)

if ! port_bindable "$port"; then
  echo "expected a free port" >&2
  exit 1
fi

python3 - "$port" << 'PY' &
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", int(sys.argv[1])))
s.listen(1)
time.sleep(30)
PY
listener=$!
sleep 0.3
if port_bindable "$port"; then
  echo "expected the listener to hold the port" >&2
  kill "$listener" 2>/dev/null || true
  wait "$listener" 2>/dev/null || true
  exit 1
fi
kill "$listener" 2>/dev/null || true
wait "$listener" 2>/dev/null || true

i=0
while [ "$i" -lt 20 ]; do
  i=$((i + 1))
  if port_bindable "$port"; then
    if ! wait_ports_free "$port"; then
      echo "wait_ports_free failed on a free port" >&2
      exit 1
    fi
    echo "port-free ok"
    exit 0
  fi
  sleep 0.2
done
echo "port stayed busy after the listener exited" >&2
exit 1

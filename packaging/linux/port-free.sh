# Wait until loopback ports can be bound.
# A connect() check misses TIME_WAIT. PostgREST then dies with
# "Address in use" when the Linux job smokes the tarball and the AppImage
# on the same runner. Bind without SO_REUSEADDR, which is the check that
# matches that failure.

port_bindable() {
  python3 - "$1" << 'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
}

wait_ports_free() {
  held=""
  i=0
  while [ "$i" -lt 90 ]; do
    i=$((i + 1))
    held=""
    for port in "$@"; do
      if ! port_bindable "$port"; then
        held="$held $port"
      fi
    done
    if [ -z "$held" ]; then
      return 0
    fi
    sleep 1
  done
  echo "ports still busy:$held" >&2
  return 1
}

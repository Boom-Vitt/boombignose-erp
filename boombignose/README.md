# BoomBigNose

Local gate for the desktop shell. It does not open a window and it does not make network calls.

```sh
cd boombignose
go test ./...
go run ./cmd/boombignose check
go run ./cmd/boombignose cutover
```

`check` exits 0 when cloud credentials are unset and service URLs are empty or on loopback. `cutover` prints the switch plan and does not touch a database.

Milestone 1 loads `http://127.0.0.1:3100` in a Wails webview after `check` passes. Milestone 2 bundles the local stack. See `docs/boombignose/ARCHITECTURE_LOCAL.md`.

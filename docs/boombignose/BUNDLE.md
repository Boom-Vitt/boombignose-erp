# Portable bundle

Checked 2026-10-27. Linux, Windows, and macOS CI pack this shape and smoke-test `/api/health`. Release workflow run [40526064339](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40526064339) printed `health ok` and `postgres stopped` on all three. The published v0.2.0 installers do not contain the tree.

## What the window does

`boombignose/internal/bundle` looks at `BOOMBIGNOSE_BUNDLE`, or at `bundle/` next to the desktop executable. Inside an AppImage that directory is `usr/bin/bundle`, beside the mounted binary.

Required files:

- `bundle/node` (`bundle/node.exe` on Windows)
- `bundle/erp/server.js`

When both exist and `127.0.0.1:3100` is closed, the window runs that Node binary with `server.js`. It does not look up `node` on `PATH` and it does not call Docker. The child environment sets `HOST` and `HOSTNAME` to `127.0.0.1` and `PORT` to the ERP port. It keeps `PATH`, `HOME`, `TMPDIR`, `LANG`, a loopback Supabase URL when the parent already has one, a loopback `OLLAMA_HOST`, and `OLLAMA_MODEL`. `LOCAL_TOTP_ENROLL` is copied only when the value is exactly `1`. `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `RESEND_API_KEY` are not passed to the ERP process. A hosted Supabase URL or a remote Ollama host is refused and the error does not include the value. The Node process does not receive the Postgres `LD_LIBRARY_PATH` (that tree ships OpenSSL 1.1).

When those two files are absent, the window keeps the checkout path: `node scripts/local/stack.mjs serve --port 3100`.

`boombignose serve` starts the same stack and prints `ready` only after the ERP port accepts TCP. `boombignose stop`, and the window shutdown, stop the recorded Node pid and run `pg_ctl -m fast stop`.

## Postgres, not SQLite

The ERP's finance and stock rules are Postgres functions, and row access is RLS. A SQLite file cannot run them.

Linux CI downloads one pinned archive and checks it before packing:

- Node v22.21.1 linux-x64, SHA-256 `680d3f30b24a7ff24b98db5e96f294c0070f8f9078df658da1bce1b9c9873c88`, MIT license copied to `bundle/NODE_LICENSE`
- Zonky `embedded-postgres-binaries-linux-amd64` 16.10.0, jar SHA-256 `17a8ded28bde97fe66247387806af30ee26190fc96503c47c3eaa4fcbdcff8b6`, PostgreSQL License in `bundle/postgres/POSTGRESQL_LICENSE.txt`

The packed binaries are `bundle/postgres/bin/initdb`, `pg_ctl`, and `postgres`, plus `lib/` and `share/`. `prelude.sql` creates a local `auth` schema, `auth.uid()`, `auth.role()`, the roles `anon`, `authenticated`, and `service_role`, a `schema_migrations` table, and a small `storage` stub so the attachment migration can record a bucket. That prelude is not the Supabase auth server and it does not issue sessions.

Windows CI uses Node v22.21.1 win-x64, SHA-256 `3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf`, and Zonky `embedded-postgres-binaries-windows-amd64` 16.10.0, jar SHA-256 `8fbb986005ed7cfe486d6626a7859235a9713fadd164aff0b0a37ce1b65857d4`, inner archive `postgres-windows-x86_64.txz`. That archive lays out `bin/`, `lib/`, and `share/` (not `share/postgresql`). `initdb` on Windows uses `--no-locale`. The server options omit `unix_socket_directories`. The launcher does not set `LD_LIBRARY_PATH` or `DYLD_LIBRARY_PATH` for that process.

macOS arm64 CI uses Node v22.21.1 darwin-arm64, SHA-256 `c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af`, and Zonky `embedded-postgres-binaries-darwin-arm64v8` 16.10.0, jar SHA-256 `8b1933ae6912399902ac901f2633f22c5e92ca81585297ba0e2b835e25208459`, inner archive `postgres-darwin-arm_64.txz`. The artifact name is `darwin-arm64v8`. `darwin-arm64` is not published. The layout is `bin/`, `lib/`, and `share/postgresql`. The launcher sets `DYLD_LIBRARY_PATH` to `lib/` for the Postgres binaries only. The assemble script clears the quarantine attribute and ad-hoc signs `node`, `initdb`, `pg_ctl`, and `postgres`. That signature is not a Developer ID.

The Next.js standalone server is built once, on Linux, and reused. `package.json` has no native runtime addon. Each platform still downloads its own Node and Postgres and checks the checksum before packing.

On first launch the data directory is `BOOMBIGNOSE_DATA` or `~/.local/share/boombignose/pg` (not inside the AppImage or DMG mount). A path containing a space is refused. `initdb` creates superuser `boombignose` with trust authentication. Unix `initdb` uses `--locale=C`. The launcher then creates database `boombignose`. The server listens on `127.0.0.1` port `54329` (`BOOMBIGNOSE_PG_PORT` overrides it). Each migration in `bundle/postgres/migrations` is applied once, in order, through one simple-query message, then recorded in `public.schema_migrations`. Startup fails if `public.organizations` is missing. A later launch skips files that are already recorded. A run on this machine against the pinned Postgres 16.10 binaries recorded every file in `supabase/migrations`. The cluster was stopped afterward.

`GET /api/health` returns `{"ok":true}` without a database and without a cloud call. The Linux smoke test requires that response from `http://127.0.0.1:3100/api/health`. Release workflow run [40520719762](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40520719762) printed `health ok` and `postgres stopped`. The Windows smoke is `packaging/windows/smoke-bundle.ps1`. The macOS smoke is the same shell script as Linux. Run [40526064339](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40526064339) printed `health ok` and `postgres stopped` for both. The smoke does not sign in. The Next server in the bundle still expects a loopback Supabase URL for sign-in. GoTrue and PostgREST are not packed. The smoke boots a writable `dist/bundle`. It does not boot the server from a read-only DMG or AppImage mount.

## Ollama

An optional binary is `bundle/ollama/ollama` (`ollama.exe` on Windows). If that file is missing, the window looks up `ollama` on `PATH`. If neither exists, startup continues. None of the platform bundles include Ollama.

When a binary exists and nothing is listening on `127.0.0.1:11434`, the window runs `ollama serve` with `OLLAMA_HOST=127.0.0.1:11434`. A remote host is refused. The window does not download a model.

The documented pull, which an operator runs by hand, is:

```sh
ollama pull qwen3:4b
```

## What is in which installer

The Linux tar.gz lists `bundle/node`, `bundle/erp/server.js`, and `bundle/postgres/bin/postgres`. The AppImage copies the same tree to `usr/bin/bundle`. The NSIS script copies `bundle\` beside `BoomBigNose.exe` and a silent install checks those files. The DMG copies `bundle` beside `BoomBigNose` and the mount check looks for the same three paths. NSIS compression is off because the tree is large.

Tag `boombignose-v0.2.0` is the older window-only release. Tag `boombignose-v0.2.1` is the current download. Its workflow run 40537854881 packed this tree into the Windows, macOS, and Linux installers and required `/api/health` before upload. v0.3.0 is not cut, because sign-in is not proved. The launcher was checked with `go test`. The smokes are CI processes, not clicks on a physical machine.

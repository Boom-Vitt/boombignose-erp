# Portable bundle

Checked 2026-10-27. This is the next slice of milestone 2. The published installers do not contain this tree.

## What the window does

`boombignose/internal/bundle` looks at `BOOMBIGNOSE_BUNDLE`, or at `bundle/` next to the desktop executable.

Required files:

- `bundle/node` (`bundle/node.exe` on Windows)
- `bundle/erp/server.js`

When both exist and `127.0.0.1:3100` is closed, the window runs that Node binary with `server.js`. It does not look up `node` on `PATH` and it does not call Docker. The child environment keeps `PATH`, `HOME`, `TMPDIR`, `LANG`, a loopback Supabase URL when the parent already has one, a loopback `OLLAMA_HOST`, and `OLLAMA_MODEL`. `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `RESEND_API_KEY` are not passed to the ERP process. A hosted Supabase URL or a remote Ollama host is refused and the error does not include the value.

When those two files are absent, the window keeps the checkout path: `node scripts/local/stack.mjs serve --port 3100`.

## Postgres, not SQLite

The ERP's finance and stock rules are Postgres functions, and row access is RLS. A SQLite file cannot run them. This slice does not add a SQLite mode.

An optional portable binary is recorded when this file exists:

- `bundle/postgres/bin/postgres` (`postgres.exe` on Windows)

When that binary exists and `bundle/postgres/data` is already a directory, and nothing is listening on `127.0.0.1:54322`, the window runs that binary with `-D <data> -h 127.0.0.1 -p 54322`. Other arguments are refused. The window does not run `initdb`, does not create roles, and does not point `server.js` at that port. The ERP still uses the loopback Supabase URL from the parent environment. A missing data directory is reported and startup of the Node server continues. Shipping `initdb`, the matching libraries, and a data directory inside the installer is a later slice. v0.2.0 does not include that binary. This start path was checked with `go test` and a fixture file, not with a real Postgres server.

## Ollama

An optional binary is `bundle/ollama/ollama` (`ollama.exe` on Windows). If that file is missing, the window looks up `ollama` on `PATH`. If neither exists, startup continues.

When a binary exists and nothing is listening on `127.0.0.1:11434`, the window runs `ollama serve` with `OLLAMA_HOST=127.0.0.1:11434`. A remote host is refused. The window does not download a model.

The documented pull, which an operator runs by hand, is:

```sh
ollama pull qwen3:4b
```

## What is not in the installer

Tag `boombignose-v0.2.0` is the Wails window only. It does not contain Node, `server.js`, Postgres, or Ollama. No newer release was cut for this slice, because the release workflow still packages that window and not this tree. The launcher was checked with `go test` and a local fixture process. It was not click-tested on a physical machine.

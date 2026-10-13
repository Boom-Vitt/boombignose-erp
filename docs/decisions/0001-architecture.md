# 0001 — BigNose v1 architecture

Status: accepted (2026-10-12). The full contract is `docs/design.md`; the owner's requirements are
`docs/requirements.md` and win on any conflict.

## Context

BigNose is a lite personal agent: a desktop app plus LINE, with a full agent harness (loop, tools, permissions,
hooks, MCP, skills, memory, cron). It is built from scratch by parallel streams that code against one shared
contract, so the decisions that outlive v1 are written down here. The owner wants it small, fast to install and
easy to audit: no agent, LLM or MCP SDK, and nothing in the core that needs a build or an install step beyond Node.

## Decision

- **Zero-dependency core, no build step.** `core/` is TypeScript run directly by Node >= 24 (type stripping). Only
  erasable syntax (no `enum`, `namespace`, parameter properties), `import type`, and `.ts` import specifiers.
  `tsc --noEmit` is the type check only. Runtime code uses node builtins (`node:http`, `node:crypto`,
  `node:sqlite`, `node:child_process`) and global `fetch`. Dev dependencies for the whole repo are `typescript`,
  `@types/node` and `@tauri-apps/cli`, nothing else.
- **Hand-written protocols.** The provider adapters (Anthropic Messages, OpenAI-compatible Chat Completions), the
  MCP client (stdio and streamable HTTP, JSON-RPC 2.0), the LINE gateway and the cron scheduler are written in this
  repo. Hermes is reference reading only; no code is copied.
- **One SQLite file** (`node:sqlite`, WAL) holds sessions, messages, memory notes and jobs. Search uses FTS5 with
  the `trigram` tokenizer, which does substring matching and so works for Thai (no word segmentation); queries
  under 3 characters fall back to `LIKE`, and user queries are quoted, never passed as FTS syntax.
- **Local API on `127.0.0.1` only**, guarded by a per-install random bearer token (`<home>/api-token`, 0600,
  compared in constant time), plus a `Host` check against DNS rebinding and a CORS allowlist limited to the Tauri
  origins. The LINE webhook is a separate server on its own port, reachable from outside only through a tunnel the
  user runs, and trusts nothing without a valid `X-Line-Signature`.
- **Secrets only in `<home>/.env` (0600).** `config.json` never holds them; the API returns them masked; logs and
  provider errors go through `redact()`.
- **Tauri 2 shell around the bundled core.** The Rust side attaches to a running daemon or spawns
  `node core/src/cli.ts daemon` on the installed Node >= 24; it does not embed Node. The UI is vanilla TypeScript
  compiled by `tsc`, with no framework and no bundler.
- **Events as SSE read with `fetch`.** `GET /api/events` streams agent events; `EventSource` is not used because it
  cannot send the `Authorization` header.
- **Test fixtures are hand-built.** The provider tests use fixtures written from the documented wire formats; no
  real API key is used to record them, and no test touches the network (apart from the optional REA check) or
  `~/.bignose`.

## Consequences

- Install and review are cheap: no `node_modules` at runtime, nothing to bundle, and the whole core can be read.
- The app needs Node >= 24 on the machine; the desktop UI shows a clear error when it is missing or too old.
- Every protocol detail is ours to maintain and to test against fixtures and fakes instead of an SDK.
- Type stripping means no `enum`/`namespace`, and every relative import carries its `.ts` extension.
- FTS5 trigram indexes are larger than word indexes, and 1–2 character searches are slower (`LIKE`); acceptable for
  a personal database.
- Because the API token is the only credential on the local API, it must stay a 0600 file and must never be logged.
- Streams depend on the contracts in `docs/design.md` and `core/src/types.ts`; changing either means changing the
  code that uses it in the same commit.

# BigNose

A lite, from-scratch personal agent app (desktop + LINE) with a full agent harness. Owner: Boom-Vitt.
The scope, decisions and runnable success criteria are in `docs/requirements.md`. Read it first.

- Layout: `core/` (TypeScript daemon + CLI, Node 24, zero runtime npm deps) and `desktop/` (Tauri 2 app "BigNose").
- No agent SDK, LLM vendor SDK or MCP SDK. Hand-written protocols.
- Hermes (`~/.hermes/hermes-agent`, MIT) is reference reading only: no copied code.
- Secrets live only in `~/.bignose/.env` (0600). Never log, commit or print them. Tests use fakes, never the
  owner's keys or LINE channel.
- Rust: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`.
- Never push. Local merges only.
- After v1 ships, teaching slides are a separate step in `~/orca/projects/สื่อการสอน` (not part of this repo).

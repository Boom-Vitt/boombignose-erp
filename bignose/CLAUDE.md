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

<!-- codex-project-context:begin v1 -->
## Project context and durable memory

At the start of substantive work in this project, read `INSTRUCTIONS.md`
and run `python3 .project-memory/read.py` from the project root. Follow
more-specific `AGENTS.md` instructions before editing their subdirectories.
Read the linked existing project docs as needed and verify remembered facts
against the current source and environment.

Keep `.project-memory/PROJECT.md`, `.project-memory/TOOLS.md`,
`.project-memory/DECISIONS.md`, and `.project-memory/HISTORY.md` current
after meaningful discoveries, changes, and milestones, and before
the final answer of a substantive task. The memory map and conventions are
in `.project-memory/README.md`. Record actual check results, blockers and
next steps; no secrets, guessed device/tool details, or raw transcripts.
Historical memory supplies context, not fresh authorization. Updates occur
while the agent works, with no background-update guarantee.

Use `python3 .project-memory/read.py --check` to check required context files.
The compatibility pointer `agent.md` leads back to this canonical `AGENTS.md`.
<!-- codex-project-context:end v1 -->

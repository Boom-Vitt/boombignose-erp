# BigNose v1 — requirements (owner, 2026-10-12)

BigNose is a lite, from-scratch personal agent app in the spirit of Hermes Agent (Nous Research), with the
full agent harness. It is a desktop app named **BigNose**, and you can also talk to it over **LINE**.

## Owner decisions
- **Written from scratch.** No agent SDK, no LLM vendor SDK, no MCP SDK. Hand-write the agent loop, the provider
  adapters, the MCP client, the gateway and the scheduler. Hermes (MIT, `~/.hermes/hermes-agent`) may be read for
  behaviour and protocol details, but no code is copied.
- **Multi-provider.** Anthropic Messages API, plus any OpenAI-compatible Chat Completions endpoint (OpenAI,
  OpenRouter, local Ollama or LM Studio) chosen by base URL. The user switches provider and model in settings.
- **Desktop: Tauri 2** (Rust shell plus web UI). Lite means small and fast, not missing harness features.
- **Messaging: LINE only.**

## Goal (v1)
One install on macOS (Apple Silicon) gives you:
1. **Core daemon** (`core/`, TypeScript on Node 24, ESM, zero runtime npm deps: use node builtins such as `node:http`,
   `node:crypto`, `node:sqlite`, `node:child_process` and `fetch`).
   - **Agent loop:** streaming, tool calls, interrupt, a max-turns guard, and context compaction (summarise old turns
     when near the model's limit).
   - **Provider adapters:** `anthropic` and `openai-compatible`, both with streaming tool calls.
   - **Built-in tools:** shell (with approval), read, write and edit files, list and search files, web fetch,
     memory read/write, skill load, schedule (cron) create/list/delete, and a `delegate` subagent that runs a nested
     loop with its own context.
   - **Permissions:** per-tool policy (allow / ask / deny). "Ask" goes to the desktop UI, or to LINE as a confirm
     button.
   - **Hooks:** user-configured shell commands for pre-tool, post-tool and session-end.
   - **MCP client:** stdio and streamable HTTP, JSON-RPC 2.0, initialize, tools/list and tools/call, per-server
     enable/disable and per-tool selection.
     - Ship REA preconfigured as an entry named `rea`: `npx -y rea-agents@6.1.0 mcp`. It is off by default, with a
       one-click enable.
   - **Skills:** folders with `SKILL.md` (agentskills.io format: frontmatter name and description). The index goes in
     the system prompt and the body loads on demand. The agent can create and update skills.
   - **Memory and sessions:**
     - Persistent user and agent memory notes.
     - Sessions stored in SQLite (`node:sqlite`), with FTS5 search across past sessions exposed as a tool.
   - **Cron scheduler:** 5-field cron. Runs a prompt and delivers the result to the desktop or a LINE chat.
     It survives restarts.
   - **LINE gateway** (LINE Messaging API webhook):
     - HMAC-SHA256 `X-Line-Signature` check, 1 MiB body limit, dedupe.
     - Allowlists for users U…, groups C… and rooms R…, deny by default.
     - Reply token first (single use, ~60 s); metered Push only as a fallback.
     - Past a slow-response threshold (default 45 s), send a postback "Get answer" button so the answer still goes
       out on a free reply token.
     - Text chunked at 4500 chars, at most 5 messages per call.
   - **Local API** for the UI: HTTP plus WebSocket or SSE on 127.0.0.1 only, guarded by a random per-install token.
   - **Config:** `~/.bignose/config.json`. Secrets go in `~/.bignose/.env` (mode 0600) and are never logged or
     returned in full by the API (masked).
   - **CLI:**
     - `bignose daemon` runs the core.
     - `bignose chat -q "<prompt>"` runs a headless single turn.
     - `bignose mcp add|list|test|enable|disable`.
     - `bignose doctor`.
2. **Desktop app** (`desktop/`, Tauri 2). App name **BigNose**, bundle id `com.boombignose.bignose`, own icon.
   - Starts or attaches to the daemon (sidecar).
   - **Chat:** streaming output, live tool activity, approve/deny prompts, session list and search.
   - **Settings:** Providers & models (API keys masked), Connectors (MCP list, toggle, add, test; REA card), Messaging
     (LINE only: token, secret, allowlists, port, public URL, enable, status), Skills, Memory, Schedules.
   - No third-party product names in the app's own UI labels (provider and connector names in pickers are fine).
   - Dark, modern, serious look.

## Non-goals (v1)
Other messaging platforms, cloud or remote gateways, voice, Windows/Linux builds, code signing, notarisation and
auto-update, a plugin marketplace, Docker/SSH terminal backends, OAuth MCP servers, and
image generation.

## Success criteria (runnable)
- `pnpm install && pnpm -r typecheck && pnpm -r test` pass from a clean clone.
- **Unit tests**, with no network and a mock provider:
  - The agent loop runs a multi-step tool chain and honours max turns.
  - Both provider adapters parse streamed tool calls from recorded fixtures.
  - The MCP client works against a fake stdio server (initialize, tools/list, tools/call, error path).
  - LINE webhook:
    - A good signature gives 200 and a bad signature gives 401.
    - The allowlist blocks strangers.
    - Reply falls back to Push when the token has expired, against a mocked LINE API.
    - The slow-response button flow goes PENDING → READY → DELIVERED.
  - Cron parse and next-run.
  - Skills index and load.
  - Memory FTS5 search.
  - Secret masking.
  - The local API rejects requests without the token.
- `bignose chat -q` runs a tool round trip end to end with a mock OpenAI-compatible server started by the test.
- `bignose mcp test rea` connects to the real REA package and lists ≥ 100 tools. This is the only network-dependent
  check and may be skipped with `BIGNOSE_SKIP_NETWORK=1`.
- `pnpm --filter desktop tauri build --bundles app` produces `BigNose.app`, whose Info.plist CFBundleName is `BigNose`.

## Environment notes
- Rust toolchain: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`. Homebrew rustup
  puts no proxies on PATH.
- Tauri CLI: use the `@tauri-apps/cli` dev dependency (`pnpm tauri …`). Do not install it globally.
- Node 24.20, pnpm 12, bun 1.4 available. Use pnpm workspaces.
- Never push, never print or commit secrets, and never use the owner's real API keys or LINE credentials in tests.

## Owner update (2026-10-13): desktop-first, agents, `/rea`
The owner wrote: "bignose should be desktop app!! that can create agent use /rea to read and reverse hermes desktop app".
This section overrides anything above that conflicts with it.

- **Desktop-first.** Every v1 feature works from the BigNose desktop app with no terminal. The CLI stays for tests and
  headless use only.
- **Agents (new, replaces the "multi-profile" non-goal).** In the desktop app you can create, edit, duplicate and delete
  agents. Each agent has:
  - name and icon
  - instructions (system prompt)
  - provider and model
  - tool permissions
  - enabled connectors (MCP servers) and skills
  - its own sessions and agent memory; user memory is shared across agents
  One agent is chosen to answer LINE. A default agent exists on first run.
- **Slash commands.** Typing `/` in the chat box lists the commands. `/<skill>` loads that skill for the turn.
- **Built-in `/rea <app or file path>`:**
  1. Turns on the REA connector for the agent. If it is off, it asks first.
  2. Loads the REA skill. REA is MIT: bundle `skills/reverse-engineer-anything` from the `rea-agents` package with its
     LICENSE, or read it from the installed package.
  3. Runs the agent on the target. The agent reads and reverses the app with REA tools and writes a report with
     evidence, shown in chat and saved as a file.
- **Headline use case.** Create an agent "Hermes Reverser", then run `/rea` on Hermes Desktop. The report covers:
  - the app type (Electron)
  - the main / preload / renderer layout
  - IPC channels
  - screens and routes, including Messaging → LINE
  - the local API it calls
  Target: `~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app` (`Contents/Resources/app.asar`). Note
  that `/Applications/Hermes.app` is only the setup bootstrap. Hermes Desktop is MIT, so reversing it is allowed.

### Added success criteria
- Agents CRUD through the local API is persisted and covered by tests. The desktop Agents screen lists, creates and
  edits agents.
- Slash commands: `/` lists commands, and `/rea <path>` expands to "REA connector on + REA skill loaded + the target
  in the prompt". There is a unit test for this.
- REA end to end (network-dependent, `BIGNOSE_SKIP_NETWORK=1` skips it):
  - Set up a mock provider scripted to call REA `open_binary` on the Hermes Desktop `app.asar`, then a JavaScript
    analysis tool.
  - BigNose's own MCP client runs the real REA, and the turn ends with non-empty tool evidence in the session
    transcript.
- Desktop e2e: with the daemon and a mock provider, the desktop web UI creates an agent, sends `/rea <path>`, and shows
  the streamed tool activity and the final message. Use Playwright against the dev web UI, or an equivalent.
- Owner-run (manual, real model key): BigNose's "Hermes Reverser" produces the Hermes Desktop report. This check is not
  automated.

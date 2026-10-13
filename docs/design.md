# BigNose v1 — design and contracts

Owner requirements: `docs/requirements.md` (wins on any conflict). This file is the contract that the parallel
build streams code against. Change it only together with the code that changes the contract.

## 1. Layout

```
package.json  pnpm-workspace.yaml  pnpm-lock.yaml  tsconfig.base.json      pnpm workspace (packages: core, desktop)
core/                     @bignose/core — daemon + CLI, Node >= 24, ESM, zero runtime deps
  src/types.ts            shared contracts (section 3, verbatim)
  src/config.ts           home dir, config, .env secrets, masking (section 4)
  src/log.ts              stderr logger that redacts known secrets
  src/providers/          anthropic + openai-compatible adapters, SSE reader          (stream core-agent)
  src/agent/              agent loop, compaction, permissions, hooks                 (stream core-agent)
  src/tools/              built-in tools + delegate                                  (stream core-agent)
  src/mcp/                MCP client (stdio, streamable HTTP) + manager              (stream core-agent)
  src/store/              SQLite store: sessions, messages, memory, jobs, FTS5       (stream core-services)
  src/memory/             memory + session_search tools                              (stream core-services)
  src/skills/             SKILL.md index/load/save + tools                           (stream core-services)
  src/cron/               cron parser, next-run, scheduler + tools                   (stream core-services)
  src/line/               LINE Messaging API gateway                                 (stream core-services)
  src/api/                local HTTP + SSE API                                       (stream core-app)
  src/app/                runtime wiring, daemon, doctor                             (stream core-app)
  src/cli.ts              `bignose` entry                                            (stream core-app)
  test/<area>/*.test.ts   node:test suites, one folder per area
desktop/                  package "desktop" — Tauri 2 app "BigNose"                  (stream desktop)
  src/                    web UI: vanilla TypeScript, no framework, no bundler
  src-tauri/              Rust shell
docs/                     requirements, this design, ADRs in docs/decisions/
```

## 2. Conventions

- **No build step for core.** Node 24 runs `.ts` directly (type stripping). Use erasable syntax only: no `enum`,
  `namespace`, parameter properties or decorators; `import type` for types; relative imports end in `.ts`.
  `tsconfig.base.json`: `strict`, `noEmit`, `module`/`moduleResolution` `nodenext`, `target` es2024,
  `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `skipLibCheck`, `types: ["node"]`.
- **Zero runtime deps in core.** Only node builtins and global `fetch`. Dev deps (whole repo): `typescript`,
  `@types/node`, `@tauri-apps/cli`. No other packages: no vite, no test framework, no SDKs.
- **Tests:** `node:test` + `node:assert/strict`, files `core/test/<area>/*.test.ts`, run with
  `node --test <files>`. No network (single exception: the REA check, section 9). Every test that touches disk sets
  `BIGNOSE_HOME` to a fresh `mkdtemp` dir; servers listen on port 0; never read `~/.bignose`, never use real keys.
- **Lazy, boring code.** Smallest thing that meets the contract; no speculative options or abstractions.
- **Secrets** come only from `<home>/.env`. Never log, print, return or persist them anywhere else. Errors that may
  echo a request (e.g. provider HTTP errors) go through `redact()`.

## 3. Shared contracts — `core/src/types.ts` (verbatim)

```ts
// Shared contracts for BigNose core. Erasable TypeScript only.

export type JsonSchema = { type?: string; description?: string; properties?: Record<string, JsonSchema>;
  required?: string[]; items?: JsonSchema; enum?: unknown[]; [key: string]: unknown };

// ---- conversation (provider-neutral; adapters convert to and from the wire formats)
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export type Message = { role: 'user' | 'assistant'; content: ContentBlock[] };

// ---- providers
export type ProviderKind = 'anthropic' | 'openai-compatible';
export interface ToolSpec { name: string; description: string; inputSchema: JsonSchema }
export interface ProviderRequest {
  model: string; system: string; messages: Message[]; tools: ToolSpec[]; maxTokens: number; signal?: AbortSignal;
}
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';
export interface Usage { inputTokens: number; outputTokens: number }
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }                                  // as soon as the name is known
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }       // arguments complete
  | { type: 'done'; stopReason: StopReason; usage: Usage };
export interface Provider { readonly kind: ProviderKind; stream(req: ProviderRequest): AsyncIterable<ProviderEvent> }

// ---- tools and permissions
export type Policy = 'allow' | 'ask' | 'deny';
export interface Agent {
  id: string; name: string; icon: string; instructions: string; provider: string; model: string;
  permissions: Record<string, Policy>; connectors: string[] | null; skills: string[] | null;
  createdAt: number; updatedAt: number;
}
export type Origin = { kind: 'desktop' } | { kind: 'cli' } | { kind: 'line'; to: string } | { kind: 'cron'; jobId: string };
export type Delivery = { kind: 'desktop' } | { kind: 'line'; to: string };
export interface ToolContext {
  sessionId: string; origin: Origin; cwd: string; signal: AbortSignal; depth: number;
  delegate?: (task: string) => Promise<string>;     // set by the agent loop when depth allows
}
export interface ToolResult { content: string; isError?: boolean }
export interface Tool extends ToolSpec {
  defaultPolicy: Policy;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
export interface ApprovalRequest { id: string; sessionId: string; origin: Origin; tool: string; input: Record<string, unknown> }
export type Approver = (req: ApprovalRequest) => Promise<boolean>;

// ---- hooks
export interface HookSpec { command: string; tools?: string[]; timeoutMs?: number }
export interface HooksConfig { preTool?: HookSpec[]; postTool?: HookSpec[]; sessionEnd?: HookSpec[] }

// ---- agent events (the local API streams them with sessionId and runId added)
export type RunStatus = 'done' | 'interrupted' | 'max_turns' | 'error';
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; callId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; callId: string; name: string; isError: boolean; output: string }   // output cut to 2000 chars
  | { type: 'approval_request'; approvalId: string; tool: string; input: Record<string, unknown> }
  | { type: 'approval_result'; approvalId: string; allowed: boolean }
  | { type: 'compaction'; removedMessages: number }
  | { type: 'run_end'; status: RunStatus; text: string; error?: string };

// ---- config (~/.bignose/config.json); secrets are never stored here
export interface ProviderConfig {
  id: string; kind: ProviderKind; label?: string; baseUrl: string;
  apiKeyEnv?: string;          // name of the .env variable holding the key; absent = no auth (local servers)
  contextWindow?: number; maxTokens?: number;
}
export type McpServerConfig =
  | { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; enabled: boolean; tools?: string[] }
  | { transport: 'http'; url: string; headers?: Record<string, string>; enabled: boolean; tools?: string[] };
export interface LineConfig {
  enabled: boolean; port: number; publicUrl?: string; slowResponseMs: number;
  agentId?: string;
  allow: { users: string[]; groups: string[]; rooms: string[] };
}
export interface Config {
  version: 1;
  active: { provider: string; model: string };
  providers: ProviderConfig[];
  agent: { maxTurns: number; workspace: string; compactAt: number; systemPrompt?: string };
  permissions: Record<string, Policy>;   // exact tool name, or a prefix ending in '*'; overrides Tool.defaultPolicy
  hooks: HooksConfig;
  mcp: { servers: Record<string, McpServerConfig> };
  line: LineConfig;
  api: { port: number };
}
```

## 4. Home, config and secrets — `core/src/config.ts`

- Home = `$BIGNOSE_HOME` or `~/.bignose` (created 0700). Files: `config.json`, `.env` (0600), `api-token` (0600),
  `bignose.db`, `skills/`, `daemon.json` (`{pid, port, version, startedAt}`), `logs/`.
- Exports: `homeDir()`, `paths(home?)`, `defaultConfig()`, `loadConfig(home?)` (defaults deep-merged with the file;
  missing file = defaults; invalid JSON = throw with the path), `saveConfig(cfg, home?)` (atomic write),
  `readEnv(home?)`, `setSecret(name, value | null, home?)` (rewrites `.env`, keeps mode 0600 even if it existed
  with other bits), `getApiKey(cfg, providerId, home?)`, `maskSecret(v)` (`''` stays `''`; else `'••••' + last 4`,
  and only `'••••'` when shorter than 12), `redact(text, secrets)`, `ensureApiToken(home?)` (32 random bytes hex,
  0600, created once per install), `VERSION`.
- `.env` format: `NAME=value` lines, `#` comments, optional single/double quotes. Names `[A-Z_][A-Z0-9_]*`.
- Secret names in use: each provider's `apiKeyEnv` (defaults below), `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`.
  MCP `env`/`headers` values may reference secrets as `${NAME}`, expanded at connect time.
- Defaults:
  - providers: `anthropic` (anthropic, `https://api.anthropic.com`, `ANTHROPIC_API_KEY`, contextWindow 200000,
    maxTokens 8192); `openai` (openai-compatible, `https://api.openai.com/v1`, `OPENAI_API_KEY`, 128000);
    `openrouter` (openai-compatible, `https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`, 128000);
    `ollama` (openai-compatible, `http://127.0.0.1:11434/v1`, no key, 32000).
  - active `{ provider: 'anthropic', model: 'claude-sonnet-5-5' }`; agent `{ maxTurns: 30, workspace: <os home>,
    compactAt: 0.8 }`; permissions `{}`; hooks `{}`; api `{ port: 47821 }`.
  - mcp.servers: `rea` = `{ transport: 'stdio', command: 'npx', args: ['-y', 'rea-agents@6.1.0', 'mcp'], enabled: false }`.
  - line: `{ enabled: false, port: 47822, slowResponseMs: 45000, allow: { users: [], groups: [], rooms: [] } }`.

## 5. Module contracts

### core-agent
- `providers/index.ts`: `createProvider(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl = fetch): Provider`.
  - anthropic: `POST {baseUrl}/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, body
    `{model, system, messages, tools:[{name, description, input_schema}], max_tokens, stream: true}`; tool results go
    as `user` blocks `{type:'tool_result', tool_use_id, content, is_error}`. Parse SSE `message_start`,
    `content_block_start` (text / tool_use), `content_block_delta` (`text_delta`, `input_json_delta`),
    `content_block_stop`, `message_delta` (stop_reason, usage), `message_stop`, `ping`, `error`.
  - openai-compatible: `POST {baseUrl}/chat/completions`, `Authorization: Bearer` only when a key is set, body
    `{model, messages, tools:[{type:'function', function:{name, description, parameters}}], stream: true,
    stream_options:{include_usage:true}}`, `max_tokens` only when the config sets maxTokens. System prompt as the
    first `system` message; assistant tool calls as `tool_calls` (arguments = JSON string); results as `role:'tool'`
    messages. Stream: `choices[0].delta.content`, `delta.tool_calls[]` by `index` (id/name in the first chunk,
    `arguments` concatenated), `finish_reason` (`tool_calls` → tool_use, `length` → max_tokens, else end_turn),
    trailing usage chunk, `data: [DONE]`.
  - Shared SSE reader (`providers/sse.ts`) handling CRLF, multi-line `data:`, comments, chunk boundaries anywhere.
  - Non-2xx: throw `Error` with status and a redacted, truncated body. Tool names sent to providers must match
    `^[a-zA-Z0-9_-]{1,64}$`.
- `agent/loop.ts`: `runAgent(opts: RunOptions): Promise<RunResult>` with
  `RunOptions = { provider, model, system, context: Message[], input: string, tools: Tool[], maxTurns, maxTokens,
  contextWindow, compactAt, permissions: Record<string, Policy>, hooks: HooksConfig, approve?: Approver,
  sessionId, origin: Origin, cwd, signal: AbortSignal, onEvent?: (e: AgentEvent) => void, depth?: number }` and
  `RunResult = { context: Message[] /* new model context, compacted if needed */, added: Message[] /* transcript
  messages of this run, input included */, status: RunStatus, text: string, usage: Usage, error?: string }`.
  - One turn = one provider call. Tool calls of a turn run in order; every `tool_use` gets a `tool_result`
    (errors, denials and interrupts included) so the context stays valid.
  - Max turns: stop with `max_turns` after `maxTurns` provider calls. Interrupt: `signal` aborts the provider call and
    the running tool; status `interrupted`. Provider errors: status `error`, never a throw.
  - Compaction: before a provider call, when the estimated context (last `usage.inputTokens`, else chars/4) exceeds
    `compactAt * contextWindow`, summarise all but the recent tail (never split a tool_use from its tool_result) with
    one provider call without tools, replace them with one user message `[Summary of earlier conversation]\n…`,
    emit `compaction`.
  - Delegate: when `depth < 1`, `ctx.delegate(task)` runs a nested `runAgent` with fresh context `[task]`, the same
    tools minus `delegate`, no `onEvent` text streaming, and returns its final text.
- `agent/permissions.ts`: effective policy = `permissions[name]` ?? longest matching `prefix*` key ??
  `tool.defaultPolicy`. `deny` → error result `denied by policy`; `ask` → `approve(req)`; no approver or `false` →
  error result `denied by user`.
- `agent/hooks.ts`: run each matching hook with `/bin/sh -c command`, JSON on stdin (`{event, sessionId, tool?,
  input?, output?, isError?, status?}`), env `BIGNOSE_HOOK_EVENT`, timeout `timeoutMs` (default 10000).
  `preTool` non-zero exit or timeout blocks the call (`blocked by hook: <first stderr line>`). `postTool` result is
  ignored. `sessionEnd` runs when a top-level `runAgent` (depth 0) ends.
- `tools/index.ts`: `builtinTools(home: string): Tool[]` — `shell` (ask; `/bin/sh -c`, cwd, timeout 120 s default,
  output cap 100 kB, kills the process group on abort), `read_file` (allow; offset/limit lines), `write_file` (ask),
  `edit_file` (ask; unique exact match unless `replaceAll`), `list_files` (allow; optional glob, skips `.git` and
  `node_modules`), `search_files` (allow; regex, `path:line: text`, caps), `web_fetch` (**ask**; http/https GET, 30 s,
  2 MB, HTML to text; the owner can set it to `allow` in `permissions`), `delegate` (allow; uses `ctx.delegate`). Relative paths resolve against `ctx.cwd`.
  - Protected files: `read_file`, `write_file` and `edit_file` refuse `<home>/.env`, `<home>/api-token` and `<home>/config.json` after resolving
    the real path (symlinks, `..`); `list_files` and `search_files` never list or read them (also when they walk the
    home dir or follow a symlink to them). The same refusal covers common credential stores of other tools:
    `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, `~/.docker/config.json`, `~/.claude.json`,
    `~/.claude/.credentials*`, `~/.hermes/.env`, `~/.codex/auth.json`, and any `.env`/`.env.*` file directly in the
    user's home.
  - `web_fetch` SSRF guard: resolve the host (`dns.lookup` all addresses) and refuse when any address is loopback,
    link-local, private, unique-local or unspecified (IPv4-mapped IPv6 included); follow redirects manually (max 5),
    re-checking every hop. Do the request with `node:http`/`node:https` and a `lookup` that rejects those addresses
    (closes DNS rebinding between check and connect).
- `mcp/client.ts`: `McpClient` for one server: `connect()` (JSON-RPC 2.0 `initialize` with protocolVersion
  `2025-11-25`, accept the server's version, then `notifications/initialized`), `listTools()` (follows
  `nextCursor`), `callTool(name, args)` → `ToolResult` (text content joined; `isError` kept; JSON-RPC error → error
  result), `close()`. Transports: stdio (spawn, newline-delimited JSON, stderr kept for errors, kill on close) and
  streamable HTTP (POST, `Accept: application/json, text/event-stream`, JSON or SSE response, `Mcp-Session-Id` and
  `MCP-Protocol-Version` headers after init, 202 for notifications). Request timeout 60 s, except the first stdio
  `initialize` (180 s: a cold `npx` download is slow). Stdio servers get `process.env` overlaid with the configured
  `env` (after `${NAME}` expansion). Answer a server→client `ping`; ignore notifications and unknown messages.
- `mcp/manager.ts`: `McpManager(servers: Record<string, McpServerConfig>, env: Record<string,string>)`:
  `start()` connects enabled servers, `tools(): Tool[]` (selected tools only; name `mcp__<server>__<tool>`
  sanitised to 64 chars; defaultPolicy `ask`), `test(name)` → `{ ok, tools: number, error? }` (works for disabled
  servers too), `status()`, `listTools(name)` (cached descriptors, including descriptions),
  `update(servers, env?)` (reconnect changed configs or secrets), `waitFor(names, signal)` (wait for initialization
  and tool discovery, up to 180 s, abortable, throws on startup failure), `stop()`.
  Provider and MCP HTTP requests reject redirects (`redirect: 'error'`), including MCP session cleanup, so
  authentication headers never follow a redirect to another origin.

### core-services
- `store/index.ts`: `openStore(file: string): Store` on `node:sqlite` (WAL). FTS5 tables use `tokenize='trigram'`
  (substring search that works for Thai); queries shorter than 3 characters fall back to `LIKE`. User queries are
  quoted, never passed as raw FTS syntax. Store API:
  sessions `createSession({title?, origin, agentId})`, `listSessions({limit?, agentId?})`, `getSession(id)` (with `context` and `origin`),
  `findSessionByOrigin(origin, agentId)` (latest session with that exact origin and agent, or undefined; one session per
  LINE chat per agent),
  `deleteSession(id)`, `setTitle(id, title)`, `appendMessages(id, msgs: Message[])` (transcript; indexes the text),
  `getMessages(id)`, `setContext(id, msgs)`, `searchMessages(query, limit?, agentId?)` → `{sessionId, title, snippet, at}[]`;
  memory `listMemory(kind?, agentId?)`, `addMemory(kind: 'user'|'agent', text, agentId?)`, `updateMemory(id, text)`,
  `deleteMemory(id)`, `searchMemory(query, limit?, kind?, agentId?)`; jobs `listJobs(agentId?)`, `saveJob(job)`, `deleteJob(id)`; `close()`.
- `memory/tools.ts`: `memoryTools(store, agentId): Tool[]` — `memory_read` (allow; list or search, by kind), `memory_write`
  (allow; add/update/delete); `sessionSearchTool(store, agentId): Tool` — `session_search` (allow). Plus
  `memoryPrompt(store, agentId?): string` (notes for the system prompt, capped at 4000 chars).
- `skills/index.ts`: skills live in `<home>/skills/<name>/SKILL.md` (agentskills.io: YAML frontmatter `name`,
  `description`, then the body). `listSkills(dir)`, `loadSkill(dir, name)` (body + list of other files in the
  folder), `saveSkill(dir, {name, description, body})` (name `^[a-z0-9][a-z0-9-]{0,63}$`), `deleteSkill(dir, name)`,
  `skillsIndex(dir, allowed?: string[] | null): string` (one line per skill for the system prompt), `skillTools(dir, allowed?: string[] | null): Tool[]` — `skill_load`
  (allow), `skill_save` (ask).
- `cron/index.ts`: `parseCron(expr)` (5 fields: minute hour day-of-month month day-of-week; `*`, lists, ranges,
  steps, month and weekday names, 0 and 7 = Sunday; when both day fields are restricted a day matches either),
  `nextRun(expr, after: Date): Date` (local time, strictly after), `Scheduler({ store, onFire: (job) => Promise<void>,
  now?, setTimer? })` with `start()`, `stop()`, `add({cron, prompt, delivery, agentId})`, `remove(id)`,
  `setEnabled(id, on)`, `list()`. Jobs persist in the store and reload on `start()` (survive restarts; runs missed
  while stopped are skipped, not replayed). `scheduleTools(scheduler, agentId): Tool[]` — `schedule_create` (ask; delivery
  defaults to the caller's origin: line → that chat, everything else → desktop), `schedule_list` (allow),
  `schedule_delete` (allow).
- `line/index.ts`: `createLineGateway(opts)` returning `{ handler(req, res), listen(port) , close(), push(to, text),
  askApproval(to, text) => Promise<boolean>, status() }`, with `opts = { config: LineConfig, channelSecret,
  accessToken, onMessage: ({to, userId, text}) => Promise<string>, fetchImpl?, apiBase? = 'https://api.line.me',
  now?, timers? }`. Behaviour in section 7.

### core-app
- `app/runtime.ts` exports `Runtime` and `RunProfile`: each run takes one snapshot containing provider config,
  model, system prompt, permissions, hooks, workspace and loop limits, plus an optional `toolFilter`. Automatic
  memory is a separate `memory` field, appended only for owner runs, including with an explicitly supplied profile.
  `Runtime.start(sessionId, input, {profile?, origin?, userId?, approve?})` returns `{runId, result}`; agent
  profiles supply this snapshot without changing the loop. Nested approvals are surfaced by the runtime's
  approver, since delegated runs intentionally suppress loop events. Non-owner LINE runs omit automatic memory
  injection as well as raising allow policies to ask.
  Non-owner LINE context keeps only user text and assistant replies without tool calls; tool-bearing assistant
  messages (including intermediate text), tool blocks and internal compaction summaries are dropped. Owner runs
  keep full context; the messages table retains the full transcript when visitor context is saved.
- `app/runtime.ts`: builds the provider (the session's agent provider + key), the tool list (builtin + memory + session_search +
  skills + schedule + MCP), the system prompt (the agent's instructions or a short default, + shared user and own agent memory notes + its skills
  index + today's date), runs `runAgent` per session (one run per session at a time), persists `added` and
  `context` in the store, sets a title from the first user message, routes approvals to the origin's channel
  (desktop → API event + `POST /api/approvals/:id`; cli = `chat -q` in-process → TTY prompt, denied without a TTY;
  line → LINE confirm buttons; cron → the job's delivery channel; 10 min timeout = deny), and delivers cron results
  (desktop → `notification` event + session; line → push). Keeps one session per LINE chat per agent (`findSessionByOrigin`).
  First-message and scheduled-session titles are redacted before whitespace normalization and truncation. A 2000-character tool preview omits a
  possible partial-secret suffix after redaction, so truncated credentials cannot reach API/CLI events.
  **LINE senders outside `allow.users`** (members of an allowlisted group or room) run with every `allow` policy
  raised to `ask`, so their requests reach the owner's disk, notes, sessions, web or memory only after a tap from an
  `allow.users` member.
- `app/daemon.ts`: `bignose daemon` — ensure home + token, open store, start MCP manager, scheduler, LINE gateway
  (when enabled and both secrets set), the API server; write `daemon.json` with the **bound** port (`api.port: 0` and `line.port: 0` mean ephemeral
  ports, used by tests; tests never use the default ports 47821/47822); apply settings changes live (LINE
  restart, MCP update); clean shutdown on SIGINT/SIGTERM.
  The API listens and `daemon.json` is written before connectors finish initializing. Initial connector startup
  runs asynchronously in the same serialized queue as settings writes; pending connectors show `connected:false`.
  Shutdown cancels their initialization and waits for the queue before closing the store.
  LINE starts before MCP initialization, and the scheduler starts after that LINE startup attempt, so slow
  connectors cannot delay inbound LINE or cron LINE delivery. Settings writes wait behind an in-flight connector
  initialization (up to the 180 s stdio initialize timeout).
  A failed LINE bind is retried on the next settings/secrets reload, even when those values are unchanged.
  `line.agentId` is excluded from the LINE listener fingerprint: changing or deleting the chosen agent keeps the
  same webhook listener; the runtime resolves the current agent on each message.
- `cli.ts` (`#!/usr/bin/env node`): `bignose daemon`, `bignose chat -q "<prompt>"` (headless single turn without a
  daemon: text to stdout, tool activity to stderr, `ask` tools prompt on a TTY and are denied otherwise; exit 0 when
  done, 1 otherwise), `bignose mcp add <name> (--url <url> | -- <command> [args…])`, `mcp list`, `mcp test <name>`
  (prints `ok <name> <n> tools`, exit 0; or `fail <name>: <error>`, exit 1), `mcp enable|disable <name>`,
  `bignose doctor` (node version, sqlite + FTS5 trigram, home writable, config valid, active provider has a key,
  LINE settings when enabled; exit 1 only on hard failures: node < 24, sqlite/FTS5 trigram missing, home not
  writable, invalid config; a missing provider key or LINE secret is a warning and exits 0).
  Doctor creates a missing fresh-install home with mode 0700 before checking writability.

## 6. Local API (core-app serves it, desktop consumes it)

- `http://127.0.0.1:<config.api.port>` (default 47821), bound to 127.0.0.1 only. Every request needs
  `Authorization: Bearer <token>` (token = `<home>/api-token`), compared in constant time → else `401`.
  `Host` must be `127.0.0.1:<port>` or `localhost:<port>` → else `403` (DNS rebinding). CORS: allowed origins
  `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`. For an allowed `Origin`, every response
  sets `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`; preflight `OPTIONS` → 204 without auth (Host check
  still applies) with `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`,
  `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Max-Age: 600`. Other origins get no
  CORS headers.
  JSON bodies ≤ 1 MiB. Errors: `{ "error": "<message>" }`. Secrets are only ever returned masked.
  General redaction masks only `.env` values and the API token of 8+ characters. Literal MCP env/header values
  are masked in their own config fields (`GET /api/settings`, `/api/mcp`); the MCP client also masks its own
  values in tool results. Ordinary filesystem ROOT paths remain intact in transcripts, SSE, titles and API text.
  Dedicated secret and MCP settings fields use `maskSecret` for every non-empty value. Each response/event/persistence
  batch snapshots its redaction list once; object keys are not cleaned.
- Every API timestamp is a number in epoch milliseconds: sessions and memory `updatedAt`, jobs
  `nextRunAt`/`lastRunAt`, and LINE `lastEventAt`. Disabled jobs have `nextRunAt: null`; optional timestamps are
  omitted until present. `daemon.json.startedAt` uses the same unit.
- Events: `GET /api/events` → `text/event-stream`; each event is one `data: <json>` line, JSON =
  `AgentEvent & { sessionId, runId }`, plus `{type:'run_start', sessionId, runId}`,
  `{type:'session_updated', sessionId}`, `{type:'notification', title, body, sessionId?}`. `: ping` every 15 s.
  Clients read it with `fetch` + a stream reader (EventSource cannot send the header).
  Every new connection first replays one `run_start` per active run and one `approval_request` per pending
  API approval, with the same `sessionId`/`runId` and approval shape as live events, then streams live events.
  CLI TTY and LINE confirm-button approvals stay in their originating channel.
  Per-run text streaming holds the larger of the run-start and current longest secret lengths minus one
  characters, redacts the joined buffer with both cleaners
  before releasing its safe prefix, and flushes the remainder before other events or completion/interruption.
  This masks secrets spanning consecutive provider deltas. `run_end` precedes `session_updated` so the desktop
  can reload the final transcript after clearing its running state.
  Tool activity and stored approval events also use the run-start redaction snapshot, so rotating/deleting a
  secret mid-run cannot expose its previous value through live events, replay or approval prompts.
- Routes:
  - `GET /api/health` → `{ ok: true, version, pid }`; `GET /api/status` → `{ version, provider: {id, kind, model},
    line: {enabled, running, webhookUrl}, mcp: [{name, enabled, connected, tools}], schedules: n }`.
  - `GET /api/agents` → `{agents: Agent[]}` (oldest first, ties by id); `GET /api/agents/:id` → `Agent`.
    `POST /api/agents` `{name, icon?, instructions?, provider?, model?, permissions?, connectors?, skills?}`
    → `201 Agent` (provider/model default to `config.active`); `PATCH /api/agents/:id` (subset of those fields)
    → `Agent`; `DELETE /api/agents/:id` → `{ok:true}` (409 for the last agent). Invalid fields return 400;
    unknown agents return 404. Deletion cancels and awaits its active runs, then cascades its sessions/messages/FTS,
    agent memory and jobs, and clears `line.agentId` when it points to that agent. Duplicate is GET then POST
    a copy named "<name> copy" in the client. See section 10 for field validation and ownership.
  - `GET /api/sessions?agent=<id>&q=&limit=` → `{ sessions: [{id, agentId, title, updatedAt, snippet?}] }`
    (no agent filter = all agents; with `q`: scoped FTS search); `POST /api/sessions` `{title?, agentId?}` → `{id}`
    (default first agent; 400 unknown agent); `GET /api/sessions/:id` → `{id, agentId, title, messages: Message[]}`;
    `DELETE /api/sessions/:id`; `POST /api/sessions/:id/messages` `{text}` → `202 {runId}` (`409` while a run is
    active; also `409 {error: 'connector <name> is off for this agent', connector: '<name>'}` for a slash command's required connector; invalid slash arguments return 400); `POST /api/sessions/:id/interrupt` → `{ok}`.
  - `POST /api/approvals/:id` `{allow: boolean}` → `{ok}` (`404` unknown or already decided).
  - `GET /api/settings` → `{ config: Config, secrets: { [name]: masked } }`. In the returned `config`, MCP `env` and
    `headers` values are masked unless they are pure `${NAME}` references; `secrets` lists every known secret name
    (each provider's `apiKeyEnv`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, plus any other name in `.env`)
    with `''` when unset; `PUT /api/settings` `{config}` (full
    config, validated, `400` on bad shape) → same shape as GET. An incoming MCP `env`/`headers` value equal to
    the masked form of its stored value preserves the original value. The same applies to any string leaf equal
    to the blanket-redacted form GET returned for that stored leaf, including workspace, prompts, hooks and URLs;
    restore these before validation. Explicit new values still apply (whole-config read-modify-write is safe).
    Array elements with an `id` (providers) match by id first; otherwise elements match by redacted content,
    preferring the same index then the first unused match, before falling back to index.
    If any restored string still contains `••••`, PUT returns
    `400 {error: "a masked value could not be restored; re-enter it"}` without saving, including an edited/moved element
    or a partial edit of a masked field.
    `line.agentId`, when supplied, must name an existing agent (400 otherwise). LINE and MCP changes apply live;
    API port changes apply on daemon restart.
    `PUT /api/secrets` `{name, value}` (`''` deletes)
    → `{name, masked}`.
  - `GET /api/mcp` → `{ servers: [{name, transport, enabled, connected, error?, tools?: [{name, selected}]}] }`;
    `POST /api/mcp` `{name, config: McpServerConfig}`; `PATCH /api/mcp/:name` `{enabled?, tools?}`;
    `DELETE /api/mcp/:name`; `POST /api/mcp/:name/test` → `{ok, tools, error?}`; `GET /api/mcp/:name/tools` →
    `{tools: [{name, description, selected}]}`.
    MCP server names must match `^[a-zA-Z0-9-]{1,32}$` at `POST /api/mcp`, `PUT /api/settings`, and CLI `mcp add`;
    invalid API input returns 400. REA is built in: `DELETE /api/mcp/rea` returns
    `400 {error: "rea is built in: disable it instead"}`; enable/disable is supported, and a full config without
    REA restores the built-in disabled entry.
    Connector POST/PATCH/DELETE operations read, validate and mutate the live config inside the daemon's
    serialized settings queue, so concurrent mutations compose instead of overwriting one another.
  - `GET /api/commands?agent=<id>` → `{commands: [{name, description, usage, kind}]}`; commands use the agent's skills (no agent = first agent; unknown agent = 400). See section 11 for slash expansion and REA.
  - `GET /api/skills` → `{skills: [{name, description, bundled?}]}`; `GET /api/skills/:name` → `{name, description, body}`;
    `PUT /api/skills/:name` `{description, body}`; `DELETE /api/skills/:name`. Bundled names refuse PUT/DELETE with `400 {error: 'built-in skill'}`; user folders with the same name take precedence when listing/loading.
  - `GET /api/memory?kind=&q=&agent=<id>` → `{notes: [{id, agentId, kind, text, updatedAt}]}`;
    `POST /api/memory` `{kind, text, agentId?}` (400 for agent-kind without a known agentId; user notes have
    `agentId:null`). Agent filters include shared user notes and only that agent's notes, subject to the kind filter;
    `PUT /api/memory/:id` `{text}`; `DELETE /api/memory/:id`.
  - `GET /api/schedules?agent=<id>` → `{jobs: [{id, agentId, cron, prompt, delivery, enabled, nextRunAt, lastRunAt?, lastStatus?}]}`;
    `POST /api/schedules` `{cron, prompt, delivery, agentId?}` (default first agent; `400` on a bad cron/unknown agent); `PATCH /api/schedules/:id` `{enabled}`;
    `DELETE /api/schedules/:id`.
  - `GET /api/line/status` → `{enabled, running, port, agentId, publicUrl?, webhookUrl?, tokenSet, secretSet, lastEventAt?,
    lastError?}`. LINE settings change through `/api/settings` (section `line`) and `/api/secrets`.
  Mutations without a more specific response above return `{ok:true}`. Memory create/update returns the note
  `{id,agentId,kind,text,updatedAt}`; schedule create returns `{id,agentId,cron,prompt,delivery,enabled}`. Missing resources return
  404. Deleting an active session returns 409; interrupt it first. An absent active run returns `{ok:false}` on
  interrupt. Memory ids are positive integers.

## 7. LINE gateway behaviour

- Own HTTP server on `127.0.0.1:<line.port>` (a tunnel exposes it); route `POST /line/webhook`. Webhook URL shown to
  the user = `<publicUrl>/line/webhook`.
- Body over 1 MiB → `413` (stop reading). Signature: base64 HMAC-SHA256 of the raw body with the channel secret,
  compared in constant time with `X-Line-Signature`; missing or wrong → `401`. Valid → `200` at once, events handled
  after. `events: []` (console verify) → 200.
- Dedupe by `webhookEventId` (bounded memory). Allowlists, deny by default: a 1:1 chat needs `source.userId` in
  `allow.users`; a group needs `groupId` in `allow.groups`; a room needs `roomId` in `allow.rooms`. Approval taps
  count only from `allow.users`. Strangers get no reply. `onMessage` receives the sender's `userId` so the runtime can
  raise `allow` tools to `ask` for senders outside `allow.users` (section 5, core-app).
- Sending: each chat keeps its latest unused reply token with its receive time. Any outgoing message uses that token
  if it is younger than ~55 s (`POST /v2/bot/message/reply`, single use); otherwise, or when reply fails (e.g. 400
  invalid/expired token), it falls back to `POST /v2/bot/message/push` (metered). Text is chunked at 4500
  characters, at most 5 messages per call (more chunks → further push calls).
- Slow response: if the answer is not ready after `slowResponseMs` (default 45000), the gateway uses the reply token
  to send a short "still working" text with a postback button "Get answer" (`data` = `get:<pendingId>`). The pending
  answer goes PENDING → READY when done → DELIVERED when the user taps the button (the tap's fresh reply token
  carries it). A tap while still PENDING replies "still working" with the button again.
- Approvals: `askApproval(to, text)` sends a confirm template (Allow / Deny postbacks `approve:<id>` /
  `deny:<id>`), resolved by the first tap from an allowlisted user (timeout 10 min = deny).
- One active run per chat; messages arriving meanwhile queue in order.

## 8. Desktop

- Tauri 2, `productName` `BigNose`, identifier `com.boombignose.bignose`, own icon generated with `pnpm tauri icon`
  from the committed source `desktop/app-icon.svg`; macOS `app` bundle only. UI = vanilla TypeScript compiled by `tsc` to
  `desktop/dist` (+ copied `index.html`, `style.css`), `withGlobalTauri` for `invoke`; no framework, no bundler.
- Sidecar: on start the Rust side takes the port from `<home>/daemon.json` when present, else config `api.port`
  (default 47821), and attaches only when `GET /api/health` with the token returns 200 (raw HTTP over `TcpStream` is
  enough); otherwise it spawns `node <core>/src/cli.ts daemon` (logs to `<home>/logs/daemon.log`) and waits up to
  15 s for that health check. The daemon is spawned with `PATH` = the login shell's `PATH` (taken by the same probe
  that finds node) with node's directory first, so `npx` (REA), hooks and shell commands work from a Finder launch. `<core>` = the bundled resource `core/` in the app
  (`bundle.resources` maps `../../core/src` and `../../core/package.json`), or the repo's `core/` in dev. Node =
  `$BIGNOSE_NODE`, else the login shell's `node`, else `/opt/homebrew/bin/node`, `/usr/local/bin/node`; it must be
  >= 24, otherwise the UI shows a clear error. A daemon the app spawned is stopped when the app quits; an attached
  one is left running. Command `daemon_info` → `{ port, token, spawned }` (token read from `<home>/api-token`). Commit
  `src-tauri/Cargo.lock`; a nested `desktop/.gitignore` covers `dist/`, `src-tauri/target/`, `src-tauri/gen/`.
- CSP allows `connect-src http://127.0.0.1:*`. All model and tool text is rendered as text (no `innerHTML` with
  untrusted content).
- Screens: **Chat** — session list with search, new chat, streaming answer, live tool activity (name, input,
  result, collapsible), Allow/Deny cards for approvals, stop button. **Settings** — Providers & models (masked keys,
  set/replace key, base URL, model, active provider), Connectors (MCP list, enable toggle, per-tool selection, add
  stdio/http, test; REA card with one-click enable), Messaging (LINE: token, secret, allowlists, port, public URL,
  enable, status, webhook URL), Skills, Memory, Schedules.
- Look: dark, modern, serious. No third-party product names in the app's own labels (names inside provider and
  connector pickers/cards are fine).

## 9. Success criteria → checks

| Criterion | Where |
|---|---|
| `pnpm install && pnpm -r typecheck && pnpm -r test` from a clean clone | root scripts, every stream |
| secret masking | `core/test/config.test.ts` |
| agent loop: multi-step tool chain, max turns | `core/test/agent/loop.test.ts` |
| both adapters parse streamed tool calls from recorded fixtures | `core/test/providers/*.test.ts` + `core/test/providers/fixtures/` |
| MCP client vs fake stdio server (initialize, tools/list, tools/call, error path) | `core/test/mcp/client.test.ts` |
| LINE: signature 200/401, allowlist, reply→push fallback, PENDING→READY→DELIVERED | `core/test/line/line.test.ts` |
| cron parse and next-run | `core/test/cron/cron.test.ts` |
| skills index and load | `core/test/skills/skills.test.ts` |
| memory FTS5 search | `core/test/store/store.test.ts` |
| local API rejects requests without the token; every section 6 route answers with the documented shape; a `tauri://localhost` preflight and an authenticated GET carry the CORS headers | `core/test/api/api.test.ts` |
| LINE senders outside `allow.users` get `allow` tools raised to `ask` | `core/test/api/api.test.ts` or `core/test/app/*.test.ts` |
| zero runtime deps / no SDKs | core-app acceptance: dependency + import guard |
| `bignose chat -q` tool round trip vs a mock OpenAI-compatible server | `core/test/e2e/chat.test.ts` |
| `bignose mcp test rea` lists ≥ 100 tools (skipped with `BIGNOSE_SKIP_NETWORK=1`) | `core/test/e2e/rea.test.ts` + acceptance |
| `pnpm --filter desktop tauri build --bundles app` → `BigNose.app`, CFBundleName `BigNose` | desktop acceptance |

Note: the BBN harness runs checks with `CI=1`, which the Tauri CLI rejects (`--ci` wants true/false), so the build
check sets `CI=true` itself.

## 10. Agents

```ts
// core/src/types.ts (added)
export interface Agent {
  id: string;                              // random, e.g. 'ag_' + 12 hex chars
  name: string;                            // 1..64 chars after trim
  icon: string;                            // short text, usually one emoji; 1..16 UTF-16 units; default '🤖'
  instructions: string;                    // the agent's system prompt; '' = the built-in default prompt
  provider: string; model: string;         // a ProviderConfig.id and a model name
  permissions: Record<string, Policy>;     // over config.permissions (agent entries win), same key rules
  connectors: string[] | null;             // MCP server names the agent uses; null = every enabled server
  skills: string[] | null;                 // skill names the agent sees; null = every skill
  createdAt: number; updatedAt: number;    // epoch ms
}
// LineConfig gains: agentId?: string     // the agent that answers LINE; absent or unknown = the first agent
```

- **Store** (`core/src/store/`): table `agents` (JSON columns for permissions/connectors/skills). `listAgents()` (oldest
  first), `getAgent(id)`, `createAgent(input)`, `updateAgent(id, patch)`, `deleteAgent(id)` (one transaction: the
  agent's sessions with their messages and search index, its agent-memory notes and its jobs go with it),
  `ensureDefaultAgent(defaults)`: when no agent exists, create `{name: 'BigNose', icon: '🤖', instructions:
  config.agent.systemPrompt ?? '', provider/model: config.active, permissions: {}, connectors: null, skills: null}`;
  then give every row without an agent (sessions, agent notes, jobs from before agents existed) to the first agent.
  For a pre-agents database, add each missing `agentId` column idempotently without dropping existing rows; test opening the old schema, preserving its sessions/messages/memory/jobs, assigning orphan rows and reopening.
  The "first agent" = oldest `createdAt` (ties: id). Sessions, agent-kind memory notes and jobs get an `agentId`.
  `createSession({title?, origin, agentId})`, `listSessions({limit?, agentId?})`, `findSessionByOrigin(origin, agentId)`
  (one session per LINE chat per agent), `searchMessages(query, limit?, agentId?)`, `listMemory(kind?, agentId?)` and
  `searchMemory(query, limit?, kind?, agentId?)` (user notes are shared and always included; agent notes only for that
  agent), `addMemory(kind, text, agentId?)` (agent kind needs an agentId).
- **Runtime** (`core/src/app/`): every run uses its session's agent: provider + key from `agent.provider` (unknown
  provider → run_end error naming it), `model = agent.model`, system prompt = `agent.instructions` or the default +
  user notes + this agent's notes + the index of the agent's skills + today's date; tools = builtin + memory tools and
  `session_search` scoped to the agent + skill tools limited to the agent's skills + schedule tools (new jobs get the
  agent's id) + MCP tools of servers that are enabled and in `agent.connectors` (null = all enabled); permissions =
  `{...config.permissions, ...agent.permissions}` (then the LINE non-owner raise to `ask`). LINE messages go to
  `line.agentId` (fallback: first agent). A cron job runs with its own agent. Unknown connector or skill names in an
  agent are ignored at run time.
- **API** (§6 additions; every timestamp is epoch ms):
  - `GET /api/agents` → `{agents: Agent[]}`; `GET /api/agents/:id` → `Agent` (404 unknown).
  - `POST /api/agents` `{name, icon?, instructions?, provider?, model?, permissions?, connectors?, skills?}` → `201
    Agent` (provider/model default to `config.active`). `PATCH /api/agents/:id` (any subset of those fields) → `Agent`.
    400 on a bad shape: name length, icon length, provider not configured, empty model, a policy that is not
    allow/ask/deny, connectors/skills not `null` or an array of names.
  - `DELETE /api/agents/:id` → `{ok: true}`; `409 {error}` when it is the last agent; cascades as in the store; clears
    `line.agentId` when it pointed at that agent.
  - Duplicate is client-side (GET the agent, POST a copy named "<name> copy"); no route.
  - Sessions: `GET /api/sessions?agent=<id>&q=&limit=` (no `agent` = all agents); `POST /api/sessions {title?, agentId?}`
    (default: first agent; 400 unknown agent); sessions in lists and `GET /api/sessions/:id` carry `agentId`.
  - Memory: `GET /api/memory?kind=&q=&agent=<id>`; `POST /api/memory {kind, text, agentId?}` (400 when kind is `agent`
    without a known agentId); notes carry `agentId` (null for user notes).
  - Schedules: jobs carry `agentId`; `POST /api/schedules {cron, prompt, delivery, agentId?}` (default first agent).
  - Settings: `line.agentId` validated on `PUT /api/settings` (unknown id → 400). `GET /api/line/status` adds the
    effective `agentId`.
- **Tests** (no network): `core/test/agents/store.test.ts` (CRUD, default agent created once, orphan rows assigned,
  cascade delete, scoped sessions/memory/search), `core/test/api/agents.test.ts` (every route above incl. 400/404/409,
  agents persisted across a daemon restart on the same `BIGNOSE_HOME`, `line.agentId` validation and clearing),
  `core/test/app/agent-runtime.test.ts` (two agents with different instructions, provider/model, permissions,
  connectors and skills: a scripted mock provider records each request and sees the right model, system prompt and
  tool list; agent notes isolated, user notes shared; a LINE message is answered by `line.agentId`).


## 11. Slash commands and `/rea` (stream `slash-rea`)

- **Module** `core/src/commands/index.ts`:
  - `listCommands(skills: SkillInfo[])` → `[{name, description, usage, kind: 'builtin' | 'skill'}]`: the built-in
    `rea` (`usage: '/rea <app or file path>'`) first, then one per skill (`usage: '/<name> [request]'`); a skill named
    like a built-in is not listed.
  - `expandSlash(text, skills, {cwd})` → `null` when the text is not a command: it must match
    `^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$` and name a listed command (so `/Users/x …` or `/foo` stay plain
    text). Otherwise `{command, skills: string[], connectors: string[], prompt: string, target?: string}` or
    `{error: string}`:
    - `/rea <path>`: the path (quotes trimmed, `~` expanded, relative to `cwd`) must exist, else `{error: 'not found:
      <path>'}`; no path → `{error: 'usage: /rea <app or file path>'}`. Result: `connectors: ['rea']`,
      `skills: ['reverse-engineer-anything']`, `target` = the absolute path, and a prompt that names the target and asks
      for a Markdown report with evidence (tool + location for each claim): app type, process/bundle layout (for
      Electron: main / preload / renderer), IPC channels, screens and routes, the local API it calls, and what is
      unknown. The prompt also says the REA tools are already connected, so no REA setup, doctor or `npx` commands.
    - `/<skill> [request]`: `skills: [name]`, `connectors: []`, prompt = the request, or `Use the <name> skill.`.
- **Bundled skill**: `core/src/skills/bundled/reverse-engineer-anything/` = an unmodified copy of
  `skills/reverse-engineer-anything/` from the `rea-agents@6.1.0` npm package (`SKILL.md` + `references/`) plus that
  package's MIT `LICENSE` in the same folder. (Under `core/src` so the desktop bundle, which ships `core/src`, carries
  it.) Skills seen by the app = user skills in `<home>/skills` + bundled skills; a user skill with the same name wins.
  `skill_load` and `GET /api/skills/:name` load bundled skills; `GET /api/skills` marks them `bundled: true`;
  `PUT`/`DELETE /api/skills/<bundled name>` and `skill_save` on a bundled name → 400 / error `built-in skill`.
- **Runtime**: the message path (`POST /api/sessions/:id/messages`, LINE, cron) expands slash commands. Before the run
  starts, every connector the command needs must be on for the session's agent (server enabled and in
  `agent.connectors` when that is a list). If one is off, no run starts: the API answers `409 {error: 'connector <name>
  is off for this agent', connector: '<name>'}` (the desktop asks the user, turns it on, and sends again); LINE gets a
  short text saying to turn it on in the app. Otherwise the run waits until those servers are connected (a cold `npx`
  start can take up to 180 s; a failure ends the run with `error`), then sends the model one input message:
  `<skill name="NAME" folder="ABS_DIR">BODY</skill>` for each skill (plus its other file names), a blank line, then the
  prompt. The transcript keeps the user's original slash text (that is what the chat shows); the model context keeps
  the expanded message. REA tools keep their `ask` policy unless the agent's permissions allow them.
- **Report**: when a `/rea` run ends `done` with non-empty text, save the text to
  `<home>/reports/rea-<target basename, lowercase, [a-z0-9-] only>-<YYYYMMDD-HHmmss>.md` (dir 0700, file 0600) and emit
  `{type: 'notification', title: 'Report saved', body: '<absolute path>', sessionId}`.
- **API**: `GET /api/commands?agent=<id>` → `{commands: [{name, description, usage, kind}]}` (skills limited to the
  agent's skills; no `agent` = first agent).
- **Tests**: `core/test/commands/slash.test.ts` (no network: listing; `/rea <path>` → connector `rea` on + skill
  `reverse-engineer-anything` loaded + the target in the prompt; usage and not-found errors; plain text cases;
  `/<skill>`; bundled skill listed, loadable, user override wins, write/delete refused; `GET /api/commands`; `POST
  …/messages` with `/rea` while REA is off → 409 + `connector`; with a fake stdio MCP server configured as `rea` and
  turned on for the agent, the first provider request carries the skill body and the target, the transcript shows the
  slash text, the report file is saved and the notification event is sent).
  `core/test/e2e/rea-flow.test.ts` (network): skipped with `BIGNOSE_SKIP_NETWORK=1`, and skipped when the target is
  missing; target = `BIGNOSE_REA_TARGET` or
  `~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app/Contents/Resources/app.asar`. Temp home; an agent
  "Hermes Reverser" with `connectors: ['rea']` and `permissions: {'mcp__rea__*': 'allow'}`; a mock OpenAI-compatible
  server scripted to call REA `open_binary` on the target, then `analyze_javascript_application` with
  `input_path: <target>.unpacked/dist/node_modules/node-pty/lib/shared`, `format: 'directory'` (build arguments from
  the input schema the real server lists), then answer with an explicitly partial report;
  BigNose's own MCP client runs the real REA (`npx -y rea-agents@6.1.0 mcp`) through `/rea <target>`. Pass = run
  status `done`, the session transcript holds both REA tool results, not errors and not empty, and the report file
  exists.
  The installed Hermes fixture's whole-ASAR analysis refuses an integrity mismatch in
  `dist/node_modules/node-pty/prebuilds/darwin-arm64/pty.node` (observed 2026-10-14). REA has no scope/exclusion
  argument for ASAR analysis. The full node-pty `lib` graph also exceeds REA's 10 MiB stdio response budget.
  The selected shipped JavaScript scope contains `conout.js`; the test verifies its SHA-256 against the original
  ASAR header before analysis and asserts actual parsed JavaScript and graph evidence. A real call through
  BigNose's MCP client verified this scope succeeds. The app is never changed or repackaged, and integrity checks
  stay enabled. This checks the agent/tool/report flow on a trusted JavaScript entry; it does not establish the
  full Hermes layout or runtime behavior. The owner's manual run must keep the whole-ASAR integrity limitation
  explicit rather than treating the native file or unexamined app features as verified.

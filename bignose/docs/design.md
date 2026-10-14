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
  `BIGNOSE_HOME` to a fresh `mkdtemp` dir; servers listen on port 0 (the test helper `testHome` sets
  `BIGNOSE_TEST_PORTS=0`; the daemon then binds the API on port 0, and LINE on port 0 when it is the default 47822, so
  first-run tests without a config file never bind 47821/47822); never read `~/.bignose`, never use real keys.
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
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown>;        // arguments complete
      error?: string }                                                                      // set when they were malformed: input is {} and the loop answers the call with this error
  | { type: 'done'; stopReason: StopReason; usage: Usage };
export interface Provider { readonly kind: ProviderKind; stream(req: ProviderRequest): AsyncIterable<ProviderEvent> }

// ---- tools and permissions
export type Policy = 'allow' | 'ask' | 'deny';
export interface Agent {
  id: string; name: string; icon: string; instructions: string; provider: string; model: string;
  maxTokens?: number;
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
  | { type: 'run_end'; status: RunStatus; text: string; error?: string; warning?: string };   // warning: section 16.2

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
    `ollama` (openai-compatible, label `Ollama (local)`, `http://127.0.0.1:11434/v1`, optional `OLLAMA_API_KEY`, 32768).
  - active `{ provider: 'ollama', model: 'qwen3:4b' }`; agent `{ maxTurns: 30, workspace: <os home>,
    compactAt: 0.8 }`; permissions `{}`; hooks `{}`; api `{ port: 47821 }`.
  - mcp.servers: `rea` = `{ transport: 'stdio', command: 'npx', args: ['-y', 'rea-agents@6.1.0', 'mcp'], enabled: false }`.
  - line: `{ enabled: false, port: 47822, slowResponseMs: 45000, allow: { users: [], groups: [], rooms: [] } }`.

## 5. Module contracts

### core-agent
- `providers/index.ts`: `createProvider(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl = fetch, retry?: Partial<RetryOptions>): Provider`
  (retries and error text: section 15).
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
  - Non-2xx: throw an `Error` (a `ProviderError`) `Provider HTTP <status>: <message>` with the message of the JSON error body only,
    redacted and cut (section 15). Tool names sent to providers must match `^[a-zA-Z0-9_-]{1,64}$`.
- `agent/loop.ts`: `runAgent(opts: RunOptions): Promise<RunResult>` with
  `RunOptions = { provider, model, system, context: Message[], input: string, tools: Tool[], maxTurns, maxTokens,
  contextWindow, compactAt, permissions: Record<string, Policy>, hooks: HooksConfig, approve?: Approver,
  sessionId, origin: Origin, cwd, signal: AbortSignal, onEvent?: (e: AgentEvent) => void, onMessage?: (m: Message) => void /* section 16.1 */, depth?: number }` and
  `RunResult = { context: Message[] /* new model context, compacted if needed */, added: Message[] /* transcript
  messages of this run, input included */, status: RunStatus, text: string, usage: Usage, error?: string, warning?: string }`.
  - One turn = one provider call. Tool calls of a turn run in order; every `tool_use` gets a `tool_result`
    (errors, denials and interrupts included) so the context stays valid. A call with an unknown or illegal name or with
    malformed arguments gets an error result the model can fix; the run goes on (section 15).
  - Max turns: stop with `max_turns` after `maxTurns` provider calls. Interrupt: `signal` aborts the provider call and
    the running tool; status `interrupted`. Provider errors: status `error`, never a throw.
  - Compaction: before a provider call, when the estimated request (the larger of the last `usage.inputTokens` and
    chars/4 of system prompt + tool schemas + messages) exceeds `(contextWindow - maxTokens) * compactAt` (the reply budget
    is kept free; it never reserves more than half the window), summarise all but the recent tail (never split a tool_use
    from its tool_result) with one provider call without tools, replace them with one user message
    `[Summary of earlier conversation]\n…`, emit `compaction`. Tool results inside the summary request are cut to 2000
    characters each. Tool results too large to summarise away are pruned, and a context-length error from the provider
    triggers a compaction and one more try (section 15).
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
  result), `close()`. Text tool results are redacted then capped at 100 kB including a truncation note,
  preserving UTF-8 character boundaries before entering model context. Transports: stdio (spawn, newline-delimited JSON, stderr kept for errors, kill on close) and
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
  `deleteSession(id)`, `setTitle(id, title)`, `appendMessages(id, msgs: Message[])` → new row ids (transcript; indexes the text),
  `updateMessages(ids, msgs)` (rewrites rows whose content changed, index included), `addNotice(id, level, text)`, `getNotices(id)` (section 16),
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
  (when enabled and both secrets set), the API server; write `daemon.json` with the **bound** port (`api.port: 0` and
  `line.port: 0` mean ephemeral ports, used by tests; the test helper `testHome` sets `BIGNOSE_TEST_PORTS=0`, so the
  daemon binds the API on port 0, and LINE on port 0 when it is the default 47822, so first-run tests without a config
  file never bind 47821/47822); apply settings changes live (LINE restart, MCP update); clean shutdown on
  SIGINT/SIGTERM.
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
  - `POST /api/doctor` → `{code, lines}`; runs cleaned diagnostics for the daemon's home (section 14.2).
  - `GET /api/agents` → `{agents: Agent[]}` (oldest first, ties by id); `GET /api/agents/:id` → `Agent`.
    `POST /api/agents` `{name, icon?, instructions?, provider?, model?, permissions?, connectors?, skills?}`
    → `201 Agent` (provider/model default to `config.active`); `PATCH /api/agents/:id` (subset of those fields)
    → `Agent`; `DELETE /api/agents/:id` → `{ok:true}` (409 for the last agent). Invalid fields return 400;
    unknown agents return 404. Deletion cancels and awaits its active runs, then cascades its sessions/messages/FTS,
    agent memory and jobs, and clears `line.agentId` when it points to that agent. Duplicate is GET then POST
    a copy named "<name> copy" in the client. See section 10 for field validation and ownership.
  - `GET /api/sessions?agent=<id>&q=&limit=` → `{ sessions: [{id, agentId, title, updatedAt, snippet?}] }`
    (no agent filter = all agents; with `q`: scoped FTS search); `POST /api/sessions` `{title?, agentId?}` → `{id}`
    (default first agent; 400 unknown agent); `GET /api/sessions/:id` → `{id, agentId, title, messages: Message[], notices: Notice[], live: LiveTurn | null}` (section 16);
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

- Tauri 2, `productName` `BigNose`, identifier `com.boombignose.bignose`, own icon regenerated with
  `pnpm --filter desktop tauri icon src-tauri/icons/source/boombignose-1024.png` from the committed source
  `desktop/src-tauri/icons/source/boombignose-1024.png`; macOS `app` bundle only. UI = vanilla TypeScript compiled by `tsc` to
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
  it.) Skills seen by the app = user skills in `<home>/skills` + bundled skills; a valid user skill with the same name wins; a broken same-named user skill falls back to the bundled folder when loading as well as listing.
  `skill_load` and `GET /api/skills/:name` load bundled skills; `GET /api/skills` marks them `bundled: true`;
  `PUT`/`DELETE /api/skills/<bundled name>` and `skill_save` on a bundled name → 400 / error `built-in skill`.
- **Runtime**: the message path (`POST /api/sessions/:id/messages`, owner LINE, cron) expands slash commands.
  Non-owner LINE senders receive plain-text handling, without slash validation, connector checks or skill body expansion. Before the run
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
  ASAR header before analysis and asserts actual parsed JavaScript and non-empty graph evidence.
  Results over 100 kB are a UTF-8-safe prefix plus a truncation note; this test checks retained path/statistics/graph
  evidence without claiming the clipped text is complete JSON or the whole graph was retained. A real call through
  BigNose's MCP client verified this scope succeeds. The app is never changed or repackaged, and integrity checks
  stay enabled. This checks the agent/tool/report flow on a trusted JavaScript entry; it does not establish the
  full Hermes layout or runtime behavior. The owner's manual run must keep the whole-ASAR integrity limitation
  explicit rather than treating the native file or unexamined app features as verified.


## 12. Desktop: agents, slash picker, e2e (stream `agents-desktop`)

- **Agents screen** (`#/agents`, in the left nav): list (icon, name, provider · model, a badge on the LINE agent);
  create; edit (name, icon, instructions, provider + model from the configured providers, tool permissions as rows of
  tool name or `prefix*` + allow/ask/deny, connectors "All" or a pick list from `GET /api/mcp`, skills "All" or a pick
  list from `GET /api/skills`, "Answers LINE" which writes `line.agentId` through settings); duplicate (client-side
  copy); delete with a confirm that says sessions, agent notes and schedules go with it (the last agent cannot be
  deleted).
- **Chat**: pick the agent; the session list and search show that agent's sessions; a new chat belongs to it.
- **Slash picker**: typing `/` at the start of the chat box opens the list from `GET /api/commands?agent=`, filtered as
  you type; arrow keys, Enter or Tab pick, Esc closes; mouse works too. Sending `/rea <path>` that gets `409` with
  `connector` shows a confirm "Turn on <connector> for <agent>?"; yes → `PATCH /api/mcp/<name> {enabled: true}` when it
  is off globally and `PATCH /api/agents/:id` adding it when the agent's connectors are a list, then send again.
  A `notification` event for the session shows as a system line in the chat (e.g. the saved report path).
- **Memory / Schedules**: an agent filter / column; new agent notes and schedules pick an agent.
- **Digest**: `docs/reverse/hermes-desktop.md`, short (about 150 lines max): what Hermes Desktop is (Electron), its
  main / preload / renderer layout, IPC channel groups, screens and routes (incl. Messaging → LINE), the local API it
  calls, and what BigNose took or simplified, each point pointing at the note it comes from. No copied code.
- **e2e** `desktop/e2e/agents-rea.e2e.ts`, script `e2e` in `desktop/package.json` (not part of `test`): start the real
  daemon (`node core/src/cli.ts daemon`, temp `BIGNOSE_HOME`, `api.port: 0`, read the bound port from `daemon.json`),
  a mock OpenAI-compatible provider (scripted: call `mcp__rea__open_binary`, then `mcp__rea__analyze_javascript_application`,
  then a final message), and a fake REA stdio MCP server (a fixture with those two tools) configured as
  `mcp.servers.rea`, so the e2e needs no network (the real REA is covered by `slash-rea`). Drive the built UI
  (`desktop/dist`, served by a tiny local static server) in the installed Google Chrome, headless, over the Chrome
  DevTools Protocol with Node's built-in `WebSocket` (no Playwright, no new dependency); `BIGNOSE_CHROME` overrides the
  browser path. Stub `window.__TAURI__` with `Page.addScriptToEvaluateOnNewDocument` so `daemon_info` returns the
  test daemon's port and token, and start Chrome with a temp `--user-data-dir` and `--disable-web-security` (CORS is
  covered by the core API tests). Flow: Agents → create "Hermes Reverser" → edit its icon and instructions, verify persisted values through GET /api/agents/:id → duplicate it, verify the copy has matching instructions → delete the copy, verify it is absent from GET /api/agents → Chat with it → type `/` → the picker
  lists `rea` → send `/rea <existing fixture path>` → confirm turning REA on → Allow the tool approvals → the chat
  shows tool activity for both tools and the final message, and `GET /api/agents` lists the new agent. Kill Chrome,
  the daemon and the servers on exit; non-zero exit on failure.

Desktop integration notes (2026-10-14): settings read-modify-write saves are serialized in the API client.
Deleting a user connector clears only its own hex-named secrets unreferenced by other connectors or providers.
The chat and Providers page edit the selected agent with PATCH; config.active only seeds new agents.
The desktop e2e reloads with a pending tool approval and verifies the SSE replay restores Stop and Allow/Deny.

## 13. Agents on any model, Ollama first, LINE connect and the BoomBigNose icon (owner update 2026-10-14)

Owner requests (verbatim, in order): "create app bignose and can connect with line and can create agents using fable5.1
xhigh"; "not building fable 5 agent let user can agent with any model inside"; "note that we will use line not use
anthropic since user can use ollama first"; "change logo bignose app to boombignose logo, find it in my github profile
logo".
Meaning: the main path is LINE plus a local model through Ollama. A fresh install talks to Ollama on this Mac with no key
and no setup beyond Ollama itself. The user creates agents on any configured provider and any model id (free text with
suggestions from the provider's model list, and a clear message when Ollama is not running or has no models). BigNose
explains Ollama's context size and warns when it is too small. The LINE connection can be set up and checked from the
app. The app icon is the owner's BoomBigNose logo. This run also ships five LINE gap fixes and four v1 final-review
follow-ups. The Anthropic adapter stays as v1.
Non-goals: model-specific agents, defaults beyond the Ollama preset, or request logic; per-agent effort; Anthropic
thinking replay, refusal or model-limit work; Ollama's native API (`/api/chat`, per-request `num_ctx`); pulling models or
starting/managing the Ollama server; other messaging platforms, LINE media, voice, code signing.

### 13.1 Shared types (`core/src/types.ts`), additions
```ts
// Agent gains: maxTokens?: number     // optional; absent = the provider's setting
```
Section 3 of this file is updated to match `types.ts` verbatim. `desktop/src/types.ts` mirrors the core shapes (no
effort, no thinking blocks, no `refused` status).

### 13.2 Model lists (`core/src/providers/models.ts`, new)
```ts
export interface ModelInfo { id: string; label?: string }
export function listModels(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]>;
```
- openai-compatible: `GET {baseUrl without trailing slashes}/models`, `Authorization: Bearer <key>` only when the key is
  non-empty; result = `data[].id` (string ids only, in the server's order).
- anthropic: `GET {baseUrl}/v1/models?limit=1000` with `x-api-key` and `anthropic-version: 2023-06-01`; `id`, and
  `display_name` as `label`; first page only.
- 15 s timeout, `redirect: 'error'` (like every v1 keyed call, `core/test/api/redirect.test.ts`), so a redirect can never
  carry a key to another origin.
- Failures throw an Error whose message never contains the key (masked as in v1) and has no trailing period (the desktop
  wraps it in a sentence):
  - Ollama provider (13.3) with no HTTP answer (refused, DNS, timeout):
    `Ollama is not running at <origin> (start it with "ollama serve" or open the Ollama app)`
  - Ollama provider and an empty list: `Ollama has no models yet (install one with "ollama pull qwen3:4b")`
  - other providers: no HTTP answer -> `Could not list models: <reason>`; empty list -> `The provider returned no models`
  - any provider: non-2xx -> `Could not list models: <status> <body, at most 200 chars>`; a body whose `data` is neither
    an array nor `null` -> `Could not list models: unexpected response`. `data: null` is an empty list (Ollama answers
    `{"object":"list","data":null}` when nothing is installed).

### 13.3 Ollama (`core/src/providers/ollama.ts`, new, and `core/src/config.ts`)
```ts
export const OLLAMA_DEFAULT_MODEL = 'qwen3:4b';
export function isOllama(cfg: ProviderConfig): boolean;  // openai-compatible and (id 'ollama' or base URL port 11434)
export const OLLAMA_CONTEXT_NOTE: string;                // text below
export function ollamaWarnings(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string[]>;
```
- Default config (`defaultConfig()`): the `ollama` entry becomes `{ id: 'ollama', kind: 'openai-compatible', label:
  'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY', contextWindow: 32768 }` (the list
  order and the other entries stay as v1) and `active` becomes `{ provider: 'ollama', model: OLLAMA_DEFAULT_MODEL }`.
  The key is optional: unset sends no `Authorization` header (v1 adapter rule), and neither the doctor nor the desktop
  treats an unset Ollama key as a problem. A stored config keeps its own providers and active model (v1 merge: stored
  arrays replace the defaults), so existing installs do not change.
- `OLLAMA_CONTEXT_NOTE` (exact text):
  `Ollama picks its own context size (OLLAMA_CONTEXT_LENGTH, only 4096 tokens on machines with less than 24 GB of GPU memory) and cuts longer prompts without an error. For agents, start Ollama with OLLAMA_CONTEXT_LENGTH=32768 ollama serve (for the Ollama app: launchctl setenv OLLAMA_CONTEXT_LENGTH 32768, then restart the app) and keep Context window here at or below that number. ollama ps shows the size in use.`
- `ollamaWarnings`: `GET <origin>/api/ps` (origin of the base URL, 2 s timeout, `redirect: 'error'`, Bearer only with a
  key). No HTTP answer -> `[<the "not running" text of 13.2>]`. For each loaded model in `models[]` whose
  `context_length` is a number below the provider's context window (`contextWindow ?? 128000`):
  `Ollama is running <name> with a <n>-token context, below this provider's Context window (<cw>). Restart Ollama with OLLAMA_CONTEXT_LENGTH=<cw>, or set Context window to <n>.`
  A non-2xx answer, a body that is not the expected JSON, or no loaded model -> `[]`. It never throws. (Ollama only
  reports the context size of a loaded model; the note covers the rest.)
- First run (daemon start, 13.6): with no config file and no agents yet and an Ollama active provider, the daemon lists Ollama's
  models (2 s timeout). When the list has models and none is `qwen3:4b`, it sets
  `active.model` to the first listed id that starts with `qwen3:` (for example `qwen3:14b`), else to the first
  listed id, and saves the config before the default agent is created. Any failure keeps
  `qwen3:4b`; a chat then shows Ollama's own error (`model "qwen3:4b" not found, try pulling it first`).

### 13.4 OpenAI-compatible adapter (`core/src/providers/openai.ts`)
v1 already speaks Ollama's OpenAI-compatible API; this run pins that with tests. Fixture
`core/test/providers/fixtures/ollama-tools.sse` = a copy of
`/Users/boombignose/orca/projects/bignose/.git/bbn/briefs/ollama-tools.sse` (a real Ollama 0.40.4 stream for qwen3:14b,
trimmed): `delta.reasoning` chunks (the model's thinking; never shown or stored), two complete tool calls with `index` 0
and 1, each in one chunk with `content: ""`, a `finish_reason: "tool_calls"` chunk, a last chunk with `choices: []` and
`usage`, then `[DONE]`. Expected events: `tool_call_start` and `tool_call` for both calls in index order with parsed
inputs (`{"city":"Tokyo"}`, `{"city":"Paris"}`), then `done` with `tool_use` and usage 141/154; no `text_delta`.
A second test pins the request for a keyless Ollama provider: no `Authorization` header, `stream_options.include_usage`,
and a finished tool round sent as an assistant message with `content: null` + `tool_calls` followed by a `role: "tool"`
message with `tool_call_id` (the hub checked that a local Ollama 0.40.4 accepts this shape and answers). An adapter
change needed to pass is in scope; nothing else in the adapter changes.

### 13.5 Agent loop
Unchanged. The loop already sends `maxTokens` from its options; per-agent max tokens is set in the runtime (13.6).

### 13.6 Agents on any model (store, API, runtime, doctor)
- Store: the `agents` table gains a nullable `max_tokens` column, added idempotently on open (`ALTER TABLE agents ADD
  COLUMN` when missing). Old agents load without `maxTokens`. `createAgent`/`updateAgent` persist it; a PATCH with `null`
  clears it.
- API: `POST`/`PATCH /api/agents` accept `maxTokens` (an integer 1-1000000 or `null`, else 400 `invalid maxTokens`);
  `model` is any string of 1-200 characters without control characters (else 400 `invalid model`). There is no effort
  field. Agent JSON includes `maxTokens` when set.
- `GET /api/providers/:id/models` -> 200 `{ ok: true, models: ModelInfo[] }`, or 200 `{ ok: false, error, models: [] }`
  with the 13.2 text (masked) when the list call fails or is empty; unknown provider -> 404. It uses the provider's saved
  key from `.env`.
- `GET /api/providers/:id/status` -> 200 `{ note?: string, warnings: string[] }`: an Ollama provider gets
  `note: OLLAMA_CONTEXT_NOTE` and `warnings: await ollamaWarnings(...)`; other providers get `{ warnings: [] }`;
  unknown provider -> 404.
- Runtime profile: `maxTokens = agent.maxTokens ?? provider.maxTokens`; when that is set it also goes into the profile's
  provider config copy, so the openai-compatible adapter sends `max_tokens` (v1 sends it only when the provider config
  sets it); when unset v1 stays (`8192` for anthropic, no `max_tokens` for openai-compatible).
- Daemon: the first-run Ollama model pick of 13.3, with the daemon's injectable fetch.
- `bignose doctor` (may become async): for an Ollama active provider there is no key warning; it adds
  `ok Ollama has <n> models` or `warn <13.2 text>`, one `warn <text>` per `ollamaWarnings` entry, and
  `note <OLLAMA_CONTEXT_NOTE>`. Warnings and notes do not change the exit code. The calls use the timeouts above, so
  doctor never hangs.
- Tests never reach a real Ollama: the default base URL `127.0.0.1:11434` is replaced by a fake server or a closed port
  in every test that runs the doctor or starts a daemon on a fresh home.

### 13.7 LINE connect
Helpers in `core/src/line/` (no gateway instance needed):
```ts
export interface LineApiOptions { accessToken: string; fetchImpl?: typeof fetch; apiBase?: string } // default https://api.line.me
export function lineBotInfo(o: LineApiOptions): Promise<{ displayName: string; basicId: string; pictureUrl?: string }>; // GET  /v2/bot/info
export function setLineWebhook(o: LineApiOptions, endpoint: string): Promise<void>;                                     // PUT  /v2/bot/channel/webhook/endpoint {endpoint}
export function testLineWebhook(o: LineApiOptions, endpoint: string): Promise<{ success: boolean; statusCode?: number; reason?: string; detail?: string; timestamp?: string }>; // POST /v2/bot/channel/webhook/test {endpoint}
export function publicUrlProblem(url: string): string | undefined; // undefined = usable: https only, no user/password, no query or fragment, at most 480 characters
export function webhookUrlFor(publicUrl: string): string;          // publicUrl without trailing slashes + '/line/webhook'
```
Each call has a 15 s timeout; failures throw `LINE <path> failed: <status> <body, at most 200 chars>` with the access
token and channel secret masked, as the gateway's own calls do.

Health: the LINE listener answers `GET /line/webhook/health` with 200 and JSON `{"ok":true}` (no auth, no secrets, no
state); other methods on that path get 405. `/line/webhook` stays POST-only.

Local API (the daemon reads the token from `.env` and passes `lineOptions.fetchImpl`/`apiBase` through for tests):
- `POST /api/line/connect` -> 200
  `{ ok, bot?: { displayName, basicId }, webhookUrl?, steps: [{ name: 'token', ok, detail }, { name: 'webhook', ok, detail }] }`
  - token: no saved token -> `Save the channel access token first.`; else `lineBotInfo` -> ok with
    `Connected to <displayName> (<basicId>)`; failure -> the masked error.
  - webhook: token step failed -> `Fix the token first.`; no public URL -> `Set a public HTTPS URL first.`;
    `publicUrlProblem` -> its text; else `setLineWebhook(webhookUrlFor(publicUrl))` -> ok with `Webhook set to <url>`;
    failure -> the masked error. `ok` is true only when both steps are ok.
- `POST /api/line/test` -> 200 `{ ok, running, statusCode?, reason?, detail }`: token, public URL and local listener are
  checked first (same texts as above; listener off -> `The LINE listener is not running. Turn LINE on, save, then test
  again.`), then `testLineWebhook(webhookUrlFor(publicUrl))`; `ok` = LINE's `success`; `detail` = LINE's detail or
  reason. Neither route ever returns the token or the secret.
- `GET /api/line/status` (v1 fields) gains `healthUrl?` (`<publicUrl>/line/webhook/health`) and `warnings: string[]`:
  `Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.` when all three allowlists are empty, and the
  `publicUrlProblem` text when the stored public URL has one.
- `PUT /api/settings`: trim `line.publicUrl` before validation and storage; Connect and Test also trim stored URLs.
  A non-empty `line.publicUrl` that differs from the trimmed stored value must pass `publicUrlProblem`
  (400 with its text); an unchanged stored value always passes, so the other settings screens (which save the whole
  config) keep working with an old http URL stored. Loading a stored config is not stricter than v1 (an old http URL
  still loads; status warns and Connect refuses it).

Desktop Messaging page (`desktop/src/settings/messaging.ts`, client calls in `desktop/src/api.ts`):
- Status card: `Enabled`/`Disabled`, `Local listener running`/`Local listener stopped`, the webhook URL with Copy, the
  health URL hint (`Open <healthUrl> in a browser to check your tunnel.`), and each warning.
- Buttons `Connect` (POST /api/line/connect) and `Test webhook` (POST /api/line/test). Each shows its result as text:
  one line per step (ok or failed + detail), the bot name and basic ID after a good token step, LINE's status code and
  detail after a test. A button is disabled while its request runs. Text only, never innerHTML.
- Form: the public URL must start with `https://` (inline error, Save blocked); the slow-response time is edited in
  seconds (1-50, saved as `slowResponseMs = seconds * 1000`) with the help text
  `Up to 50 seconds, so LINE's reply token is still valid.`; a note that Save does not prove the token or the tunnel
  work: use Connect and Test webhook.

### 13.8 LINE gateway fixes (Hermes LINE gap report, section 4)
1. Cached answers resume: a `Pending` answer remembers how many messages were already delivered; a failed batch keeps
   that progress; the next `Get answer` tap sends only the unsent remainder; the state becomes `DELIVERED` only after the
   last batch succeeds. A timed-out batch counts as not delivered (the retry resends that batch; never assume delivery).
2. Setup and status are actionable: health route, HTTPS validation, warnings and labels (13.7).
3. Dedupe survives reloads: `createLineGateway` takes an optional `seen?: Set<string>`; the daemon creates one set and
   passes it to every gateway it builds, so a redelivered `webhookEventId` is ignored after a settings reload (bounded at
   2000 ids, oldest dropped).
4. Loading indicator: a text message from a user DM (chat id starts with `U`) that starts a run sends one best-effort
   `POST /v2/bot/chat/loading/start {chatId, loadingSeconds: 60}`. Groups and rooms are skipped. Its failure is recorded
   (masked) and never delays or blocks the answer or the `Get answer` button.
5. LINE plain-text hint: runs whose origin is `line` get one more system-prompt paragraph:
   `You are replying in a LINE chat. Write plain text: short paragraphs, no Markdown headings, tables or bold markers, and put each URL on its own line. Keep answers brief unless the user asks for detail.`
   Desktop, CLI and cron runs do not get it.

### 13.9 v1 final-review follow-ups (`.bbn/final-rev-report.md`)
1. Daemon `close()` aborts runs first: `runtime.close()` (abort every run, await them) runs before `api.close()`,
   `mcp.stop()` and `line.close()`, so a slow MCP shutdown can no longer let the sidecar's SIGKILL land before an
   approved `shell` process group is killed.
2. A non-owner LINE turn never overwrites the stored context: the model gets the filtered copy as input; the stored
   model context stays the full previous context plus only the new non-owner turn (the user text and, only when the run
   did not error, the final assistant text; no tool or thinking blocks).
3. LINE slash errors: `lineMessage` replies with a `CommandError`'s own message (usage, path not found) instead of the
   generic `Sorry, something went wrong.`
4. The file guard also refuses `~/.git-credentials`, `~/.npmrc`, `~/.pypirc`, `~/.kube/` and `~/.config/gcloud/` for
   read, write, edit, list and search, like `.ssh`.

### 13.10 Desktop (`desktop/src/`)
- Agents form (`agents.ts`): Provider select (v1). Model: free text with suggestions (datalist) from
  `GET /api/providers/:id/models` for the selected provider, loaded when the form opens and again when the provider
  changes; a stale answer for the previous provider never overwrites the new one; nothing is pre-selected or changed when
  the list arrives. When the answer is `ok: false`, a muted line under the field reads
  `Couldn't load the model list: <error>. You can still type a model id.` Typing any model id always works.
- No Effort select: the select, the effort on the card, and `effort` in the types, the API client and saved bodies are
  removed. The thinking-block and `refused` handling the core never sends is removed too, so `desktop/src/types.ts`
  matches the core shapes.
- Max tokens: optional number input (blank = the provider's setting, saved as `maxTokens: null`; else 1-1000000, other
  values blocked with an inline error), help text
  `Blank uses the provider's setting. Thinking models (for example qwen3 or deepseek-r1) spend tokens on thinking first, so leave it blank unless you need a limit.`
- The agent card shows `provider · model`.
- Providers page (`settings/providers.ts`): the Agent model card's Model field gets the same suggestions and error line.
  A provider card whose `GET /api/providers/:id/status` answer has a `note` shows the note and each warning (warning
  style), loaded with the page. The Ollama card's key row reads `API key (optional):` with the masked key or `not set`.
- Messaging page (`settings/messaging.ts`): Connect step lines read `Token` / `Webhook` (capitalised) with ok or failed
  and the detail; after a Connect the status card reloads; the slow-response field allows 1-50 seconds (13.7).

### 13.11 App icon (`desktop/src-tauri/icons/`)
The owner's BoomBigNose logo replaces the v1 icon. Master (the owner's own image, used as is):
`/Users/boombignose/orca/projects/bignose-research/brand/boombignose-app-icon-1024.png`, 1024x1024 RGBA PNG, sha256
`89843365951de91c2600f4cd5c941f1bac9037c3a460a5078c89f269327e7548` (made from the owner's GitHub avatar). It is copied
byte for byte to `desktop/src-tauri/icons/source/boombignose-1024.png`, and the five icons `tauri.conf.json` lists
(`icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.png`, `icons/icon.icns`) are regenerated from
it with the project's own Tauri CLI (`pnpm --filter desktop tauri icon src-tauri/icons/source/boombignose-1024.png`, run
from the repo root; the path is relative to `desktop/`). Extra files the CLI writes (Windows, iOS, Android, Store logos)
are not committed; the icon list in `tauri.conf.json` stays as v1. The v1 SVG drawing (`app-icon.svg` in `desktop/`) is
deleted (not referenced anywhere). No other UI change. A release build (`tauri build --bundles app`) puts the regenerated `icon.icns`
into `BigNose.app/Contents/Resources/` under the name in `CFBundleIconFile`.

### 13.12 Owner-run checks (manual, never in tests)
A real chat with an agent on a local Ollama model (and the context warning when Ollama runs with a small context), and a
real LINE channel through a public HTTPS tunnel: Connect, Test webhook, a DM, a slow local answer with `Get answer`; the
new icon in the Dock and Finder. Steps are in the run's final report.

## 14. Connector exit, doctor API, chat resume and diagnostics (build spec T09, T15, T16, T17)

Four gaps from `~/orca/projects/bignose-research/hermes-desktop-complete/bignose-build-spec.md` (Hermes Desktop REA,
reference only: no Hermes code, names or IPC). Everything else in that spec is out of scope. Tests use fakes and an
isolated `BIGNOSE_HOME`; none may reach the owner's Ollama (127.0.0.1:11434), LINE or a real provider.

### 14.1 MCP connector exit (T09, `core/src/mcp/`)
- A connector is *established* once `connect()` and the tool listing succeeded. When its server goes away afterwards
  (stdio: the process exits; any transport: the client loses the connection), the manager keeps an error for it:
  `connector <name> exited (<code or signal>)` for a stdio exit, `connector <name> closed` otherwise, plus the redacted
  stderr tail when there is one. Secrets stay masked by the client's existing redaction.
- `waitFor` rejects at once with that error (no 180 s poll, no AbortError). A `tools/call` that is pending when the server
  goes away, and any later call through a tool handed out before, fails at once (no 60 s request timeout) with a message
  that names the connector and says it exited or closed. `status()` reports `connected: false` with the error, so
  Settings → Connectors shows it.
- No silent restart: an exited connector stays down until the user acts (settings change, enable/disable, `mcp test`).
  `stop()` stays idempotent: twice in a row, and after an exit, it neither throws nor spawns anything.

### 14.2 Doctor API (T15, `core/src/api/index.ts`)
- `POST /api/doctor` (token and Host checks like every route) runs the existing `doctor(home, fetchImpl)` for the
  daemon's own BigNose home and answers `200 {code, lines}`; `code` 0 means every hard check passed. The request body is
  ignored apart from the usual size/JSON checks: the route never takes a path, command or URL from the caller, never
  installs or uploads anything, and contacts nothing beyond what `bignose doctor` already checks (the active Ollama
  server, through the daemon's `fetchImpl`). Lines pass through the same cleaner as every response, so no token, key or
  `.env` value appears. Other methods on the path behave like any unknown route.

### 14.3 Chat history resume (T16, `desktop/src/chat.ts`, `desktop/src/main.ts`)
- Leaving Chat while a session's history is loading never leaves "Loading…" behind: when Chat is shown again
  (`refreshAgents()` on navigation back), the selected session's history is loaded again and rendered, with the usual
  error + Retry on failure. A late answer for an agent or session that is no longer selected never renders (the existing
  sequence fencing stays).

### 14.4 Diagnostics in General settings (T17, `desktop/src/settings/general.ts`, `desktop/src/api.ts`, `desktop/src/types.ts`)
- `api.doctor()` → `POST /api/doctor` → `DoctorResult {code: number; lines: string[]}`.
- Settings → General has a Diagnostics card with a "Run diagnostics" button. While it runs the button is disabled (no
  duplicate request). The result shows a summary (code 0: all checks passed; otherwise: some checks failed) and every
  line as text; an error shows its message and a Retry button; a new run replaces the old result. Text nodes only (no
  `innerHTML`). No upload, telemetry, new route or new screen.

## 15. Run robustness (stream `bignose-run-robustness`)
The agent loop and the providers recover instead of breaking. Zero runtime dependencies; no new events.

### 15.1 Tool calls the model gets wrong (`agent/loop.ts`, `providers/common.ts`, `tools/coerce.ts`)
- Malformed, cut-off or non-object arguments no longer throw inside the provider. The adapter emits
  `{type:'tool_call', id, name, input: {}, error}` with `error` = `Invalid tool arguments: <reason>. Send the call again with a
  complete JSON object.` The loop does not run that tool; it answers the call with `{isError: true, content: error}` and keeps
  running the other calls of the turn, then gives the model another turn.
- Tool names: a call whose name is not `^[a-zA-Z0-9_-]{1,64}$` (for example `functions.read_file`) is answered with
  `Unknown tool: <name cut to 100 characters>`. The stored `tool_use` carries a sanitised name (other characters become `_`,
  at most 64, `invalid_tool` when nothing is left), so no later request is rejected. A stored context with an illegal name is
  repaired in memory at the start of the next run (sessions that broke before this change work again). `tool_start` still
  shows the name the model used.
- Arguments are coerced from the tool's own `inputSchema` before `run`: a string for a property of type `integer`/`number`
  that reads as a number (`"10"`) becomes a number; `"true"`/`"false"` for a `boolean` becomes a boolean. Nothing else changes;
  the tool still validates. This covers built-in and MCP tools.

### 15.2 Context budget (`agent/loop.ts`, `agent/budget.ts`)
- `RunOptions` gains `spillDir?: string` and `redact?: (text: string) => string`. The runtime passes
  `<BIGNOSE_HOME>/tool-results` and its secret cleaner.
- Per-result cap = 0.6 x `contextWindow` characters (15% of the window at 4 characters a token), at least 2000 and at most
  100000 (the tools' own cap). A result over the cap is redacted (`RunOptions.redact`) as a whole, then becomes its first 1500 characters plus a note with the original size and,
  when `spillDir` is set, the path of a file (`<uuid>.txt`, mode 0600, redacted) that holds the full output; the model can read
  it in parts with `read_file` (by lines, so a one-line output cannot be paged). If the file cannot be written, or there is no `spillDir`, the note says the rest was truncated.
  `tool_end.output`, the `postTool` hook and the stored `tool_result` all carry the budgeted text. The MCP client keeps its own
  100 kB cap below this one.
- After compaction (or when compaction has nothing to cut, as in a short session with one huge result), if the request is
  still over the limit the loop prunes the oldest tool results longer than 1000 characters to their first 500 characters (of the
  redacted text) plus `[Tool output cleared to save context space]`, until the estimate fits. The caller's context and the `added` transcript are not
  mutated; the pruned form is what `RunResult.context` keeps.
- A provider error that says the request was too large (`context length`, `context window`, `prompt is too long`, `too many
  tokens`, `maximum context`, HTTP 413 / `payload too large`) before any output arrived does not end the run: the loop
  compacts and prunes harder (pruning about half the context) and asks again, at most twice per run, without using up a turn.
  A third overflow ends the run with that error.
- Redaction comes before every cut: the preview, the pruned head, the spill file and the history of the summary request are all
  taken from text that `redact` has already run over, so a secret that crosses a cut never leaves a readable prefix.
- The summary request is bounded too: it carries only the newest `max(4 * limit, 8000)` characters of the history (half of that
  after a forced compaction), where `limit` is the compaction threshold in tokens. If the provider still answers that request with
  a context-length error (Thai text costs about 4 times what chars / 4 assumes), the history is quartered and the request is sent
  again, within the same two-overflow budget as above, so one oversized turn cannot leave the session dead.
- Argument coercion (15.1) happens once, right after the tool is found: the approval request (and its `approval_request` event),
  the `preTool` and `postTool` hooks and `run` all receive the coerced input, so a guard that checks `replaceAll === true` sees
  what the tool will run with. `tool_start` still shows the arguments as the model sent them.

### 15.3 Retries (`providers/retry.ts`, applied by `createProvider`)
- A stream attempt is repeated only while it has yielded no event, so output that has already streamed is never replayed.
  Retried: HTTP 429, 500, 502, 503, 529, and socket failures `ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, `EAI_AGAIN`,
  `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`. Not retried: other statuses (400/401/403/404...), provider error chunks, parse
  errors, aborts.
- Defaults `RetryOptions = {retries: 3, baseMs: 500, maxMs: 30000, sleep}`: waits of 500, 1000, 2000 ms. A `Retry-After`
  header (seconds or HTTP date) replaces the backoff; one longer than `maxMs` fails at once instead of waiting. The wait ends
  at once when the run's `signal` aborts (the abort reason is thrown). Tests pass `sleep` to avoid real waiting.

### 15.4 Error text (`providers/errors.ts`)
- HTTP errors: `Provider HTTP <status>: <message>`. For a JSON body only `error.message` (or `message`, or a string `error`)
  is shown; plain-text bodies are cut to 300 characters; HTML (content type or leading tag) is never shown: the text is
  `Provider HTTP <status>: the server answered with a web page, not an API response`. The key redaction always runs before a
  cut (the 300-character body cut and the 1000-character cut of the whole message), so a key echoed across a cut is masked.
- Network errors name the origin (scheme, host, port; never the path, query or credentials) and the cause:
  `Cannot reach the provider at <origin> (connection refused, ECONNREFUSED)` (also host not found, timed out ...) and
  `The provider at <origin> closed the connection before finishing (socket closed, UND_ERR_SOCKET)`. For an Ollama provider
  (`isOllama`) a refused connection reads `Ollama is not running at <origin> (start it with "ollama serve" or open the Ollama
  app)`, the same text the doctor and Settings show. Any other undici `fetch failed` / `terminated` becomes
  `Network error talking to <origin>: <cause> (fetch failed)`. The text reaches the desktop chat, the CLI and LINE as the run error.
- OpenAI-compatible `delta.tool_calls` are keyed by `index`; servers that omit it are keyed by call `id`, and a fragment with
  neither continues the latest call.

## 16. Turn persistence (stream `bignose-turn-persistence`)

A turn is saved while it runs, and what a run leaves behind (its outcome note, the part still streaming) is part of the session, so a
crash, a reload, a chat switch or an event-stream reconnect does not lose it.

### 16.1 Saved as it happens (`app/runtime.ts`, `agent/loop.ts`, `store/index.ts`)
- `Runtime.start()` saves the user's message (the text as typed, so a slash command stays `/rea ...`) and, when the chat has no title,
  the title, before the run begins. `runAgent` gets `onMessage(message)`, called with each finished step as it is added (the assistant
  message after its provider call, the batch of tool results after its tools): not the input, and not a `delegate` sub-run's messages.
  The runtime appends each to the transcript. A crash or kill mid-run keeps the prompt and every finished step. The end of the run
  appends nothing: `appendMessages` returns the row ids and the run keeps them.
- A failed step save (a locked database, an I/O error) does not stop the run: that would leave the context with a `tool_use` nobody
  answered, and the chat would be refused by the provider from then on. The runtime skips every later step save, so the saved rows
  stay a prefix of the transcript, and the run end appends the missing rest once (`transcript.slice(saved.length)`). If that write
  fails too, the run rejects before `setContext`, as before this stream.
- The model context (`sessions.context`) is still written once, at the end: a half-finished turn must never leave a `tool_use`
  without its result there. After a crash the transcript shows the turn; the model's context does not include it.
- Redaction keeps its order. Each step is cleaned when it is saved, with the run-start cleaner plus a fresh one. At the end the
  transcript is cleaned once more with the end-of-run cleaner and `updateMessages(ids, transcript)` rewrites only the rows that
  changed (a secret saved during the run reaches the prompt and earlier steps; the search index follows through the `messages_au`
  trigger) and the title is set again from the same cleaning.
- Store schema, additive only (`CREATE ... IF NOT EXISTS`; nothing dropped or renamed, no `ALTER`): table `notices(id, session_id
  REFERENCES sessions ON DELETE CASCADE, after_messages, level, text, at)` with index `notices_session`, and trigger `messages_au`
  (`AFTER UPDATE OF text`, same pattern as `memory_au`). An older database opens with its sessions, messages, context and search
  intact (store test with the pre-notices schema).

### 16.2 Run outcome notes
- When a run ends, the runtime stores a notice for each of: `interrupted` → `info` "Stopped."; `max_turns` → `warn` "Stopped at the
  turn limit. Send another message to continue."; `error` → `error` "Error: <message>" (or "The run failed."); and the loop's
  `warning`. A notice is `{after, level: 'info'|'warn'|'error', text, at}`; `after` is the number of messages saved before it, so
  clients render it between messages in order. Text is cleaned like the transcript.
- `runAgent` sets `warning` (on the result and on its `run_end` event) only for a run that finished with status `done`:
  the last provider call stopped with `max_tokens` ("The reply was cut off at the output limit (max_tokens) ...") or the final
  text is blank ("The model returned an empty reply."). A cut that the next call recovers from is not reported. The API's `run_end`
  event carries the same `warning`.

### 16.3 Live turn (`GET /api/sessions/:id`)
- Response: `{id, agentId, title, messages, notices, live}`. `live` is `null` unless a run is active; then
  `{runId, seq, text, tools: [{callId, name, input, done, isError?, output?}]}`: `text` is the streamed text of the current provider call
  (what the event stream has released: the same last-(longest secret - 1)-characters hold-back applies) and `tools` are the calls of
  the current step that started (a result moves into `messages` when its batch is saved). While a run is active, a tool call in `messages`
  without a result is still running. Messages, notices and `live` come from one synchronous read, so they agree.
- Event numbering: the runtime numbers the `text_delta`, `tool_start` and `tool_end` events of a run 1, 2, 3 ... (`seq`, on the
  event next to `runId`; other events have none). `live.seq` is the number of the last such event that `live.text` and
  `live.tools` include (0 before the first), and `live.runId` names the run, so a client can tell which events a snapshot already holds.
- Desktop (`desktop/src/chat.ts`): `renderHistory(messages, notices, live)` renders notices between messages by `after`, then the
  live text as the open assistant bubble and live tools on their rows, so later `text_delta` and `tool_end` events continue the same
  bubble and row. This runs for opening a chat, switching back to one, and `refresh()` after an event-stream reconnect.
  - Tool rows are keyed by `callId`: a `tool_start` for a call already on screen and still running (restored from history or from
    `live`) reuses its row. A finished call's id that a provider reuses in a later turn gets a new row.
  - Events and snapshots line up by `seq`. While a read is in flight the chat holds back text and tool events for the open chat;
    after the render it records `{runId, seq}` of the snapshot and replays the held events through the same check. An event of the
    same run with `seq` at or below the recorded one is dropped (already in the snapshot, or a late copy), any other is applied
    and advances the record. No re-read is needed, and no text is lost or shown twice. Events without `seq` (an older daemon)
    are always applied. If the read fails and is still the current one, the held events are replayed anyway. `running` still comes
    only from the event stream (replayed `run_start`).
  - `live === null` means no run is going: a tool call in `messages` without a result (the daemon was killed mid-run) is shown
    as finished with an error, "Interrupted: the run did not finish.", not as running forever.
  - `run_end` no longer builds its own note: it reloads the session, and the stored note comes back with it, so `session_updated`
    cannot wipe it. Fallback: when `run_end` has status `error` and an `error` text, the chat remembers `Error: <error>` for that
    chat (until its next `run_start`) and renders it, with the `error` tone, after the stored notices unless one of them already
    has that text. This covers a run whose notice could not be stored (for example the end-of-run write failed).

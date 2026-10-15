# BigNose desktop UI

Owner rule: **the UI should be simple.** The design is the "native-simple" proposal (two columns, one accent, one quiet line
per thing). It is a vanilla-DOM TypeScript app built with `el()` from `desktop/src/dom.ts`: no framework, no dependency.

## Rules that keep it simple

1. **Two columns.** The sidebar holds the agent switcher, New chat, the chats, then Agents, Settings and the connection
   line. The main area shows one page.
2. **One accent.** Orange (`--accent`) fills only `.btn.primary`, `.send` (not `.stop`), a checked `.switch`, a checked
   `.choice-tick` and the running `.dot`. It also draws focus rings, the streaming caret and the selected tab. The e2e checks it.
3. **No inline styles.** All CSS is in `desktop/src/style.css` (the Tauri CSP is `style-src 'self'`). Never write a `style`
   attribute, `setAttribute('style', …)` or `cssText`. Writing `textarea.style.height` (composer autogrow) is allowed.
   `e2e/ui-simple.e2e.ts` greps `desktop/src` for the first three and the e2e page runs under the app's exact CSP, so a
   violation fails the run.
4. **UI copy is English; content keeps its language.** Every element whose text has Thai gets `lang="th"` (`th()` and
   `setLang()` in `dom.ts`). Thai glyphs use Sukhumvit Set through `BN Thai`. Single lines clipped with an ellipsis use
   `line-height: var(--lh-clip)` (1.75) so tone marks are not cut.
5. **Dates are English, 24 h** (`formatTime`), so Thai month names never mix into the UI.

## Theme and the contrast gate

`style.css` starts with the tokens: a light `:root`, a dark block under `prefers-color-scheme`, and the same dark block under
`:root[data-theme="dark"]`. `scripts/contrast.mjs` checks 71 colour pairs per theme and that the two dark blocks match; the
desktop `build` runs it first, so a bad token fails the build. Keep the block layout it parses (`:root {` at column 0, the dark
media block indented two spaces, `:root[data-theme="dark"] {`).

## Shell and chat

| Part | Where |
|---|---|
| Nav: `chat.agentSwitch`, New chat, `chat.sidebar`, then Agents, Settings, `.nav-conn` | `main.ts` |
| Header: `h1.chat-title` and `a.model-link` (the agent's model, links to `#/settings/model`; the chat no longer edits the agent) | `chat.ts` |
| Messages: `.msg.user` bubble, flat `.msg.assistant`, markdown subset (headings, lists, bold, code, code blocks with Copy) | `chat.ts`, `dom.ts` `renderText`, `format.ts` |
| Tool row: one sentence (`toolLine`, the only map), icon, time, status; a failed row opens itself; unknown tools keep their raw id | `chat.ts` |
| Approval card: title, one sentence, the command or path, **Deny** (`Esc`) then **Allow once**. A `write_file`/`edit_file` card also has a collapsed **Show changes** fold with the new contents, or the old and new text (the running row that holds the input is hidden while the card is up). No "Always allow" (the daemon has no per-chat allow yet) | `chat.ts` |
| Error card: plain cause, one fix, **Try again** (latest card only), **Show details** (raw error, model, base URL, time, Copy diagnostics). "Ollama" is only named for a provider whose id says Ollama; a status comes only from the `HTTP <code>` text the provider errors use | `chat.ts` |
| Composer: one `.send` button that swaps to Stop; Send is disabled when blank or while the stream is down; no hint line | `chat.ts` |
| Empty chat: app icon, "How can I help?", agent and model, three starters that fill the composer without sending | `chat.ts` |

Picking a chat in the sidebar while Agents or Settings is showing goes to `#/chat` (only that click navigates, not the programmatic opens). A tool call the user denied keeps its failed row closed (the receipt line says it); a policy denial opens, it has no receipt. A restored approval card goes in front of the call that is running (the live turn's, else the oldest running call of that tool), because `approval_request` has no call id. The header title is remembered per chat, so a search that leaves the open chat out of the list does not change it.

Keyboard: **Esc** denies the newest pending approval of the open chat (not while the slash picker or a dialog is open; Enter
never approves); a new card focuses **Deny** unless the user is typing; **⌘N** new chat, **⌘,** Settings, **⌘F** chat search.
`main.ts` owns `document.onkeydown` and hands Esc to `chat.onKey`.

Behaviour kept from the turn-persistence work: numbered events and the `seen` check, held events replayed after the render,
interrupted tool rows (`!row.done` when no run is going), stored notices and the `run_end` error fallback. Stored `error`
notices render as the error card; `info` and `warn` stay one-line notes. Approval receipts ("You allowed once: …") are kept in
the client for the life of the page, because the daemon does not store approvals. Opening a chat or New chat drops any older
pending read, so the new chat streams; a failed first open shows its error without replaying held events onto "Loading…".

## Agents

`agents.ts` has two pages. `mountAgents` is the roster (`#/agents`): one `.card` of `.agent-row`s, each with the avatar
(`avatar()` in `dom.ts`: the agent's emoji, or the headphone bot for a blank or default 🤖 icon), the name (+ an "Answers LINE"
badge only while `line.enabled`), what it is for (the first line of the instructions, 80 characters, or "General assistant"),
and its model (prefixed with the provider when that differs from Settings) with an "N schedules" link. **Chat** shows on hover or
focus (opacity, so it stays a tab stop); the ⋯ menu (Edit…, Duplicate, Delete…) opens with a click or ↓, moves with ↑/↓, closes with Esc
(focus returns to ⋯), Tab or a press elsewhere on the page, and highlights with the neutral `--select` fill. Delete… asks through
`confirmDialog` (Cancel focused) and says what goes with the agent: its schedules, and who answers LINE afterwards. It is off for the
last agent.

`mountAgentForm` is the form as its own page: `#/agents/new` and `#/agents/<id>` (`main.ts` routes both). A card of rows (Name, Icon
with a live avatar, Instructions, Model), then one **More options** fold (What it may do, Connectors and skills, Longest answer),
then the save bar. The save bar names what differs from the saved agent ("Instructions changed", "Name and 2 more changed") and
hides when nothing does; a new agent shows "New agent · Cancel · Create agent". Saving goes back to `#/agents` with an "Agent saved" toast.

- **Model** is a select: "Same as Settings (…)" (writes the active provider and model), a model the provider lists, or Other… (shows
  Provider and a typed Model name; the `agent-models` datalist keeps suggesting). An agent already on the Settings model, or on a
  listed one, opens as that option.
- **What it may do** has four plain groups (Read files, Change files, Run commands, Open web pages) with Allow / Ask / Never; pressing
  the pressed one hands the tools back to Settings. Any other tool keeps its own rule row (`Add permission`). One tool cannot have two rules.
- **Connectors and skills** keeps the two "All / pick some" fieldsets unchanged behind **Choose…**.
- LINE is chosen in Settings › LINE, not on the form. A blank icon saves the default 🤖 (the API wants 1 to 16 characters).

Not built, because the core has no field for it: the "Last run failed" line on a row (`lastError`), the "Chat opens the newest desktop
chat" rule (the session list has no origin kind), and an introduction line for a blank instruction (the hint only says what is true).

## BigNose OS panel

`body.os-panel` (set by `main.ts` when the Tauri side says so) turns the shell into one 420 px column: the nav becomes a top
bar (switcher, then New chat, Agents and Settings as icons with screen-reader labels, then a dot for the connection), the chat
list is a sideways strip under it, and the 40 px rail is only the toggle button. After Ready the launcher is still polled
(`waitForStop`): when the ERP server exits, `boot()` shows the launcher's own "The ERP server stopped" screen with **Retry** and
returns to the panel once the server is up. The toggle button is mounted on `<body>`, outside `#app`, so that screen keeps it: collapsed to the rail, the stopped screen is hidden and the toggle is the way back.

## Settings

Five plain-text tabs under `.page-head` + `.tabs`: **Model · LINE · Tools · Memory · Schedules** (`#/settings/<tab>`). The old
section names still work (`ALIASES` in `main.ts`: `general` and `providers` open Model, `connectors`, `hooks` and `skills` open
Tools, `messaging` opens LINE). The Settings link, ⌘, and the header model link all land on Model. The `phase1 bridge` rules are
gone from `style.css`.

- **Save bar.** A tab with a form shows no bar until something differs; then it reads "Model changed from X to Y" (or "A and B
  changed", or "API key replaced"; it never shows a key) with Discard and Save, and hides again when the value is put back. LINE
  adds " · LINE will reconnect" for fields that restart the gateway.
- **Model.** Two "Runs on" cards (This Mac / A cloud service), the Model field with the provider's models as suggestions, and a test
  line. The line only checks that the server answers and lists the model: core has no test-message route, so it never sends a
  prompt. It tests the saved address and key, so with an unsaved one it says "Save to test the new address". One More options fold: Context window, Most steps, Summarise at 60/80/90%, address, API key, Saved key (Remove key), Run diagnostics. **Remove key** shows only while the chosen provider has a saved key, asks first ("Remove the Remote key?"), then deletes it with `putSecret(name, '')` and says "Key removed"; the form keeps whatever else was typed and the test line goes back to "Not tested yet.". The
  diagnostics verdict is "All checks passed" only when nothing is `warn` or `fail`; a `note` does not count. Saving a new default
  also moves every agent that followed the old default (same provider and model) so "Every agent uses this model unless you pick
  another" stays true; an agent with its own model is left alone. "Other server…" is not offered.
- **LINE.** Enable switch, **Answered by** (writes `line.agentId`; the first agent when unset), three steps (token and secret,
  Connect / Test webhook, allowed IDs), then More options (address, port, "Still working" after, the three allow lists). "Tried to
  reach you" appears only when the status carries `blocked`, which core does not report yet (a marked shortcut).
- **Tools.** Allow / Ask / Never for four groups (Read files, Change files, Run commands, Open web pages). A group shows what the
  core would do: the tool's own rule, else the longest `prefix*` rule, else the default; a mixed group lists each tool's policy.
  A foot line says that an agent's own rules on the Agents page beat these (core asks the agent's rules first, see design §13).
  Pressing a segment writes one exact rule per tool, so it always needs Save. Then the workspace folder,
  connectors as rows with a switch (a connector that is starting stays "Starting…"; the tool selection is hidden unless it is
  connected), Skills behind Manage. More options: single-tool rules, the add-connector form, hooks.
- **Memory** and **Schedules** are lists with a ⋯ menu per row. Schedules pick a plain When (Every day, Weekdays, Every week, Every
  hour, Custom (cron)) that becomes the cron; `#/settings/schedules?agent=<id>` shows only that agent's jobs and says so.
  Once and Run now are not built (core has no such job type or route).

Rules that live in the daemon, not the page:

- The workspace folder is checked only when a save changes `agent.workspace` (`resolveWorkspace`, in `PUT /api/settings`): `~` is
  expanded, the path must be absolute, exist and be a directory, and the expanded path is what is stored. `validateConfig` does not
  check it, so a stored relative folder never blocks an unrelated save.
- The **active agent** is the one that answers LINE, else the first agent. `/api/status` and the diagnostics check that agent's
  provider and model (a missing provider fails, a missing Ollama model warns), not the Settings default. `bignose doctor` on the CLI
  has no agent and still checks `config.active`.

Still not built: the test-message route, Once and Run now for schedules, and the "Tried to reach you" data.

## Checks

- `pnpm --filter desktop test`: unit tests (`chat`, `ui-simple`, `agents`, `agent-model`, `format`, `os/startup` among them).
- `pnpm --filter desktop e2e`: builds (contrast gate included) and runs `agents-rea`, `line-connect`, `model-agent`, `os-layout` and `ui-simple` in headless
  Chrome, each with its own daemon on a temp home. Set `BIGNOSE_SHOTS=<dir>` to save `chat-light.png`, `chat-dark.png`,
  `agents-light.png`, `agent-edit-light.png`, `settings-light.png`, `settings-line-light.png` and a few more for a human look.
- Not covered: the real Tauri WKWebView. `size-adjust`, the `local()` Sukhumvit names, `:has()`, `text-wrap: balance` and
  `content: "Esc" / ""` need one look in the app window.

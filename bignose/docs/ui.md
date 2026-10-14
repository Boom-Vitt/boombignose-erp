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
| Approval card: title, one sentence, the command, **Deny** (`Esc`) then **Allow once**. No "Always allow" (the daemon has no per-chat allow yet) | `chat.ts` |
| Error card: plain cause, one fix, **Try again** (latest card only), **Show details** (raw error, model, base URL, time, Copy diagnostics) | `chat.ts` |
| Composer: one `.send` button that swaps to Stop; Send is disabled when blank or while the stream is down; no hint line | `chat.ts` |
| Empty chat: app icon, "How can I help?", agent and model, three starters that fill the composer without sending | `chat.ts` |

Keyboard: **Esc** denies the newest pending approval of the open chat (not while the slash picker or a dialog is open; Enter
never approves); a new card focuses **Deny** unless the user is typing; **⌘N** new chat, **⌘,** Settings, **⌘F** chat search.
`main.ts` owns `document.onkeydown` and hands Esc to `chat.onKey`.

Behaviour kept from the turn-persistence work: numbered events and the `seen` check, held events replayed after the render,
interrupted tool rows (`!row.done` when no run is going), stored notices and the `run_end` error fallback. Stored `error`
notices render as the error card; `info` and `warn` stay one-line notes. Approval receipts ("You allowed once: …") are kept in
the client for the life of the page, because the daemon does not store approvals. Opening a chat or New chat drops any older
pending read, so the new chat streams; a failed first open shows its error without replaying held events onto "Loading…".

## BigNose OS panel

`body.os-panel` (set by `main.ts` when the Tauri side says so) turns the shell into one 420 px column: the nav becomes a top
bar (switcher, then New chat, Agents and Settings as icons with screen-reader labels, then a dot for the connection), the chat
list is a sideways strip under it, and the 40 px rail is only the toggle button. After Ready the launcher is still polled
(`waitForStop`): when the ERP server exits, `boot()` shows the launcher's own "The ERP server stopped" screen with **Retry** and
returns to the panel once the server is up.

## Not finished here (next streams)

- Agents roster and form page, and the five Settings tabs (migration steps 3 to 5 of the spec). Until then Agents and
  Settings keep their old DOM: `style.css` ends with a `/* phase1 bridge */` block that styles it with the new tokens, and the
  Settings page shows its eight sections as a tab row. The step that moves them deletes the bridge and that tab row, and
  replaces the `model` entry in `ALIASES` in `main.ts` (`#/settings/model` opens Providers & models for now).
- The e2e checks cover the chat routes and the panel. Each later stream adds its own routes to `e2e/ui-simple.e2e.ts`.

## Checks

- `pnpm --filter desktop test`: unit tests (`chat`, `ui-simple`, `format`, `os/startup` among them).
- `pnpm --filter desktop e2e`: builds (contrast gate included) and runs `agents-rea`, `os-layout` and `ui-simple` in headless
  Chrome, each with its own daemon on a temp home. Set `BIGNOSE_SHOTS=<dir>` to save `chat-light.png`, `chat-dark.png` and a
  few more for a human look.
- Not covered: the real Tauri WKWebView. `size-adjust`, the `local()` Sukhumvit names, `:has()`, `text-wrap: balance` and
  `content: "Esc" / ""` need one look in the app window.

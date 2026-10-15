# View mode (2D↔3D), Chat chrome, LINE roadmap

Status as of 2026-10-16 (auth-polish worktree).

## 1. UI shell — 2D ↔ 3D toggle

| Mode | Behaviour |
| --- | --- |
| **2D** | Classic ERP: sidebar tabs + module pages (Dashboard, Clients, …). |
| **3D** | Full Campus scene (warehouse + office) in one WebGL space — no tab hop for overview. Toggle floats top-right. |

- Preference: `localStorage.bignose-view-mode` (`2d` \| `3d`).
- Entry: toolbar segmented control on every `(app)` page; legacy `/warehouse` sets `3d` and redirects to `/dashboard`.
- Nav item “Campus 3D” removed (toggle replaces it). Blueprint stays as its own page.
- **Not in this pass:** clicking a 3D zone to open the matching 2D module; deep-linking module state inside the scene.

## 2. Color unify (ERP left / Chat right)

- ERP: FB BoomBigNose (`html.dark`) — navy `#0b1e3a`, teal rail `#1f5a7a`, orange `#f07a1a`, cream `#ece7d6`.
- Chat panel: when `body.os-panel` (BigNose OS), CSS tokens remapped to the same FB dark palette so chrome matches the ERP webview.
- Standalone BigNose (non-OS) keeps the previous native-simple light/dark tokens.
- Campus 3D header tinted to navy/cream so 3D mode does not flash a separate blue/white chrome.

**Requires rebuilding BigNose OS.app** for the Chat CSS change (Tauri bundles `desktop/dist`). ERP Next changes apply on `:3100` after refresh.

## 3. Chat ↔ ERP grounding

| Exists | Missing / weak |
| --- | --- |
| Read-only MCP `erp` tools (lists + `finance_summary`) | No `get_*` by id detail tools |
| OS provisions “ERP assistant” + connector | Old agents kept stale instructions forever |
| Allow-list: only `mcp__erp__*` | Model still can skip tools if instructions are soft |

**This session:** stronger grounding instructions; `provisionErp` **patches** instructions / connectors / permissions when they drift (leaves provider/model alone).

## 4. LINE inventory

| Area | Exists | Missing |
| --- | --- | --- |
| OA / user DM | Text webhook → agent → reply/push | — |
| Groups / rooms | `allow.groups` / `allow.rooms` + resolveChat | Rich group UX, mention handling |
| Images / video / audio / file | **Ack-only reply** (this session) | Content API download, store, vision/transcribe, RAG |
| Learning over time | Memory tools on other agents | ERP assistant denies memory_* by design; need separate “LINE learner” agent or loosening |
| Lag / one-data | Queue per `to` | Media pipeline, streaming, retry budgets |
| Push | Configurable | **Do not re-enable** while token burn / `enabled=false` |

### Roadmap (ordered)

1. Media Content API fetch + encrypted local blob store + message index.
2. Image → caption (vision model); video → keyframe + transcript stub.
3. Group thread context window (last N) without leaking cross-tenant.
4. Optional memory write for LINE learner agent (not ERP assistant).
5. Re-enable LINE push only with Boom OK + rate limits.

## 5. Pilot note

Hosted Starter pilot still needs PromptPay billing before “paid ≥1 cycle” gates are measurable. LINE stays design-ready, push off.

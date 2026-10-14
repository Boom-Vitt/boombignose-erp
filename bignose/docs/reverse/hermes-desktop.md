# Hermes Desktop reference digest

2026-10-14 — Reference reading of the 2026-10-13 built-app inspection notes.
Hermes Desktop is MIT. No Hermes code was copied into BigNose.
The notes describe static evidence; this digest does not claim Hermes was launched.
Start with [00-synthesis.md][00] for the evidence boundaries and unresolved questions.

## App and process layout

- The desktop target is the Electron app at
  `~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app`;
  its useful payload is `Contents/Resources/app.asar`. `/Applications/Hermes.app`
  is the setup bootstrap. The package includes Electron and helper applications.
  [Packaging notes][01], [synthesis][00].
- Main is bundled in `dist/electron-main.mjs`. Recovered module families cover
  lifecycle, windows, tray, updates and diagnostics. Their presence does not prove
  startup order, close policy, updater operation or recovery behavior. [02][02].
- `dist/electron-preload.js` exposes `window.hermesDesktop`; a separate preview
  guest preload exists. The notes recover 298 bridge member paths and 258 literal
  IPC names, plus unresolved dynamic channels. These declarations do not establish
  complete signatures or verified main handlers. [Preload/IPC notes][03].
- Renderer assets separate chat, sessions/profile routing, agent activity,
  personalities, messaging, settings, cron and artifacts. JSX and hooks support
  React attribution; framework versions and the router remain unknown. [15][15], [16][16].
- Main selects a backend descriptor and brokers HTTP. Runtime executable, ports,
  readiness, spawn/attach ownership and reconnect policy were not recovered.
  [Runtime notes][04], [Messaging trace][10].

## IPC groups

| Concern | Representative recovered names | Evidence |
|---|---|---|
| HTTP and routing | `hermes:api`, `hermes:connection:for`, `hermes:connection:active-route` | [03][03], [05][05], [10][10] |
| Runtime / gateway discovery | `hermes:backend:touch`, `hermes:backend:recycle`, `hermes:gateway:ws-url` | [03][03], [05][05] |
| Profiles and roster | `hermes:profile:get`, `hermes:profile:set`, `hermes:profile:default:set`, `hermes:agents:roster` | [16][16] |
| Window / tray / links | `hermes:window:openSession`, `hermes:minimize-to-tray:set`, `hermes:deep-link-ready` | [02][02], [03][03] |
| Files / preview | `hermes:readFileText`, `hermes:selectPaths`, `hermes:watchPreviewFile` | [03][03] |
| Connection testing / OAuth | `hermes:connection-config:test`, `hermes:mcp-oauth:listen`, `hermes:mcp-oauth:cancel` | [03][03], [09][09] |
| Diagnostics / updates | `hermes:logs:recent`, `hermes:updates:check`, `hermes:updates:apply` | [02][02] |

Most entries establish preload invoke/send/listener syntax only. The focused
Messaging trace establishes the HTTP broker; other schemas need verification. [03][03], [10][10].

## Screens, routes and Messaging → LINE

- Chat/history/search, profile controls, settings, capabilities, messaging,
  skills/plugins, cron, memory/context, agents/subagents and artifacts occur as
  feature surfaces. Exact URL routes and navigation history were not recovered;
  these notes do not justify inventing a Hermes `/settings` route. [00][00], [07][07], [15][15].
- Profile selection, bot roster and execution monitoring are separate surfaces.
  Creation payloads, personality contents and per-agent model/tool persistence
  remain unknown. BigNose defines its own saved-agent contract. [16][16].
- Messaging renders credential descriptors supplied by the backend. Activation
  and completeness are separate states. Empty scalar edits preserve credentials;
  explicit clear is separate. Lists are normalized before saving. [10][10].
- Messaging → LINE could use a returned LINE descriptor through this generic UI.
  Neither a LINE-specific schema nor backend LINE support was proven by the
  inspected renderer. BigNose implements LINE from its own requirements.
  [Messaging notes][10], [owner requirements](../requirements.md).

## Recovered local HTTP surface

Renderer requests pass through `hermesDesktop.api` and `hermes:api` to a selected
backend. The envelope contains a path and optional method/body/profile/connection,
priority and timeout. One authentication branch uses `X-Hermes-Session-Token`;
credential storage and the full error schema are unresolved. [05][05], [10][10].

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/messaging/platforms` | Platform descriptors/status |
| PUT | `/api/messaging/platforms/{id}` | Credential or activation patch; live-apply feedback |
| GET | `/api/pairing` | Approved/pending entries |
| POST | `/api/pairing/approve` | Approve a platform request |
| POST | `/api/pairing/revoke` | Revoke a platform user |
| POST | `/api/gateway/restart` | Request restart |
| GET | `/api/actions/{name}/status?lines=…` | Poll action completion |

These pairs come from [Messaging notes][10], not a complete API specification.
`session.events.since`, `client.capabilities`, `reload.mcp`, `config.set` and
`skills.manage` occur as request-name literals; they are not established REST
paths or streaming schemas. Chat, stop, approval, create-agent, cron and memory
wire contracts remain unresolved. [05][05], [00][00].

## What BigNose retained or simplified

- Retained agent identity, scoped sessions, tool activity, connectors, messaging
  and durable notes as useful boundaries. Its API and tests define their behavior.
  [00][00], [06][06], [07][07], [16][16], [design](../design.md).
- Uses one Tauri window, vanilla TypeScript and one Node daemon; a narrow
  `daemon_info` command supplies the loopback API connection. Electron helpers,
  overlay windows, remote pools and broad IPC were not adopted. [00][00], [02][02], [03][03].
- Uses semantic colors, accessible native forms and expandable tool details.
  Model/tool output enters text nodes. [06][06], [14][14], [15][15].
- Makes provider/model, permissions, connectors, skills and LINE assignment
  explicit on saved agents. The slash picker and `/rea` confirmation use the
  BigNose API, rather than guessed Hermes endpoints. [16][16], [design §12](../design.md).
- Uses masked secret status, replace/clear actions and LINE-only settings.
  Signing, notarization, auto-update, other messaging platforms and connector
  OAuth stay outside v1. [10][10], [14][14], [requirements](../requirements.md).

[00]: ../../../bignose-research/hermes-desktop/00-synthesis.md
[01]: ../../../bignose-research/hermes-desktop/01-packaging.md
[02]: ../../../bignose-research/hermes-desktop/02-main-process.md
[03]: ../../../bignose-research/hermes-desktop/03-preload-ipc.md
[04]: ../../../bignose-research/hermes-desktop/04-backend-runtime.md
[05]: ../../../bignose-research/hermes-desktop/05-local-api-client.md
[06]: ../../../bignose-research/hermes-desktop/06-chat-streaming.md
[07]: ../../../bignose-research/hermes-desktop/07-sessions-sidebar.md
[09]: ../../../bignose-research/hermes-desktop/09-connectors-mcp.md
[10]: ../../../bignose-research/hermes-desktop/10-messaging-line.md
[14]: ../../../bignose-research/hermes-desktop/14-security.md
[15]: ../../../bignose-research/hermes-desktop/15-ui-system.md
[16]: ../../../bignose-research/hermes-desktop/16-agent-creation.md

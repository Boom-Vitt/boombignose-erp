# Durable decisions

2026-10-13 — Resume owner-authorized BBN run
- Evidence: `.git/bbn/bbn-bignose-codex-194504.goal`, `.git/bbn/handoff.md`, `docs/requirements.md`.
- Use existing integration branch and runtime R; fresh independent reviewer approves current replan. Keep all three owner-update streams. Builders/fixers use real Codex CLI; reviewers use fresh BBN reviewer teammates.
- Hermes Desktop notes are reference only; agents-desktop commits a digest at `docs/reverse/hermes-desktop.md`. REA is exercised by the app runtime/tests, not by hub MCP tools.
- No pushes. Local target merge requires acceptance, gate and current independent final review.

2026-10-14 — Owner keeps the original v1 scope
- Asked whether "LINE only, keep it simple" meant cutting desktop/agents/`/rea`; owner chose "continue the original plan" (messaging stays LINE only, as already specified).
- Hermes Desktop: reuse the existing 16 reverse notes in `~/orca/projects/bignose-research/hermes-desktop/`; no new REA run.

2026-10-14 — Hub decisions during the resumed run (canonical list: `.git/bbn/briefs/hub-decisions.md`)
- SSE `/api/events` replays active runs and pending approvals on connect (no new route); desktop clears run/approval state at stream open.
- MCP server names `^[a-zA-Z0-9-]{1,32}$` so tool aliases cannot collide.
- A non-owner LINE run gets only what was already visible in that chat (user text + final assistant replies).
- General redaction masks `.env` values and the API token (8+ chars); literal MCP env/header values are masked only in their own fields.

2026-10-14 — Owner: agents with any model; LINE connect from the app
- Owner corrected an earlier reading ("not building fable 5 agent let user can agent with any model inside"): no Fable-specific default; agents take any provider/model (typed id plus provider model-list suggestions) and an optional effort sent to Anthropic only when set.
- Anthropic adapter stays model-agnostic and correct for current models: thinking blocks replayed verbatim, `block_binding` drop_block only when replaying thinking, refusal handled, no server-side fallbacks. LINE connect/verify plus line-gap and final-review fixes. Builders stay Codex. Correction file: `.git/bbn/bbn-bignose-124521-owner-correction.md`.

2026-10-14 — Owner correction: agents on any model, not a Fable agent
- Owner: "not building fable 5 agent let user can agent with any model inside" (`.git/bbn/briefs/owner-correction-2026-10-14.md`). Supersedes the Fable-specific reading above: no model-specific agent/default/fallbacks.
- Agents: any provider + model id (suggestions from the provider's model list, clear error on failure), optional effort (Anthropic only) and max tokens. Anthropic adapter is model-agnostic: thinking blocks verbatim; adaptive + block_binding drop_block + beta only when replaying thinking; refusal rolls the model context back; compaction strips thinking from kept turns; max_tokens capped by GET /v1/models/{id}.
- Contract: `.git/bbn/briefs/agents-line-design.md` (docs/design.md §13 once merged).
- Correction 2 (same day): "we will use line not use anthropic since user can use ollama first". Primary path = LINE + local Ollama (OpenAI-compatible, no key, preset http://127.0.0.1:11434/v1, model list from /models, context-length warning). Anthropic-only stream (`provider-thinking`) stopped and replaced by `provider-ollama`; per-agent effort dropped. File: `.git/bbn/bbn-bignose-124521-owner-correction-2.md`.
- Correction 3 (same day): app icon = owner's GitHub avatar (Boom-Vitt), as a 1024 macOS-style master at `~/orca/projects/bignose-research/brand/boombignose-app-icon-1024.png`; regenerated via the local Tauri CLI in a small `app-icon` stream. File: `.git/bbn/bbn-bignose-124521-owner-correction-3.md`.
- 2026-10-14 (hub): the first-run Ollama model pick runs only on a true first run (no config.json and no agent in the store); later starts never call Ollama for it, so the default agent and `active.model` cannot diverge. A wrong default model then shows Ollama's own "not found, try pulling it first" error and the user picks a model from the suggestions.

2026-10-14 — Run r5 (hub bbn-bignose-163426): Hermes-parity T09/T15/T16/T17
- Acceptance proves "tests fail before the work" with `.git/bbn/briefs/r5/check-tests.sh red 982c9cb ...` (copies the stream's test files onto a clean `git archive` of the base and requires a named assertion failure); spec checks pin the research spec file's sha256.
- A merge-time gate failure that names the stream's own new timing-bound tests is fixed in the stream (test-only, more headroom, proven under parallel load), re-reviewed and merged on a quiet machine — not replanned. Merge ticks wait until no reviewer/load test is running.
- T09 scope as built: stdio exit (and intentional close) is detected; HTTP transport loss is not (follow-up: narrow design §14.1 or add detection).

2026-10-14 (owner, evening) — full harness, nicer UI, lightweight model
- Owner: "now continuously create full harness architechture like hermes desktop using rea and all feature not work in bignose app fix it", then "continue and update ui to be more nice and use more lite weight model let /mcp__rea__investigate_feature grok bot". Clarified by owner choice: the lighter model is BigNose's own default (qwen3:4b), and REA investigate_feature "bot" runs on both Hermes Desktop (Bot Mode / BOTS roster + messaging bots) and BigNose.app.
- Scope change: full Hermes Desktop harness parity replaces the old "lite" skip decisions of bignose-build-spec.md; still LINE-only, Tauri + vanilla DOM, zero runtime deps, hand-written protocols, any model (Ollama first). Excluded: other messaging platforms, Electron/Python mechanisms without user-visible behaviour, Nous cloud/billing/telemetry.
- Default Ollama model: qwen3:4b (pulled 2026-10-14; owner's active model and "BigNose" agent switched via the local API). Code default `OLLAMA_DEFAULT_MODEL` is still 'qwen3' (first-run pick → qwen3:<first tag>); change to qwen3:4b goes into the next BBN wave.
- A Hermes "bot" (Bot Mode teammate: title, mission, avatar, capabilities, private conversation, routines, bot-to-bot messaging) maps to a BigNose agent; Hermes messaging bots map to the LINE gateway only.
- UI direction (owner, 2026-10-14): "ui should be simple not just like hermes". BigNose UI = simple and nice (few controls per screen, progressive disclosure, plain words, BoomBigNose accent); Hermes Desktop is a feature/flow reference only, not a look to copy.

2026-10-14 — Owner: merge boombignose-erp into this repo as one codebase, built by Gemini 4
- Asked what "merge ERP with BigNose" means; owner picked "One codebase" (over an MCP bridge, an ERP tab in the desktop app, or ERP-only AI) and "Merge all using gemini": every BBN build/fix runs on Gemini 4 (`google/gemini-4-argon` via OpenRouter) as the Hermes builder, and the product's AI (ERP AI features; BigNose via its existing `openrouter` provider) runs on Gemini 4.
- Source: Boom-Vitt/boombignose-erp main 58867a0 (= origin/main 2026-10-14; the Claude Code desktop worktree brave-euclid fdb2a1c is already merged). Unmerged remote branches feat/company-os-v2 and claude/feature-comparison-odoo-ftonu6 are not part of it.
- Rule conflicts to settle in an ADR superseding part of 0001: 0001 limits repo-wide dev deps to typescript/@types/node/@tauri-apps/cli; the ERP is Next.js 16 + Supabase with its own deps. Its only LLM SDK use (`@anthropic-ai/sdk` in `lib/ai/client.ts`) is to be replaced by a hand-written OpenRouter call, which keeps the "no LLM vendor SDK" rule.

2026-10-14 — Correction (same evening): the ERP is the base, not this repo
- Supersedes the entry above. The owner chose "ERP Company OS is the base": `boombignose-erp` (~/Desktop/erp/boombignose-erp) stays the main repo, and BigNose plays a supporting role there as a snapshot of fee9b53 under `bignose/` (no history). This repo stays the read-only source; nothing here changes.
- Product direction: no more web use for the owner. The ERP becomes ONE native desktop app ("BigNose OS": a Tauri shell that starts the ERP's Next.js server, local Supabase in Docker starting from migrations + seed with cloud untouched, a slide-out BigNose chat/agents panel, a read-only ERP MCP server for the agent, and a three.js "exploded blueprint" 3D scene in the app). AI runs on Gemini 4 via OpenRouter; Gemini (Hermes `bbn-gemini`) builds every stream. Goal: ERP .git/bbn/bbn-boombignose-erp-235858-20261014.goal.

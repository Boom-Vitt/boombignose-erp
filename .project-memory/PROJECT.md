# BigNose — project context

Verified 2026-10-13 from `docs/requirements.md`, `.git/bbn/handoff.md`, `.bbn/plan.json`, and `git status --short --branch`.

- Objective: desktop-first personal agent app on macOS Apple Silicon with LINE gateway, full handwritten harness, multi-provider support, agent CRUD, slash skills and `/rea`.
- Source layout (declared and visible on integration/feature branches): `core/` Node 24 TypeScript daemon/CLI, zero runtime npm dependencies; `desktop/` Tauri 2 and vanilla TypeScript. Main currently contains requirements/instructions; implementation is being integrated in `bbn/bignose-v1-dde279`.
- Canonical scope: `docs/requirements.md`, especially owner update 2026-10-13. Design is currently on integration branch: `git show bbn/bignose-v1-dde279:docs/design.md`.
- Runtime BBN root for this accepted continuation: `/Users/boombignose/.claude/mods/bbnw` (v0.8.0 config); do not use the older general BBN root.
- Eight streams: foundation (previously merged), core-agent, core-services, desktop, core-app, agents-core, slash-rea, agents-desktop. All pending build/fix streams use Codex gpt-6.1-sol xhigh.
- Current milestone: first apply tick requests fresh independent plan review. Previous teammates verified done with `herdr agent list`; no running teammate report remained to collect.
- Validation: memory reader ran; application acceptance/gate not yet rerun by this hub. Never push or use real owner keys/LINE credentials.
- Next: reviewer approves draft; accept with `--by reviewer`; drive every harness action through final verify/review/local merge and report.

# Verified tools and commands

Observed 2026-10-13:
- `node --version` → v24.20.0; `pnpm --version` → 12.3.4.
- Active hub is inside herdr; `herdr agent list` worked through approved execution and showed the earlier builders done.
- BBN runtime: `/Users/boombignose/.claude/mods/bbnw`, config v0.8.0, maxParallelAgents 8/maxParallelWorktrees 9. Tick: `node /Users/boombignose/.claude/mods/bbnw/scripts/bbn-run.mjs --apply --json`. Dispatch: `scripts/bbn-team.sh ask NAME ROLE WORKTREE BRIEF`.
- Current Codex model/effort declared by runtime config: gpt-6.1-sol/xhigh. Actual build actions still pending dispatch.
- Graft `graft_repo_map` was callable but returned no graph for main; do not claim a successful source map. Use explicit worktree context for implementation.
- `python3 .project-memory/read.py` passed. Application build/tests not yet rerun by this hub.
- Selected BBN, Ponytail full, Superpowers verification-before-completion, ECC verification-loop skills were read.

Tests must use fake providers/LINE and isolated BIGNOSE_HOME, never real owner credentials. Rust path and test commands are source-declared in `docs/requirements.md` and `.bbn/plan.json`; record their actual result after the harness runs them.

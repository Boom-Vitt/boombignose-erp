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

Observed 2026-10-14 (Claude hub `bbn-bignose-013533`, herdr workspace wK):
- `bbn-team.sh ask|stop` drove fresh Codex CLI teammates (gpt-6.1-sol xhigh) and Claude `bbn-reviewer` teammates without any teammate dying. Codex teammates needed sandbox escalation for npm DNS, loopback test servers and the linked worktree git index.
- `bbn-team.sh stop <name>` deletes `.git/bbn/team/<name>.*` including the report: copy the report first.
- Claude reviewers' background `bbn-codex.sh review` was killed with exit 144 twice; detached `nohup` reruns completed.
- Google Chrome is at `/Applications/Google Chrome.app` (desktop e2e). Hermes Desktop asar exists at `~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app/Contents/Resources/app.asar`; REA's whole-ASAR JS analysis refuses it (integrity mismatch on the unpacked `node-pty/prebuilds/darwin-arm64/pty.node`).
- Ollama on the owner's Mac (checked 2026-10-14): 0.40.4 at /opt/homebrew/bin/ollama, models qwen3:14b and deepseek-r1:8b; `/api/ps` showed `context_length` 32768 for a loaded model. OpenAI-compatible streaming sends thinking as `delta.reasoning`, each tool call complete in one chunk with `index`, then `finish_reason: tool_calls`, a usage-only chunk (`choices: []`), `[DONE]`; it accepts assistant `content: null` + `tool_calls` and `role: tool` replies. Tests must never call it (127.0.0.1:11434).
- `tauri icon` lives in the project's own `@tauri-apps/cli` 2.12.2 (`pnpm --filter desktop tauri icon <png>`); it also writes Windows/iOS/Android extras.
- Flaky under load: `core/test/tools/builtin.test.ts` "noisy shell output retains at most 100 kB" missed its 3 s deadline once while a Tauri release build ran in parallel; passed on rerun.
- BBN harness: a failed `bbn-merge.sh` on an unchanged HEAD becomes `stop` on the next tick (no retry). Stopping herdr teammates right before a merge tick can disturb a gate running in the same worktree; wait a few seconds after `bbn-team.sh stop` before ticking.

Observed 2026-10-14 (hub bbn-bignose-163426):
- `node --test --test-name-pattern=...` on a `.ts` test file with no matching test reports the file itself as one passing test (`ok 1 - <file>`, `# pass 1`): count passing tests by name, not `# pass`.
- `/bin/bash` on this Mac is 3.2.57 (no `${arr[@]}` under `set -u` when empty); BBN acceptance helpers must stay bash-3.2 safe.
- BBN harness keeps only the last 3 lines of a failed merge (`run.merge` reason in `.git/bbn/runs.jsonl`) and the next gate overwrites the worktree's `bbn/gate.log`: to name a merge-time failure, rerun `bbn-merge.sh --apply --base <integration>` in the stream worktree with output to a file. Normal gates for this repo take 4-8 s; merge-time gates that took 15-76 s coincided with concurrent reviewer load and tight (1 s) test bounds.

Observed 2026-10-14 (ERP merge prep, Claude session outside herdr):
- OpenRouter public catalog: `google/gemini-4-argon` context 1,048,576, max completion 65,536, tools supported, $2/M input, $10/M output.
- No OpenRouter key was found on the Mac (shell env, launchctl, ~/.hermes/.env, profile .envs, ~/.bignose/.env, which does not exist). The owner must add it; never in chat.
- Hermes profile `bbn-gemini` created (clone of `bbn`; model.default google/gemini-4-argon, model.provider openrouter, model.max_tokens 32768). BBN picks the Hermes profile only from global `team.hermesProfile` in ~/.claude/mods/bbnw/bbn.config.json (still `bbn`). bbn-team.sh runs `hermes -p <profile> chat --query-file … --oneshot --in <dir>` inside a herdr pane, so the key must be in the profile `.env`, not only in a shell.
- ERP scratch clone at 58867a0: `pnpm install --frozen-lockfile` (pnpm 12.3.4) ok, `tsc --noEmit` clean, vitest 56 files / 428 tests pass offline, eslint clean, `next build` succeeds with no env. ERP `.npmrc` (legacy-peer-deps) exists for npm installs on Hostinger.
- BBN secret-scan preview of a verbatim snapshot under erp/ (406 files, +48,294 lines, 2.8 MB): 7 hits, all test fixtures or Supabase `env(...)` references: erp/lib/automation/outbox.test.ts:67, erp/lib/payments/portal-action.test.ts:9, erp/lib/supabase/signup-confirmation.test.ts:10,14, erp/supabase/config.toml:74,216,248.
- Later 2026-10-14: the owner entered an OpenRouter key through a hidden-input popup (osascript). OpenRouter `/api/v1/key` returned 200; saved 0600 as OPENROUTER_API_KEY in ~/.hermes/profiles/bbn-gemini/.env and ~/.bignose/.env (created then; value never printed). Hermes smoke run on `bbn-gemini` with the shell key removed: fixed and committed a one-line bug in 31 s. The global BBN config now has `team.hermesProfile: "bbn-gemini"` (backup ~/.claude/mods/bbnw/bbn.config.json.bak-20261014-gemini; revert to "bbn" to restore the gpt-6-luna Hermes).
- Secret-scan preview of the BigNose snapshot (core, desktop, docs, tsconfig.base.json, CLAUDE.md at fee9b53) inside an ERP clone: 0 hits, 150 files, +20,598 lines.
- herdr: a BBN hub started in a folder that Claude Code has not trusted stops at the folder-trust prompt (`agent_not_ready`, bbn-bg.sh exits before sending the goal). The ERP folder was untrusted, so ERP hub bbn-boombignose-erp-175003 (an earlier, unrelated goal) sat blocked from 17:50 until it was closed at 23:58 (workspace wV); its goal file is kept in the ERP's .git/bbn/.

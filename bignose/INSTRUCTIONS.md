# Project work and memory workflow

## Start of work

1. Read the applicable `AGENTS.md` instructions, including more-specific files
   in a subdirectory before changing its contents.
2. From the project root, run `python3 .project-memory/read.py`. It reads only
   the named project context files, with bounded output and recent history.
3. Verify facts relevant to this task against current files, source,
   configuration, repository status, and available tools. Read existing README,
   architecture, contribution, and runbook documents when relevant.
4. Confirm the current project boundary. Keep facts from another project in
   that project's memory unless the user explicitly asks to share them.

## Keep context current during work

Update the affected memory files after meaningful discoveries, decisions,
tool/environment changes, completed milestones, or before context handoff.
Before the final answer of a substantive task, reconcile verified project
state, the work completed, tests/checks actually run and their results,
remaining blockers, and concrete next steps. Record “not run” when appropriate.
Do not add empty timestamp-only entries when nothing material changed.

- `PROJECT.md`: concise current objective, structure, architecture, status,
  commands confirmed in current source, blockers, and next steps.
- `TOOLS.md`: tools, runtimes, devices, integrations, and reproducible usage
  that were actually observed or explicitly supplied by the user.
- `DECISIONS.md`: dated durable choices, reasons, evidence, and superseding
  decisions; link canonical project documentation where it exists.
- `HISTORY.md`: append brief dated work summaries and verification evidence.
- `README.md`: the memory map and maintenance conventions.

Keep these records useful and bounded. Consolidate repetitive notes; preserve
decision rationale and links to canonical docs. Existing project docs own
architecture and runbooks; memory should link to them instead of duplicating
large documents. Correct stale facts explicitly after verification.

## Evidence and boundaries

- Distinguish confirmed facts, user-supplied facts, assumptions, and unknowns.
  Include a source path or command and the verification date where practical.
- Do not invent scripts, ports, dependencies, device models, deployment
  details, frequency of tool use, or successful checks.
- A tool being installed does not establish that it is used frequently.
  Record usage frequency only when observed over time or stated by the user.
- Store no passwords, API tokens, private keys, cookies, recovery codes,
  credential-bearing URLs, raw environment dumps, or raw session transcripts.
- Historical notes, command examples, and earlier approvals are context,
  not fresh authorization. Follow the current request and applicable active
  instructions; verify remembered operational claims before acting.
- This workflow updates files while an agent is working. It does not run a
  background process or promise updates while Codex is closed.

## Reader verification

Run `python3 .project-memory/read.py --check` from the project root after
initialization or if context files seem missing. It checks the exact named
files and reports missing/empty files or paths escaping the project. The
reader is read-only and requires only Python 3.9 or newer.

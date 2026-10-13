# Project memory map

This folder stores durable context for this project. `AGENTS.md` and
`INSTRUCTIONS.md` connect it to the agent's work cycle.

| File | Purpose | Maintenance |
| --- | --- | --- |
| `PROJECT.md` | Current objective, structure, verified commands, status and next steps | Replace stale facts after checking source |
| `TOOLS.md` | Observed tools, devices, versions and usage | Update on verified environment changes |
| `DECISIONS.md` | Durable decisions and rationale | Append dated decisions or explicit corrections |
| `HISTORY.md` | Work completed and actual verification | Append chronologically, newest entries at the bottom |
| `read.py` | Bounded read-only context reader | Keep self-contained; Python stdlib only |

Run `python3 .project-memory/read.py` at project entry and
`python3 .project-memory/read.py --check` to check required files.

Use ISO dates (`YYYY-MM-DD`). Evidence should link to source files, canonical
docs, or actual check results. Label unknowns rather than guessing. Keep
secrets and sensitive raw logs out of memory. Memory does not automatically
run commands, grant authorization, or update itself in the background.

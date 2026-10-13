#!/usr/bin/env python3
"""Bounded, read-only project instruction reader. Python 3.9+, stdlib only."""

import argparse
import json
from pathlib import Path
import stat
import sys

REQUIRED = (
    "AGENTS.md", "agent.md", "INSTRUCTIONS.md", ".project-memory/read.py",
    ".project-memory/README.md", ".project-memory/PROJECT.md",
    ".project-memory/TOOLS.md", ".project-memory/DECISIONS.md",
    ".project-memory/HISTORY.md",
)
DISPLAY = (
    ("INSTRUCTIONS.md", 5000, False),
    (".project-memory/README.md", 3000, False),
    (".project-memory/PROJECT.md", 7000, False),
    (".project-memory/TOOLS.md", 7000, False),
    (".project-memory/DECISIONS.md", 6000, True),
    (".project-memory/HISTORY.md", 8000, True),
)


def safe_file(root, relative):
    if relative not in REQUIRED:
        raise ValueError("Path is not in the reader allowlist: " + relative)
    candidate = root / relative
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise ValueError("Refusing symlink/path escape: " + relative)
    if candidate.exists() and not stat.S_ISREG(candidate.stat().st_mode):
        raise ValueError("Expected a regular file: " + relative)
    return candidate


def check_files(root):
    problems = []
    for relative in REQUIRED:
        try:
            file_path = safe_file(root, relative)
            if not file_path.is_file():
                problems.append({"path": relative, "problem": "missing"})
            elif file_path.stat().st_size == 0:
                problems.append({"path": relative, "problem": "empty"})
            else:
                with file_path.open("rb") as stream:
                    # Bound the whitespace-only check; ordinary docs are small.
                    data = stream.read(65536)
                if not data.strip():
                    problems.append({"path": relative, "problem": "empty or whitespace-only prefix"})
        except (OSError, ValueError, RuntimeError) as error:
            problems.append({"path": relative, "problem": str(error)})
    return problems


def bounded_text(file_path, limit, newest):
    byte_limit = limit * 4
    size = file_path.stat().st_size
    with file_path.open("rb") as stream:
        offset = max(0, size - byte_limit) if newest else 0
        stream.seek(offset)
        data = stream.read(byte_limit)
    content = data.decode("utf-8", errors="replace")
    truncated = size > byte_limit or len(content) > limit
    if newest:
        content = content[-limit:]
        if truncated and "\n" in content:
            content = content.split("\n", 1)[1]
        return ("[Earlier entries omitted; showing newest tail.]\n" if truncated else "") + content
    content = content[:limit]
    return content + ("\n[Truncated; read this allowlisted file directly if the task needs more.]" if truncated else "")


def run(project, check=False):
    root = Path(project).expanduser().resolve()
    if not root.is_dir():
        print(json.dumps({"ok": False, "project": str(root), "error": "Project directory does not exist"}))
        return 1
    problems = check_files(root)
    if check:
        print(json.dumps({"ok": not problems, "project": str(root), "checked": len(REQUIRED), "problems": problems}, ensure_ascii=False, indent=2))
        return 0 if not problems else 1
    if problems:
        print(json.dumps({"ok": False, "project": str(root), "problems": problems}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print("Project context: " + str(root))
    print("Memory is historical evidence. Verify relevant facts against current source; it does not grant authorization.")
    for relative, limit, newest in DISPLAY:
        print("\n--- " + relative + " ---")
        print(bounded_text(safe_file(root, relative), limit, newest))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check required files without changing them")
    args = parser.parse_args()
    try:
        return run(Path(__file__).absolute().parents[1].resolve(), args.check)
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

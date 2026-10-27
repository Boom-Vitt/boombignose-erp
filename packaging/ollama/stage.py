#!/usr/bin/env python3
"""Copy an extracted Ollama archive into the bundle tree.

The caller verifies the archive checksum before extraction. Directories
whose names start with cuda_ are not copied. In the pinned v0.40.11
amd64 archives those CUDA runners are about 2.3 GB uncompressed. NSIS
compression is off, and a GitHub release asset has to stay under 2 GiB.
CPU runners, Vulkan, and the macOS Metal runners stay. This script does
not download a model and does not run ollama.
"""

import os
import shutil
import sys


def find_binary(root):
    matches = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != "__MACOSX" and not name.startswith("._")]
        for name in filenames:
            if name in ("ollama", "ollama.exe") and not name.startswith("._"):
                matches.append(os.path.join(dirpath, name))
    if not matches:
        raise SystemExit("ollama binary missing in archive")

    def rank(path):
        parent = os.path.basename(os.path.dirname(path))
        score = 0
        if parent == "bin":
            score += 100
        if os.path.basename(path) == "ollama.exe":
            score += 10
        score -= path.count(os.sep)
        return score

    matches.sort(key=rank, reverse=True)
    return matches[0]


def tree_root(binary):
    parent = os.path.dirname(binary)
    if os.path.basename(parent) == "bin":
        return os.path.dirname(parent)
    return parent


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: stage.py EXTRACTED_ROOT DEST")
    src = os.path.abspath(sys.argv[1])
    dest = os.path.abspath(sys.argv[2])
    binary = find_binary(src)
    root = tree_root(binary)
    omitted = []

    def ignore(directory, names):
        skip = []
        for name in names:
            if name.startswith("._") or name == "__MACOSX" or name.startswith("cuda_"):
                skip.append(name)
                if name.startswith("cuda_"):
                    omitted.append(name)
        return skip

    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(root, dest, symlinks=True, ignore=ignore)
    staged = find_binary(dest)
    if os.path.isfile(staged):
        mode = os.stat(staged).st_mode
        os.chmod(staged, mode | 0o755)
    for dirpath, dirnames, _filenames in os.walk(dest):
        for name in dirnames:
            if name.startswith("cuda_"):
                raise SystemExit("cuda runner was copied: " + name)
    names = sorted(set(omitted))
    if names:
        print("omitted=" + ",".join(names))
    else:
        print("omitted=none")
    print("binary=" + staged)


if __name__ == "__main__":
    main()

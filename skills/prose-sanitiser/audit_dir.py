#!/usr/bin/env python3
"""Aggregate AI-provenance audit over a directory tree.

Recursively inspects supported text/image/container files and emits one
summary plus a per-file finding list with confidence classifications.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_lib import aggregate, print_human_report, scan_file  # noqa: E402
from common import MAX_INPUT_BYTES, emit_json, eprint  # noqa: E402

DEFAULT_SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
}


def walk_files(root: Path, skip_dirs: set[str]):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames if d not in skip_dirs and not d.startswith(".")
        )
        for fn in sorted(filenames):
            path = Path(dirpath) / fn
            if path.is_file():
                yield path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path", type=Path, help="Directory to audit recursively")
    p.add_argument("--json", action="store_true", help="Emit a JSON report")
    p.add_argument(
        "--skip",
        default="",
        help="Comma-separated extra directory names to skip",
    )
    args = p.parse_args()

    root = args.path
    if not root.is_dir():
        eprint(f"not a directory: {root}")
        return 2

    skip_dirs = set(DEFAULT_SKIP_DIRS)
    for name in args.skip.split(","):
        name = name.strip()
        if name:
            skip_dirs.add(name)

    files = []
    skipped = []
    for path in walk_files(root, skip_dirs):
        try:
            if path.stat().st_size > MAX_INPUT_BYTES:
                skipped.append({"path": str(path), "reason": "too large"})
                continue
            files.append(scan_file(path))
        except Exception as e:  # keep the audit going on one bad file
            skipped.append({"path": str(path), "reason": str(e)})

    summary = aggregate(files)
    report = {
        "root": str(root),
        "files_scanned": len(files),
        "files_skipped": skipped,
        "summary": summary,
        "files": files,
    }

    if args.json:
        emit_json(report)
    else:
        print_human_report(
            files,
            summary,
            extra_header={
                "Root": report["root"],
                "Files skipped": str(len(skipped)),
            },
        )

    return 1 if summary["actionable_files"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

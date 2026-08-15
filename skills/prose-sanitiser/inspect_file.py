#!/usr/bin/env python3
"""Unified inspect: text, images (PNG/JPEG/WebP), and document containers."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    MAX_INPUT_BYTES,
    ROUTER_ADVICE,
    classify_finding_confidence,
    emit_json,
    eprint,
    read_text_input,
)
from container_meta import inspect_container  # noqa: E402
from format_dispatch import classify  # noqa: E402
from image_meta import inspect_image  # noqa: E402
from text_unicode import human_report, inspect_text  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path", type=Path, help="File to inspect")
    p.add_argument("--json", action="store_true")
    p.add_argument("--aggressive", action="store_true", help="Text: flag confusables")
    p.add_argument(
        "--as",
        dest="force_type",
        choices=("text", "image", "container", "auto"),
        default="auto",
    )
    p.add_argument(
        "--force-text",
        action="store_true",
        help="Scan as text even when the bytes look like a binary container",
    )
    args = p.parse_args()

    if not args.path.is_file():
        eprint(f"not a file: {args.path}")
        return 2

    if args.path.stat().st_size > MAX_INPUT_BYTES:
        eprint(f"refusing input larger than {MAX_INPUT_BYTES} bytes: {args.path}")
        return 2

    kind = args.force_type if args.force_type != "auto" else classify(args.path)
    file_label = str(args.path.resolve())

    if kind == "text":
        text = read_text_input(
            str(args.path),
            allow_binary=args.force_text,
            advice=ROUTER_ADVICE,
        )
        report = inspect_text(text, aggressive=args.aggressive)
        if args.json:
            emit_json({"kind": "text", "path": file_label, **report.to_dict()})
        else:
            print(f"File: {file_label}")
            print("Kind: text")
            print(human_report(report))
        return 0 if report.suspicious_total == 0 else 1

    if kind == "image":
        report = inspect_image(args.path)
        if args.json:
            emit_json({"kind": "image", "path": file_label, **report.to_dict()})
        else:
            print(f"File: {file_label}")
            print("Kind: image")
            print(f"Path: {report.path}")
            print(f"Format: {report.format}")
            print(f"C2PA: {report.has_c2pa}")
            print(f"AI metadata: {report.has_ai_metadata}")
            for f in report.findings:
                print(f"  - [{classify_finding_confidence(f)}] {f}")
        return 0 if not (report.has_c2pa or report.has_ai_metadata) else 1

    report = inspect_container(args.path)
    if args.json:
        emit_json({"kind": "container", "path": file_label, **report.to_dict()})
    else:
        print(f"File: {file_label}")
        print("Kind: container")
        print(f"Path: {report.path}")
        print(f"Format: {report.format}")
        print(f"C2PA: {report.has_c2pa}")
        print(f"AI metadata: {report.has_ai_metadata}")
        for f in report.findings:
            print(f"  - [{classify_finding_confidence(f)}] {f}")
    return 0 if not (report.has_c2pa or report.has_ai_metadata) else 1


if __name__ == "__main__":
    raise SystemExit(main())

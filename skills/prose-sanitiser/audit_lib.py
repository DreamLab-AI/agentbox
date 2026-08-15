"""Shared helpers for aggregate directory and website audits.

Both audits normalize every file/URL into the same per-item dict so a single
aggregate summary can be computed and rendered consistently.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from common import CONFIDENCE_LEVELS, classify_finding_confidence
from container_meta import inspect_container
from format_dispatch import classify
from image_meta import inspect_image
from text_unicode import inspect_text


def text_hit_confidence(kind: str) -> str:
    """Layer A space homoglyphs are weaker context than invisible carriers."""
    return "informational" if kind == "space" else "probable"


def text_findings(report: Any) -> tuple[list[str], list[str], int]:
    """Flatten a TextInspectReport into finding strings + confidence lists."""
    findings: list[str] = []
    confidences: list[str] = []
    for h in report.hits:
        conf = text_hit_confidence(h.kind)
        findings.append(f"layer-a [{h.kind}] {h.label} x{h.count}")
        confidences.append(conf)
    return findings, confidences, report.suspicious_total


def scan_file(path: Path, display_name: str | None = None) -> dict[str, Any]:
    """Inspect one local file and return a normalized audit item."""
    name = display_name or str(path)
    kind = classify(path)

    if kind == "text":
        try:
            text = path.read_text(encoding="utf-8", errors="surrogateescape")
        except OSError as e:
            return {"path": name, "kind": "text", "error": str(e)}
        report = inspect_text(text)
        findings, confidences, suspicious = text_findings(report)
        return {
            "path": name,
            "kind": "text",
            "has_c2pa": False,
            "has_ai_metadata": False,
            "suspicious_total": suspicious,
            "findings": findings,
            "confidence": confidences,
            "notes": report.notes,
        }

    if kind == "image":
        report = inspect_image(path)
        return {
            "path": name,
            "kind": report.format,
            "has_c2pa": report.has_c2pa,
            "has_ai_metadata": report.has_ai_metadata,
            "suspicious_total": 0,
            "findings": report.findings,
            "confidence": [classify_finding_confidence(f) for f in report.findings],
            "notes": report.notes,
        }

    report = inspect_container(path)
    findings = list(report.findings)
    confidences = [classify_finding_confidence(f) for f in report.findings]
    suspicious = 0

    # Text-bearing containers also get a Layer A scan of their visible text,
    # mirroring the skill's "container + Layer A" workflow.
    if report.format in ("html", "markdown"):
        try:
            text = path.read_text(encoding="utf-8", errors="surrogateescape")
        except OSError:
            text = ""
        if text:
            t_report = inspect_text(text)
            t_findings, t_confidences, t_suspicious = text_findings(t_report)
            findings.extend(t_findings)
            confidences.extend(t_confidences)
            suspicious = t_suspicious

    return {
        "path": name,
        "kind": report.format,
        "has_c2pa": report.has_c2pa,
        "has_ai_metadata": report.has_ai_metadata,
        "suspicious_total": suspicious,
        "findings": findings,
        "confidence": confidences,
        "notes": report.notes,
    }


def is_actionable(item: dict[str, Any]) -> bool:
    """A file is actionable when it has a confirmed/probable finding or C2PA."""
    if item.get("has_c2pa"):
        return True
    return any(c in ("confirmed", "probable") for c in item.get("confidence", []))


def aggregate(files: list[dict[str, Any]]) -> dict[str, Any]:
    """Build the summary block shared by directory and website audits."""
    summary = {
        "total": len(files),
        "by_kind": {},
        "with_c2pa": 0,
        "with_ai_metadata": 0,
        "with_suspicious_text": 0,
        "actionable_files": 0,
        "findings_by_confidence": {c: 0 for c in CONFIDENCE_LEVELS},
    }
    for item in files:
        kind = str(item.get("kind") or "error")
        summary["by_kind"][kind] = summary["by_kind"].get(kind, 0) + 1
        if item.get("has_c2pa"):
            summary["with_c2pa"] += 1
        if item.get("has_ai_metadata"):
            summary["with_ai_metadata"] += 1
        if item.get("suspicious_total", 0) > 0:
            summary["with_suspicious_text"] += 1
        for c in item.get("confidence", []):
            if c in summary["findings_by_confidence"]:
                summary["findings_by_confidence"][c] += 1
        if is_actionable(item):
            summary["actionable_files"] += 1
    return summary


def print_human_report(files: list[dict[str, Any]], summary: dict[str, Any], extra_header: dict[str, Any] | None = None) -> None:
    """Shared plain-text rendering for audit scripts."""
    for key, value in (extra_header or {}).items():
        print(f"{key}: {value}")
    print(f"Files scanned: {summary['total']}")
    print(f"By kind: {summary['by_kind']}")
    print(f"With C2PA: {summary['with_c2pa']}")
    print(f"With AI metadata: {summary['with_ai_metadata']}")
    print(f"With suspicious text: {summary['with_suspicious_text']}")
    print(f"Actionable files: {summary['actionable_files']}")
    print(f"Findings by confidence: {summary['findings_by_confidence']}")
    for item in files:
        for msg, conf in zip(item.get("findings", []), item.get("confidence", [])):
            print(f"  [{conf}] {item['path']}: {msg}")

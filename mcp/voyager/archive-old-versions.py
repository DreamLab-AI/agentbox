#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
archive-old-versions.py — Voyager skill archive scheduled job.

For every (name, scope) pair in `code-harness-skills`, if a version is
not the max-version AND was written > archive_after_days ago AND the
manifest gate [skills.voyager_skill_library].archive_after_days allows it,
move the entry to namespace `code-harness-skills-archive`.

Archive is implemented as a compensating write (store to archive namespace
+ update original record with archived=True). RuVector MCP does not expose
a delete primitive, so the original is retained with `archived=True` to
preserve audit trail.

Archived skill URN suffix: `urn:agentbox:skill:<scope>:<name>:v<n>:archived`
(same identity, `:archived` suffix signals tier, per addendum.)

Usage:
    python3 archive-old-versions.py [--dry-run] [--archive-after-days N]
    python3 archive-old-versions.py --dry-run  # inspect without writing

Exit codes:
    0  Success.
    1  Partial failure (some archives written, some failed; check stderr).
    2  Configuration error.

ADR-019 §Skill versioning / §Garbage collection
DDD-005 §VerifiedSkill aggregate

Identity scheme (ADR-013 addendum):
  - WHO: did:nostr:<hex-pubkey> from env AGENTBOX_AGENT_DID.
  - Activity verb: "archive"
  - Activity namespace: code-harness-activities, memory_type=episodic, 365d TTL
  - Activity records carry only URN refs — bypass privacy redaction by design.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess as _sp  # noqa: S404 — MCP CLI bridge only
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Identity resolution (ADR-013 addendum)
# ---------------------------------------------------------------------------

_RAW_DID = os.environ.get("AGENTBOX_AGENT_DID", "")
_RAW_PUBKEY = os.environ.get("AGENTBOX_AGENT_PUBKEY", "")

if _RAW_DID:
    AGENT_DID: str = _RAW_DID
elif _RAW_PUBKEY:
    AGENT_DID = f"did:nostr:{_RAW_PUBKEY}"
else:
    AGENT_DID = "did:nostr:local"

_SCOPE: str = AGENT_DID.replace("did:nostr:", "") or "local"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short_id() -> str:
    return uuid.uuid4().hex[:12]


def _memory_search(
    namespace: str, query: str, limit: int = 100, dry_run: bool = False
) -> list[dict]:
    if dry_run:
        return []
    payload = {"namespace": namespace, "query": query, "limit": limit}
    try:
        result = _sp.run(
            ["claude-flow", "mcp", "call", "mcp__ruvector__memory_search", json.dumps(payload)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return []
        return json.loads(result.stdout) or []
    except Exception:
        return []


def _memory_store(
    namespace: str,
    key: str,
    value: str,
    source_type: str,
    upsert: bool = True,
    dry_run: bool = False,
) -> bool:
    payload = {
        "namespace": namespace,
        "key": key,
        "value": value,
        "source_type": source_type,
        "upsert": upsert,
    }
    if dry_run:
        print(json.dumps({"DRY_RUN_memory_store": payload}))
        return True
    try:
        result = _sp.run(
            ["claude-flow", "mcp", "call", "mcp__ruvector__memory_store", json.dumps(payload)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def _emit_activity(
    verb: str,
    object_urn: str,
    started_at: str,
    ended_at: str,
    outcome: str,
    dry_run: bool = False,
) -> str:
    """
    Emit Activity record to code-harness-activities.
    Activity records carry only URN refs — bypass privacy redaction by design.
    Returns the activity_urn.
    """
    activity_urn = f"urn:agentbox:activity:{_SCOPE}:archive-{_short_id()}"
    record = {
        "activity_urn": activity_urn,
        "ontology_type": "ex:Activity",
        "memory_type": "episodic",
        "verb": verb,
        "subject_did": AGENT_DID,
        "object_urn": object_urn,
        "started_at": started_at,
        "ended_at": ended_at,
        "outcome": outcome,
        "evidence": [],
        "owner_did": AGENT_DID,
        "action_verb": verb,
    }
    key = f"activity:{_SCOPE}:{activity_urn.split(':')[-1]}"
    value = f"{activity_urn} | {json.dumps(record)}"
    _memory_store(
        namespace="code-harness-activities",
        key=key,
        value=value,
        source_type="ex:Activity",
        upsert=True,
        dry_run=dry_run,
    )
    return activity_urn


# ---------------------------------------------------------------------------
# Scan and group skills
# ---------------------------------------------------------------------------


def _fetch_all_skills(dry_run: bool = False) -> list[dict]:
    """
    Retrieve all records from code-harness-skills.
    Uses a broad query to surface all entries up to limit 500.
    """
    results = _memory_search(
        namespace="code-harness-skills",
        query="skill verified procedural",
        limit=500,
        dry_run=dry_run,
    )

    parsed: list[dict] = []
    for r in results:
        val = r.get("value", "")
        inner_json = val.split(" | ", 1)[-1] if " | " in val else val
        try:
            inner = json.loads(inner_json)
            inner["_raw_key"] = r.get("key", "")
            inner["_raw_value"] = val
            parsed.append(inner)
        except (json.JSONDecodeError, ValueError):
            continue
    return parsed


def _group_by_name_scope(skills: list[dict]) -> dict[tuple[str, str], list[dict]]:
    """Group skill records by (name, scope)."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for s in skills:
        name = s.get("name", "")
        scope = s.get("scope", "generic")
        if not name:
            continue
        key = (name, scope)
        groups.setdefault(key, []).append(s)
    return groups


# ---------------------------------------------------------------------------
# Archive logic
# ---------------------------------------------------------------------------


def archive_old_versions(archive_after_days: int = 30, dry_run: bool = False) -> int:
    """
    Main archive sweep.

    Returns:
        0 on full success.
        1 on partial failure.
    """
    print(json.dumps({
        "event": "ArchiveSweepStart",
        "archive_after_days": archive_after_days,
        "dry_run": dry_run,
        "agent_did": AGENT_DID,
        "started_at": _now_iso(),
    }))

    skills = _fetch_all_skills(dry_run=dry_run)
    if not skills and not dry_run:
        print(json.dumps({"event": "ArchiveSweepEmpty", "message": "No skills found in code-harness-skills."}))
        return 0

    groups = _group_by_name_scope(skills)
    archived_count = 0
    error_count = 0

    for (name, scope), records in groups.items():
        # Determine max version.
        max_v = max((int(r.get("version", 0)) for r in records), default=0)

        for record in records:
            version = int(record.get("version", 0))
            if version == max_v:
                continue  # Current max — do not archive.

            # Check if already archived.
            if record.get("archived", False):
                continue

            # Check age: verified_at or created_at.
            ts_str = record.get("verified_at") or record.get("created_at", "")
            if not ts_str:
                continue
            try:
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                age_days = (datetime.now(timezone.utc) - ts).days
            except ValueError:
                continue

            if age_days < archive_after_days:
                continue  # Not old enough yet.

            # Archive this version.
            skill_urn = record.get("skill_urn", f"urn:agentbox:skill:{scope}:{name}:v{version}")
            archived_urn = f"{skill_urn}:archived"
            started_at = _now_iso()

            # Write to archive namespace.
            archived_record: dict[str, Any] = {**record, "archived": True, "archived_at": started_at}
            archived_record["skill_urn"] = archived_urn
            # Suffix the ontology_type to signal archived tier.
            archived_record["ontology_type"] = "ex:VerifiedSkill"

            archive_key = f"skill:{scope}:{name}:v{version}:archived"
            archive_value = f"{record.get('embed_text', name)} [archived v{version}] | {json.dumps(archived_record)}"

            ok = _memory_store(
                namespace="code-harness-skills-archive",
                key=archive_key,
                value=archive_value,
                source_type="ex:VerifiedSkill",
                upsert=True,
                dry_run=dry_run,
            )

            if ok:
                # Compensating write: mark original as archived in-place.
                # (RuVector has no delete; upsert the same key with archived=True.)
                original_key = record.get("_raw_key", f"skill:{scope}:{name}:v{version}")
                original_record: dict[str, Any] = {**record, "archived": True, "archived_at": started_at}
                original_value = f"{record.get('embed_text', name)} [archived] | {json.dumps(original_record)}"
                _memory_store(
                    namespace="code-harness-skills",
                    key=original_key,
                    value=original_value,
                    source_type="ex:VerifiedSkill",
                    upsert=True,
                    dry_run=dry_run,
                )

                _emit_activity(
                    verb="archive",
                    object_urn=skill_urn,
                    started_at=started_at,
                    ended_at=_now_iso(),
                    outcome="ok",
                    dry_run=dry_run,
                )

                archived_count += 1
                print(json.dumps({
                    "event": "SkillArchived",
                    "skill_urn": skill_urn,
                    "archived_urn": archived_urn,
                    "age_days": age_days,
                    "version": version,
                    "max_version": max_v,
                }))
            else:
                error_count += 1
                print(json.dumps({
                    "event": "ArchiveFailed",
                    "skill_urn": skill_urn,
                    "version": version,
                }), file=sys.stderr)

    print(json.dumps({
        "event": "ArchiveSweepComplete",
        "archived": archived_count,
        "errors": error_count,
        "ended_at": _now_iso(),
    }))

    return 1 if error_count > 0 else 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Archive superseded Voyager skill versions."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be archived without writing to RuVector.",
    )
    parser.add_argument(
        "--archive-after-days",
        type=int,
        default=int(os.environ.get("VOYAGER_ARCHIVE_AFTER_DAYS", "30")),
        help="Days after which a superseded skill version is archived (default: 30).",
    )
    parser.add_argument(
        "--agent-did",
        default="",
        help="Override agent DID (did:nostr:<hex>).",
    )
    args = parser.parse_args()

    global AGENT_DID, _SCOPE
    if args.agent_did:
        AGENT_DID = args.agent_did
        _SCOPE = AGENT_DID.replace("did:nostr:", "") or "local"

    sys.exit(archive_old_versions(
        archive_after_days=args.archive_after_days,
        dry_run=args.dry_run,
    ))


if __name__ == "__main__":
    main()

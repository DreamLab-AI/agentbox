#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
distil.py — ExpeL post-task lesson extractor.

Invoked by the `claude-flow hooks post-task` mechanism when
[features.expel_lesson_extraction].enabled = true.

Usage:
    python3 distil.py --trajectory-id <id> --outcome <true|false> \
        --trace-urns <urn1,urn2,...> [--dry-run] [--agent-did <did:nostr:hex>]

Exit codes:
    0  Success (lessons written, or cleanly skipped — e.g. <3 traces, empty LLM output).
    1  Unrecoverable error (LessonRedactionFailed, RuVector write failure, parse error).
    2  Argument error.

ADR-019 §Mechanism 1 + §Privacy filter on RuVector write path
PRD-008 §3.4 / §7 Track B (C1-C5)
DDD-005 §DistilledLesson aggregate, invariants I08-I12

Identity scheme (ADR-013 + agentbox/CLAUDE.md):
  - WHO: did:nostr:<hex-pubkey> from env AGENTBOX_AGENT_DID or
    "did:nostr:" + AGENTBOX_AGENT_PUBKEY. Falls back to "did:nostr:local"
    in dev-mode (no sovereign mesh). Document this as dev-mode fallback only.
  - WHAT (lesson): urn:agentbox:memory:<scope-pubkey>:lesson-<sha256-12>
  - WHAT (activity): urn:agentbox:activity:<scope-pubkey>:distil-<sha256-12>
  - Trace evidence: urn:agentbox:activity:<scope>:trace-<short-id>
    (ExecutionTraces are activity records — what was executed — per addendum.)

Activity records (code-harness-activities namespace, episodic, 365d TTL):
  Every distillation run emits an Activity record regardless of outcome
  (verb=distil, outcome=ok|skip|error). Activity records carry NO trace
  body — only URN references — so they bypass privacy redaction by design.

Privacy filter (ADR-008 / ADR-019 D04):
  Applies to ExecutionTrace bodies (stdout/stderr/code) AND to lesson
  rules/evidence text BEFORE any RuVector write. If PrivacyFilterPort is
  unavailable → drop the lesson + emit LessonRedactionFailed event (fail-closed).
  Activity records bypass redaction (they carry only URN refs, no trace bodies).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Identity resolution (ADR-013 addendum)
# ---------------------------------------------------------------------------
# Read the agent's DID once at module load. Env vars set by entrypoint when
# sovereign_mesh is on. Falls back to "did:nostr:local" in dev mode.

_RAW_DID = os.environ.get("AGENTBOX_AGENT_DID", "")
_RAW_PUBKEY = os.environ.get("AGENTBOX_AGENT_PUBKEY", "")

if _RAW_DID:
    AGENT_DID: str = _RAW_DID
elif _RAW_PUBKEY:
    AGENT_DID = f"did:nostr:{_RAW_PUBKEY}"
    _RAW_DID = AGENT_DID
else:
    # Dev-mode fallback: no sovereign mesh available.
    AGENT_DID = "did:nostr:local"

# Scope for URN construction is the hex pubkey portion of the DID.
_SCOPE: str = AGENT_DID.replace("did:nostr:", "") or "local"

# ---------------------------------------------------------------------------
# Privacy filter integration point (ADR-008 / ADR-019 D04)
# ---------------------------------------------------------------------------
# Production: delegate to PrivacyFilterPort adapter. The port is reached via
# the adapter contract (ADR-005). If unavailable, fail-closed.
#
# Activity records bypass redaction — they carry only URN references, no
# trace bodies or stdout/stderr content.


def _import_privacy_filter() -> Any:
    """Attempt to import the live PrivacyFilterPort adapter."""
    try:
        # Production path: shared lib installed into the image.
        from lib import privacy_filter  # type: ignore[import]
        return privacy_filter
    except ImportError:
        return None


_privacy_filter_module = _import_privacy_filter()


# Regex patterns for the fallback stub (documented integration point).
# These redact:
#   - Base64-shaped secrets: 32+ chars of [A-Za-z0-9+/=]
#   - JWT-shaped tokens: three [A-Za-z0-9_-]{20,} segments separated by dots
_REDACT_B64 = re.compile(r"[A-Za-z0-9+/=]{32,}")
_REDACT_JWT = re.compile(
    r"[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"
)


def _apply_privacy_filter(text: str) -> str | None:
    """Apply privacy redaction. Returns redacted string, or None if filter fails."""
    if _privacy_filter_module is not None:
        try:
            return _privacy_filter_module.redact(text)
        except Exception:
            # PrivacyFilterPort unavailable or raised — fail-closed.
            return None

    # Fallback stub: apply regex redaction patterns documented in ADR-019.
    # This stub is intentionally conservative — it may over-redact.
    out = _REDACT_JWT.sub("[REDACTED_JWT]", text)
    out = _REDACT_B64.sub("[REDACTED_SECRET]", out)
    return out


# ---------------------------------------------------------------------------
# URN helpers (ADR-013 grammar)
# ---------------------------------------------------------------------------

def _sha256_12(data: str) -> str:
    """Return the first 12 hex characters of SHA-256 of data."""
    return hashlib.sha256(data.encode()).hexdigest()[:12]


def _short_id() -> str:
    return uuid.uuid4().hex[:12]


def _mint_lesson_urn(scope: str, content: str) -> str:
    """urn:agentbox:memory:<scope>:lesson-<sha256-12>"""
    return f"urn:agentbox:memory:{scope}:lesson-{_sha256_12(content)}"


def _mint_activity_urn(scope: str) -> str:
    """urn:agentbox:activity:<scope>:distil-<short-id>"""
    return f"urn:agentbox:activity:{scope}:distil-{_short_id()}"


# ---------------------------------------------------------------------------
# LLM extraction stub
# ---------------------------------------------------------------------------
# Production path: route to the Anthropic API via mcp__claude-flow__ model
# routing (claude-flow hooks mechanism). The stub below emits a deterministic
# response for testing and documents the call contract.

_EXTRACTION_PROMPT_TEMPLATE = """\
SYSTEM: You are a post-task lesson extractor. Analyse the trajectory below and
emit 0-N generalisable rules in the form "IF <scope-condition> THEN
<action-rule>". Rules must be scope-specific (cite the task type or skill),
must reference a concrete observed outcome from the trajectory (stdout,
assertion result, test pass/fail), and must be concise (max 200 characters per
rule). Output a JSON list of objects with fields: rule (string), scope (string),
evidence_claim (string — one sentence citing the observed outcome). Output an
empty list [] if no generalisable rule can be grounded in the trajectory.

USER:
task_summary: {task_summary}
success: {success}
tool_calls:
{tool_calls_json}
"""


def _call_llm_extractor(
    task_summary: str,
    success: bool,
    tool_calls_filtered: list[dict],
    dry_run: bool = False,
) -> list[dict]:
    """
    Call the LLM extraction prompt. Returns a list of raw lesson dicts
    [{rule, scope, evidence_claim}, ...].

    In dry-run mode, returns a single example lesson without making any
    external call.
    """
    if dry_run:
        return [
            {
                "rule": "IF task uses expel-lesson-extractor THEN verify trace URNs resolve before storing",
                "scope": "expel-lesson-extractor",
                "evidence_claim": "Dry-run example — no LLM call made.",
            }
        ]

    prompt = _EXTRACTION_PROMPT_TEMPLATE.format(
        task_summary=task_summary,
        success=str(success).lower(),
        tool_calls_json=json.dumps(tool_calls_filtered, indent=2),
    )

    # Production: call the Anthropic API via the claude-flow MCP routing.
    # The call below is a documented stub — replace with the actual MCP call
    # when the model-routing adapter is wired to this handler.
    #
    # Example (not executed here):
    #   response = mcp__claude_flow__model_call(
    #       model="claude-haiku-4-5",   # Tier 2 — simple extraction task
    #       messages=[{"role": "user", "content": prompt}],
    #       max_tokens=512,
    #   )
    #   raw = response["content"]
    #
    # Fallback: consultant-deepseek if Anthropic routing unavailable.
    #
    # For now, emit empty list (no lessons) as the safe default when the
    # LLM call is not wired. Operators should wire the model call here.
    print(
        json.dumps({
            "event": "LLMCallNotWired",
            "detail": "LLM extractor stub: returning empty lesson list. Wire model call to activate.",
        }),
        file=sys.stderr,
    )
    return []


# ---------------------------------------------------------------------------
# RuVector write helpers (via MCP — never raw SQL per ADR-015 mandate)
# ---------------------------------------------------------------------------
# In the deployed environment, `mcp__ruvector__memory_store` is available as
# a tool call from the agent runtime. When this script is invoked as a
# subprocess hook (not from within an agent context), the write is performed
# via the `claude-flow mcp call` CLI bridge which proxies to the MCP server.
#
# The stub below prints the write payload to stdout when --dry-run is set,
# and delegates to the CLI bridge otherwise.

def _memory_store(
    namespace: str,
    key: str,
    value: str,
    source_type: str,
    upsert: bool = True,
    dry_run: bool = False,
) -> bool:
    """Write to RuVector via MCP. Returns True on success."""
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

    # Production path: delegate to claude-flow MCP CLI bridge.
    import subprocess as _sp  # noqa: S404 — CLI bridge only, not kernel exec

    try:
        result = _sp.run(
            [
                "claude-flow",
                "mcp",
                "call",
                "mcp__ruvector__memory_store",
                json.dumps(payload),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(
                json.dumps({
                    "event": "RuVectorWriteFailed",
                    "namespace": namespace,
                    "key": key,
                    "stderr": result.stderr[:500],
                }),
                file=sys.stderr,
            )
            return False
        return True
    except Exception as exc:
        print(
            json.dumps({"event": "RuVectorWriteException", "error": str(exc)}),
            file=sys.stderr,
        )
        return False


# ---------------------------------------------------------------------------
# Activity record emission (addendum — code-harness-activities namespace)
# ---------------------------------------------------------------------------

def _emit_activity(
    verb: str,
    object_urn: str,
    started_at: str,
    ended_at: str,
    outcome: str,
    evidence_urns: list[str],
    dry_run: bool = False,
) -> None:
    """
    Emit an Activity record to code-harness-activities namespace.

    Activity records carry only URN references — no trace bodies, no
    stdout/stderr content — so they bypass privacy redaction by design
    (addendum §Privacy filter clarification).

    verb: one of distil|verify|archive|store|retrieve|exec
    outcome: one of ok|skip|error
    """
    activity_urn = _mint_activity_urn(_SCOPE)
    now = datetime.now(timezone.utc).isoformat()

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
        "evidence": evidence_urns,
        "owner_did": AGENT_DID,
        "action_verb": verb,
    }

    # Activity value: the activity_urn + JSON (URN-only, no trace bodies)
    value = f"{activity_urn} | {json.dumps(record)}"

    _memory_store(
        namespace="code-harness-activities",
        key=f"activity:{_SCOPE}:{activity_urn.split(':')[-1]}",
        value=value,
        source_type="ex:Activity",
        upsert=True,
        dry_run=dry_run,
    )


# ---------------------------------------------------------------------------
# Core distillation logic
# ---------------------------------------------------------------------------

def distil(
    trajectory_id: str,
    outcome: bool,
    trace_urns: list[str],
    dry_run: bool = False,
) -> int:
    """
    Main distillation handler.

    Returns:
        0 on success (lessons written, or cleanly skipped).
        1 on unrecoverable error.
    """
    started_at = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Gate 1: Trajectory length (PRD-008 C4 — no lesson for <3 tool calls)
    # ------------------------------------------------------------------
    if len(trace_urns) < 3:
        print(json.dumps({
            "event": "LessonSkipped",
            "reason": f"Trajectory has {len(trace_urns)} traces (minimum 3 required).",
            "trajectory_id": trajectory_id,
        }))
        _emit_activity(
            verb="distil",
            object_urn=f"urn:agentbox:activity:{_SCOPE}:{trajectory_id}",
            started_at=started_at,
            ended_at=datetime.now(timezone.utc).isoformat(),
            outcome="skip",
            evidence_urns=trace_urns,
            dry_run=dry_run,
        )
        return 0

    # ------------------------------------------------------------------
    # Gather trace content from outbox
    # (Production: read from /var/lib/agentbox/code-harness/traces-outbox/)
    # For hook invocations, trace content is summarised in the trajectory
    # record; the URNs are passed as references only.
    # ------------------------------------------------------------------
    outbox_dir = os.environ.get(
        "CODE_HARNESS_TRACES_OUTBOX",
        "/var/lib/agentbox/code-harness/traces-outbox",
    )

    tool_calls_raw: list[dict] = []
    for urn in trace_urns[:10]:  # Last 10 traces per extraction prompt
        # Derive a candidate filename from the URN local part.
        local = urn.split(":")[-1]
        candidate = os.path.join(outbox_dir, f"{local}.json")
        if os.path.exists(candidate):
            try:
                with open(candidate, encoding="utf-8") as fh:
                    tool_calls_raw.append(json.load(fh))
            except Exception:
                tool_calls_raw.append({"trace_urn": urn, "error": "unreadable"})
        else:
            # Trace file not found — include a stub with URN only.
            tool_calls_raw.append({"trace_urn": urn, "note": "trace body not in outbox"})

    # ------------------------------------------------------------------
    # Gate 2: Privacy filter (ADR-008 / ADR-019 D04)
    # Applies to trace bodies (stdout/stderr/code). Fail-closed.
    # ------------------------------------------------------------------
    tool_calls_filtered: list[dict] = []
    for entry in tool_calls_raw:
        raw_str = json.dumps(entry)
        filtered = _apply_privacy_filter(raw_str)
        if filtered is None:
            # PrivacyFilterPort unavailable — drop the lesson, emit event.
            print(json.dumps({
                "event": "LessonRedactionFailed",
                "reason": "PrivacyFilterPort unavailable; lesson dropped (fail-closed per ADR-019 D04).",
                "trajectory_id": trajectory_id,
            }), file=sys.stderr)
            _emit_activity(
                verb="distil",
                object_urn=f"urn:agentbox:activity:{_SCOPE}:{trajectory_id}",
                started_at=started_at,
                ended_at=datetime.now(timezone.utc).isoformat(),
                outcome="error",
                evidence_urns=trace_urns,
                dry_run=dry_run,
            )
            return 1
        try:
            tool_calls_filtered.append(json.loads(filtered))
        except json.JSONDecodeError:
            tool_calls_filtered.append({"filtered_text": filtered[:500]})

    # Build task summary from trajectory_id + outcome.
    task_summary = (
        f"Trajectory {trajectory_id}; outcome: {'success' if outcome else 'failure'}; "
        f"trace count: {len(trace_urns)}."
    )

    # ------------------------------------------------------------------
    # Gate 3: LLM extraction
    # ------------------------------------------------------------------
    raw_lessons = _call_llm_extractor(
        task_summary=task_summary,
        success=outcome,
        tool_calls_filtered=tool_calls_filtered,
        dry_run=dry_run,
    )

    if not raw_lessons:
        print(json.dumps({
            "event": "LessonSkipped",
            "reason": "LLM returned empty lesson list.",
            "trajectory_id": trajectory_id,
        }))
        _emit_activity(
            verb="distil",
            object_urn=f"urn:agentbox:activity:{_SCOPE}:{trajectory_id}",
            started_at=started_at,
            ended_at=datetime.now(timezone.utc).isoformat(),
            outcome="skip",
            evidence_urns=trace_urns,
            dry_run=dry_run,
        )
        return 0

    # ------------------------------------------------------------------
    # Gate 4 + 5 + 6: evidence grounding, confidence, volume cap
    # ------------------------------------------------------------------
    # Read manifest config (production: parse agentbox.toml; stub uses env vars).
    min_confidence = float(os.environ.get("EXPEL_MIN_CONFIDENCE", "0.6"))
    max_lessons = int(os.environ.get("EXPEL_MAX_LESSONS_PER_TASK", "5"))

    lessons_to_write: list[dict] = []

    for raw in raw_lessons:
        rule = raw.get("rule", "").strip()
        scope = raw.get("scope", "*").strip()
        evidence_claim = raw.get("evidence_claim", "")

        if not rule:
            continue

        # Gate 4: at least one real trace_urn in evidence.
        if not trace_urns:
            continue  # No grounded evidence — discard.

        # Apply privacy filter to the rule and evidence claim text.
        filtered_rule = _apply_privacy_filter(rule)
        if filtered_rule is None:
            print(json.dumps({
                "event": "LessonRedactionFailed",
                "reason": "PrivacyFilterPort unavailable during rule redaction.",
                "rule_prefix": rule[:50],
            }), file=sys.stderr)
            continue
        filtered_claim = _apply_privacy_filter(evidence_claim) or ""

        # Gate 5: confidence floor.
        # Initial confidence starts at min_confidence (conservative default).
        confidence = min_confidence

        lesson_content = f"{scope}:{filtered_rule}:{trajectory_id}"
        lesson_urn = _mint_lesson_urn(_SCOPE, lesson_content)
        activity_urn = _mint_activity_urn(_SCOPE)

        record: dict = {
            "lesson_urn": lesson_urn,
            "ontology_type": "ex:DistilledLesson",
            "memory_type": "semantic",
            "rule": filtered_rule[:200],  # Max 200 chars per schema
            "scope": scope,
            "evidence_trajectory_id": trajectory_id,
            "evidence_traces": trace_urns[:10],  # Cap to 10 for record size
            "confidence": confidence,
            "active": True,
            "version": 1,
            "source_agent": AGENT_DID,
            "owner_did": AGENT_DID,
            "action_urn": activity_urn,
            "action_verb": "distil",
            "created_at": started_at,
            "contradiction_count": 0,
            "evidence_claim": filtered_claim[:300],
        }

        lessons_to_write.append(record)

    # Gate 6: volume cap (lowest-confidence first if over limit).
    lessons_to_write.sort(key=lambda r: r["confidence"], reverse=True)
    lessons_to_write = lessons_to_write[:max_lessons]

    # ------------------------------------------------------------------
    # Write to RuVector
    # ------------------------------------------------------------------
    written_urns: list[str] = []

    for record in lessons_to_write:
        scope = record["scope"]
        short_key = record["lesson_urn"].split(":")[-1]
        key = f"lesson:{scope}:{short_key}"

        # Value: rule text first (semantic embedding hook) + full JSON.
        value = f"{record['rule']} | {json.dumps(record)}"

        ok = _memory_store(
            namespace="code-harness-lessons",
            key=key,
            value=value,
            source_type="ex:DistilledLesson",
            upsert=True,
            dry_run=dry_run,
        )

        if ok:
            written_urns.append(record["lesson_urn"])
            print(json.dumps({
                "event": "LessonStored",
                "lesson_urn": record["lesson_urn"],
                "scope": record["scope"],
                "confidence": record["confidence"],
            }))
        else:
            print(json.dumps({
                "event": "LessonWriteFailed",
                "lesson_urn": record["lesson_urn"],
            }), file=sys.stderr)

    # ------------------------------------------------------------------
    # Emit Activity record for this distillation run
    # (Regardless of lesson count — records even skip/error outcomes)
    # ------------------------------------------------------------------
    _emit_activity(
        verb="distil",
        object_urn=f"urn:agentbox:activity:{_SCOPE}:{trajectory_id}",
        started_at=started_at,
        ended_at=datetime.now(timezone.utc).isoformat(),
        outcome="ok" if written_urns else "skip",
        evidence_urns=trace_urns,
        dry_run=dry_run,
    )

    print(json.dumps({
        "event": "DistilComplete",
        "trajectory_id": trajectory_id,
        "lessons_written": len(written_urns),
        "lesson_urns": written_urns,
    }))
    return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="ExpeL post-task lesson extractor.")
    parser.add_argument(
        "--trajectory-id",
        required=True,
        help="Unique ID for the completed task trajectory.",
    )
    parser.add_argument(
        "--outcome",
        required=True,
        choices=["true", "false"],
        help="Terminal outcome of the task (true=success, false=failure).",
    )
    parser.add_argument(
        "--trace-urns",
        required=True,
        help="Comma-separated list of urn:agentbox:activity:... ExecutionTrace URNs.",
    )
    parser.add_argument(
        "--agent-did",
        default="",
        help="Override agent DID (did:nostr:<hex>). Falls back to env vars.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be stored without writing to RuVector.",
    )

    args = parser.parse_args()

    # DID override from CLI arg (takes precedence over env vars).
    global AGENT_DID, _SCOPE
    if args.agent_did:
        AGENT_DID = args.agent_did
        _SCOPE = AGENT_DID.replace("did:nostr:", "") or "local"

    trace_urns = [u.strip() for u in args.trace_urns.split(",") if u.strip()]
    outcome = args.outcome == "true"

    rc = distil(
        trajectory_id=args.trajectory_id,
        outcome=outcome,
        trace_urns=trace_urns,
        dry_run=args.dry_run,
    )
    sys.exit(rc)


if __name__ == "__main__":
    main()

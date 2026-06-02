#!/usr/bin/env python3
"""SessionEnd hook — mirror a curated session digest to the operator's phone.

This is the egress half of the Nostr mobile bridge (the replacement for the
retired Telegram/CTM mirror). On SessionEnd it:

  1. reads the session transcript Claude Code points us at,
  2. asks the **Z.AI / GLM** provider (the same endpoint the `zai` consultant
     uses — ADR-011) to distil it into a curated digest: a short summary, the
     concrete actions, and the actionable questions — *not* the full
     transcript,
  3. pipes that digest as JSON into `nostr-pod-bridge summarise`, which signs a
     kind-30840 event, dual-writes it to the Solid pod, and publishes it to the
     embedded relay for the live phone view.

The crypto stays in Rust (nostr-bbs-core via the bridge); the summarisation
stays on the paid Z.AI model; the main Claude session is not re-invoked. The
hook is best-effort: any failure logs to stderr and exits 0 so a missing key,
unreachable endpoint, or malformed transcript never blocks session teardown.

Gating: the hook self-disables (silent exit 0) unless the bridge secrets
(AGENTBOX_BRIDGE_SK + AGENTBOX_BRIDGE_RECIPIENT_PUBKEY + AGENTBOX_POD_ROOT +
AGENTBOX_ADMIN_PUBKEY) and a Z.AI key are present in the environment — so
profiles without the mobile bridge configured simply do nothing.

Privacy note: the transcript is sent to the Z.AI endpoint for summarisation,
the one external hop on this path. Operators under a strict outbound privacy
policy should leave [sovereign_mesh.mobile_bridge] disabled (the hook is not
registered then) or point ZAI_URL at a local GLM endpoint.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# Transcript turns past this many characters are trimmed (head + tail kept) so
# the Z.AI prompt stays cheap regardless of how long the session ran.
MAX_TRANSCRIPT_CHARS = 50_000
HEAD_CHARS = 15_000

ZAI_TIMEOUT_S = 180
SUMMARISE_TIMEOUT_S = 30


def log(msg: str) -> None:
    sys.stderr.write(f"[nostr-session-summary] {msg}\n")


def env_first(*keys: str) -> str:
    for k in keys:
        v = os.environ.get(k)
        if v:
            return v
    return ""


def bridge_configured() -> bool:
    """True only when every input the `summarise` subcommand requires is set."""
    required = (
        "AGENTBOX_BRIDGE_SK",
        "AGENTBOX_BRIDGE_RECIPIENT_PUBKEY",
        "AGENTBOX_POD_ROOT",
        "AGENTBOX_ADMIN_PUBKEY",
    )
    return all(os.environ.get(k) for k in required)


def extract_transcript(path: str) -> str:
    """Flatten a Claude Code JSONL transcript to compact `ROLE: text` turns."""
    turns: list[str] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = rec.get("message")
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            if role not in ("user", "assistant"):
                continue
            text = _content_text(message.get("content"))
            if text:
                turns.append(f"{role.upper()}: {text}")
    joined = "\n\n".join(turns)
    if len(joined) > MAX_TRANSCRIPT_CHARS:
        tail = MAX_TRANSCRIPT_CHARS - HEAD_CHARS
        joined = f"{joined[:HEAD_CHARS]}\n\n...[transcript trimmed]...\n\n{joined[-tail:]}"
    return joined


def _content_text(content) -> str:
    """Pull human-readable text out of a message's content (string or blocks)."""
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return " ".join(p.strip() for p in parts if p).strip()


SUMMARY_SYSTEM = (
    "You distil a coding-assistant session into a curated digest for the "
    "operator's phone. Output ONLY a single JSON object, no prose, no markdown "
    "fences. Schema: {\"summary\": string (2-4 sentences, what the session "
    "accomplished), \"actions\": string[] (concrete changes made or started), "
    "\"actionable_questions\": string[] (open questions that need an operator "
    "decision; empty if none)}. Be concise; this is a notification, not a log."
)


def summarise_via_zai(transcript: str) -> dict:
    base = env_first("ZAI_URL").rstrip("/") or "https://api.z.ai/api/anthropic"
    url = f"{base}/v1/messages"
    api_key = env_first("ZAI_ANTHROPIC_API_KEY", "ZAI_API_KEY")
    model = env_first("AGENTBOX_ZAI_MODEL") or "glm-5.2"

    payload = {
        "model": model,
        "max_tokens": 1500,
        "system": SUMMARY_SYSTEM,
        "messages": [{"role": "user", "content": transcript}],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": api_key,
            "authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=ZAI_TIMEOUT_S) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    text = _anthropic_text(body)
    return _parse_json_object(text)


def _anthropic_text(body: dict) -> str:
    content = body.get("content")
    if isinstance(content, list):
        return "".join(
            str(b.get("text", "")) for b in content if isinstance(b, dict) and b.get("type") == "text"
        ).strip()
    return ""


def _parse_json_object(text: str) -> dict:
    """Best-effort extraction of the first JSON object from the model output."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    decoder = json.JSONDecoder()
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object in Z.AI response")
    obj, _ = decoder.raw_decode(text[start:])
    if not isinstance(obj, dict):
        raise ValueError("Z.AI response top-level is not an object")
    return obj


def publish(digest: dict) -> None:
    binary = env_first("AGENTBOX_BRIDGE_BIN") or "nostr-pod-bridge"
    proc = subprocess.run(
        [binary, "summarise"],
        input=json.dumps(digest).encode("utf-8"),
        capture_output=True,
        timeout=SUMMARISE_TIMEOUT_S,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"{binary} summarise exited {proc.returncode}: "
            f"{proc.stderr.decode('utf-8', 'replace')[:400]}"
        )


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # no hook payload; nothing to do

    if not bridge_configured():
        return 0  # mobile bridge not configured for this profile
    if not env_first("ZAI_ANTHROPIC_API_KEY", "ZAI_API_KEY"):
        log("Z.AI key not set; skipping session summary")
        return 0

    session_id = payload.get("session_id") or "unknown"
    transcript_path = payload.get("transcript_path")
    if not transcript_path or not os.path.exists(transcript_path):
        log("no transcript path in hook payload; skipping")
        return 0

    try:
        transcript = extract_transcript(transcript_path)
        if not transcript.strip():
            return 0
        digest = summarise_via_zai(transcript)
        digest["session_id"] = session_id  # authoritative id from the hook
        digest.setdefault("summary", "")
        digest.setdefault("actions", [])
        digest.setdefault("actionable_questions", [])
        publish(digest)
        log(f"session {session_id} mirrored to phone")
    except (OSError, urllib.error.URLError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        log(f"session summary failed (non-fatal): {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

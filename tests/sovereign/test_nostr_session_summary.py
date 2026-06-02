"""
tests/sovereign/test_nostr_session_summary.py

pytest coverage for config/hooks/nostr-session-summary.py — the SessionEnd
egress half of the Nostr mobile bridge (the kind-30840 phone mirror).

The crypto/signing lives in Rust (nostr-pod-bridge `summarise`, covered by the
crate's own unit tests). This hook owns the JS/Python-layer glue that Rust does
not: env/admin gating, transcript flattening, Z.AI digest generation + robust
JSON extraction, the `summarise` subprocess dispatch, and the best-effort
main() orchestration that must never block session teardown.

Groups:
  A. bridge_configured        — admin/env gating ("admin check")
  B. _content_text            — message-content flattening
  C. extract_transcript       — JSONL → ROLE: text turns + trim boundary
  D. _anthropic_text          — Z.AI response text extraction
  E. _parse_json_object       — fenced / prose-prefixed / malformed model output
  F. summarise_via_zai        — request construction + parsed digest ("summary generation")
  G. publish                  — summarise subprocess argv/stdin + failure surfacing
  H. main                     — orchestration: gating short-circuits + happy path + non-fatal
"""

import importlib.util
import io
import json
import os
import pathlib
import sys

import pytest

# ─── Load the hyphenated hook script as a module ────────────────────────────────

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOOK_PATH = ROOT / "config" / "hooks" / "nostr-session-summary.py"


@pytest.fixture
def hook():
    """Fresh import of the hook module (no main() side effects: __main__ guard)."""
    spec = importlib.util.spec_from_file_location("nostr_session_summary", HOOK_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


REQUIRED_ENV = (
    "AGENTBOX_BRIDGE_SK",
    "AGENTBOX_BRIDGE_RECIPIENT_PUBKEY",
    "AGENTBOX_POD_ROOT",
    "AGENTBOX_ADMIN_PUBKEY",
)


@pytest.fixture
def clean_env(monkeypatch):
    """Strip every bridge/Z.AI env var so each test sets only what it asserts."""
    for k in (*REQUIRED_ENV, "ZAI_URL", "ZAI_ANTHROPIC_API_KEY", "ZAI_API_KEY",
              "AGENTBOX_ZAI_MODEL", "AGENTBOX_BRIDGE_BIN"):
        monkeypatch.delenv(k, raising=False)


def set_required(monkeypatch):
    for k in REQUIRED_ENV:
        monkeypatch.setenv(k, "x" * 64)


# ═══════════════════════════════════════════════════════════════════════════════
# A. bridge_configured — admin/env gating
# ═══════════════════════════════════════════════════════════════════════════════

def test_bridge_configured_true_when_all_present(hook, clean_env, monkeypatch):
    set_required(monkeypatch)
    assert hook.bridge_configured() is True


@pytest.mark.parametrize("missing", REQUIRED_ENV)
def test_bridge_configured_false_when_any_missing(hook, clean_env, monkeypatch, missing):
    set_required(monkeypatch)
    monkeypatch.delenv(missing, raising=False)
    assert hook.bridge_configured() is False


def test_bridge_configured_treats_empty_string_as_unset(hook, clean_env, monkeypatch):
    set_required(monkeypatch)
    monkeypatch.setenv("AGENTBOX_ADMIN_PUBKEY", "")
    assert hook.bridge_configured() is False


def test_env_first_returns_first_nonempty(hook, clean_env, monkeypatch):
    monkeypatch.setenv("ZAI_ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("ZAI_API_KEY", "fallback-key")
    assert hook.env_first("ZAI_ANTHROPIC_API_KEY", "ZAI_API_KEY") == "fallback-key"
    assert hook.env_first("DOES_NOT_EXIST_1", "DOES_NOT_EXIST_2") == ""


# ═══════════════════════════════════════════════════════════════════════════════
# B. _content_text
# ═══════════════════════════════════════════════════════════════════════════════

def test_content_text_plain_string(hook):
    assert hook._content_text("  hello world  ") == "hello world"


def test_content_text_text_blocks_concatenated(hook):
    content = [
        {"type": "text", "text": "first"},
        {"type": "tool_use", "name": "Edit"},   # ignored — not a text block
        {"type": "text", "text": "second"},
    ]
    assert hook._content_text(content) == "first second"


def test_content_text_bare_strings_in_list(hook):
    assert hook._content_text(["a", "b"]) == "a b"


def test_content_text_non_list_non_string_is_empty(hook):
    assert hook._content_text({"type": "text", "text": "x"}) == ""
    assert hook._content_text(None) == ""


# ═══════════════════════════════════════════════════════════════════════════════
# C. extract_transcript
# ═══════════════════════════════════════════════════════════════════════════════

def write_jsonl(tmp_path, records) -> str:
    p = tmp_path / "transcript.jsonl"
    with open(p, "w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec) + "\n")
    return str(p)


def test_extract_transcript_flattens_user_and_assistant(hook, tmp_path):
    path = write_jsonl(tmp_path, [
        {"message": {"role": "user", "content": "fix the bug"}},
        {"message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}},
    ])
    out = hook.extract_transcript(path)
    assert out == "USER: fix the bug\n\nASSISTANT: done"


def test_extract_transcript_skips_noise(hook, tmp_path):
    path = tmp_path / "t.jsonl"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n")                                          # blank line
        fh.write("not json at all\n")                          # malformed
        fh.write(json.dumps({"no_message": True}) + "\n")      # no message key
        fh.write(json.dumps({"message": {"role": "system", "content": "x"}}) + "\n")  # wrong role
        fh.write(json.dumps({"message": {"role": "user", "content": ""}}) + "\n")     # empty text
        fh.write(json.dumps({"message": {"role": "user", "content": "kept"}}) + "\n")
    out = hook.extract_transcript(str(path))
    assert out == "USER: kept"


def test_extract_transcript_trims_long_sessions(hook, tmp_path, monkeypatch):
    monkeypatch.setattr(hook, "MAX_TRANSCRIPT_CHARS", 200)
    monkeypatch.setattr(hook, "HEAD_CHARS", 60)
    big = "A" * 500
    path = write_jsonl(tmp_path, [{"message": {"role": "user", "content": big}}])
    out = hook.extract_transcript(path)
    assert "...[transcript trimmed]..." in out
    assert len(out) < 500
    assert out.startswith("USER: AAA")


# ═══════════════════════════════════════════════════════════════════════════════
# D. _anthropic_text
# ═══════════════════════════════════════════════════════════════════════════════

def test_anthropic_text_joins_text_blocks(hook):
    body = {"content": [
        {"type": "text", "text": "part1 "},
        {"type": "thinking", "text": "ignored"},
        {"type": "text", "text": "part2"},
    ]}
    assert hook._anthropic_text(body) == "part1 part2"


def test_anthropic_text_empty_when_no_list(hook):
    assert hook._anthropic_text({"content": "string-not-list"}) == ""
    assert hook._anthropic_text({}) == ""


# ═══════════════════════════════════════════════════════════════════════════════
# E. _parse_json_object
# ═══════════════════════════════════════════════════════════════════════════════

def test_parse_json_object_plain(hook):
    assert hook._parse_json_object('{"summary": "ok", "actions": []}') == {
        "summary": "ok", "actions": []
    }


def test_parse_json_object_strips_json_fence(hook):
    text = '```json\n{"summary": "fenced"}\n```'
    assert hook._parse_json_object(text) == {"summary": "fenced"}


def test_parse_json_object_strips_bare_fence(hook):
    text = '```\n{"summary": "bare"}\n```'
    assert hook._parse_json_object(text) == {"summary": "bare"}


def test_parse_json_object_ignores_leading_prose(hook):
    text = 'Here is your digest: {"summary": "after prose"} hope that helps'
    assert hook._parse_json_object(text) == {"summary": "after prose"}


def test_parse_json_object_raises_without_object(hook):
    with pytest.raises(ValueError, match="no JSON object"):
        hook._parse_json_object("there is nothing structured here")


def test_parse_json_object_raises_on_array_only_output(hook):
    # No '{' anywhere → caught by the find("{") guard before decoding.
    with pytest.raises(ValueError, match="no JSON object"):
        hook._parse_json_object("[1, 2, 3]")


# ═══════════════════════════════════════════════════════════════════════════════
# F. summarise_via_zai — request construction + digest generation
# ═══════════════════════════════════════════════════════════════════════════════

class _FakeResp:
    def __init__(self, body: dict):
        self._raw = json.dumps(body).encode("utf-8")

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_summarise_via_zai_builds_request_and_parses(hook, clean_env, monkeypatch):
    monkeypatch.setenv("ZAI_URL", "https://glm.local/api/")
    monkeypatch.setenv("ZAI_ANTHROPIC_API_KEY", "secret-key")
    monkeypatch.setenv("AGENTBOX_ZAI_MODEL", "glm-5.2")

    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = {k.lower(): v for k, v in req.header_items()}
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _FakeResp({"content": [{"type": "text", "text": '{"summary": "did the thing", "actions": ["edited x"], "actionable_questions": []}'}]})

    monkeypatch.setattr(hook.urllib.request, "urlopen", fake_urlopen)

    digest = hook.summarise_via_zai("USER: hi\n\nASSISTANT: done")

    assert digest == {"summary": "did the thing", "actions": ["edited x"], "actionable_questions": []}
    # trailing slash collapsed, /v1/messages appended
    assert captured["url"] == "https://glm.local/api/v1/messages"
    assert captured["body"]["model"] == "glm-5.2"
    assert captured["body"]["messages"][0]["content"] == "USER: hi\n\nASSISTANT: done"
    assert captured["headers"]["x-api-key"] == "secret-key"
    assert captured["headers"]["authorization"] == "Bearer secret-key"
    assert captured["timeout"] == hook.ZAI_TIMEOUT_S


def test_summarise_via_zai_defaults_model_and_endpoint(hook, clean_env, monkeypatch):
    monkeypatch.setenv("ZAI_ANTHROPIC_API_KEY", "k")
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["model"] = json.loads(req.data.decode("utf-8"))["model"]
        return _FakeResp({"content": [{"type": "text", "text": '{"summary": "x"}'}]})

    monkeypatch.setattr(hook.urllib.request, "urlopen", fake_urlopen)
    hook.summarise_via_zai("transcript")
    assert captured["url"] == "https://api.z.ai/api/anthropic/v1/messages"
    assert captured["model"] == "glm-5.2"


# ═══════════════════════════════════════════════════════════════════════════════
# G. publish — summarise subprocess dispatch
# ═══════════════════════════════════════════════════════════════════════════════

class _Proc:
    def __init__(self, returncode=0, stderr=b""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = b""


def test_publish_invokes_bridge_summarise_with_json_stdin(hook, clean_env, monkeypatch):
    captured = {}

    def fake_run(argv, input=None, capture_output=None, timeout=None):
        captured["argv"] = argv
        captured["input"] = input
        captured["timeout"] = timeout
        return _Proc(returncode=0)

    monkeypatch.setattr(hook.subprocess, "run", fake_run)
    hook.publish({"summary": "s", "session_id": "abc"})

    assert captured["argv"] == ["nostr-pod-bridge", "summarise"]
    assert json.loads(captured["input"].decode("utf-8")) == {"summary": "s", "session_id": "abc"}
    assert captured["timeout"] == hook.SUMMARISE_TIMEOUT_S


def test_publish_honours_bridge_bin_override(hook, clean_env, monkeypatch):
    monkeypatch.setenv("AGENTBOX_BRIDGE_BIN", "/opt/agentbox/bin/nostr-pod-bridge")
    captured = {}
    monkeypatch.setattr(hook.subprocess, "run",
                        lambda argv, **kw: captured.update(argv=argv) or _Proc(0))
    hook.publish({"x": 1})
    assert captured["argv"][0] == "/opt/agentbox/bin/nostr-pod-bridge"


def test_publish_raises_on_nonzero_exit(hook, clean_env, monkeypatch):
    monkeypatch.setattr(hook.subprocess, "run",
                        lambda argv, **kw: _Proc(returncode=2, stderr=b"relay rejected kind 30840"))
    with pytest.raises(RuntimeError, match="relay rejected kind 30840"):
        hook.publish({"x": 1})


# ═══════════════════════════════════════════════════════════════════════════════
# H. main — orchestration (best-effort, always exits 0)
# ═══════════════════════════════════════════════════════════════════════════════

def drive_main(hook, monkeypatch, stdin_obj):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(stdin_obj)))
    return hook.main()


def test_main_returns_zero_on_invalid_stdin(hook, clean_env, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO("not json"))
    assert hook.main() == 0


def test_main_short_circuits_when_bridge_unconfigured(hook, clean_env, monkeypatch):
    called = {"summarise": False, "publish": False}
    monkeypatch.setattr(hook, "summarise_via_zai", lambda t: called.update(summarise=True) or {})
    monkeypatch.setattr(hook, "publish", lambda d: called.update(publish=True))
    assert drive_main(hook, monkeypatch, {"session_id": "s", "transcript_path": "/x"}) == 0
    assert called == {"summarise": False, "publish": False}


def test_main_short_circuits_without_zai_key(hook, clean_env, monkeypatch):
    set_required(monkeypatch)  # bridge configured ...
    # ... but no ZAI key set
    published = {"called": False}
    monkeypatch.setattr(hook, "publish", lambda d: published.update(called=True))
    assert drive_main(hook, monkeypatch, {"session_id": "s", "transcript_path": "/x"}) == 0
    assert published["called"] is False


def test_main_short_circuits_on_missing_transcript(hook, clean_env, monkeypatch):
    set_required(monkeypatch)
    monkeypatch.setenv("ZAI_API_KEY", "k")
    published = {"called": False}
    monkeypatch.setattr(hook, "publish", lambda d: published.update(called=True))
    assert drive_main(hook, monkeypatch, {"session_id": "s", "transcript_path": "/does/not/exist"}) == 0
    assert published["called"] is False


def test_main_happy_path_publishes_defaulted_digest(hook, clean_env, monkeypatch, tmp_path):
    set_required(monkeypatch)
    monkeypatch.setenv("ZAI_API_KEY", "k")
    path = write_jsonl(tmp_path, [{"message": {"role": "user", "content": "do work"}}])

    monkeypatch.setattr(hook, "summarise_via_zai", lambda t: {"summary": "did work"})
    captured = {}
    monkeypatch.setattr(hook, "publish", lambda d: captured.update(digest=d))

    rc = drive_main(hook, monkeypatch, {"session_id": "sess-42", "transcript_path": path})
    assert rc == 0
    d = captured["digest"]
    assert d["session_id"] == "sess-42"          # authoritative id from the hook
    assert d["summary"] == "did work"
    assert d["actions"] == []                     # defaulted
    assert d["actionable_questions"] == []        # defaulted


def test_main_swallows_publish_failure(hook, clean_env, monkeypatch, tmp_path):
    set_required(monkeypatch)
    monkeypatch.setenv("ZAI_API_KEY", "k")
    path = write_jsonl(tmp_path, [{"message": {"role": "user", "content": "x"}}])
    monkeypatch.setattr(hook, "summarise_via_zai", lambda t: {"summary": "s"})

    def boom(d):
        raise RuntimeError("bridge down")

    monkeypatch.setattr(hook, "publish", boom)
    # Non-fatal: a failed mirror must never block session teardown.
    assert drive_main(hook, monkeypatch, {"session_id": "s", "transcript_path": path}) == 0


def test_main_returns_zero_on_empty_transcript(hook, clean_env, monkeypatch, tmp_path):
    set_required(monkeypatch)
    monkeypatch.setenv("ZAI_API_KEY", "k")
    path = write_jsonl(tmp_path, [{"message": {"role": "tool", "content": "noise"}}])  # no user/assistant
    published = {"called": False}
    monkeypatch.setattr(hook, "publish", lambda d: published.update(called=True))
    assert drive_main(hook, monkeypatch, {"session_id": "s", "transcript_path": path}) == 0
    assert published["called"] is False

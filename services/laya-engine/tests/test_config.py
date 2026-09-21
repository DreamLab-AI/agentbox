"""Unit tests for the engine's configuration surface.

Deliberately torch-free: these run anywhere `python -m pytest` runs, including
the agentbox container, which has no CUDA wheels. The inference path is covered
by the live probes in the README's build-and-run section and by the façade's own
contract tests, both of which need real weights to mean anything.

    python -m pytest services/laya-engine/tests -q
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from laya_engine.config import ModelSpec, Settings, parse_models  # noqa: E402


def test_named_pairs_parse_into_specs():
    specs = parse_models("laya-typed-decisions=convaiinnovations/laya:typed-decisions,laya=convaiinnovations/laya")
    assert specs == [
        ModelSpec("laya-typed-decisions", "convaiinnovations/laya", "typed-decisions"),
        ModelSpec("laya", "convaiinnovations/laya", None),
    ]
    assert specs[0].source == "convaiinnovations/laya:typed-decisions"


def test_a_bare_source_names_itself():
    assert parse_models("convaiinnovations/laya") == [ModelSpec("laya", "convaiinnovations/laya", None)]
    assert parse_models("convaiinnovations/laya:multilingual") == [
        ModelSpec("multilingual", "convaiinnovations/laya", "multilingual")
    ]


def test_local_paths_survive_a_colon_free_split():
    # A local path is a path, not repo:subfolder; `::` is the explicit escape.
    assert parse_models("/models/laya") == [ModelSpec("laya", "/models/laya", None)]
    assert parse_models("x=/models/bundle::typed-decisions") == [
        ModelSpec("x", "/models/bundle", "typed-decisions")
    ]


def test_blank_entries_are_dropped():
    assert parse_models(" , ,") == []


def test_settings_default_to_a_loopback_bind(monkeypatch):
    for key in list(os.environ):
        if key.startswith("LAYA_"):
            monkeypatch.delenv(key, raising=False)
    s = Settings.from_env()
    # The contract's one non-negotiable default: the engine is not an ingress.
    assert s.bind_host == "127.0.0.1"
    assert s.bind_port == 8098
    assert s.default_model == "laya-typed-decisions"
    # No budget override unless the operator sets one, so the checkpoint's own
    # max_len/head_max_len win and /v1/models reports "checkpoint".
    assert s.max_len_override is None
    assert s.head_max_len_override is None


def test_invalid_or_zero_budget_overrides_are_ignored(monkeypatch):
    monkeypatch.setenv("LAYA_MAX_LEN", "0")
    monkeypatch.setenv("LAYA_HEAD_MAX_LEN", "not-a-number")
    s = Settings.from_env()
    assert s.max_len_override is None
    assert s.head_max_len_override is None


def test_explicit_overrides_are_taken(monkeypatch):
    monkeypatch.setenv("LAYA_MAX_LEN", "2048")
    monkeypatch.setenv("LAYA_HEAD_MAX_LEN", "512")
    s = Settings.from_env()
    assert (s.max_len_override, s.head_max_len_override) == (2048, 512)

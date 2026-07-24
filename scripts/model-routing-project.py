#!/usr/bin/env python3
"""model-routing-project.py — ADR-041 boot projection.

Projects the [model_routing] policy from agentbox.toml into agentic-qe's
on-disk router config (issue #568): every `.agentic-qe/` directory under the
workspace gets its `llm-config.json` `agentOverrides` map (plus
defaultProvider and a complete fallbackChain) reconciled from the manifest.

One policy, many projections (pattern adapted from pacphi/agentic-kit
ADR-0001; the consuming mechanism is upstream agentic-qe >= 3.13.1):
  - the manifest is the ONLY edit point — this file's output is replaced
    wholesale at every boot, like .mcp.json (edit agentbox.toml, not the JSON)
  - all other keys in an existing llm-config.json are preserved (deep-merged
    around the managed keys), and API keys are never written (agentic-qe's
    own loader also strips them defensively)
  - atomic write (temp + rename), matching aqe's saveRouterConfigFile

Exit is always 0 with a diagnostic on stderr — a routing projection failure
must never block boot (fail-open; the fleet then keeps upstream defaults).

Usage: model-routing-project.py [--manifest /etc/agentbox.toml]
                                [--workspace /home/devuser/workspace]
                                [--dry-run]
"""

import json
import os
import re
import sys
import tempfile

try:
    import tomllib
except ImportError:  # python < 3.11 — fail open, never block boot
    print("[model-routing] tomllib unavailable (python < 3.11) — skipping", file=sys.stderr)
    sys.exit(0)

# Activity → agentic-qe agent types (grounded in aqe's shipped agent names;
# same map agentic-kit derived from upstream — see ADR-041 §3).
AGENT_ACTIVITY_MAP = {
    "qe-security-scanner":      "security-scan",
    "qe-security-auditor":      "security-scan",
    "qe-pentest-validator":     "security-scan",
    "qe-security-reviewer":     "security-analysis",
    "qe-test-architect":        "testing",
    "qe-test-generator":        "testing",
    "qe-coverage-specialist":   "testing",
    "qe-mutation-tester":       "testing",
    "qe-code-reviewer":         "review",
    "qe-integration-reviewer":  "review",
    "qe-performance-reviewer":  "review",
    "qe-requirements-validator": "specification",
}

# host → agentic-qe ExtendedProviderType (subscription-tier: $0 marginal)
HOST_PROVIDER = {"claude": "claude-code", "codex": "codex"}

# Providers agentic-qe 3.13.1 can construct (sanitizeAgentOverrides drops the
# rest — mirror the drop here so the file we write is already clean).
AQE_CONSTRUCTIBLE = {
    "claude", "claude-code", "codex", "openai", "ollama",
    "openrouter", "gemini", "azure-openai", "bedrock", "cognitum",
}

ROUTE_RE = re.compile(
    r"^\s*(claude|codex):([A-Za-z0-9._-]+)"
    r"(?:\s*->\s*(claude|codex):([A-Za-z0-9._-]+))?\s*$"
)

MANAGED_KEYS = ("agentOverrides", "defaultProvider", "fallbackChain", "_managedBy")


def parse_route(value):
    """'host:model [-> host:model]' → (host, model, esc_host, esc_model)."""
    m = ROUTE_RE.match(value or "")
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3), m.group(4)


def build_config(mr):
    routes = {}
    for activity, raw in (mr.get("routes") or {}).items():
        parsed = parse_route(raw)
        if parsed is None:
            print(f"[model-routing] unparseable route {activity!r} = {raw!r} — skipped", file=sys.stderr)
            continue
        routes[activity] = parsed

    overrides = {}
    for agent, activity in AGENT_ACTIVITY_MAP.items():
        r = routes.get(activity)
        if not r:
            continue
        provider = HOST_PROVIDER[r[0]]
        if provider not in AQE_CONSTRUCTIBLE:
            continue
        overrides[agent] = {"provider": provider, "model": r[1]}

    default_provider = mr.get("aqe_llm_provider", "claude-code")
    if default_provider not in AQE_CONSTRUCTIBLE:
        print(f"[model-routing] aqe_llm_provider {default_provider!r} not constructible — using claude-code", file=sys.stderr)
        default_provider = "claude-code"

    # Complete FallbackChain (aqe merges partial RouterConfig over its
    # defaults, but a partial *chain object* would clobber field-wise — write
    # every field). Each entry carries the distinct models the policy routes
    # on that provider so the fallback lands on a model the vendor serves.
    chain_providers = [p.strip() for p in (mr.get("aqe_fallback_chain") or "").split(",") if p.strip()]
    chain_providers = [p for p in chain_providers if p in AQE_CONSTRUCTIBLE]
    provider_models = {}
    for host, model, esc_h, esc_m in routes.values():
        provider_models.setdefault(HOST_PROVIDER[host], []).append(model)
        if esc_h:
            provider_models.setdefault(HOST_PROVIDER[esc_h], []).append(esc_m)
    entries = []
    for i, prov in enumerate(chain_providers):
        models = sorted(set(provider_models.get(prov, [])))
        entries.append({
            "provider": prov,
            "models": models,
            "enabled": True,
            "priority": len(chain_providers) - i,
        })

    cfg = {
        "_managedBy": "agentbox entrypoint (ADR-041) — edit [model_routing] in agentbox.toml, not this file",
        "defaultProvider": default_provider,
        "agentOverrides": overrides,
    }
    if entries:
        cfg["fallbackChain"] = {
            "id": "agentbox-adr041",
            "entries": entries,
            "maxRetries": 2,
            "retryDelayMs": 1000,
            "backoffMultiplier": 2,
            "maxDelayMs": 15000,
        }
    return cfg


def strip_api_keys(obj):
    """Defence in depth: never persist anything apiKey-shaped."""
    if isinstance(obj, dict):
        return {k: strip_api_keys(v) for k, v in obj.items() if k.lower() != "apikey"}
    if isinstance(obj, list):
        return [strip_api_keys(v) for v in obj]
    return obj


def reconcile(target_dir, managed, dry_run):
    path = os.path.join(target_dir, "llm-config.json")
    existing = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                existing = json.load(fh)
        except (json.JSONDecodeError, OSError) as e:
            print(f"[model-routing] {path}: unreadable ({e}) — rewriting managed keys only", file=sys.stderr)
            existing = {}

    merged = {k: v for k, v in existing.items() if k not in MANAGED_KEYS}
    merged.update(managed)
    merged = strip_api_keys(merged)

    if merged == existing:
        return False
    if dry_run:
        print(f"[model-routing] would update {path}", file=sys.stderr)
        return True

    fd, tmp = tempfile.mkstemp(dir=target_dir, prefix=".llm-config.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(merged, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    except OSError as e:
        print(f"[model-routing] {path}: write failed ({e})", file=sys.stderr)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False
    return True


def main():
    manifest = "/etc/agentbox.toml"
    workspace = os.environ.get("WORKSPACE", "/home/devuser/workspace")
    dry_run = False
    args = sys.argv[1:]
    while args:
        a = args.pop(0)
        if a == "--manifest" and args:
            manifest = args.pop(0)
        elif a == "--workspace" and args:
            workspace = args.pop(0)
        elif a == "--dry-run":
            dry_run = True

    try:
        with open(manifest, "rb") as fh:
            cfg = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError) as e:
        print(f"[model-routing] cannot read manifest {manifest}: {e} — skipping", file=sys.stderr)
        return 0

    mr = cfg.get("model_routing") or {}
    if not (mr.get("enabled") and mr.get("aqe_agent_overrides", True)):
        print("[model-routing] gate off — no projection", file=sys.stderr)
        return 0

    managed = build_config(mr)

    # Reconcile every .agentic-qe project dir under the workspace (depth-capped;
    # dirs created after boot pick the policy up at the next boot) + ensure the
    # workspace root carries one.
    targets = set()
    root_aqe = os.path.join(workspace, ".agentic-qe")
    if not dry_run:
        os.makedirs(root_aqe, exist_ok=True)
    targets.add(root_aqe)
    max_depth = workspace.rstrip("/").count("/") + 4
    for dirpath, dirnames, _ in os.walk(workspace):
        if dirpath.rstrip("/").count("/") >= max_depth:
            dirnames[:] = []
            continue
        # never descend into heavyweight/irrelevant trees
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "target", ".tmp", "dist")]
        if ".agentic-qe" in dirnames:
            targets.add(os.path.join(dirpath, ".agentic-qe"))

    changed = 0
    for t in sorted(targets):
        if os.path.isdir(t) or not dry_run:
            if reconcile(t, managed, dry_run):
                changed += 1

    print(f"[model-routing] projected agentOverrides ({len(managed.get('agentOverrides', {}))} agents, "
          f"provider={managed.get('defaultProvider')}) into {len(targets)} project dir(s), {changed} updated",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

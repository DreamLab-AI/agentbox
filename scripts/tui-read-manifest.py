#!/usr/bin/env python3
"""
tui-read-manifest.py  —  read agentbox.toml, emit JSON state for the TUI.
Usage: python3 tui-read-manifest.py <agentbox.toml> <state.json>
Emits a flat JSON dict with every field the TUI needs, using safe defaults
for any missing keys so a fresh/partial manifest does not break the wizard.
"""
import json
import pathlib
import sys
import tomllib

config_path = pathlib.Path(sys.argv[1])
state_path  = pathlib.Path(sys.argv[2])

cfg: dict = {}
if config_path.exists():
    with config_path.open("rb") as fh:
        cfg = tomllib.load(fh)

def g(*keys, default=None):
    """Nested get with default."""
    d = cfg
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, default)
        if d is None:
            return default
    return d

state = {
    # ── federation ──────────────────────────────────────────────────────────────
    "federation.mode":           g("federation", "mode",         default="standalone"),
    "federation.external_url":   g("federation", "external_url", default=""),
    # ── adapters ────────────────────────────────────────────────────────────────
    "adapters.beads":        g("adapters", "beads",        default="local-sqlite"),
    "adapters.pods":         g("adapters", "pods",         default="local-jss"),
    "adapters.memory":       g("adapters", "memory",       default="embedded-ruvector"),
    "adapters.events":       g("adapters", "events",       default="local-jsonl"),
    "adapters.orchestrator": g("adapters", "orchestrator", default="local-process-manager"),
    # ── gpu ─────────────────────────────────────────────────────────────────────
    "gpu.backend":           g("gpu", "backend", default="none"),
    # ── desktop ─────────────────────────────────────────────────────────────────
    "desktop.enabled":    g("desktop", "enabled",    default=False),
    "desktop.stack":      g("desktop", "stack",      default="hyprland-wayland"),
    "desktop.resolution": g("desktop", "resolution", default="1920x1080"),
    # ── toolchains ──────────────────────────────────────────────────────────────
    "toolchains.claude":          g("toolchains", "claude",          default=True),
    "toolchains.claude_code":     g("toolchains", "claude_code",     default=False),
    "toolchains.ruflo":           g("toolchains", "ruflo",           default=True),
    "toolchains.claude_flow":     g("toolchains", "claude_flow",     default=True),
    "toolchains.agentic_qe":      g("toolchains", "agentic_qe",      default=True),
    "toolchains.nagual_qe":       g("toolchains", "nagual_qe",       default=True),
    "toolchains.gemini_cli":      g("toolchains", "gemini_cli",      default=False),
    "toolchains.code_server":     g("toolchains", "code_server",     default=False),
    "toolchains.codebase_memory": g("toolchains", "codebase_memory", default=True),
    "toolchains.rust":            g("toolchains", "rust",            default=True),
    "toolchains.cuda":            g("toolchains", "cuda",            default=False),
    # ── skills.browser ──────────────────────────────────────────────────────────
    "skills.browser.agent_browser": g("skills","browser","agent_browser", default=True),
    "skills.browser.playwright":    g("skills","browser","playwright",    default=True),
    "skills.browser.qe_browser":    g("skills","browser","qe_browser",    default=False),
    # ── skills.media ────────────────────────────────────────────────────────────
    "skills.media.ffmpeg":            g("skills","media","ffmpeg",            default=True),
    "skills.media.imagemagick":       g("skills","media","imagemagick",       default=True),
    "skills.media.comfyui_builtin":   g("skills","media","comfyui_builtin",   default=False),
    # ── skills.spatial_and_3d ───────────────────────────────────────────────────
    "skills.spatial_and_3d.blender":            g("skills","spatial_and_3d","blender",            default=False),
    "skills.spatial_and_3d.qgis":               g("skills","spatial_and_3d","qgis",               default=False),
    "skills.spatial_and_3d.gaussian_splatting": g("skills","spatial_and_3d","gaussian_splatting", default=False),
    # ── skills.data_science ─────────────────────────────────────────────────────
    "skills.data_science.pytorch": g("skills","data_science","pytorch", default=False),
    "skills.data_science.jupyter": g("skills","data_science","jupyter", default=False),
    # ── skills.docs ─────────────────────────────────────────────────────────────
    "skills.docs.latex":          g("skills","docs","latex",          default=True),
    "skills.docs.mermaid":        g("skills","docs","mermaid",        default=True),
    "skills.docs.report_builder": g("skills","docs","report_builder", default=True),
    # ── skills.ontology ─────────────────────────────────────────────────────────
    "skills.ontology.enabled": g("skills","ontology","enabled", default=False),
    # ── providers — just the enabled flags; env_var values stay in .env ─────────
    "providers.anthropic.enabled":  g("providers","anthropic","enabled",  default=False),
    "providers.openai.enabled":     g("providers","openai","enabled",     default=False),
    "providers.gemini.enabled":     g("providers","gemini","enabled",     default=False),
    "providers.deepseek.enabled":   g("providers","deepseek","enabled",   default=False),
    "providers.perplexity.enabled": g("providers","perplexity","enabled", default=False),
    "providers.openrouter.enabled": g("providers","openrouter","enabled", default=False),
    "providers.context7.enabled":   g("providers","context7","enabled",   default=False),
    "providers.brave.enabled":      g("providers","brave","enabled",      default=False),
    "providers.github.enabled":     g("providers","github","enabled",     default=False),
    "providers.zai.enabled":        g("providers","zai","enabled",        default=False),
    # ── observability ────────────────────────────────────────────────────────────
    "observability.metrics_port":  str(g("observability","metrics_port",  default=9091)),
    "observability.otlp_endpoint": g("observability","otlp_endpoint",     default=""),
    "observability.log_level":     g("observability","log_level",         default="info"),
    # ── integrations ─────────────────────────────────────────────────────────────
    "integrations.ragflow.enabled":                g("integrations","ragflow","enabled",                     default=False),
    "integrations.comfyui_external.enabled":       g("integrations","comfyui_external","enabled",            default=False),
    "integrations.comfyui_external.url":           g("integrations","comfyui_external","url",                default="http://comfyui:8188"),
    "integrations.comfyui_external.ws_url":        g("integrations","comfyui_external","ws_url",             default="ws://comfyui:8188/ws"),
    "integrations.ruvector_external.enabled":      g("integrations","ruvector_external","enabled",           default=False),
    "integrations.ruvector_external.conninfo":     g("integrations","ruvector_external","conninfo",          default=""),
    # ── privacy filter (ADR-008) ─────────────────────────────────────────────────
    "privacy_filter.enabled":            g("privacy_filter", "enabled",            default=False),
    "privacy_filter.mode":               g("privacy_filter", "mode",               default="off"),
    "privacy_filter.port":               str(g("privacy_filter", "port",           default=9092)),
    "privacy_filter.dtype":              g("privacy_filter", "dtype",              default="bf16"),
    "privacy_filter.model":              g("privacy_filter", "model",              default="openai/privacy-filter"),
    "privacy_filter.policy.pods":        g("privacy_filter", "policy", "pods",         default="strict"),
    "privacy_filter.policy.memory":      g("privacy_filter", "policy", "memory",       default="strict"),
    "privacy_filter.policy.events":      g("privacy_filter", "policy", "events",       default="soft"),
    "privacy_filter.policy.beads":       g("privacy_filter", "policy", "beads",        default="soft"),
    "privacy_filter.policy.orchestrator":g("privacy_filter", "policy", "orchestrator", default="off"),
    "privacy_filter.policy.inbound":     g("privacy_filter", "policy", "inbound",      default="soft"),
    "privacy_filter.policy.outbound":    g("privacy_filter", "policy", "outbound",     default="soft"),
    # ── sovereign_mesh ───────────────────────────────────────────────────────────
    "sovereign_mesh.enabled":              g("sovereign_mesh","enabled",              default=True),
    "sovereign_mesh.solid_pod":            g("sovereign_mesh","solid_pod",            default=True),
    "sovereign_mesh.nostr_bridge":         g("sovereign_mesh","nostr_bridge",         default=True),
    "sovereign_mesh.https_bridge":         g("sovereign_mesh","https_bridge",         default=False),
    "sovereign_mesh.publish_agent_events": g("sovereign_mesh","publish_agent_events", default=False),
    "sovereign_mesh.telegram_mirror":      g("sovereign_mesh","telegram_mirror",      default=False),
    "sovereign_mesh.jss_rust_backend":     g("sovereign_mesh","jss_rust_backend",     default=False),
    # ── sovereign_mesh.relay (PRD-004 / ADR-009) ─────────────────────────────────
    "sovereign_mesh.relay.enabled":          g("sovereign_mesh","relay","enabled",          default=False),
    "sovereign_mesh.relay.implementation":   g("sovereign_mesh","relay","implementation",   default="nostr-rs-relay"),
    "sovereign_mesh.relay.port":             str(g("sovereign_mesh","relay","port",         default=7777)),
    "sovereign_mesh.relay.bind":             g("sovereign_mesh","relay","bind",             default="127.0.0.1"),
    "sovereign_mesh.relay.expose":           g("sovereign_mesh","relay","expose",           default=False),
    "sovereign_mesh.relay.data_dir":         g("sovereign_mesh","relay","data_dir",         default="/var/lib/nostr-relay"),
    "sovereign_mesh.relay.ingress_policy":   g("sovereign_mesh","relay","ingress_policy",   default="allowlist"),
    "sovereign_mesh.relay.pod_bridge":       g("sovereign_mesh","relay","pod_bridge",       default=True),
    "sovereign_mesh.relay.external_fanout":  g("sovereign_mesh","relay","external_fanout",  default="off"),
    "sovereign_mesh.relay.max_event_bytes":  str(g("sovereign_mesh","relay","max_event_bytes", default=131072)),
    "sovereign_mesh.relay.messages_per_sec": str(g("sovereign_mesh","relay","messages_per_sec",default=5)),
    "sovereign_mesh.relay.retention_days":   str(g("sovereign_mesh","relay","retention_days", default=30)),
    "sovereign_mesh.relay.allow_nip04":      g("sovereign_mesh","relay","allow_nip04",      default=False),
    "sovereign_mesh.relay.info_description": g("sovereign_mesh","relay","info_description", default="Agentbox sovereign relay"),
    "sovereign_mesh.relay.info_contact":     g("sovereign_mesh","relay","info_contact",     default=""),
}

state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

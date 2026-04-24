#!/usr/bin/env python3
"""
tui-write-manifest.py  —  take the TUI state JSON, emit a canonical agentbox.toml.
Usage: python3 tui-write-manifest.py <state.json> <output.toml>
Preserves every schema-valid key; omits sections that are entirely default/empty
so the output is readable.  The caller is responsible for atomic rename.
"""
import json
import pathlib
import sys

state_path  = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])

s: dict = json.loads(state_path.read_text(encoding="utf-8"))

def b(key: str) -> str:
    """Bool field → TOML literal."""
    v = s.get(key, False)
    return "true" if v else "false"

def q(key: str, default: str = "") -> str:
    """String field → double-quoted TOML value."""
    return json.dumps(s.get(key, default))

def i(key: str, default: int = 0) -> str:
    """Integer field (stored as string in state) → TOML integer."""
    v = s.get(key, str(default))
    try:
        return str(int(v))
    except ValueError:
        return str(default)

lines: list[str] = []

# ── core ────────────────────────────────────────────────────────────────────────
lines += [
    "[core]",
    'orchestration = "ruflo-v3"',
    'vector_db = "ruvector-embedded"',
    "",
]

# ── federation ──────────────────────────────────────────────────────────────────
lines += ["[federation]", f'mode = {q("federation.mode", "standalone")}']
if s.get("federation.external_url", "").strip():
    lines.append(f'external_url = {q("federation.external_url")}')
lines.append("")

# ── adapters ────────────────────────────────────────────────────────────────────
lines += [
    "[adapters]",
    f'beads        = {q("adapters.beads",        "local-sqlite")}',
    f'pods         = {q("adapters.pods",         "local-jss")}',
    f'memory       = {q("adapters.memory",       "embedded-ruvector")}',
    f'events       = {q("adapters.events",       "local-jsonl")}',
    f'orchestrator = {q("adapters.orchestrator", "local-process-manager")}',
    "",
]

# ── gpu ─────────────────────────────────────────────────────────────────────────
lines += ["[gpu]", f'backend = {q("gpu.backend", "none")}', ""]

# ── desktop ─────────────────────────────────────────────────────────────────────
lines += [
    "[desktop]",
    f'enabled    = {b("desktop.enabled")}',
    f'stack      = {q("desktop.stack", "hyprland-wayland")}',
    f'resolution = {q("desktop.resolution", "1920x1080")}',
    "",
]

# ── sovereign_mesh ──────────────────────────────────────────────────────────────
lines += [
    "[sovereign_mesh]",
    f'enabled              = {b("sovereign_mesh.enabled")}',
    f'solid_pod            = {b("sovereign_mesh.solid_pod")}',
    f'nostr_bridge         = {b("sovereign_mesh.nostr_bridge")}',
    f'https_bridge         = {b("sovereign_mesh.https_bridge")}',
    f'publish_agent_events = {b("sovereign_mesh.publish_agent_events")}',
    f'telegram_mirror      = {b("sovereign_mesh.telegram_mirror")}',
    f'jss_rust_backend     = {b("sovereign_mesh.jss_rust_backend")}',
    "",
]

# ── observability ───────────────────────────────────────────────────────────────
lines += [
    "[observability]",
    f'metrics_port  = {i("observability.metrics_port", 9091)}',
    f'log_level     = {q("observability.log_level", "info")}',
]
otlp = s.get("observability.otlp_endpoint", "").strip()
if otlp:
    lines.append(f'otlp_endpoint = {json.dumps(otlp)}')
lines.append("")

# ── privacy filter (ADR-008) ────────────────────────────────────────────────────
lines += [
    "[privacy_filter]",
    f'enabled = {b("privacy_filter.enabled")}',
    f'mode    = {q("privacy_filter.mode",  "off")}',
    f'port    = {i("privacy_filter.port",  9092)}',
    f'dtype   = {q("privacy_filter.dtype", "bf16")}',
    f'model   = {q("privacy_filter.model", "openai/privacy-filter")}',
    "",
    "[privacy_filter.policy]",
    f'pods         = {q("privacy_filter.policy.pods",         "strict")}',
    f'memory       = {q("privacy_filter.policy.memory",       "strict")}',
    f'events       = {q("privacy_filter.policy.events",       "soft")}',
    f'beads        = {q("privacy_filter.policy.beads",        "soft")}',
    f'orchestrator = {q("privacy_filter.policy.orchestrator", "off")}',
    f'inbound      = {q("privacy_filter.policy.inbound",      "soft")}',
    f'outbound     = {q("privacy_filter.policy.outbound",     "soft")}',
    "",
    "[privacy_filter.entities]",
    "enabled = []",
    "",
]

# ── providers ───────────────────────────────────────────────────────────────────
PROVIDERS = {
    "anthropic":  "ANTHROPIC_API_KEY",
    "openai":     "OPENAI_API_KEY",
    "gemini":     "GOOGLE_GEMINI_API_KEY",
    "deepseek":   "DEEPSEEK_API_KEY",
    "perplexity": "PERPLEXITY_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "context7":   "CONTEXT7_API_KEY",
    "brave":      "BRAVE_API_KEY",
    "github":     "GITHUB_TOKEN",
    "zai":        "ZAI_API_KEY",
}
OPTIONAL_ENV_VARS: dict[str, list[str]] = {
    "openai":    ["OPENAI_BASE_URL"],
    "deepseek":  ["DEEPSEEK_BASE_URL"],
    "zai":       ["ZAI_ANTHROPIC_API_KEY", "ZAI_URL"],
}
for pname, env_var in PROVIDERS.items():
    enabled = s.get(f"providers.{pname}.enabled", False)
    optionals = OPTIONAL_ENV_VARS.get(pname, [])
    opt_str = json.dumps(optionals)
    lines += [
        f"[providers.{pname}]",
        f"enabled  = {'true' if enabled else 'false'}",
        f'env_var  = "{env_var}"',
        f"optional_env_vars = {opt_str}",
        "",
    ]

# ── toolchains ──────────────────────────────────────────────────────────────────
lines += [
    "[toolchains]",
    f'claude          = {b("toolchains.claude")}',
    f'claude_code     = {b("toolchains.claude_code")}',
    f'ruflo           = {b("toolchains.ruflo")}',
    f'claude_flow     = {b("toolchains.claude_flow")}',
    f'agentic_qe      = {b("toolchains.agentic_qe")}',
    f'nagual_qe       = {b("toolchains.nagual_qe")}',
    f'gemini_cli      = {b("toolchains.gemini_cli")}',
    f'code_server     = {b("toolchains.code_server")}',
    f'codebase_memory = {b("toolchains.codebase_memory")}',
    f'rust            = {b("toolchains.rust")}',
    f'cuda            = {b("toolchains.cuda")}',
    "",
]

# ── skills ──────────────────────────────────────────────────────────────────────
lines += [
    "[skills.browser]",
    f'agent_browser = {b("skills.browser.agent_browser")}',
    f'playwright    = {b("skills.browser.playwright")}',
    f'qe_browser    = {b("skills.browser.qe_browser")}',
    "",
    "[skills.media]",
    f'ffmpeg           = {b("skills.media.ffmpeg")}',
    f'imagemagick      = {b("skills.media.imagemagick")}',
    f'comfyui_builtin  = {b("skills.media.comfyui_builtin")}',
    "",
    "[skills.spatial_and_3d]",
    f'blender            = {b("skills.spatial_and_3d.blender")}',
    f'qgis               = {b("skills.spatial_and_3d.qgis")}',
    f'gaussian_splatting = {b("skills.spatial_and_3d.gaussian_splatting")}',
    "",
    "[skills.data_science]",
    f'pytorch = {b("skills.data_science.pytorch")}',
    f'jupyter = {b("skills.data_science.jupyter")}',
    "",
    "[skills.docs]",
    f'latex          = {b("skills.docs.latex")}',
    f'mermaid        = {b("skills.docs.mermaid")}',
    f'report_builder = {b("skills.docs.report_builder")}',
    "",
    "[skills.ontology]",
    f'enabled = {b("skills.ontology.enabled")}',
    "",
]

# ── sovereign_mesh.relay (PRD-004 / ADR-009) ────────────────────────────────────
if s.get("sovereign_mesh.relay.enabled", False):
    lines += [
        "[sovereign_mesh.relay]",
        f'enabled          = true',
        f'implementation   = {q("sovereign_mesh.relay.implementation",  "nostr-rs-relay")}',
        f'port             = {i("sovereign_mesh.relay.port",             7777)}',
        f'bind             = {q("sovereign_mesh.relay.bind",             "127.0.0.1")}',
        f'expose           = {b("sovereign_mesh.relay.expose")}',
        f'data_dir         = {q("sovereign_mesh.relay.data_dir",         "/var/lib/nostr-relay")}',
        f'ingress_policy   = {q("sovereign_mesh.relay.ingress_policy",   "allowlist")}',
        "allowed_pubkeys  = []",
        "allowed_kinds    = [1, 1059, 30078, 27235, 38000, 38100]",
        f'pod_bridge       = {b("sovereign_mesh.relay.pod_bridge")}',
        f'external_fanout  = {q("sovereign_mesh.relay.external_fanout",  "off")}',
        f'max_event_bytes  = {i("sovereign_mesh.relay.max_event_bytes",  131072)}',
        f'messages_per_sec = {i("sovereign_mesh.relay.messages_per_sec", 5)}',
        f'retention_days   = {i("sovereign_mesh.relay.retention_days",   30)}',
        f'allow_nip04      = {b("sovereign_mesh.relay.allow_nip04")}',
        f'info_description = {q("sovereign_mesh.relay.info_description", "Agentbox sovereign relay")}',
        f'info_contact     = {q("sovereign_mesh.relay.info_contact",     "")}',
        "",
    ]

# ── integrations ─────────────────────────────────────────────────────────────────
if s.get("integrations.comfyui_external.enabled", False):
    lines += [
        "[integrations.comfyui_external]",
        f'enabled = true',
        f'url    = {q("integrations.comfyui_external.url",    "http://comfyui:8188")}',
        f'ws_url = {q("integrations.comfyui_external.ws_url", "ws://comfyui:8188/ws")}',
        "",
    ]
else:
    lines += [
        "[integrations.comfyui_external]",
        "enabled = false",
        'url    = "http://comfyui:8188"',
        'ws_url = "ws://comfyui:8188/ws"',
        "",
    ]

if s.get("integrations.ruvector_external.enabled", False):
    lines += [
        "[integrations.ruvector_external]",
        "enabled = true",
        f'conninfo = {q("integrations.ruvector_external.conninfo")}',
        "",
    ]

if s.get("integrations.ragflow.enabled", False):
    lines += [
        "[integrations.ragflow]",
        "enabled = true",
        "",
    ]

output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

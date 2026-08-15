# Setup Wizard

The setup wizard is a browser-based, pre-boot editor for `agentbox.toml`. It
ships as a standalone HTML/CSS/JS frontend under `setup/frontend/dist/`.
Running-system operations moved to the operator cockpit in PRD-021.

## How to access it

Run the setup script from the project root:

```bash
./scripts/start-agentbox.sh
```

The script copies `agentbox.toml` and the JSON Schema alongside the frontend, then
serves them via `python3 -m http.server`. It prints the URL to stdout, for example:

```
AGENTBOX Setup: http://127.0.0.1:8765
```

Open that URL in any browser. No Node, Python runtime, or other dependency is
required beyond Python 3's built-in HTTP server.

If the optional `agentbox-setup` Rust binary is present, it serves the frontend
on a random `127.0.0.1` port and writes the validated manifest server-side.

## What it does

The wizard edits `agentbox.toml` through a form-based UI generated from the
manifest's JSON Schema. Every field shows the type, allowed values, and default.
Changes are validated on every keystroke; saving writes the TOML back preserving
comments and key ordering.

It deliberately has no post-boot operations mode. Once the container is running,
use `./agentbox.sh voice open`; this prevents setup code from maintaining a
second, drifting model of service health and governance.

## Sections

The wizard renders one card per top-level `agentbox.toml` section:

| Section | Description |
|---|---|
| Core | Orchestration engine and vector database |
| Mesh | Standalone or federated deployment mode (ADR-025) |
| Federation | Standalone or client federation with a host container mesh |
| Adapters | Five pluggable adapter slots (ADR-005) |
| Integrations | RuVector PG sidecar with PRD-018 retrieval gates (hybrid search, typed metadata, orient, health, TTL sweep), solid-pod-rs, ComfyUI |
| GPU | GPU backend and acceleration |
| Toolchains | Language runtimes and dev tools |
| Security | Sandbox policy, read-only rootfs |
| Sovereign Mesh | Nostr relay, NIP-98 auth, pure-Nostr mobile agent bridge |
| Skills | Pluggable skill modules |
| Features | Feature flags (ExpeL lesson extraction, etc.) |
| Desktop | VNC desktop environment |
| Linked Data | JSON-LD federation surfaces (PRD-006) |
| Privacy Filter | Local PII redaction sidecar (ADR-008) |
| Compression | Context-aware compression middleware (PRD-016) |
| Observability | Prometheus, OpenTelemetry |
| Payments | DREAM token economy and Web Ledger |
| Marketplace | LLM Resource Marketplace (kinds 38300-38305) |
| Providers | LLM provider configuration and API keys |
| Consultants | LLM consultant MCPs (PRD-013) |
| Networking | Tailscale mesh and host gateway |
| Plugins | Nix package plugins and extensions |
| Memory | RuVector memory backend and access control |
| Memory Learning | Trajectory-recording learning loop (PRD-018/ADR-036); enable producers before consumers (W066) |
| Memory Hygiene | Gates for non-dry-run data-hygiene ops (namespace repair, embedding backfill, legacy archival); fail-closed |
| Project Tracking | Sovereign project tracking (PRD-017/ADR-035): telemetry, `/v1/projects`, kind-30841 digests |

## See also

- [configuration.md](configuration.md) — full `agentbox.toml` field reference
- [ADR-024](../reference/adr/ADR-024-setup-dashboard.md) — dashboard architecture decisions
- [PRD-012](../reference/prd/PRD-012-setup-dashboard.md) — setup wizard product spec
- [web-interfaces.md](web-interfaces.md) — all running-system browser surfaces

# Setup Dashboard

The setup dashboard is a browser-based SPA for editing `agentbox.toml` and
observing the running container. It ships as a standalone HTML/CSS/JS frontend
under `setup/frontend/dist/`.

## How to access it

Run the setup script from the project root:

```bash
./scripts/start-agentbox.sh
```

The script copies `agentbox.toml` and the JSON Schema alongside the frontend, then
serves them via `python3 -m http.server`. It prints the URL to stdout, for example:

```
Dashboard: http://127.0.0.1:8765
```

Open that URL in any browser. No Node, Python runtime, or other dependency is
required beyond Python 3's built-in HTTP server.

If the optional `agentbox-setup` Rust binary is present, it serves the frontend
on a random `127.0.0.1` port and proxies Management API calls server-side so the
browser never holds the API key.

## What it does

The dashboard edits `agentbox.toml` through a form-based UI generated from the
manifest's JSON Schema. Every field shows the type, allowed values, and default.
Changes are validated on every keystroke; saving writes the TOML back preserving
comments and key ordering.

Once the container is running the dashboard switches to an operations view: service
health, real-time agent events, and adapter status sourced from the Management API
at `localhost:9090`.

## Sections

The dashboard renders one card per top-level `agentbox.toml` section:

| Section | Description |
|---|---|
| Core | Orchestration engine and vector database |
| Mesh | Standalone or federated deployment mode (ADR-025) |
| Adapters | Five pluggable adapter slots (ADR-005) |
| GPU | GPU backend and acceleration |
| Toolchains | Language runtimes and dev tools |
| Security | Sandbox policy, read-only rootfs |
| Sovereign Mesh | Nostr relay, NIP-98 auth, events |
| Skills | Pluggable skill modules |
| Desktop | VNC desktop environment |
| Linked Data | JSON-LD federation surfaces (PRD-006) |
| Identity | Sovereign identity (did:nostr) |
| Limits | Resource limits and quotas |
| Observability | Prometheus, OpenTelemetry |
| Backup | Volume backup configuration |
| Payment | DREAM token economy |
| Code-as-Harness | Code execution environments (PRD-008) |
| Marketplace | LLM Resource Marketplace |
| Providers | LLM provider configuration and API keys |
| Consultants | LLM consultant MCPs (PRD-013) |
| Networking | Tailscale mesh and host gateway |
| Plugins | Nix package plugins and extensions |
| Memory | RuVector memory backend and access control |

## See also

- [configuration.md](configuration.md) — full `agentbox.toml` field reference
- [ADR-024](../reference/adr/ADR-024-setup-dashboard.md) — dashboard architecture decisions
- [PRD-012](../reference/prd/PRD-012-setup-dashboard.md) — setup wizard product spec

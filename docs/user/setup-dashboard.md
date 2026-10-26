# Setup Wizard

The setup wizard is a browser-based, pre-boot editor for `agentbox.toml`. Running-system
operations moved to the operator cockpit in PRD-021.

## How to access it

```bash
./scripts/start-agentbox.sh
```

The script starts the compiled `agentbox-setup` server (build it once with
`cargo build --release` in `setup/`; if it is missing the script stops and says so; `--tui` runs the older shell
wizard, which rewrites the whole file). The server picks a random loopback port and prints the URL. To reach it from
another container, set `AGENTBOX_SETUP_BIND=<address>:<port>`. **The server has no authentication and its `/api/proxy` forwards with the management key, so bind beyond loopback only on a trusted network** (it prints a warning). `AGENTBOX_SETUP_NO_OPEN=1`
stops it launching a browser.

There is no server-less browser mode. Editing needs the server, which parses
`agentbox.toml` and changes only the values you edit.

## How it edits

The browser never parses or writes TOML. Each change you make is sent to the server as a
`{path, value}` edit (`POST /api/config/edit`) and applied with a comment-preserving editor
(`toml_edit`). Comments, ordering, whitespace and every untouched value survive byte for
byte, and `[[plugins.packages]]` entries are addressed by index. Saving validates the text
as TOML and writes it atomically (temp file in the same directory, fsync, rename).
If no `agentbox.toml` exists, the wizard starts from `setup/agentbox.default.toml` and
saving creates the file.

## Where the text comes from

| What | Source |
|---|---|
| Field descriptions | `description` in `schema/agentbox.toml.schema.json` |
| Section labels and groups | `schema/agentbox.toml.ui.json` |
| "Live / On restart / Needs rebuild" badges and "About" notes | `schema/agentbox.toml.apply.json`, generated from the CATALOGUE in `management-api/lib/system-manifest.js` by `node scripts/gen-setup-apply.cjs` |

`tests/config/setup-ui-drift.test.mjs` fails when a section lacks a label, group or
description, when a key lacks a description, when the seed contains a key the schema does
not know, or when the apply file is stale.

## Sections

| Group | What it covers | Sections |
|---|---|---|
| Platform & build | What is installed in the image and which core services run. | Core, Adapters, Feature flags, Plugins, Toolchains, Skills, Desktop |
| Models & routing | Which LLM providers, models and judges agents use. | Provider keys, Claude Code, Model routing, Consultants, System One judge |
| Memory & knowledge | Agent memory, the learning loop, the knowledge vault and linked data. | Memory access, Memory learning, Memory hygiene, Integrations, Knowledge vault, Linked data, Ontology monitor, Compression |
| Agents & scheduled jobs | Operator console, nightly jobs and project tracking. | Interaction plane (AoE), Voice console, Dream machine, Project tracking, Diagram review, SEO watch |
| Identity, mesh & economy | Nostr identity, federation with other containers, payments and forum seats. | Sovereign mesh, Mesh, Federation (deprecated), Networking, Sidechain, LLM marketplace, Payments, Poker house seat, Poker coach |
| Security & privacy | Sandbox policy and PII redaction. | Security, Privacy filter |
| Hardware & observability | GPU, CPU and memory limits, metrics and logs. | GPU, Resource limits, Observability |

## Tests

```bash
(cd setup && cargo test && cargo clippy --all-targets -- -D warnings)
node --test tests/config/setup-ui-drift.test.mjs
```

## See also

- [configuration.md](configuration.md) — full `agentbox.toml` field reference
- [ADR-024](../archive/adr/ADR-024-setup-dashboard.md) — original dashboard architecture (its standalone browser tiers are superseded by the server-only design above)
- [PRD-012](../archive/prd/PRD-012-setup-dashboard.md) — setup wizard product spec
- [web-interfaces.md](web-interfaces.md) — all running-system browser surfaces

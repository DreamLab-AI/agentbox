# Linked-Data interfaces

Agentbox can present every external surface — pod resources, Nostr envelopes, agent-event receipts, identity documents, payment mandates, MCP capabilities — as W3C [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/). This page is the operator's one-pager. The full product spec is [PRD-006](../reference/prd/PRD-006-linked-data-interfaces.md); the architectural decision is [ADR-012](../reference/adr/ADR-012-jsonld-federation-grammar.md); the bounded context is [DDD-004](../reference/ddd/DDD-004-linked-data-interchange-domain.md).

> **TL;DR.** Default off. Per-surface gates. The encoder runs after the privacy filter. Contexts are pinned at build time. Hand-authored docs use the LION subset.

## Quickstart — turn it on

```toml
# agentbox.toml
[linked_data]
enabled = true                  # master gate

# Phase 1 — mechanism only, no user data touched.
architecture_docs = "emit"
skill_metadata    = "emit"
```

Re-validate and rebuild:

```sh
agentbox config validate     # confirms E040–E049 pass
./agentbox.sh up --build
```

## What turns on with which gate

| Gate | Surface | Direction | Vocabulary | Prerequisite |
|---|---|---|---|---|
| `pods` | S1 — pod resources | bidirectional | ActivityStreams + Schema.org + LDP + agbx | `adapters.pods` ∈ {`local-solid-rs`, `external`} |
| `events` | S2 — Nostr envelope payloads | bidirectional | ActivityStreams + agbx | `[sovereign_mesh.relay].enabled = true` |
| `credentials` | S3 — Verifiable Credentials | emit | VC v2 + agbx | none (canonicalisation = jcs required) |
| `did_documents` | S4 — DID Documents at `/.well-known/did.json` | emit | DID v1 + did:nostr | `sovereign_mesh.solid_pod = true` |
| `provenance` | S5 — PROV-O receipts | emit | PROV-O + agbx | none |
| `capability_descriptors` | S6 — WoT Thing Descriptions | emit | WoT TD + Schema.org | none |
| `skill_metadata` | S7 — Schema.org HowTo | emit | Schema.org + agbx | none (build-time) |
| `payments` | S8 — agentic-payment mandates + receipts | bidirectional | VC + ODRL + Schema.org | canonicalisation = jcs |
| `memory_catalogue` | S9 — DCAT-3 namespace catalogue | emit | DCAT + PROV-O + agbx | none |
| `architecture_docs` | S10 — ADR/PRD/DDD frame frontmatter | emit | dcterms + SKOS + agbx | none (build-time) |
| `http_meta` | S11 — `/v1/meta` + `/v1/agent-events` | emit | Schema.org + PROV-O + agbx | none |

Each gate accepts `on`, `emit`, or `off`. A surface marked `on` is bidirectional (read+write); `emit` is one-way out; `off` is the default.

## Why turn it on

- An external integrator can dereference `did:nostr:<your-npub>` → DID Document → pod → resource representations and reach a complete description of the agent without bespoke code.
- The same `did:nostr:<pubkey>` signs every Nostr envelope, every Verifiable Credential, every payment receipt. The chain is verifiable end-to-end.
- Schema.org markup means search engines and Solid clients can interpret your agent's outputs without cooperation.
- W3C VC + ODRL gives agentic-payments mandates a deployed cryptographic-claim ecosystem instead of a bespoke envelope.

## Why leave it off (the default)

Agentbox is idiomatic JSON inside; turning the encoder on only matters when something outside agentbox cares. If you run a single-tenant standalone agent that only your tooling reads, leave it off — you'll save cycles and avoid a context-catalogue prefetch step. You can flip it on later without rebuilding anything except the manifest.

## Privacy filter handoff

The encoder runs **after** the [privacy filter](privacy-filter.md). When a span gets redacted, the encoder sees the marker (`[REDACTED]` by default) and emits a normal JSON-LD literal plus an `agbx:redacted = true` flag — the consumer can detect redaction without parsing the marker text.

`[linked_data].privacy_handoff.order = "after"` is documentation only. The validator rejects any other value (E048).

## Context catalogue

Every external `@context` IRI is fetched at build time, hashed, and shipped under `/opt/agentbox/contexts/` with an `index.json`. The runtime never fetches a context document — DDD-004 §L09. If you bump a vocabulary version, run:

```sh
./scripts/prefetch-hashes.sh --linked-data
```

This walks `lib/linked-data-contexts.nix`, resolves every `lib.fakeHash`, and patches the file in place. Mirrors how npm CLIs and Cargo crates work in agentbox.

## LION authoring

Hand-authored JSON-LD documents (skill `SKILL.md` frontmatter, ADR/PRD/DDD frontmatter, payment mandates that humans review before signing) use the [Linked Object Notation](https://linkedobjects.github.io/) subset. Five rules:

1. `@id` is a URL.
2. `@type` is optional but, if present, is a URL or a known term.
3. `@context` defaults are inherited — you don't write one unless you need to override.
4. Properties are URLs or known terms.
5. No `@protected` overrides.

Lint with:

```sh
node management-api/middleware/linked-data/lion-linter.js docs/reference/adr/*.md
```

CI runs the linter on every `.md` with a JSON-LD frontmatter block.

## Round-trip and canonicalisation

Every surface that emits JSON-LD satisfies:

```
emit(input) == compact(expand(emit(input)), context)
```

CI runs the round-trip tests on every PR. If you write a custom surface, add a fixture under `tests/contract/linked-data/` and the harness does the rest.

Surfaces that produce signed credentials (S3) or signed mandates (S8) additionally satisfy [JCS canonicalisation](https://www.rfc-editor.org/rfc/rfc8785) — the proof block hashes the canonical bytes.

## Common operator tasks

### Inspect the current catalogue

```sh
docker exec agentbox cat /opt/agentbox/contexts/index.json | jq .
```

### Override a context IRI

```toml
[linked_data.contexts]
schema = "https://corp-mirror.example.com/schema-org/v23.context.jsonld"
```

The override IRI must already be in the pinned catalogue (E045). Edit `lib/linked-data-contexts.nix` first, then prefetch.

### See which surfaces are active

```sh
curl -s http://localhost:9090/v1/meta -H 'Accept: application/ld+json' | jq '."agbx:linked-data-surfaces"'
```

### Disable everything quickly

```toml
[linked_data]
enabled = false       # forces every per-surface gate to off (E040)
```

Restart the container; nothing else changes.

## Validation rules

| Code | Meaning |
|---|---|
| `E040` | a per-surface gate is `on`/`emit` but `[linked_data].enabled = false` |
| `E041` | `pods` is on but the pods adapter is not local-solid-rs/external |
| `E042` | `events` is on but the embedded relay is not enabled |
| `E043` | `credentials`/`payments` is on but `canonicalisation != "jcs"` |
| `E044` | `did_documents` is on but `sovereign_mesh.solid_pod = false` |
| `E045` | a `[linked_data.contexts]` value is empty |
| `E046` | `context_cache_mode = "off"` paired with a user-touching surface |
| `W047` | `unknown_context_policy = "fail-open"` paired with `pods = "on"` |
| `W048` | linked-data is on but the privacy filter is off |
| `E048` | `[linked_data.privacy_handoff].order` is not `"after"` |
| `E049` | DID-document emit requires the `did-nostr` Cargo feature |

## Acknowledgements

JSON-LD 1.1 — Gregg Kellogg (in memoriam), Pierre-Antoine Champin, Dave Longley. LION — Melvin Carvalho. Verifiable Credentials, DID Core, ActivityStreams, PROV-O, Schema.org, WoT TD, DCAT, ODRL, SKOS — W3C Working Groups. Solid Protocol — Sarven Capadisli, Tim Berners-Lee, Ruben Verborgh and contributors. JCS RFC 8785 — Anders Rundgren, Bret Jordan, Samuel Erdtman.

The full bibliography: [PRD-006 §14](../reference/prd/PRD-006-linked-data-interfaces.md#14-acknowledgements-and-attribution).

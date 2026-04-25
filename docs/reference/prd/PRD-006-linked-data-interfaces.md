# PRD-006: Linked-data interfaces and JSON-LD compatible surfaces

**Status:** Draft v1
**Date:** 2026-04-25
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** PRD-001 (Capabilities and adapters), PRD-004 (External agent messaging), ADR-005 (Pluggable adapter architecture), ADR-008 (Privacy filter routing), ADR-009 (Embedded Nostr relay), ADR-010 (solid-pod-rs), ADR-012 (JSON-LD 1.1 adoption — this PRD's decision record), DDD-003 (Sovereign messaging domain), DDD-004 (Linked-data interchange domain)

## TL;DR for newcomers
*Skip if you already know why agentbox needs a single semantic grammar at its federation seams.*

This PRD enumerates every surface in agentbox where producing or consuming JSON-LD 1.1 ([W3C Recommendation, Kellogg, Champin, Longley](https://www.w3.org/TR/json-ld11/)) makes the seam cleaner — Solid pod resources, Nostr envelope payloads, Verifiable Credentials, DID Documents, agent-event provenance, MCP capability descriptors, agentic-payment mandates, ADR/PRD/DDD machine-readable cross-references — and pins down how each one maps onto agentbox's existing manifest, adapter, and middleware spine. The pain point it addresses is that the sovereign data stack already speaks RDF on the pod side, JSON on the relay side, ad-hoc envelopes on the payments side, and prose-only on the architecture-doc side; an external integrator cannot programmatically reason about agentbox without writing a parser per surface. The shape of the answer is **JSON-LD as a cross-cutting encoding middleware** that sits next to ADR-005 observability and ADR-008 privacy filter, plus a hand-authoring subset (Linked Object Notation, [Carvalho 2024, MIT](https://linkedobjects.github.io/)) for documents written by humans, plus a curated context catalogue that pins every external vocabulary by content hash. You will get the surface inventory, the manifest contract, the context-publishing model, the conformance commitment, and the round-tripping guarantees.

**If you remember only one thing:** one grammar at every federation seam, one hand-authored subset, one pinned context catalogue — agentbox is reachable as Linked Data without giving up its idiomatic JSON.

For the deep version, keep reading.

> **Scope.** This document specifies the **linked-data interchange product surface**: which agentbox seams expose JSON-LD, which vocabularies they bind, how operators control it via `agentbox.toml`, and what conformance guarantees we make to integrators. It does not redesign the existing adapters; it adds an encoding layer over them.

## 1. Product summary

Agentbox already ships a coherent sovereign data stack (identity, pods, relay, privacy filter — see `README.md` §"Sovereign data stack" and ADR-010). The data stack speaks RDF natively at the pod layer, raw JSON at the relay layer, and idiomatic JSON everywhere else. PRD-006 unifies that mix by committing to **JSON-LD 1.1 as the canonical interchange grammar at every external surface** — the boundary at which an external integrator (host project, federated peer, external agent, Nostr counterparty, payment counterparty) has to reason about agentbox-produced data without a bespoke schema.

Internal config, internal queues, and per-process state remain plain JSON, plain TOML, or domain-native structures. Linked-data encoding never crosses into the supervisor manifest, the adapter dispatch path, or the Nix flake evaluator.

The product commits to:

1. **Eleven federation surfaces** (§3) emit JSON-LD 1.1 in either Compacted, Expanded, or Framed form, selected per-surface.
2. **A pinned context catalogue** (§5) ships under `/opt/agentbox/contexts/` with content-addressed filenames, mirroring the same FOD-pattern used for npm CLIs (lib/npm-cli.nix) and Cargo crates (lib/solid-pod-rs.nix, lib/nagual-qe.nix).
3. **A hand-authoring subset** — Linked Object Notation (LION) — for documents that humans write directly (ADRs, PRDs, DDDs, skill metadata). LION is a strict subset of JSON-LD 1.1 with five rules; every LION document is a valid JSON-LD document.
4. **A round-trip guarantee**: every surface that emits JSON-LD MUST round-trip through Expansion → Compaction with the published context to byte-identical output. Tested in CI per surface.
5. **A privacy-filter handoff**: the linked-data middleware runs *after* the privacy filter (ADR-008) on outbound writes — the encoder never sees un-redacted spans.
6. **An off-by-default master gate**: `[linked_data].enabled = false` in the default manifest. Operators opt in per-surface; standalone-mode users see no behavioural change unless they ask for it.

## 2. Principles

1. **Federation seams only.** JSON-LD belongs at the boundary between agentbox and an external consumer. Internal config, internal events, and the adapter dispatch path stay plain.
2. **One grammar, multiple forms.** JSON-LD 1.1 supports Expanded, Compacted, Flattened, and Framed forms. Each surface picks one form and commits to it; consumers do not need to handle every form per surface.
3. **Context pinning is non-negotiable.** Remote `@context` IRIs are resolved at build time, hashed, and shipped under `/opt/agentbox/contexts/`. Runtime never fetches a context from the network. This mirrors the standard ADR-005 mistrust of mutable boot-time state.
4. **LION for humans, JSON-LD for machines.** Hand-authored documents use LION's five rules (`@id`, `@type`, optional `@context`, URLs as identifiers, no overrides of protected terms). Machine-emitted documents use the full JSON-LD 1.1 surface.
5. **Privacy filter is upstream.** ADR-008 runs on the data; the encoder sees post-filter bytes. This means a redaction-strict slot still produces valid JSON-LD even when entire fields are dropped.
6. **Round-trip discipline.** Every emitter is paired with a Compact-of-Expand test using the surface's published context. Drift between docs and emit fails CI.
7. **No vocabulary lock-in.** Surfaces bind to W3C / IETF / Schema.org / Solid / OCAP vocabularies whenever they exist; the `urn:agentbox:*` vocabulary is reserved for terms with no upstream equivalent.
8. **Read paths optional.** Producing JSON-LD is mandatory at marked surfaces; consuming JSON-LD is opt-in, gated per slot. Inbound unknown-context handling is *fail-closed* on `pods` and `events`, *fail-open* on `memory` and `beads`.

## 3. Surface inventory

Eleven federation surfaces are in scope. Each row pins a vocabulary, a JSON-LD form, an emit/consume direction, and the manifest gate that activates it.

| # | Surface | Direction | Vocabulary | JSON-LD form | Manifest gate |
|---|---|---|---|---|---|
| **S1** | Solid pod resource representations | bidirectional | LDP + Schema.org + ActivityStreams 2.0 | Compacted | `[linked_data].pods = "on"` (default when `adapters.pods = "local-solid-rs"`) |
| **S2** | Nostr envelope payloads (NIP-17 sealed DM `content`) | bidirectional | ActivityStreams 2.0 + agentbox extension | Compacted | `[linked_data].events = "on"` |
| **S3** | Verifiable Credentials (agent identity attestations, work receipts) | emit | W3C VC Data Model 2.0 + DID-VC | Compacted | `[linked_data].credentials = "on"` |
| **S4** | DID Documents (agent identity resolution) | emit | DID Core 1.0 + did:nostr method | Compacted | `[linked_data].did_documents = "on"` |
| **S5** | Provenance receipts (bead claims, agent actions) | emit | W3C PROV-O | Compacted | `[linked_data].provenance = "on"` |
| **S6** | MCP capability descriptors (Web of Things style) | emit | W3C WoT TD + Schema.org SoftwareApplication | Compacted | `[linked_data].capability_descriptors = "on"` |
| **S7** | Skill metadata (manifest + frontmatter) | emit | Schema.org HowTo + agentbox extension | Compacted | `[linked_data].skill_metadata = "on"` |
| **S8** | Agentic-payment mandates and receipts | bidirectional | W3C VC + ODRL 2.2 policy | Compacted | `[linked_data].payments = "on"` |
| **S9** | Memory namespace catalogues (RuVector → external publisher) | emit | DCAT-3 + PROV-O | Compacted | `[linked_data].memory_catalogue = "on"` |
| **S10** | ADR / PRD / DDD machine-readable headers | emit | Dublin Core Terms + agentbox extension + SKOS | Framed | `[linked_data].architecture_docs = "on"` |
| **S11** | `/v1/meta` + `/v1/agent-events` HTTP responses | emit | Schema.org SoftwareApplication + PROV-O | Compacted | `[linked_data].http_meta = "on"` |
| **S12** | Operator/agent JSON-LD viewer at `/lo/*` | consume | linkedobjects/browser + agentbox panes | Compacted | `[linked_data.viewer].mode = "local-linkedobjects"` |

Surface details follow.

### S1 — Solid pod resource representations

**Why:** the Solid Protocol 0.11 already mandates JSON-LD as a content negotiation target ([solid-pod-rs supports `text/turtle`, `application/ld+json`, `application/n-triples`](../adr/ADR-010-rust-solid-pod-adoption.md)). PRD-004's pod-inbox bridge writes Nostr envelopes to `pods/<npub>/events/inbox/<id>.json`; under PRD-006, those writes use the published Compacted form with the agentbox context.

**Vocabulary binding:**
- `as:` → `https://www.w3.org/ns/activitystreams#` ([ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-vocabulary/), Snell + Prodromou, W3C Recommendation 2017-05-23)
- `schema:` → `http://schema.org/` ([Schema.org](https://schema.org/), Guha et al., community-maintained)
- `ldp:` → `http://www.w3.org/ns/ldp#` ([Linked Data Platform 1.0](https://www.w3.org/TR/ldp/), Speicher + Arwe + Malhotra, W3C Recommendation 2015-02-26)
- `agbx:` → `https://agentbox.dreamlab-ai.systems/ns/v1#` (agentbox extension, this project)

**Form:** Compacted with the published `agentbox-pod.context.jsonld` document. Round-trip required.

**Read path:** consumer-supplied JSON-LD is expanded against the pinned context catalogue; unknown `@context` IRIs that are not in the catalogue cause the write to be rejected with `415 Unsupported Media Type` (fail-closed per §2.8).

### S2 — Nostr envelope payloads

**Why:** NIP-17 sealed DMs carry a `content` string that is opaque to the relay. Today agentbox uses ad-hoc JSON inside that envelope. Under PRD-006, the envelope content is JSON-LD 1.1 Compacted form, allowing external agents (Damus, Amethyst, custom counterparties) to interpret the payload semantically without coordinating a per-deployment schema.

**Vocabulary binding:** ActivityStreams 2.0 (`as:Activity`, `as:Note`, `as:Question`) + agentbox extension for agent-specific verbs (`agbx:RequestBriefing`, `agbx:HandoffClaim`, `agbx:DeliverArtefact`).

**Form:** Compacted, single root activity per envelope.

**Privacy filter handoff:** the encoder runs after ADR-008 redaction; redacted spans become `xsd:string` literals containing the configured replacement marker (default `[REDACTED]`).

**Round-trip:** the envelope content is a self-contained JSON-LD document; round-trip is tested as a unit.

### S3 — Verifiable Credentials

**Why:** agentbox already produces work receipts (beads claims, ADR-005 `events` adapter), agent identity attestations (sovereign-bootstrap.py), and agentic-payment authorisations (PRD-005 consultant tier emits per-call receipts). These are credentials in the W3C sense; emitting them as VCs gives external integrators a standard verification path.

**Vocabulary binding:**
- `https://www.w3.org/ns/credentials/v2` ([VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/), Sporny + Longley + Sabadello + Steele + Allen, W3C Recommendation 2025-05-15)
- `did:nostr:<npub>` issuer DID (S4)
- `BbsBlsSignature2020` or `Ed25519Signature2020` proof suite, depending on operator config

**Form:** Compacted, one credential per emit.

**Receipts as VCs:** each bead claim, each agentic-payment, and each privacy-filter redaction event produces a VC with the action's PROV-O trace as `credentialSubject`. The credential is signed by the agent identity and stored in `pods/<npub>/credentials/<credential-id>.jsonld`.

### S4 — DID Documents

**Why:** the sovereign identity layer already mints a Nostr keypair per profile. Exposing that as a DID Document via `did:nostr:<npub>` lets external systems resolve agent identity through a standard W3C method without bespoke Nostr-aware code.

**Vocabulary binding:**
- `https://www.w3.org/ns/did/v1` ([DID Core 1.0](https://www.w3.org/TR/did-core/), Reed + Sporny + Longley + Allen + Grant + Sabadello, W3C Recommendation 2022-07-19)
- `did:nostr` method spec ([draft, DreamLab-AI / nostr-protocol](https://github.com/nostr-protocol/nips/pull/1227))

**Resolution:**
1. solid-pod-rs already implements the `did-nostr` Cargo feature ([ADR-010](../adr/ADR-010-rust-solid-pod-adoption.md)); the DID Document for `did:nostr:<npub>` is fetched at `https://<pod-base>/.well-known/did.json`.
2. In `federation.mode = "client"`, the host orchestrator can mint DIDs into the same namespace; the agent uses its own `did:nostr` regardless.

**Form:** Compacted. One DID Document per agent identity. Updated only on identity rotation (DDD-003 §AgentIdentity).

### S5 — Provenance receipts

**Why:** every action an agent takes — claim a bead, write a memory entry, fetch a context, dispatch a consultant — is provenance. PROV-O is the canonical W3C vocabulary for it ([PROV-O](https://www.w3.org/TR/prov-o/), Lebo + Sahoo + McGuinness, W3C Recommendation 2013-04-30). Today these are written as plain JSON to the `events` adapter; under PRD-006, the same writes are also emitted as PROV-O JSON-LD when the surface is enabled.

**Vocabulary binding:**
- `prov:` → `http://www.w3.org/ns/prov#`
- `agbx:` for agentbox-specific entity classes

**Form:** Compacted, one `prov:Activity` per emitted event with linked `prov:Agent`, `prov:Entity`, `prov:wasGeneratedBy`, `prov:wasAttributedTo`.

**Coexistence with `events` adapter:** the PROV-O encoding is a parallel emit, not a replacement. Internal consumers (post-task hooks, intelligence routing) keep reading the plain JSONL form; external consumers subscribe to the PROV-O stream over the host orchestrator's webhook, MCP, or Nostr fan-out.

### S6 — MCP capability descriptors

**Why:** the 13 MCP servers shipped today (Playwright, ImageMagick, QGIS, Blender, ComfyUI, ...) are described in `agentbox.toml` and `provision-agent-stacks.py` in agentbox-internal terms. An external orchestrator that wants to discover what an agentbox container offers needs a portable description. W3C Web of Things Thing Descriptions ([WoT TD 1.1](https://www.w3.org/TR/wot-thing-description11/), Käbisch + Charpenay + Kaebisch + Kovatsch, W3C Recommendation 2023-12-05) is the right shape: a Thing has Properties, Actions, and Events, each with Forms (transport bindings) and DataSchemas.

**Vocabulary binding:**
- `td:` → `https://www.w3.org/2019/wot/td#`
- `schema:SoftwareApplication` for the MCP server itself
- `agbx:` for agentbox-specific bindings (stdio over `docker exec -i`, MCP transport variants)

**Form:** Compacted Thing Description per MCP server, served at `/v1/things/<server-id>` and discoverable at `/v1/things` (LDP container).

### S7 — Skill metadata

**Why:** the 96-skill catalogue ships as plain markdown frontmatter today. Schema.org's [`HowTo`](https://schema.org/HowTo) gives a standard shape for instructional content; combined with agentbox's progressive-disclosure pattern (skill metadata describes when to invoke, not what to do), it makes skills discoverable by external agents that have never seen agentbox before.

**Vocabulary binding:**
- `schema:HowTo`, `schema:HowToStep`, `schema:HowToTool`, `schema:HowToSupply`
- `agbx:Skill`, `agbx:ProgressiveDisclosure`, `agbx:invocationTrigger`, `agbx:requires`

**Form:** Compacted, one document per skill, embedded as JSON-LD frontmatter (`<script type="application/ld+json">` block) in the skill's `SKILL.md`.

**Authoring path:** skill authors write LION; the build emits full JSON-LD with the canonical context.

### S8 — Agentic-payment mandates and receipts

**Why:** the agentic-payments architecture (per the `agentic-payments` agent template) authorises agent-initiated payments. Every authorisation is a credential (S3) augmented with a policy (ODRL Permission/Prohibition/Obligation). Every payment receipt is a VC with the mandate as `credentialSubject.evidence`.

**Vocabulary binding:**
- VC Data Model 2.0 (S3)
- `odrl:` → `http://www.w3.org/ns/odrl/2/` ([ODRL Information Model 2.2](https://www.w3.org/TR/odrl-model/), Iannella + Villata, W3C Recommendation 2018-02-15)
- `schema:PaymentMethod`, `schema:Invoice`

**Form:** Compacted. Mandates are signed by the human principal's DID; receipts are signed by the agent's DID and reference the mandate by `evidence.id`.

**Round-trip with the cryptographic proof:** the JSON Canonicalization Scheme (JCS, [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), Rundgren + Jordan + Erdtman) MUST be applied before signing; the proof block contains the canonical hash. CI enforces JCS round-trip per emit.

### S9 — Memory namespace catalogues

**Why:** RuVector's `personal-context`, `project-state`, etc. namespaces are inert from an external integrator's perspective. Publishing each namespace as a DCAT Dataset with PROV-O lineage exposes which namespaces exist, who wrote into them, and when, without exposing entries themselves (privacy-respecting metadata).

**Vocabulary binding:**
- `dcat:` → `http://www.w3.org/ns/dcat#` ([DCAT-3](https://www.w3.org/TR/vocab-dcat-3/), Albertoni + Browning + Cox + Gonzalez Beltran + Perego + Winstanley, W3C Recommendation 2024-08-22)
- `dcterms:` → `http://purl.org/dc/terms/`
- `prov:` (S5)

**Form:** Compacted DCAT Catalog at `/v1/memory/catalogue`, one Dataset per namespace, PROV-O activity log per Dataset.

**Privacy:** entry content never appears in S9. Only namespace name, owner DID, last-modified timestamp, count, and access policy are published.

### S10 — Architecture documentation cross-references

**Why:** ADR-001 through ADR-012, PRD-001 through PRD-006, DDD-001 through DDD-004 already cross-reference each other in markdown. A small Framed JSON-LD header per document makes the whole architecture machine-traversable: an external tool can follow `dcterms:references` and `dcterms:supersedes` without parsing prose.

**Vocabulary binding:**
- `dcterms:` → `http://purl.org/dc/terms/`
- `skos:` → `http://www.w3.org/2004/02/skos/core#` ([SKOS Reference](https://www.w3.org/TR/skos-reference/), Miles + Bechhofer, W3C Recommendation 2009-08-18)
- `agbx:adr`, `agbx:prd`, `agbx:ddd` for agentbox-specific document classes

**Form:** Framed (one frame per doc class), embedded as JSON-LD frontmatter at the top of each `.md` file.

**Authoring path:** docs are hand-authored in LION; a build step re-emits the frame block. Frames live under `/docs/reference/_frames/`.

### S11 — `/v1/meta` and `/v1/agent-events`

**Why:** the management-api already exposes `/v1/meta` (compose-introspectable identity payload), `/livez`, `/ready`, `/health` (DDD-002 Probe Contract), and `/v1/agent-events` (PRD-004 outbound bridge). When `[linked_data].http_meta = "on"`, these responses are returned with `Content-Type: application/ld+json` and the published context, satisfying integrators that prefer Linked Data discovery over OpenAPI.

**Vocabulary binding:**
- `schema:SoftwareApplication`
- `prov:` (S5)
- `agbx:Capability`, `agbx:RuntimeContract`

**Form:** Compacted. The endpoints simultaneously support `application/json` and `application/ld+json` via standard HTTP content negotiation.

### S12 — Operator/agent JSON-LD viewer

**Why:** every emit surface (S1–S11) produces JSON-LD that is rendered today only via `curl -H 'Accept: application/ld+json'`. S12 mounts a JSON-LD-aware browser at `/lo/*` (default off) so operators and agents can navigate everything pod resources, credentials, mandates, agent-event streams, MCP capability descriptors, memory catalogues, and the runtime contract — by URL, with `@type`-dispatched panes that follow links between surfaces.

**Vocabulary binding:** every PRD-006 vocabulary plus the `agbx:` extension. Pane discovery is data-driven via `/lo/manifest.json`.

**Form:** Compacted (the viewer reads what the surfaces emit; no re-encoding).

**Implementation:** [linkedobjects/browser](https://github.com/linkedobjects/browser) (Melvin Carvalho et al., AGPL-3.0) is the first viewer implementation. The slot accepts other implementations behind the same `/lo/manifest.json` contract — operators can swap to a hosted instance via `[linked_data.viewer].mode = "external"` without rebuilding the image. See PRD-006 §15 for the full slot specification.

**URI dependency:** S12 follows links via the canonical URI grammar (ADR-013); every property pointing at a `urn:agentbox:*` URI becomes navigable via the `/v1/uri/<urn>` resolver. See PRD-006 §16.

## 4. Manifest model

A new top-level section `[linked_data]` controls every surface. The default is fully off; surfaces enabled here, plus their adapter-prerequisites, drive code paths.

```toml
[linked_data]
enabled = false                          # master gate; if false, every surface below is forced "off"

# Per-surface gates. "on" / "emit" / "off". Some surfaces only support emit.
pods                  = "off"            # S1; on | emit | off
events                = "off"            # S2; on | emit | off  (requires sovereign_mesh.relay.enabled)
credentials           = "off"            # S3; emit | off
did_documents         = "off"            # S4; emit | off       (requires sovereign_mesh.solid_pod = true)
provenance            = "off"            # S5; emit | off
capability_descriptors = "off"           # S6; emit | off
skill_metadata        = "off"            # S7; emit | off       (build-time emit only)
payments              = "off"            # S8; on | emit | off  (requires consultants or agentic-payments)
memory_catalogue      = "off"            # S9; emit | off
architecture_docs     = "off"            # S10; emit | off      (build-time emit only)
http_meta             = "off"            # S11; emit | off

# Encoding controls.
default_form          = "compacted"      # compacted | expanded | flattened | framed
context_catalogue     = "/opt/agentbox/contexts"   # path; image-time pinned
context_cache_mode    = "image"          # image | bind | off
unknown_context_policy = "fail-closed"   # fail-closed | fail-open
canonicalisation      = "jcs"            # jcs | none      (jcs required for S3 + S8)

# Vocabulary binding overrides — operator may pin alternate context IRIs at deploy time.
[linked_data.contexts]
agentbox  = "https://agentbox.dreamlab-ai.systems/ns/v1.context.jsonld"
activity  = "https://www.w3.org/ns/activitystreams"
credentials = "https://www.w3.org/ns/credentials/v2"
did       = "https://www.w3.org/ns/did/v1"
prov      = "http://www.w3.org/ns/prov#"
schema    = "http://schema.org/"
solid     = "http://www.w3.org/ns/solid/terms#"
wot       = "https://www.w3.org/2019/wot/td/v1.1"

# DID method controls.
[linked_data.did]
method        = "nostr"                  # nostr | key | web — nostr is the default sovereign method
service_endpoints = ["pod", "relay"]     # which agentbox services to publish in the DID Document
publish_to_well_known = true             # serve at /.well-known/did.json via solid-pod-rs

# Privacy-filter handoff (declarative; the actual middleware order is fixed in code).
[linked_data.privacy_handoff]
order = "after"                          # always after; this key is documentation, not configuration
```

### 4.1 Validation rules enforced by `agentbox config validate`

Each rule has an error code, a stderr regex, and a contract test under `tests/contract/linked-data/`.

1. `E040` — any `[linked_data].<surface> = "on"` or `"emit"` requires `[linked_data].enabled = true`.
2. `E041` — `[linked_data].pods = "on"` requires `adapters.pods = "local-solid-rs"` or `"external"` (an `off` pods adapter cannot serve resource representations).
3. `E042` — `[linked_data].events = "on"` requires `[sovereign_mesh.relay].enabled = true` (the JSON-LD encoder for S2 reads from the relay's pod-bridge channel).
4. `E043` — `[linked_data].credentials = "on"` and `[linked_data].payments = "on"` both require `[linked_data].canonicalisation = "jcs"` (JCS is mandatory for the proof suite).
5. `E044` — `[linked_data].did_documents = "on"` requires `sovereign_mesh.solid_pod = true` (the DID Document is served via solid-pod-rs `.well-known`).
6. `E045` — every IRI in `[linked_data.contexts]` MUST resolve to a file under `[linked_data].context_catalogue` at build time; unresolved IRIs fail Nix eval.
7. `E046` — `[linked_data].context_cache_mode = "off"` is rejected when any surface other than `architecture_docs` or `skill_metadata` is enabled (runtime contexts must be cached).
8. `E047` — `[linked_data].unknown_context_policy = "fail-open"` triggers a `W047` warning when `[linked_data].pods = "on"` (fail-open on the pods read path is dangerous; allowed but warned).
9. `E048` — privacy-filter handoff: if `[linked_data].enabled = true` and `[privacy_filter].enabled = false`, AND any surface that emits user-supplied bytes (S1, S2, S5, S8) is `"on"`, then the validator emits `W048` (recommend enabling the privacy filter).
10. `E049` — `[linked_data.did].method = "nostr"` requires the `did-nostr` Cargo feature in `lib/solid-pod-rs.nix` (which is on by default, but may be disabled by an operator). Cross-checked at flake eval.

## 5. Context catalogue

Every external `@context` IRI consumed by agentbox is **resolved at build time** and **pinned by content hash** into the runtime image at `/opt/agentbox/contexts/`. This mirrors the FOD pattern that backs npm CLIs (`lib/npm-cli.nix`) and Cargo crates (`lib/solid-pod-rs.nix`, `lib/nagual-qe.nix`). Runtime never fetches a context document.

### 5.1 Build-time resolution

`lib/linked-data-contexts.nix` (new) declares the catalogue:

```nix
{ lib, pkgs }:

let
  fetchContext = { url, sha256 }: pkgs.fetchurl {
    inherit url sha256;
    name = lib.replaceStrings ["/" ":"] ["-" "-"]
             (lib.removePrefix "https://" url);
  };

  catalogue = [
    { name = "activitystreams.context.jsonld";
      url  = "https://www.w3.org/ns/activitystreams";
      sha256 = "sha256-…"; }
    { name = "credentials-v2.context.jsonld";
      url  = "https://www.w3.org/ns/credentials/v2";
      sha256 = "sha256-…"; }
    { name = "did-v1.context.jsonld";
      url  = "https://www.w3.org/ns/did/v1";
      sha256 = "sha256-…"; }
    { name = "schema-org.context.jsonld";
      url  = "https://schema.org/docs/jsonldcontext.jsonld";
      sha256 = "sha256-…"; }
    { name = "wot-td.context.jsonld";
      url  = "https://www.w3.org/2019/wot/td/v1.1";
      sha256 = "sha256-…"; }
    { name = "prov-o.context.jsonld";
      url  = "http://www.w3.org/ns/prov-o#";
      sha256 = "sha256-…"; }
    { name = "dcat-3.context.jsonld";
      url  = "https://www.w3.org/ns/dcat#";
      sha256 = "sha256-…"; }
    { name = "odrl-2.context.jsonld";
      url  = "http://www.w3.org/ns/odrl/2/";
      sha256 = "sha256-…"; }
    { name = "skos.context.jsonld";
      url  = "http://www.w3.org/2004/02/skos/core";
      sha256 = "sha256-…"; }
    { name = "dcterms.context.jsonld";
      url  = "http://purl.org/dc/terms/";
      sha256 = "sha256-…"; }
    { name = "agentbox-v1.context.jsonld";
      url  = "https://agentbox.dreamlab-ai.systems/ns/v1.context.jsonld";
      sha256 = "sha256-…"; }
  ];
in
  pkgs.symlinkJoin {
    name = "agentbox-linked-data-contexts";
    paths = map fetchContext catalogue;
  }
```

The `prefetch-hashes.sh --linked-data` flag (added under PRD-006) walks the catalogue and resolves every `lib.fakeHash` to a real SRI hash, mirroring how `--cli` and `--service` work today.

### 5.2 Runtime resolution

The management-api boots a `LinkedDataContextResolver` whose `resolve(iri)` method:

1. Look up `iri` in the in-memory catalogue index (loaded once from `/opt/agentbox/contexts/index.json`).
2. If found, return the cached document.
3. If not found and `unknown_context_policy = fail-closed`, raise `UnknownContextError`. Adapter writes that depend on this context fail with `415 Unsupported Media Type` on the read path or `500 Internal Server Error` on the write path (rare; emit-only surfaces never produce unknown contexts).
4. If not found and `unknown_context_policy = fail-open`, log a `linked-data.unknown-context` event and return a stub context that maps every term to `xsd:string`.

The resolver is the only piece of agentbox code that knows about JSON-LD context IRIs.

### 5.3 Operator overrides

`[linked_data.contexts]` lets a deployment override individual context IRIs (e.g. point at a corporate-mirror copy of Schema.org). Overridden IRIs are still resolved at build time when `nix build .#runtime` runs against the deployment's manifest; runtime never fetches.

## 6. LION authoring subset

Hand-authored documents (skill SKILL.md frontmatter, ADR/PRD/DDD frontmatter, agent-issued mandates that humans review before signing) use [Linked Object Notation](https://linkedobjects.github.io/) ([Carvalho 2024, MIT-licensed](https://github.com/linkedobjects/linkedobjects.github.io/blob/main/LICENSE)).

### 6.1 LION rules

Every LION document is valid JSON-LD 1.1 by construction. Authors learn five rules:

1. **`@id` is a URL.** Every object has an `@id` whose value is an absolute IRI or a relative IRI that resolves under the document's base.
2. **`@type` is optional but recommended.** When present, its value is a URL or a term defined in the document's `@context`.
3. **`@context` defaults are inherited.** A LION document with no `@context` inherits the surface's published context (e.g. an ADR frame inherits `agbx:adr`). Authors do not write `@context` blocks unless they need to override a term.
4. **Properties are URLs (or terms).** Property names are either short terms defined in the inherited context or full IRIs. No bare ad-hoc keys; the linter rejects them.
5. **No `@protected` overrides.** LION documents may not redefine terms protected by the surface's published context. This is what makes LION safe to round-trip through full JSON-LD.

The LION linter (`agentbox lint linked-data <path>`) enforces these. CI runs the linter on every `.md` file containing a JSON-LD frontmatter block.

### 6.2 Why a subset

Full JSON-LD 1.1 has many features that humans get wrong: scoped contexts (§4.1.8 of the JSON-LD 1.1 Recommendation), framing pattern grammar, type-scoped vs property-scoped contexts, blank-node identifier discipline, base-IRI resolution rules. LION drops every one of those. Authors get the benefits of identifier-keyed objects without the footguns.

## 7. Privacy filter handoff

ADR-008 specifies the privacy filter as a cross-cutting middleware that wraps every adapter dispatch. PRD-006 adds the JSON-LD encoder as a *second* cross-cutting middleware whose order relative to the privacy filter is **fixed in code**: privacy filter runs first, encoder runs second.

```
adapter.write(payload)
  └─> observability.before()
      └─> privacy_filter.redact(payload)        (ADR-008)
          └─> linked_data.encode(redacted)      (PRD-006)
              └─> adapter.<impl>.write(jsonld_bytes)
              ↑ PRD-006 middleware
          ↑ ADR-008 middleware
      ↑ ADR-005 §Observability middleware
```

The `[linked_data].privacy_handoff.order` manifest key is documentation only — it cannot be set to `before`, and the validator rejects any other value. The intent is that operators reading `agentbox.toml` understand the order without reading source.

When ADR-008 redacts a span to `[REDACTED]`, the encoder treats the marker as a literal `xsd:string`. No special handling. This means a strict-redacted pod write produces a Compacted JSON-LD document where, e.g., `schema:email` has the value `"[REDACTED]"` and an associated `agbx:redacted = true` flag. Consumers can detect redaction through the flag without parsing the marker text.

## 8. Round-trip and conformance

### 8.1 Round-trip rule

Every emitter produces JSON-LD that satisfies:

```
emit(input) == compact(expand(emit(input)), context)
```

Tested in CI via `tests/contract/linked-data/round-trip.spec.js`, parameterised over all enabled surfaces. A regression in the round-trip test blocks merge.

### 8.2 Canonicalisation rule (S3, S8)

Surfaces that produce signed credentials or signed mandates additionally satisfy:

```
canonicalise(emit(input)) == jcs(emit(input))
```

JCS is [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (Rundgren + Jordan + Erdtman, IETF Informational 2020-06). The canonical hash is what the proof block signs.

### 8.3 W3C JSON-LD Test Suite

PRD-006 commits to passing the [W3C JSON-LD 1.1 Test Suite](https://w3c.github.io/json-ld-api/tests/) for:

- Expansion (100% of compact-tests, expand-tests)
- Compaction (100% of compact-tests)
- Flattening (skipped — no surface uses it; revisit if S5 PROV-O moves to flattened)
- Framing (100% of frame-tests applicable to S10 architecture-docs)

CI runs the test suite weekly via `nix flake check`.

### 8.4 No vocabulary lock-in

If a W3C, IETF, or schema.org vocabulary covers a concept agentbox needs, agentbox uses it. The `agbx:` namespace is reserved for terms with no upstream equivalent (e.g. `agbx:HandoffClaim`, `agbx:ProgressiveDisclosure`). Adding a term to `agbx:` requires:

1. A short rationale in `docs/reference/_vocab/agbx.md`.
2. A search pass for an equivalent in Schema.org, ActivityStreams, PROV-O, ODRL, or DCAT.
3. The term's IRI, datatype, and example use.
4. A round-trip test in `tests/contract/linked-data/vocab-agbx.spec.js`.

The `agbx:` context document itself is published at `https://agentbox.dreamlab-ai.systems/ns/v1.context.jsonld` and pinned in §5.

## 9. Federation interaction

PRD-006 amplifies federation in two ways:

### 9.1 `federation.mode = "client"`

When agentbox is federated with a host orchestrator, the host MAY supply a context override file. Surfaces enabled by the host adopt host-specific terms via `[linked_data.contexts]` overrides. The agentbox-side validator confirms each override file matches its declared `sha256`; mismatched files fail validation (E045).

### 9.2 `federation.mode = "standalone"`

In standalone mode, agentbox publishes its own context catalogue and is reachable as Linked Data without any external coordinator. An external integrator dereferences `did:nostr:<npub>` → `pod base IRI` → `pod resource representations (S1)` → `agent-event stream (S5)` and gets a complete picture without a host project ever existing. This is the strongest version of agentbox-as-product.

## 10. Test surface

Per ADR-005's contract-test discipline, every surface gets contract tests:

```
tests/contract/linked-data/
├── round-trip.spec.js              # §8.1 — every surface
├── jcs.spec.js                     # §8.2 — S3, S8
├── w3c-test-suite.spec.js          # §8.3 — expand, compact, frame
├── pods-s1.spec.js                 # S1 read + write
├── nostr-s2.spec.js                # S2 envelope encode/decode
├── credentials-s3.spec.js          # S3 sign + verify
├── did-s4.spec.js                  # S4 publish + resolve
├── prov-s5.spec.js                 # S5 event encode
├── wot-s6.spec.js                  # S6 thing description
├── skill-s7.spec.js                # S7 metadata frontmatter
├── payments-s8.spec.js             # S8 mandate + receipt round-trip
├── catalogue-s9.spec.js            # S9 DCAT publishing
├── arch-docs-s10.spec.js           # S10 frame round-trip
├── http-meta-s11.spec.js           # S11 content negotiation
├── privacy-handoff.spec.js         # §7 — middleware order
├── lion-linter.spec.js             # §6 — LION rule enforcement
└── unknown-context.spec.js         # §5.2 — fail-closed / fail-open
```

Each spec runs against all three implementation classes of the surface's prerequisite adapter (e.g. S1 runs against `local-solid-rs`, `external`, and the contract-test in-memory pod), confirming behavioural equivalence.

## 11. Phased rollout

The full surface inventory is large; PRD-006 ships in three phases. Each phase is independently testable and operator-visible.

### Phase 1 — foundations (target: 2026-05)

- §5 context catalogue, §5.1 build-time resolution, §5.2 runtime resolver
- §6 LION subset + linter
- §4 manifest model, §4.1 validation rules E040–E049
- S10 architecture-docs Framed encoding (build-time only; lowest risk)
- S7 skill metadata (build-time only)
- §8 round-trip rule + W3C test suite wiring

This phase ships the mechanism without enabling any user-data-touching surface.

### Phase 2 — sovereign-stack surfaces (target: 2026-06)

- S1 pods Compacted encoding (read + write)
- S2 Nostr envelope payloads
- S4 DID Documents
- S5 PROV-O provenance receipts (parallel emit alongside `events` adapter)
- §7 privacy-filter handoff wired in code, ordering test passing

This phase activates the linked-data surfaces of the existing sovereign data stack.

### Phase 3 — credential-bearing surfaces (target: 2026-07)

- S3 Verifiable Credentials with Ed25519Signature2020 proof suite
- S8 agentic-payment mandates and receipts with ODRL policies
- S6 MCP capability descriptors as WoT Thing Descriptions
- S9 DCAT memory namespace catalogues
- S11 `/v1/meta` and `/v1/agent-events` content negotiation
- §8.2 JCS canonicalisation enforced

This phase makes agentbox a first-class Linked Data citizen with verifiable claims.

## 12. UX commitments

1. **Silent in standalone-default mode.** A user who clones agentbox and runs `./agentbox.sh up --build` without touching `[linked_data]` sees zero behavioural change from PRD-006.
2. **Discoverable via `agentbox config validate`.** Operators see clear validation errors when they enable a surface without its prerequisites.
3. **Single-page operator doc.** [`docs/user/linked-data.md`](../../user/linked-data.md) (added under PRD-006) is the one-page walkthrough; it links to surface-specific deep-dives and the W3C source specifications.
4. **JSON-LD playground links.** Every example in the operator and developer docs links to the [JSON-LD Playground](https://json-ld.org/playground/) with a pre-loaded fragment, mirroring the W3C spec's own conventions.
5. **No magic strings.** `agentbox.toml` keys are descriptive; the validator's error messages cite the exact section and the precise prerequisite that failed.

## 15. Viewer slot (S12)

The eleven emit surfaces produce JSON-LD; S12 makes it browsable. The slot mirrors the ADR-005 adapter pattern: one abstract slot, multiple implementations, manifest-gated.

### 15.1 Three implementations

| Mode | Implementation | When to use |
|---|---|---|
| `local-linkedobjects` | [linkedobjects/browser](https://github.com/linkedobjects/browser) bundled into the image at `/opt/agentbox/browser/` | default for any operator who wants an interactive surface; ~1100 LOC vanilla JS, no deps |
| `external` | operator-supplied URL (e.g. `https://linkedobjects.org/browser/`) | when an off-host viewer is preferred; SRI hash recommended |
| `off` | route returns 404 | default; emit surfaces still produce JSON-LD, no UI |

### 15.2 Pane manifest contract

Every viewer implementation reads `/lo/manifest.json` at boot. The shape is:

```json
{
  "agentbox":   "<image-version>",
  "agentDid":   "did:nostr:<npub>",
  "viewer":     { "name": "linkedobjects-browser", "version": "...", "license": "AGPL-3.0-only", "source": "..." },
  "panes":      [PaneEntry, ...],
  "registry":   { "<@type>": "<pane-url>", ... },
  "deeplinks":  { "meta": "/v1/meta", "did-document": "<pod>/.well-known/did.json", ... },
  "buildInfo":  { "name": "...", "version": "...", "rev": "..." }
}
```

`PaneEntry` shape:

```json
{
  "id":              "vc",
  "label":           "Credentials",
  "icon":            "🪪",
  "url":             "/lo/panes/vc-pane.js",
  "matches":         [ { "@type": "VerifiableCredential" }, ... ],
  "agentbox-surface": "S3",
  "source":          "built-in"   // or "operator" or "upstream"
}
```

### 15.3 Three pane sources

Panes merge in priority order:

1. **Operator-supplied** via `[linked_data.viewer].extra_panes`. Each entry is a URL or a path under `/workspace/profiles/<stack>/viewer/panes/`. Operators ship custom panes without forking agentbox.
2. **Built-in** under `management-api/middleware/linked-data/viewer/panes/`. The agentbox-specific viewers for surfaces the upstream browser does not ship: VC (S3/S8), provenance (S5/S11), capability (S6), runtime (S11), DCAT (S9), handoff (S2).
3. **Upstream** from the linkedobjects/browser bundle: folder, profile, markdown, todo, playlist, sharing, source, home.

Later sources override earlier ones by `id`.

### 15.4 Public extension API

Adding a pane requires zero core changes:

```js
// /workspace/profiles/<stack>/viewer/panes/billing.js
import { html, render } from '/lo/losos/html.js';

export default {
  id: 'billing',
  label: 'Billing',
  icon: '💳',
  matches: [{ '@type': 'PaymentReceipt' }],
  canHandle(subject, store) { /* … */ },
  render(subject, store, container, raw) { render(container, html`…`); }
};
```

```toml
[linked_data.viewer]
extra_panes = ["/workspace/profiles/default/viewer/panes/billing.js"]
```

The pane manifest endpoint picks it up on the next request.

### 15.5 AGPL-3.0 §13 compliance

The bundled linkedobjects/browser is AGPL-3.0. Every response from `/lo/*` carries:

- `Source-Code: https://github.com/linkedobjects/browser` (per AGPL §13)
- `X-Viewer-Version: <pinned-version>`
- `X-Viewer-Source: <upstream-tree-url>`
- `X-Viewer-License: AGPL-3.0-only`

Aggregation analysis follows the [solid-pod-rs treatment](../adr/ADR-010-rust-solid-pod-adoption.md): the browser is shipped as static assets served by the management-api, never linked into agentbox first-party JavaScript. Agentbox stays MPL-2.0.

### 15.6 Validation rules

| Code | Meaning |
|---|---|
| `E050` | viewer.mode != off requires master gate enabled |
| `E051` | viewer.mode = "external" requires external_url |
| `E052` | sri_hash must look like an SRI (`sha-{256\|384\|512}-<base64>`) |
| `W053` | linked-data emits but viewer is off (advisory) |
| `E054` | mount_path collides with a reserved management-api route |

## 16. Canonical URI grammar (ADR-013 cross-reference)

Every `@id` value emitted by a PRD-006 surface follows the canonical URI grammar specified in [ADR-013](../adr/ADR-013-canonical-uri-grammar.md). Two key contracts:

- **Uniqueness is unconditional.** Every URI emitted by `uris.mint(...)` is globally unique by construction. Same payload → same URI, every time.
- **Resolvability is best-effort.** The `/v1/uri/<urn>` resolver returns 307 (resolvable), 404 (unknown), or 410 (retracted). Consumers can always trust the URI as a name; they should only trust the redirect when the resolver answers 307.

The viewer (S12) follows the contract: it dereferences URIs through `/v1/uri/<urn>`, renders 200 results in their pane, and renders 404 results as the URN literal with a "no representation available" badge so panes always finish rendering.

The full URI grammar:

```
identity-uri   ::= "did:nostr:" npub
name-uri       ::= "urn:agentbox:" kind ":" [scope ":"] local
kind           ::= pod | envelope | credential | mandate | receipt
                 | activity | event | mcp | memory | skill
                 | adr | prd | ddd | thing | dataset | bead | meta
content-hash   ::= "sha256-12-" 12HEXDIGIT
```

See [ADR-013 §1](../adr/ADR-013-canonical-uri-grammar.md#1-grammar) for the full grammar and [ADR-013 §3](../adr/ADR-013-canonical-uri-grammar.md#3-surface-refactor) for the per-surface mint shape.

## 13. Out-of-scope

The following are deliberately not in scope for PRD-006:

- **Full SPARQL endpoint over agentbox data.** A SPARQL surface is an obvious next step but lives in a follow-up PRD.
- **JSON-LD Algorithms 1.1 ([RDF dataset canonicalisation, RDFC-1.0](https://www.w3.org/TR/rdf-canon/))**. RDFC-1.0 is needed for general-purpose RDF dataset signing; agentbox's signed surfaces (S3, S8) use JCS over the JSON-LD bytes directly, which is sufficient for the agentic-payments and VC use cases. RDFC-1.0 may be added in a follow-up if a federated peer requires it.
- **YAML-LD or CBOR-LD.** Both are in development at the W3C ([YAML-LD CG Report](https://www.w3.org/community/json-ld/wiki/YAML-LD); [CBOR-LD draft](https://digitalbazaar.github.io/cbor-ld-spec/)). Not on the agentbox roadmap until a real consumer asks.
- **Internal config in JSON-LD.** Out of scope by §1 §2.1. `agentbox.toml`, supervisor configs, and contract-test fixtures stay plain.
- **Adapter contract changes.** PRD-006 sits *above* the adapter contract (ADR-005); it does not add a sixth slot or change any existing slot's interface.

## 14. Acknowledgements and attribution

PRD-006 is layered over decades of W3C and IETF standardisation. The specifications it depends on, with their authors:

| Specification | Authors | Status |
|---|---|---|
| [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) | Gregg Kellogg, Pierre-Antoine Champin, Dave Longley (1.1 editors); Manu Sporny, Markus Lanthaler (1.0 editors); Niklas Lindström | W3C Recommendation 2020-07-16 (errata 2025-06-04) |
| [JSON-LD 1.1 Processing Algorithms and API](https://www.w3.org/TR/json-ld11-api/) | Gregg Kellogg, Dave Longley, Pierre-Antoine Champin | W3C Recommendation 2020-07-16 |
| [JSON-LD 1.1 Framing](https://www.w3.org/TR/json-ld11-framing/) | Dave Longley, Gregg Kellogg, Pierre-Antoine Champin | W3C Recommendation 2020-07-16 |
| [Linked Object Notation (LION)](https://linkedobjects.github.io/) | Melvin Carvalho et al. | MIT-licensed open spec; the LION authoring rules in §6 are paraphrased from this source |
| [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | Manu Sporny, Dave Longley, Markus Sabadello, Orie Steele, Christopher Allen | W3C Recommendation 2025-05-15 |
| [DID Core 1.0](https://www.w3.org/TR/did-core/) | Drummond Reed, Manu Sporny, Dave Longley, Christopher Allen, Ryan Grant, Markus Sabadello | W3C Recommendation 2022-07-19 |
| [ActivityStreams 2.0 Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/) | James M Snell, Evan Prodromou | W3C Recommendation 2017-05-23 |
| [PROV-O](https://www.w3.org/TR/prov-o/) | Timothy Lebo, Satya Sahoo, Deborah McGuinness | W3C Recommendation 2013-04-30 |
| [Web of Things Thing Description 1.1](https://www.w3.org/TR/wot-thing-description11/) | Sebastian Käbisch, Victor Charpenay, Matthias Kovatsch, Daniel Peintner | W3C Recommendation 2023-12-05 |
| [Schema.org](https://schema.org/) | Ramanathan V. Guha and the schema.org community | Living standard, multi-vendor |
| [SKOS Reference](https://www.w3.org/TR/skos-reference/) | Alistair Miles, Sean Bechhofer | W3C Recommendation 2009-08-18 |
| [DCAT-3](https://www.w3.org/TR/vocab-dcat-3/) | Riccardo Albertoni, David Browning, Simon Cox, Alejandra Gonzalez Beltran, Andrea Perego, Peter Winstanley | W3C Recommendation 2024-08-22 |
| [ODRL Information Model 2.2](https://www.w3.org/TR/odrl-model/) | Renato Iannella, Serena Villata | W3C Recommendation 2018-02-15 |
| [LDP 1.0](https://www.w3.org/TR/ldp/) | Steve Speicher, John Arwe, Ashok Malhotra | W3C Recommendation 2015-02-26 |
| [Solid Protocol 0.11](https://solidproject.org/TR/protocol) | Sarven Capadisli, Tim Berners-Lee, Ruben Verborgh, Kjetil Kjernsmo, Justin Bingham, Dmitri Zagidulin | Solid Project, Editor's Draft |
| [JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785) | Anders Rundgren, Bret Jordan, Samuel Erdtman | IETF Informational, RFC 8785, 2020-06 |
| [RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/) | Richard Cyganiak, David Wood, Markus Lanthaler | W3C Recommendation 2014-02-25 |

In memoriam: **Gregg Kellogg** (d. 2025-09-06), central editor of JSON-LD 1.0 and 1.1 across more than a decade of W3C work. Agentbox stands on his shoulders.

The DreamLab-AI dependencies that make PRD-006 implementable today:

- [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) — Solid Protocol 0.11 server with `did-nostr` resolver, native JSON-LD content negotiation, and atomic-rename storage. Powers S1 + S4 + S9.
- [`nostr-rs-relay`](https://github.com/scsibug/nostr-rs-relay) — vendored at `lib/nostr-rs-relay.nix`. Powers S2.
- The agentbox sovereign-bootstrap layer (`scripts/sovereign-bootstrap.py`) — the keypair source for every S3, S4, S8 signature.
- `nostr-tools` + `@noble/curves` — cryptographic primitives for Schnorr signatures over BIP-340.

PRD-006 commits to keeping every surface implementable without proprietary dependencies and without paid third-party services.

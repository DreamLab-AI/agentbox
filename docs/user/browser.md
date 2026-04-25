# The agentbox browser — every surface, one URL away

When the viewer slot is on, every JSON-LD document agentbox emits has a clickable URL. Point a browser tab at a pod resource, a credential, an agent-event stream, an MCP capability descriptor — anything PRD-006 emits — and you get an interactive view, with `@type`-dispatched panes, `@id`-following navigation, and copy-pasteable deeplinks. No backend coordination, no SDK, no per-deployment client. One URI, one renderer.

This page is the operator's walkthrough. The companion docs:

- [`docs/user/linked-data.md`](linked-data.md) — the eleven JSON-LD federation surfaces (S1–S11) that produce the documents the viewer renders
- [`docs/user/uris.md`](uris.md) — the canonical URI grammar that lets every emitted document have a stable, dereferenceable name
- [PRD-006](../reference/prd/PRD-006-linked-data-interfaces.md) — full product spec
- [ADR-012](../reference/adr/ADR-012-jsonld-federation-grammar.md) — JSON-LD adoption decision
- [ADR-013](../reference/adr/ADR-013-canonical-uri-grammar.md) — URI grammar decision

> **TL;DR.** Default off. `[linked_data.viewer].mode = "local-linkedobjects"` mounts a JSON-LD-aware browser at `/lo/*`, served by the management-api. It reads `/lo/manifest.json` at boot, follows `@id` URIs through `/v1/uri/<urn>`, and renders every PRD-006 surface with a per-`@type` pane. AGPL-3.0; uses [linkedobjects/browser](https://github.com/linkedobjects/browser) (Melvin Carvalho et al.) as the first viewer implementation.

## The URI surface in one paragraph

Every agentbox JSON-LD document carries an `@id` minted through the canonical grammar (`did:nostr:<pubkey>` or `urn:agentbox:<kind>:[<scope>:]<local>`, [ADR-013](../reference/adr/ADR-013-canonical-uri-grammar.md)). The `/v1/uri/<urn>` resolver dereferences names to current HTTPS IRIs (best-effort: 307 when known, 404 when not). The viewer follows those redirects automatically. This means: if you can produce a URI that names something agentbox manages — a credential, an event, a pod resource, an MCP server — you can drop it into a browser address bar and get a rendered view, even when the URI is name-only and the resolver only knows the redirect target on this specific deployment. **Names are unconditional; views are best-effort. The browser handles both.**

## Quickstart — turn it on

```toml
# agentbox.toml
[linked_data]
enabled = true
http_meta = "emit"        # so /v1/meta becomes JSON-LD too

[linked_data.viewer]
mode = "local-linkedobjects"
```

```sh
agentbox config validate
./scripts/prefetch-hashes.sh --service linkedobjects-browser  # resolve srcHash on first build
./agentbox.sh up --build
```

Then open `http://<host>:9090/lo/` and click around.

## How it works

```
┌────────────────────────────────────────────────────────────┐
│  Operator/agent's browser                                  │
│  GET /lo/  →  index.html  →  imports /lo/mashlib.js        │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  /lo/* on the management-api (port 9090)                   │
│   • serves the linkedobjects/browser bundle (AGPL-3.0)     │
│   • serves /lo/panes/<file> for built-in agentbox panes    │
│   • emits /lo/manifest.json — the pane registry            │
│   • adds Source-Code header (AGPL §13 compliance)          │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  /lo/manifest.json (Compacted JSON-LD)                     │
│   {                                                         │
│     "agentDid": "did:nostr:<pubkey-hex>",                      │
│     "panes":    [PaneEntry, ...],                          │
│     "registry": {"<@type>": "<pane-url>"},                 │
│     "deeplinks": {"meta": "/v1/meta", ...},                │
│     "viewer":   {"name": "linkedobjects-browser",          │
│                  "version": "...", "license": "AGPL-3.0"}  │
│   }                                                         │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Pane dispatch (LOSOS shell)                               │
│   1. Local panes whose canHandle() returns true            │
│   2. ui:view if the resource declares one                  │
│   3. Registry @type → URL fallback                         │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  /v1/uri/<urn> resolver (always available)                 │
│   307 → fetch redirect target  (resolvable)                │
│   404 → render URN literal     (name-only)                 │
│   410 → "retracted" badge      (gone)                      │
└────────────────────────────────────────────────────────────┘
```

## Three pane sources

The pane manifest endpoint merges three sources, each independently versionable:

| Source | Where | Examples | When to use |
|---|---|---|---|
| **Upstream** | the linkedobjects/browser bundle | folder, profile, markdown, todo, playlist, sharing, source, home | shipped with the bundle; cover S1, S4, S7, S10 directly |
| **Built-in** | `management-api/middleware/linked-data/viewer/panes/` | vc, provenance, capability, runtime, dcat, handoff | agentbox-specific surfaces (S2, S3, S5, S6, S8, S9, S11); ship in the image |
| **Operator** | `[linked_data.viewer].extra_panes` | anything operators add via filesystem path or URL | custom panes for deployment-specific resources |

Later sources override earlier ones by `id`. **Adding a pane requires zero code changes to agentbox** — write the ES module, register it in the manifest, reload.

## Surface-by-surface walkthrough

Each PRD-006 emit surface has a default URL operators can paste into the browser. Where the resolver returns 307, the viewer follows the redirect automatically; where it returns 404, the viewer renders the URN literal with a "no representation available" badge.

### S1 — Pod resources

```
http://<host>:9090/lo/?resource=urn:agentbox:pod:01234567…:sha256-12-deadbeef
```

The resolver redirects to `<pod-base>/agents/<pubkey>/pod/<local>`; the upstream `folder-pane` or `markdown-pane` (or our own pane if the resource carries an agentbox `@type`) renders.

### S2 — Nostr envelope payloads

```
http://<host>:9090/lo/?resource=urn:agentbox:envelope:01234567…:sha256-12-…
```

Renders with the agentbox `handoff-pane` for `agbx:HandoffClaim` / `RequestBriefing` / `DeliverArtefact`, with the upstream `source-pane` for raw `as:Note` / `as:Activity`.

### S3 — Verifiable Credentials

```
http://<host>:9090/lo/?resource=urn:agentbox:credential:01234567…:sha256-12-…
```

The agentbox `vc-pane` renders the issuer (clickable to S4 DID Document), validity window, credentialSubject, evidence (clickable to S8 mandate URIs), and proof block.

### S4 — DID Documents

```
http://<host>:9090/lo/?resource=did:nostr:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The upstream `profile-pane` renders verification methods, service endpoints (clickable: pod base, relay URL), authentication methods. The DID is the agent's primary identity URI; clicking it from any other surface lands here.

### S5 — PROV-O agent events

```
http://<host>:9090/lo/?resource=/v1/agent-events
```

The agentbox `provenance-pane` renders an event stream as a table — time, action, slot, op, agent, used entities, generated entities. Each entity is clickable; click `prov:generated` URIs to land on the resource the activity produced.

### S6 — MCP capability descriptors

```
http://<host>:9090/lo/?resource=urn:agentbox:mcp:playwright
```

The agentbox `capability-pane` renders the WoT Thing Description: forms (transports), actions, properties, events, and security definitions. One click per MCP server in the deployment.

### S7 — Skills

```
http://<host>:9090/lo/?resource=urn:agentbox:skill:console-buddy
```

The upstream `markdown-pane` renders the skill `SKILL.md` plus the Schema.org HowTo frontmatter (steps, tools, supplies).

### S8 — Payment mandates and receipts

```
http://<host>:9090/lo/?resource=urn:agentbox:mandate:fedcba98…:sha256-12-…
http://<host>:9090/lo/?resource=urn:agentbox:receipt:01234567…:sha256-12-…
```

The `vc-pane` (which handles every VerifiableCredential subclass) renders ODRL Permissions, Schema.org Invoice fields, and `evidence` chains.

### S9 — DCAT memory namespace catalogue

```
http://<host>:9090/lo/?resource=/v1/memory/catalogue
```

The agentbox `dcat-pane` renders namespace name, identifier, modified time, byte size, access policy. Memory entry contents are deliberately not exposed (PRD-006 §S9 privacy).

### S10 — ADR / PRD / DDD frame frontmatter

```
http://<host>:9090/lo/?resource=urn:agentbox:adr:013
```

The upstream `markdown-pane` plus a Framed JSON-LD header gives clickable cross-references between architecture documents (`dcterms:references`, `dcterms:replaces`).

### S11 — Runtime contract

```
http://<host>:9090/lo/?resource=/v1/meta
```

The agentbox `runtime-pane` renders the resolved adapter map, observability binding, security profile, bootstrap state, and readiness requirements.

## Writing a custom pane

Three lines plus an ES module:

```js
// /workspace/profiles/default/viewer/panes/billing.js
import { html, render } from '/lo/losos/html.js';

export default {
  id: 'billing',
  label: 'Billing',
  icon: '💳',
  matches: [{ '@type': 'PaymentReceipt' }, { '@type': 'http://schema.org/Invoice' }],
  canHandle(subject, store) {
    const t = store.type ? store.type(subject.value) : null;
    return Array.isArray(t)
      ? t.some((x) => String(x).includes('Invoice'))
      : false;
  },
  render(subject, store, container, raw) {
    render(container, html`
      <article>
        <h1>Invoice ${raw['schema:invoiceNumber']}</h1>
        <p>${raw['schema:totalPaymentDue']}</p>
      </article>
    `);
  },
};
```

```toml
# agentbox.toml
[linked_data.viewer]
extra_panes = ["/workspace/profiles/default/viewer/panes/billing.js"]
```

The pane manifest picks it up on the next `/lo/manifest.json` request. No image rebuild.

## Implementation modes

| Mode | What happens | When to use |
|---|---|---|
| `off` (default) | every `/lo/*` request returns 404 | viewer not needed; surfaces still emit JSON-LD |
| `local-linkedobjects` | bundle materialised at `/opt/agentbox/browser/` is served by management-api | want an interactive surface, single-tenant |
| `external` | management-api redirects `/lo/*` to a hosted instance | want to share a viewer across many deployments |

`external` mode supports an `sri_hash` value to pin the integrity of the upstream bundle.

## Configuration reference

```toml
[linked_data.viewer]
mode                 = "off"                    # off | local-linkedobjects | external
mount_path           = "/lo"                    # URL prefix; reserved-route-safe (E054)
bundle_path          = "/opt/agentbox/browser"  # override for local-linkedobjects
external_url         = ""                       # required when mode = external (E051)
sri_hash             = ""                       # SRI hash for external bundles (E052)
expose_port          = false                    # reach /lo/* from outside the host
extra_panes          = []                       # operator-supplied pane URLs/paths
upstream_panes_visible = true                   # show upstream panes in the manifest
source_code_header   = ""                       # override; default = upstream repo URL
```

## Validation rules

| Code | Meaning |
|---|---|
| `E050` | viewer mode != off requires `[linked_data].enabled = true` |
| `E051` | `mode = "external"` requires `external_url` |
| `E052` | `sri_hash` must look like an SRI (`sha-{256\|384\|512}-<base64>`) |
| `W053` | linked-data emits but viewer is off (advisory) |
| `E054` | `mount_path` collides with a reserved management-api route prefix |

## AGPL-3.0 §13 compliance

The bundled linkedobjects/browser is AGPL-3.0. Every response from `/lo/*` carries:

- `Source-Code: https://github.com/linkedobjects/browser` — the upstream repo (AGPL §13)
- `X-Viewer-Source: <upstream-tree-url>` — the exact tree the bundle was built from
- `X-Viewer-Version: <pinned-version>`
- `X-Viewer-License: AGPL-3.0-only`

Aggregation analysis matches the [solid-pod-rs treatment](../developer/licensing.md): the browser is shipped as static assets served by the management-api, never linked into agentbox first-party JavaScript. Agentbox stays MPL-2.0; the viewer remains AGPL-3.0.

## Common operator tasks

### Inspect the live pane manifest

```sh
curl -s http://<host>:9090/lo/manifest.json | jq .
```

### Confirm the source-code header

```sh
curl -sI http://<host>:9090/lo/ | grep -i source-code
# Source-Code: https://github.com/linkedobjects/browser
```

### Discover the URI grammar from the resolver

```sh
curl -s http://<host>:9090/v1/uri | jq .
```

### Resolve any URI

```sh
URI='urn:agentbox:meta:runtime'
curl -sI "http://<host>:9090/v1/uri/$(jq -rn --arg u "$URI" '$u | @uri')"
# 307 Location: /v1/meta
```

### Add a custom pane without rebuilding

```sh
mkdir -p /workspace/profiles/default/viewer/panes
cat > /workspace/profiles/default/viewer/panes/billing.js <<EOF
import { html, render } from '/lo/losos/html.js';
export default {
  id: 'billing', label: 'Billing', icon: '💳',
  matches: [{ '@type': 'PaymentReceipt' }],
  canHandle: (s, store) => true,
  render: (s, store, c) => render(c, html`<h1>Billing</h1>`),
};
EOF

# add the path to [linked_data.viewer].extra_panes in agentbox.toml
```

## Acknowledgements & attribution

The viewer slot stands on:

- **[linkedobjects/browser](https://github.com/linkedobjects/browser)** — Melvin Carvalho et al., AGPL-3.0. The first-implementation viewer; 1100 lines of vanilla JS, no dependencies, dispatches by `@type`. Source pinned by content hash in `lib/linkedobjects-browser.nix`.
- **[Linked Object Notation (LION)](https://linkedobjects.github.io/)** — Melvin Carvalho et al., MIT. The authoring subset agentbox adopts for hand-written JSON-LD documents (PRD-006 §6).
- **JSS / NosDav / Solid lineage** — Sir Tim Berners-Lee, Sarven Capadisli, Ruben Verborgh, Kjetil Kjernsmo, Justin Bingham, Dmitri Zagidulin, and the broader Solid community. Mashlib's `--mashlib-module` interface and the rdflib subset that LION reproduces.
- **[W3C JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)** — Gregg Kellogg (in memoriam, d. 2025-09-06), Pierre-Antoine Champin, Dave Longley.
- **[W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)**, **[W3C DID Core 1.0](https://www.w3.org/TR/did-core/)**, **[W3C ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-vocabulary/)**, **[W3C PROV-O](https://www.w3.org/TR/prov-o/)**, **[W3C WoT TD 1.1](https://www.w3.org/TR/wot-thing-description11/)**, **[Schema.org](https://schema.org/)**, **[W3C DCAT-3](https://www.w3.org/TR/vocab-dcat-3/)**, **[W3C ODRL 2.2](https://www.w3.org/TR/odrl-model/)**, **[W3C SKOS](https://www.w3.org/TR/skos-reference/)** — vocabularies the surfaces and panes bind to.
- **[Solid Protocol 0.11](https://solidproject.org/TR/protocol)** — Sarven Capadisli, Tim Berners-Lee, Ruben Verborgh, Kjetil Kjernsmo, Justin Bingham, Dmitri Zagidulin.
- **[IETF RFC 8141 (URN syntax)](https://www.rfc-editor.org/rfc/rfc8141)** — P. Saint-Andre, J. Klensin. The URN philosophy of stable names independent of location.

The DreamLab-AI dependencies that make this surface implementable today:

- **[`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs)** — Solid Protocol 0.11 server with `did:nostr` resolver, JSON-LD content negotiation, and atomic-rename storage. Powers S1, S4, S9 dereferencing.
- **`nostr-rs-relay`** — vendored at `lib/nostr-rs-relay.nix`. Powers S2.
- **The agentbox sovereign-bootstrap layer** (`scripts/sovereign-bootstrap.py`) — keypair source for every DID, every signed credential, every payment receipt.

Per-pane attribution is in each file's header comment under `management-api/middleware/linked-data/viewer/panes/`.

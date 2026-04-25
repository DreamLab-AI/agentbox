# Canonical URIs — the names that unify every agentbox surface

Every JSON-LD document agentbox emits — pod resources, Nostr envelopes, Verifiable Credentials, DID Documents, agent-event records, MCP capability descriptors, payment mandates, memory namespace catalogues, ADR/PRD/DDD frame headers, the runtime contract — carries an `@id`. This page explains what those `@id`s mean, the contract they satisfy, and how operators dereference them.

The full architectural decision is [ADR-013](../reference/adr/ADR-013-canonical-uri-grammar.md). The bounded context lives in [DDD-004 §URICanonicaliser](../reference/ddd/DDD-004-linked-data-interchange-domain.md#uricanonicaliser).

> **TL;DR.** Two URI shapes: `did:nostr:<pubkey>` for identity, `urn:agentbox:<kind>:[<scope>:]<local>` for everything else. Uniqueness is unconditional. Resolvability is best-effort. The `/v1/uri/<urn>` endpoint dereferences the names that resolve, and tells you when one doesn't.

## The two contracts

**Uniqueness — unconditional.** Every URI agentbox mints is globally unique by construction. The same payload (a credential's subject, an agent activity, a Nostr envelope's content) always yields the same URI; different payloads always yield different URIs. This holds whether the resolver can fetch the resource or not, whether the pod is online or not, whether the operator has flipped surfaces on or off.

**Resolvability — best-effort.** Pointing a tool at a URI and asking it to fetch a representation may or may not succeed. The `/v1/uri/<urn>` endpoint is the operator's resolver; it answers in three states:

| HTTP status | Meaning | What to do |
|---|---|---|
| `307 Location: <https-iri>` | URI is resolvable here, now | follow the redirect to fetch a current representation |
| `404 not-resolvable` | URI is well-formed but the resolver cannot point at a representation | use the URI as a name; it still identifies the resource |
| `410 gone` | URI was once resolvable; the resource has been retracted | stop attempting to fetch |
| `400 malformed-uri` | input does not match the grammar | rewrite the URI |

Treating a URI as a name first, an address second, is the same model W3C [DID Core](https://www.w3.org/TR/did-core/) and IETF [RFC 8141 (URN syntax)](https://www.rfc-editor.org/rfc/rfc8141) commit to. Agentbox follows that lineage.

## The grammar

```
URI            ::= identity-uri | name-uri

identity-uri   ::= "did:nostr:" pubkey-hex
                   ; agent's sovereign identity (BIP-340 x-only pubkey, 64 lc hex)

name-uri       ::= "urn:agentbox:" kind ":" [scope ":"] local
                   ; everything else

kind           ::= pod | envelope | credential | mandate | receipt
                 | activity | event | mcp | memory | skill
                 | adr | prd | ddd | thing | dataset | bead | meta
                   ; closed set; new kinds are a one-line code change

scope          ::= pubkey-hex              ; required for owner-scoped kinds
                                           ; (see "When is the pubkey scope present?" below)

local          ::= content-hash | slug
content-hash   ::= "sha256-12-" 12HEXDIGIT  ; first 12 hex chars of SHA-256
slug           ::= [A-Za-z0-9._-]{1,96}     ; ASCII slug
```

## Three minting rules

Every URI agentbox emits follows one of three rules, codified in `management-api/lib/uris.js` and called by every surface emitter.

### R1 — Content-addressed

When the payload uniquely determines the resource, `<local>` is `sha256-12-<first 12 hex chars of SHA-256(stableStringify(payload))>`. Same input → same URI, every time.

Used for: `credential`, `mandate`, `receipt`, `activity`, `event`, `pod`, `envelope`.

```
urn:agentbox:credential:01234567…:sha256-12-deadbeef0000
                                    └── SHA-256 of the credentialSubject
```

If you re-issue the same credential to the same subject with the same fields, you get the same URI. Tools can deduplicate without coordinating IDs.

### R2 — Scope-bearing

When the resource is owned by an agent, `<scope>` carries the owner's BIP-340 x-only pubkey hex.

Used for: every owner-scoped kind (`pod`, `envelope`, `credential`, `mandate`, `receipt`, `activity`, `event`, `dataset`, `bead`).

```
urn:agentbox:event:01234567…:sha256-12-…
              kind  scope        local
```

The pubkey and the kind together let monitoring tools query "all events emitted by this agent" or "all credentials issued by this agent" without scanning every name.

### R3 — Stable on identity

When the resource is a static thing with a public, immutable name (a skill, an MCP server, an ADR number), `<local>` is its public label and there is no `<scope>`.

Used for: `mcp`, `skill`, `adr`, `prd`, `ddd`, `thing`, `memory`, `meta`.

```
urn:agentbox:skill:console-buddy
urn:agentbox:mcp:playwright
urn:agentbox:adr:013
urn:agentbox:meta:runtime
```

Same skill, same MCP server, same ADR — same URI across rebuilds, deployments, federations.

## When is the pubkey scope present?

| Kind | scope present? | Why |
|---|---|---|
| `pod` | ✓ | resources live in an agent's pod |
| `envelope` | ✓ | Nostr envelopes are signed by an agent |
| `credential` | ✓ | scoped to the issuer |
| `mandate` | ✓ | scoped to the principal who signed it |
| `receipt` | ✓ | scoped to the issuing agent |
| `activity` | ✓ | scoped to the actor |
| `event` | ✓ | scoped to the agent emitting |
| `dataset` | ✓ | scoped to the dataset owner |
| `bead` | ✓ | scoped to the agent that claimed it |
| `mcp` | ✗ | server is shared across agents |
| `memory` | ✗ | namespace, not owner |
| `skill` | ✗ | corpus member, not owner |
| `adr` / `prd` / `ddd` | ✗ | architecture artefact, not owner |
| `thing` | ✗ | exposed capability, not owner |
| `meta` | ✗ | one runtime per container |

## Worked examples

### A Verifiable Credential the agent issued

```
urn:agentbox:credential:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:sha256-12-9f3a5b2c8e1d
```

- `kind = credential`
- `scope = 01234567…` — the agent who issued it (BIP-340 x-only pubkey hex)
- `local = sha256-12-…` — content-addressed on the credentialSubject

Resolvable when `[linked_data].credentials = "emit"` and `[linked_data].pods != "off"`. The resolver redirects to:
`http://<pod-base>/agents/<pubkey>/credential/<local>`.

### A DID Document for an agent

```
did:nostr:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Resolvable when `[linked_data].did_documents = "emit"`. The resolver redirects to:
`http://<pod-base>/.well-known/did.json`.

### A PROV-O activity record

```
urn:agentbox:activity:01234567…:sha256-12-1e1cf2a04d77
```

Content-addressed on `{ action, slot, operation, startedAt, input, output }`. Resolvable when `[linked_data].provenance = "emit"`.

### An MCP capability descriptor

```
urn:agentbox:mcp:playwright
```

Stable on the server id. Resolvable when `[linked_data].capability_descriptors = "emit"`.

### A skill in the corpus

```
urn:agentbox:skill:console-buddy
```

Stable on the skill id. Resolvable when `[linked_data].skill_metadata = "emit"`. The resolver redirects to `/v1/skills/console-buddy`.

### An ADR

```
urn:agentbox:adr:013
```

Resolves to `/docs/reference/adr/013.md` when `[linked_data].architecture_docs = "emit"`.

### The runtime meta document

```
urn:agentbox:meta:runtime
```

Resolves to `/v1/meta`. Always one per agent.

### A memory namespace dataset

```
urn:agentbox:dataset:01234567…:project-state
```

Scoped to the agent that owns the namespace; resolvable when `[linked_data].memory_catalogue = "emit"`.

### An agentic-payment mandate

```
urn:agentbox:mandate:fedcba98…:sha256-12-a4cf7e891b30
```

Scoped to the human principal who signed it. Resolvable when `[linked_data].payments != "off"`.

### A retracted resource

```
GET /v1/uri/urn%3Aagentbox%3Acredential%3A01234567…%3Asha256-12-…  → 410 Gone
```

The resource was once resolvable; the resolver has positive knowledge that it has been deleted. Clients should stop trying.

### An unresolvable URI from a federated peer

```
GET /v1/uri/urn%3Aagentbox%3Acredential%3Acafebabe…%3Asha256-12-…  → 404
```

Well-formed; the resolver doesn't know how to fetch it because the credential lives in another agentbox. The URI still identifies the credential uniquely; tooling can use it as a name.

### Discovering the grammar

```
GET /v1/uri  → 200 application/json
```

Returns the grammar, the kind catalogue, the contract statements, and a doc link. Useful for clients that want to discover what this agentbox supports.

## The viewer follows URIs

When the viewer (S12, [`docs/user/browser.md`](browser.md)) renders a document and encounters a URI in any field, it constructs `?resource=<uri>` deeplinks. Click a credential's `evidence` field → the viewer dereferences the mandate URI, opens the mandate pane, and you see the policy that authorised the credential. Click an activity's `prov:used` entity → you see the entity's pane. The browser is the consumer side of the same URI grammar the surfaces emit.

When the resolver answers 404, the viewer renders the URN literally with a `🔗 no representation available` badge. The pane still finishes rendering; the URN is still useful as a copy-pastable identifier.

## Common operator tasks

### Inspect a URI

```sh
curl -s http://localhost:9090/v1/uri | jq .grammar
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
     "http://localhost:9090/v1/uri/$(jq -rn --arg u 'urn:agentbox:meta:runtime' '$u | @uri')"
```

### Mint a URI by hand

The grammar is simple enough to mint URIs without running agentbox:

```sh
# stable on a public id
echo "urn:agentbox:skill:console-buddy"

# content-addressed on a payload
node -e '
const crypto = require("crypto");
const stable = (v) => v === null || typeof v !== "object"
  ? JSON.stringify(v)
  : Array.isArray(v)
    ? "[" + v.map(stable).join(",") + "]"
    : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
const pubkey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const payload = { id: "did:nostr:b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0", name: "Subject" };
const hash = crypto.createHash("sha256").update(stable(payload), "utf8").digest("hex").slice(0, 12);
console.log(`urn:agentbox:credential:${pubkey}:sha256-12-${hash}`);
'
```

### Treat a URI as a name when the resolver is unreachable

```javascript
const uris = require('@agentbox/uris');
if (uris.isCanonical(someId)) {
  // use as a name regardless of whether resolver answers
  cache.set(someId, body);
}
```

## Why this matters

Without the URI grammar, the eleven JSON-LD surfaces are eleven independent emit streams that happen to share JSON syntax. With it:

- **Verifiable signatures bind a stable identifier.** A signed credential's proof block hashes a URI that doesn't change on re-emit.
- **Federation works.** A URI minted under `local-solid-rs` keeps its identity when the operator switches to `external` pods; only the resolver's redirect target changes.
- **Deduplication is automatic.** Re-emitting the same payload yields the same URI; external indexes don't double-count.
- **Monitoring is uniform.** "Show me every credential this agent has ever issued" is a single SPARQL query (or a single `urn:agentbox:credential:<pubkey>:*` glob).
- **The viewer can navigate.** Cross-surface links are real links, not opaque blobs.
- **Backends are swappable.** Operators move pods, swap memory backends, change relay URLs; URIs survive.

## Attribution

The URI grammar stands on:

- **W3C DID Core 1.0** — Drummond Reed, Manu Sporny, Dave Longley, Christopher Allen, Ryan Grant, Markus Sabadello. The two-step name-vs-resolution model.
- **IETF [RFC 8141 (URN syntax)](https://www.rfc-editor.org/rfc/rfc8141)** — P. Saint-Andre, J. Klensin (IETF, April 2017). The URN philosophy of stable names independent of location.
- **W3C VC Data Model 2.0** — Manu Sporny, Dave Longley, Markus Sabadello, Orie Steele, Christopher Allen. Credential identifier conventions.
- **`did:nostr` method draft** — DreamLab-AI / nostr-protocol contributors.
- The agentbox FOD-everything pattern — `lib/npm-cli.nix`, `lib/solid-pod-rs.nix`, `lib/nagual-qe.nix`, `lib/linked-data-contexts.nix`. Content-addressing as a deployment discipline.

In memoriam: **Gregg Kellogg** (d. 2025-09-06). Editor of JSON-LD 1.0 and 1.1; the JSON-LD layer every URI in this grammar plays inside.

The full PRD-006 / ADR-012 / ADR-013 / DDD-004 bibliography is in [PRD-006 §14](../reference/prd/PRD-006-linked-data-interfaces.md#14-acknowledgements-and-attribution).

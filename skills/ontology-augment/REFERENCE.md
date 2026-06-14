# Ontology Augment — Reference

Full spec for the consumption side of the ontology binding (PRD-020 / ADR-112).
Architecture: one shared in-process retrieval library (`mcp/servers/lib/ontology-retrieval.js`)
exposing an identical "brain" to every caller — the MCP tool, the consultant seam, and
the CLI. Not an HTTP microservice; each process builds its own via `createDefaultRetrieval()`.

---

## `ontology_ask` — parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | natural-language concept; semantically matched against `ns:ontology-classes` |
| `model_tier` | `haiku`\|`sonnet`\|`opus` | tier default | controls mode, depth, and the token cap |
| `mode` | `menu`\|`expand` | per-tier | `menu` = seeds only (cheap); `expand` = seeds + relations |
| `depth` | int | per-tier | expansion hops; clamped to the tier's max |
| `max_tokens` | int | per-tier cap | hard upper bound on the serialised Turtle |
| `provenance` | `asserted`\|`inferred`\|… | `asserted` | which graph layer to read from |
| `full` | bool | false | full subgraph; **forbidden below `sonnet`** (ADR-116) — silently downgraded, never rejected |
| `domain` | string | — | optional domain filter (`ai`/`bc`/`mv`/`rb`/`tc`/`ngm`) |

### Returns

```jsonc
{
  turtle: "PREFIX vc: …\n<urn:ngm:class:…> a owl:Class .",  // budget-clamped
  breadcrumb: "[ONTOLOGY] seed: vc:… → expand via ontology_ask",
  seed_iris: ["urn:ngm:class:…"],   // top semantic seeds (≤8)
  tokens_used: 146,
  truncated: false,                 // true when clamp trimmed the subgraph
  provenance: "asserted",
  cache_hit: false,                 // 120s TTL cache, keyed on the full request
  degraded: false,                  // true ⇒ backend failed, returned empty (fail-open)
  full_denied: false,               // true ⇒ full:true downgraded for tier
  latency_ms: 5035
}
```

## Budget & tier model (ADR-116)

- Each tier maps to `{ mode, depth, token-cap }`. Higher tier ⇒ deeper expansion and a
  larger cap. `clampToBudget()` trims the Turtle to the cap and sets `truncated`.
- `full:true` requires ≥ `sonnet`; below that it is downgraded (`full_denied:true`) so a
  cheap agent can still call the tool without erroring.
- A 120s TTL cache (max 256 entries) keyed on `{query, tier, mode, depth, provenance, full}`
  amortises repeat asks within a turn-cluster.

## Maturity & domain gating

- Seeds carry a `maturity` rank; by default only `established`+ (rank ≥ 4) survive.
  **Unknown** maturity (knowledge-page stubs) is *not* gated out — only explicitly-low
  maturity is dropped. Override via `deps.minMaturity` when constructing a custom retrieval.
- `domain` filters seeds to one source-domain prefix.

## Fail-open semantics

Both stages are wrapped: a `seed` failure returns `{degraded:true, error:'seed_unavailable'}`
(empty), an `expand` failure degrades to the seed *menu* rather than failing the whole call.
Grounding never blocks a turn.

## SPARQL via `graph_query`

- Read-only: only `SELECT`/`ASK`/`DESCRIBE`/`CONSTRUCT`. `UPDATE`/`INSERT`/`DELETE` rejected
  (`sparql_readonly`).
- Server-side hardening (WS-0): naive `SELECT` clamped to `MAX_SPARQL_ROWS=10000`, 8 MiB
  response cap, and the `SERVICE` keyword is in the forbidden set (SSRF block).
- Hits `POST /api/ontology/sparql` with `Authorization: Bearer $VISIONCLAW_DEV_TOKEN` +
  `X-Nostr-Pubkey: $AGENTBOX_PUBKEY` (power_user-gated).

## Governed writeback (write side, WS-1/WS-9/WS-12)

Reads are pervasive; **writes are governed** — three gates:

1. `ontology_propose` → `POST /api/ontology-agent/propose` — `RequireAuth` + `RateLimit`;
   the proposer identity is taken from the authenticated user, overriding any client-supplied
   value. Unauthenticated → 403.
2. Proposals persist in a durable SQLite store (`SqliteEnrichmentRepository`, migration 0003)
   and surface on the **broker inbox** governance queue for sign-off.
3. Derived facts go to `POST /api/ontology/derived` — fenced: writes targeting
   `urn:ngm:graph:ontology:assert` or `:inferred` are rejected (400 "fenced graph");
   only the `:summary` graph is writable. This keeps agent-derived material out of the
   asserted/inferred truth layers until elevated through governance.

Two-speed governance (ADR-122): high-confidence evolving facts may auto-elevate;
structural/asserted changes route through the forum agent-card surface (and, per ADR-123,
voice-mediated sign-off). See those ADRs for the elevation policy.

## PUSH channel mechanics

- `getOntologyBreadcrumb(prompt)` scores the prompt against the cached class index using
  trigram Jaccard similarity; emits a breadcrumb only when the top score ≥
  `ONTOLOGY_PUSH_MIN_RELEVANCE` (default `0.11`).
- Injected per turn by `config/hooks/claude-flow-hook-adapter.cjs` (`maybeInjectOntology`)
  in the route path. The class-index cache is rebuilt at container boot
  (`entrypoint-unified.sh` Phase 5d → `ontology-index-build.js`).
- Output is one line, ≤~80 tokens, carrying the seed plus `(maturity, domain)` metadata.

## Consultant seam

`mcp/consultants/shared/consultant-base.js` `_handleConsult` augments a consultant's
context with an `ontology_ask` result when `CONSULT_ONTOLOGY_AUGMENT=1` and the consultant
opts in (`ontologyAugmentEnabled`). Same retrieval brain, same budget.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `VISIONCLAW_API_URL` | KG backend base URL | `http://visionclaw-server:4000` |
| `VISIONCLAW_DEV_TOKEN` | power_user bearer token | — |
| `AGENTBOX_PUBKEY` | `X-Nostr-Pubkey` identity | — |
| `ONTOLOGY_TIMEOUT_MS` | per-request timeout | `10000` |
| `ONTOLOGY_PUSH_MIN_RELEVANCE` | PUSH floor | `0.11` |
| `CONSULT_ONTOLOGY_AUGMENT` | enable consultant seam | off |

## Source map

| Concern | File |
|---|---|
| retrieval brain | `agentbox/mcp/servers/lib/ontology-retrieval.js` |
| PUSH breadcrumb | `agentbox/mcp/servers/lib/ontology-push.js` |
| index builder | `agentbox/mcp/servers/lib/ontology-index-build.js` |
| budget/tier | `agentbox/mcp/servers/lib/ontology-budget.js` |
| MCP tools | `agentbox/mcp/servers/ontology-bridge.js` |
| consultant seam | `agentbox/mcp/consultants/shared/consultant-base.js` |
| Rust write-path | VisionClaw `src/handlers/ontology_*`, `adapters/sqlite_enrichment_repository.rs` |

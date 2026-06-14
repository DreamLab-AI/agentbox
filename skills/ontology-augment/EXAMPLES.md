# Ontology Augment — Examples

Worked examples. The PULL outputs below are **real**, captured live against
`visionclaw-server:4000` (5,975-class index) on 2026-06-14.

---

## Natural-language triggers (autonomous matching)

These phrasings match the skill / `ontology_ask` without an explicit tool call:

- "Ground this in our ontology: …"
- "What does our knowledge graph say about …?"
- "Is there a class for … already?"
- "What's related to … in the KG?"
- "Check the ontology before I assert this."

## PULL — `ontology_ask` (deep retrieval)

### Domain concept — sonnet, expand

```jsonc
ontology_ask({ query: "knowledge graph entities and relations", model_tier: "sonnet", mode: "expand" })
```
```
seeds=8  tokens=1986  truncated=true  degraded=false  5111ms
breadcrumb: [ONTOLOGY] seed: vc:datalog-knowledge-graph-query-language → expand via ontology_ask
turtle:
  <urn:ngm:class:datalog-knowledge-graph-query-language> a owl:Class .
  <urn:ngm:class:gpu-knowledge-graph-platform>          a owl:Class .
  <urn:ngm:class:knowledge-graph-kanban-board>          a owl:Class .
```
`truncated:true` ⇒ the clamp trimmed the subgraph to the sonnet token cap.

### Smart-contract concept — semantic match (not keyword)

```jsonc
ontology_ask({ query: "escrow oracle payment settlement", model_tier: "sonnet", mode: "expand" })
```
```
seeds=8  tokens=146  degraded=false
breadcrumb: [ONTOLOGY] seed: vc:random-oracle-model → expand via ontology_ask
turtle:
  <urn:ngm:class:random-oracle-model>          a owl:Class .
  <urn:ngm:class:price-oracle>                 a owl:Class .
  <urn:ngm:class:cbdc-cross-border-settlement> a owl:Class .
```
"escrow/oracle/payment" surfaced `price-oracle` and `cbdc-cross-border-settlement` —
semantic retrieval finds the contract domain even without literal term matches.

### Cheaper tier — haiku (smaller budget)

```jsonc
ontology_ask({ query: "agent governance and elevation backlog", model_tier: "haiku" })
```
```
seeds=8  tokens=175
breadcrumb: [ONTOLOGY] seed: vc:ai-governance-law-and-privacy → expand via ontology_ask
turtle:
  <urn:ngm:class:ai-governance-law-and-privacy>             a owl:Class .
  <urn:ngm:class:multi-layer-agentic-governance-framework>  a owl:Class .
```
Same query at haiku returns a tighter subgraph than sonnet — tier drives the budget.

## PUSH — per-turn breadcrumb (floor-gated, automatic)

```
"How does the ontology model knowledge graph classes…"  → [ONTOLOGY] seed: vc:ontology-structure (emerging, spatial-computing)
"remind me where we are up to please"                    → (gated — below relevance floor) ✅ noise suppressed
"design an escrow contract with an oracle…"              → [ONTOLOGY] seed: vc:optimistic-oracle (established, blockchain)
```
The off-topic prompt is correctly silenced; on-topic prompts get a one-line seed with
`(maturity, domain)`. No invocation — this is ambient.

## CLI (shell-native, same brain)

```bash
node scripts/ontology-ask.cjs "price oracle"                 # menu + breadcrumb
node scripts/ontology-ask.cjs "knowledge graph" --tier sonnet --full
node scripts/ontology-ask.cjs "escrow" --sparql              # print the read-only SPARQL only
node scripts/ontology-ask.cjs "metaverse avatar" --domain mv --json
```

## Read-only SPARQL — `graph_query`

```sparql
PREFIX vc: <https://narrativegoldmine.com/ns/v1#>
SELECT ?c ?label WHERE {
  ?c a owl:Class ; rdfs:label ?label .
  FILTER(CONTAINS(LCASE(?label), "oracle"))
} LIMIT 50
```
`UPDATE`/`INSERT`/`DELETE` → rejected (`sparql_readonly`). Naive `SELECT` is clamped to
10,000 rows; `SERVICE` is blocked.

## Governed writeback — `ontology_propose`

```jsonc
ontology_propose({ operation: "create",
                   class: "single-use-seal-contract",
                   parent: "smart-contract",
                   rationale: "ADR-124 web-contracts BIP-341 seal pattern",
                   provenance: "asserted" })
// → queued to the broker inbox for sign-off (NOT applied directly)
```
- Unauthenticated → **403**.
- Derived summaries go to `/api/ontology/derived` targeting `:summary` only; targeting
  `:assert`/`:inferred` → **400 "fenced graph"**.

## Anti-patterns

- ❌ Dumping `full:true` Turtle into a haiku agent's context — it downgrades anyway; let the
  budget work.
- ❌ Treating a `degraded:true` empty result as "no such class" — it means the backend was
  unreachable. Retry or proceed ungrounded.
- ❌ Writing facts by raw SPARQL — there is no write SPARQL; use `ontology_propose`.

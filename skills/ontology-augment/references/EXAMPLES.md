# Ontology Augment — Examples

Worked examples. Outputs marked **live** were captured against the Loom on
`192.168.2.132:8084` on 2026-09-22. Outputs marked **shape** show the contract
(C2) the `vault` binary returns; they are what to expect, not a transcript.

Throughout: `S=/opt/agentbox/skills/ontology-augment/scripts/ontology-augment.sh`.

---

## Natural-language triggers

These phrasings should send you here without an explicit invocation:

- "Ground this in our ontology: …"
- "What does our knowledge graph say about …?"
- "Is there a class for … already?"
- "What's related to … in the corpus?"
- "Check the ontology before I assert this."

## `ask` — seeds, then bounded expansion

```bash
$S ask "escrow oracle dispute resolution" --documents 8 --depth 2
```

Two `vault` calls under the hood; the wrapper prints them to stderr so you can
see what was actually asked:

```
STUB-ARGV: find --query escrow oracle dispute resolution --limit 5 --json
STUB-ARGV: retrieve "Price Oracle" "Escrow Contract" --expand is-a=2,requires=2,enables=2,part-of=2 --max-documents 8 --json
```

**shape**

```jsonc
{
  "seeds": [
    { "id": "Price Oracle", "type": "Class",
      "resource": "urn:ngm:class:price-oracle", "status": "stable" }
  ],
  "expanded": [
    { "id": "Smart Contract", "via": "is-a",     "depth": 1 },
    { "id": "Settlement",     "via": "requires", "depth": 1 }
  ],
  "truncated": false
}
```

`truncated: true` means the `--max-documents` cap bit. It means *there is more*,
never *that is all there is*.

With no seed match you get an explicit empty, not an error:

```jsonc
{ "seeds": [], "expanded": [], "degraded": false, "note": "no seed matched" }
```

`degraded: false` is the important field there: nothing was wrong, the corpus
genuinely has no page for that phrase. Compare with the degraded shape below.

## `search` / `get` / `classes`

```bash
$S search "gaussian splatting" --limit 5
$S get "Knowledge Graph"
$S classes --limit 20
```

**shape** (`search`)

```jsonc
{ "results": [
    { "id": "3D Gaussian Splatting", "title": "3D Gaussian Splatting", "type": "Class", "score": 0.91 },
    { "id": "Differentiable Rendering", "title": "Differentiable Rendering", "type": "Class", "score": 0.78 }
] }
```

`id` is the page identity — a vault-relative path without `.md`, spaces and all.
Feed it straight back into `get`, `tree` or `propose`, quoted.

## `sparql` — the reasoned closure (live)

```bash
$S sparql 'SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } LIMIT 2'
```

```json
{"boolean":null,"columns":["c"],"rows":[["http://www.w3.org/2004/02/skos/core#Concept"],["https://narrativegoldmine.com/class/smart-contract"]],"truncated":false}
```

An `ASK` fills `boolean` and leaves `rows` empty:

```bash
$S sparql 'ASK { ?s ?p ?o }'
# {"boolean":true,"columns":[],"rows":[],"truncated":false}
```

A long query belongs in a file:

```bash
$S sparql @/tmp/closure-check.rq
```

Note what this queried: the **built generation**, not the working tree. A page
edited five minutes ago is not in here.

## `health` — availability and age (live)

```bash
$S health | jq '{ok, classes: .index_classes, generation: .generation.id, promoted: .generation.promoted_at, triples: .graph.triples}'
```

```json
{
  "ok": true,
  "classes": 8146,
  "generation": "2026-08-22T08:19:43.776950+00:00",
  "promoted": "2026-09-01T09:56:41.244829+00:00",
  "triples": 282492
}
```

Read that carefully: **healthy and a month stale**. `ok: true` answers "can I
reach the reasoner", not "is the reasoner current". If a claim depends on recent
corpus work, check the generation date before quoting a SPARQL result, and say so.

## `neighbours` — reasoned, else asserted (live degradation)

```bash
$S neighbours knowledge-graph --limit 3
```

```
ontology-augment: http://192.168.2.132:8084/mcp returned HTTP 404 — degrading (fail-open)
ontology-augment: falling back to `vault tree` (asserted edges only, no inferred closure)
```
```jsonc
{ "id": "Knowledge Graph", "children": [ { "id": "Ontology", "children": [] } ] }
```

Both lines are on **stderr** and the JSON on **stdout**, so a pipeline still
works while a human still sees what happened. The fallback answer is real — it is
just a different question: asserted wikilinks, not the inferred closure.

When ADR-140's plane deploys, the same command returns `loom.neighbours` output
and neither stderr line appears. No flag to flip.

## `paths` — an honest refusal (live)

```bash
$S paths knowledge-graph ontology
```

```
ontology-augment: shortest paths need the reasoned graph (Loom /mcp, HTTP 404); no corpus equivalent
```
```jsonc
{ "degraded": true, "reason": "paths_need_reasoned_graph", "loom_status": "404",
  "hint": "run `neighbours` on each end, or wait for the ADR-140 /mcp plane" }
```

There is deliberately no fallback. Walking asserted wikilinks from one end and
calling the result "the shortest path" would be a different answer wearing this
one's name, and nobody downstream would know.

## `validate` — OKF conformance, locally

```bash
$S validate --vault knowledge
$S validate --vault all --strict     # exit 1 on any warning too
```

**shape**

```jsonc
{ "ok": true, "vault": "knowledge", "errors": [], "warnings": [], "pages_checked": 8433 }
```

Exit code is the contract: 0 clean, 1 dirty. No network, no Loom, no generation —
this reads the disk, so it is the right check *before* a commit, where the Loom's
answer would still describe the previous build.

## `propose` — governed writeback

```bash
$S propose urn:ngm:class:single-use-seal-contract \
   --level schema \
   --hypothesis "ADR-124 web-contracts BIP-341 seal pattern needs its own class under Smart Contract" \
   --dry-run
```

**shape** (contract C4)

```jsonc
{ "level": "schema", "iri": "urn:ngm:class:single-use-seal-contract",
  "page": "Single Use Seal Contract", "hypothesis": "ADR-124 …",
  "diff": "--- a/knowledge/pages/…\n+++ b/…\n+is-a: [\"[[Smart Contract]]\"]\n",
  "digest": "sha256:…", "blockers": [], "proposer": "process:vault/1.0",
  "generation": "visionGraph@a1b2c3d", "stale_after": "2026-10-06T00:00:00Z" }
```

Drop `--dry-run` and a forum 31402 is posted for a human signature. The page is
**not** written; a 31403 `Approve` is what writes it.

A blocked proposal:

```jsonc
{ "blockers": [ { "kind": "SUBCLASS_CYCLE", "detail": "Single Use Seal Contract → Smart Contract → Single Use Seal Contract" } ] }
```

Nothing was posted. Do not re-run with different wording — a cycle is a fact
about the model, and the hypothesis is not the thing that is wrong.

## Anti-patterns

- ❌ Reading `degraded: true` as "no such class". It means nobody answered.
  `{"seeds":[],"degraded":false}` is the one that means the corpus has nothing.
- ❌ Quoting a SPARQL result as current without checking `generation.generated_at`.
  `ok: true` and "up to date" are different claims.
- ❌ Passing a page id to `xargs` or leaving it unquoted. Ids contain spaces.
- ❌ Using `vault edit` to apply a proposal by hand. Approval writes it, with an
  `--expect` blast radius; a hand edit has neither signature nor ledger entry.
- ❌ Looking for `mcp__ontology-bridge__*`. It is deleted — see ADR-2107/2108.

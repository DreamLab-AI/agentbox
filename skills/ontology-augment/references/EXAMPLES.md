# Ontology Augment — Examples

Worked examples. Outputs marked **live** were captured against the Loom on
`192.168.2.132:8084` on 2026-09-22. Outputs marked **shape** show the contract
(C2) the `vault` binary returns; they are what to expect, not a transcript.

Throughout: `S=/opt/agentbox/skills/ontology-augment/scripts/ontology-augment.sh`.

Since ADR-2129 every wrapper call prints an envelope (`grounding`, `source`,
`generation`, `note`) with the body below under `result`; the bodies shown here
are what sits in `.result`. See REFERENCE.md, *Output envelope*.

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

With no seed match you get an explicit empty, not an error (captured
2026-10-05 against the local corpus):

```jsonc
{ "grounding": "silent", "degraded": false, "source": "vault",
  "generation": { "id": "visionGraph@ae913f93a23e7cd604f4c5ec94d0d48dfee8aec8",
                  "from": ".../visionGraph/site-data/.generation.json",
                  "working_tree_commit": "ec5af2d9…", "version_iri": null, … },
  "note": "healthy call, nothing asserted or inferred matched: the corpus does not say at this generation. This is not negative evidence; propose, never assert (ADR-2129).",
  "result": { "seeds": [], "expanded": [], "query": "…", "reason": "no seed matched" } }
```

`silent` is the important field there: nothing was wrong, and the corpus has no
page for that phrase. That is *unknown*, not *no*. Compare with the degraded
shape below, where nobody answered at all.

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
$S health | jq '.result | {ok, classes: .index_classes, generation: .generation.id, promoted: .generation.promoted_at, triples: .graph.triples}'
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

## `neighbours` and `paths` — the reasoned graph (live, 2026-10-13)

```bash
$S neighbours "Knowledge Graph"      # a title: resolved by exact match via loom.browse
$S neighbours knowledge-graph        # a slug passes straight through
```

```jsonc
{ "grounding": "answered", "source": "loom",
  "generation": { "id": "visionGraph@45976a8c7ca4305dd38bf66c7c6128732f6de4d7" },
  "result": { "result": { "structuredContent": { "result": {
      "iri": "urn:ngm:class:knowledge-graph", "title": "Knowledge Graph",
      "is_a": ["urn:ngm:class:sc-content-and-assets"],
      "relations": [ { "predicate": "has-part", … }, { "predicate": "requires", … },
                     { "predicate": "enables", … }, { "predicate": "depends-on", … },
                     { "predicate": "part-of", … } ] } } } } }
```

```bash
$S paths "Knowledge Graph" "Ontology"
```

```jsonc
{ "grounding": "answered", "source": "loom",
  "result": { "result": { "structuredContent": { "result": {
      "found": true, "hops": 1,
      "path": ["urn:ngm:class:knowledge-graph", "urn:ngm:class:ontology"] } } } } }
```

A class the corpus does not have is `silent`, never a "no":

```bash
$S neighbours no-such-class-zzz       # → { "grounding": "silent", "source": "loom", "result": …{ "found": false } }
```

**When the Loom does not answer** (unreachable, non-200, or a JSON-RPC error on
HTTP 200) `neighbours` degrades to the corpus and says so on **stderr**, with the
JSON still on stdout:

```
ontology-augment: Loom did not answer (000); falling back to `vault tree` (asserted edges only, no inferred closure)
```
```jsonc
{ "grounding": "answered", "source": "vault",
  "fallback": { "from": "loom.neighbours", "loom_status": "000",
                "scope": "asserted edges only, no inferred closure" },
  "result": { "id": "Knowledge Graph", "children": [ { "id": "Ontology", "children": [] } ] } }
```

The fallback answer is real; it is just a different question: asserted wikilinks,
not the inferred closure. `paths` has no such fallback and reports `degraded`.

## `paths` — an honest refusal (when the Loom does not answer)

With the Loom's `/mcp` answering, `paths` returns the live result shown above. If the
Loom is unreachable, answers a non-200, or returns a JSON-RPC error on HTTP 200,
`paths` refuses rather than guess:

```bash
$S paths knowledge-graph ontology
```

```
ontology-augment: shortest paths need the reasoned graph (Loom /mcp: 000); no corpus equivalent
```
```jsonc
{ "degraded": true, "reason": "paths_need_reasoned_graph", "loom_status": "000",
  "hint": "the Loom /mcp did not answer; run `neighbours` on each end for the asserted neighbourhoods, then retry" }
```

`loom_status` is the HTTP status, `000` for unreachable, or `rpc_error` for a JSON-RPC
error carried on HTTP 200.

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

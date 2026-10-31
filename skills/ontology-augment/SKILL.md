---
name: ontology-augment
description: "Ground agent reasoning in dreamlab's sovereign corpus (visionGraph: ~8.4k OKF-typed pages, Whelk-reasoned by the Ontology Loom) through the `ontomark` CLI and the Loom's HTTP surface. Use when you want to ground or augment thinking in the ontology, check what the corpus says about a concept, retrieve a budget-bounded subgraph, run read-only SPARQL over the reasoned closure, find class neighbours or shortest paths, validate OKF conformance, or propose a governed enrichment. Read-pervasive, write-governed; budget-bounded and fail-open so it never bloats the context window or blocks a turn. Bash only — there is no MCP server for the corpus."
---

# Ontology Augment

The **consumption** side of the corpus: pull structured knowledge into reasoning,
on demand and within a strict budget. Sibling of
[`ontology-core`](../ontology-core/SKILL.md) (authoring) and
[`ontology-enrich`](../ontology-enrich/SKILL.md) (validation) — those *produce*
the corpus; this one *consumes* it at inference time.

## There is no MCP server here (read this first)

If you are looking for `mcp__ontology-bridge__ontology_ask`, it is gone. ADR-2107
retired every MCP server fronting the corpus; ADR-2108 deleted the
`ontology-bridge` implementation. Nothing replaced it with another MCP server.

Two doors, both reachable from Bash:

| Door | Authoritative for | How you call it |
|---|---|---|
| **`ontomark`** | what a page **says** — frontmatter, types, relations, OKF lifecycle, link integrity | a binary on `PATH` (`/opt/agentbox/bin/ontomark`) |
| **the Loom** | what the **reasoner concluded** — the Whelk closure, SPARQL, typed neighbours, shortest paths | HTTP on `http://192.168.2.132:8084` (LAN) |

That split is not an implementation detail you can ignore. `ontomark` reads the
corpus on disk and knows nothing of inference; the Loom serves a *built
generation* and may be hours behind the disk. When the two disagree, say which
one you asked. A third, narrow door: `check` asks VisionClaw
(`$VISIONCLAW_API_URL/api/ontology-agent/check`) for a tri-valued membership
verdict, the only answer that can be `contradicted`.

## When To Use

- **Yes** — grounding a claim or design in the corpus, "what does our knowledge
  graph say about X", finding related classes, navigating `is-a`/`requires`
  structure, checking a page's `status` before asserting something, or proposing
  a new fact back into the corpus.
- **No** — authoring or exporting corpus pages (use `ontology-core`), validating
  or enriching source markdown (use `ontology-enrich`), or generic RDF unrelated
  to this corpus (use plain SPARQL tools).

## Prerequisites

`ontomark` is baked into the image by Nix (`lib/ontomark.nix`, ADR-2136); check
it with `ontomark --version`. If it is absent the wrapper stops with a message
naming `ONTOMARK_BIN`, and the image needs a rebuild. `vault` is baked too
(`[vault].cli`, ADR-2108) but carries only the governance transport: `vault
propose` and `vault panel publish` (`vault --version` to check it).

```
VAULT_ROOT=/home/devuser/workspace/visionGraph/knowledge   # [vault].root, ADR-2028
VAULT_PAGES=$VAULT_ROOT            # pages sit at the vault root
VAULT_WORKING_ROOT=/home/devuser/workspace/visionGraph/working
LOOM_BASE_URL=http://192.168.2.132:8084                    # the façade, LAN
ONTOLOGY_TIMEOUT_SECS=10                                   # per-Loom-call timeout
```

No token, no bearer, no pubkey: reads are local file access plus a LAN HTTP call.

**Fail-open.** If the Loom is unreachable, every call that needs it returns a
marked-degraded empty result and exits 0. Grounding is an augmentation, never a
dependency — a turn must continue ungrounded rather than die.

## Reading a result: three empties and a generation (ADR-2129)

Every wrapper call prints one envelope: `grounding`, `source`, `generation`,
`note`, and the untouched body under `result`.

| `grounding` | Means | You may |
|---|---|---|
| `answered` | facts came back | cite them with `generation.id` |
| `silent` | a **healthy** call found nothing: the corpus does not say | treat as *unknown*, never as "no"; propose, never assert |
| `degraded` | nobody answered (Loom down, wrong route) | proceed ungrounded; it is evidence of nothing |
| `contradicted` | `check` got `entailed_false` from VisionClaw (ADR-2127) | act on it as a real negative |

`generation` is filled automatically: Loom calls carry `x-loom-generation` and
`x-loom-content-digest`; `ontomark` calls carry the local build's
`.generation.json` id plus the working-tree commit; `version_iri` is the
`owl:versionIRI` whenever the response or build carries one. Quote it with any
claim that matters. A SPARQL query using `FILTER NOT EXISTS` or `MINUS` gets a
`negation` block reading **"not asserted at this generation"**: its rows lack a
statement, they are not proven false. Only a positive count is `answered`; a
healthy body whose shape the wrapper cannot count is `silent` with
`shape: "unrecognised"` (read `.result` yourself).

## Labels and `--ref`: cite by short name

Every envelope carries a `call_id` (`c-1a2b3c4d`) and a `refs` list: the citable
entries of that result, each with a short label by kind, unique within the call.

| Label | Kind | From |
|---|---|---|
| `E1`, `E2` … | page / entity | `ask`, `search`, `get`, `classes` |
| `N1`, `N2` … | neighbour (with `via`: `is-a`, `ancestor`, or the predicate) | `neighbours` |
| `P1`, `P2` … | step on a path, in order | `paths` |
| `S1`, `S2` … | IRI in a SPARQL row | `sparql` |

```bash
$S search "escrow oracle"              # refs: [{label:"E1", id:"Escrow Oracle", …}], call_id c-1a2b3c4d
$S neighbours --ref c-1a2b3c4d:E1      # no re-quoting a title with spaces or a long IRI
$S paths --ref c-1a2b3c4d:E1 "Ontology"
```

`--ref` stands in for a positional id on `get`, `neighbours`, `paths`, `check`
and `propose`; it may appear twice (`paths`) and mixes with literal ids. A
malformed, unknown or expired ref is a usage error (exit 2) that names what does
exist. Labels are a convenience over the same ids: `result` is untouched, `refs`
is capped at 25 (`refs_truncated`), and if the per-call cache under
`${XDG_RUNTIME_DIR:-/tmp}` is unusable the labels are still printed with
`ref_cache: "unavailable"` and only `--ref` fails. The cache holds one file per
call, so concurrent sessions never share state. Details: REFERENCE.md.

## Stop rules (read before the second call)

Grounding is meant to settle a question quickly, not to explore the graph.

1. **Converge in 1-2 targeted rounds.** One `ask` or `search` to find the
   concept, at most one follow-up (`get`, `neighbours`, or one `sparql`) to
   check the specific thing you are about to claim. A third round means the
   question was not specific enough: sharpen it or stop.
2. **At most 2 graph hops** from any seed (`--depth` / `--max-hops` no higher
   than 2, and no chaining `neighbours` of `neighbours` of `neighbours`). A
   relation that only appears at hop 3 is a hypothesis, not a finding.
3. **Every asserted link needs source evidence.** To say "A requires B" or "A is
   a kind of B", you must hold the entry that says so (a `neighbours` `via`, a
   `get` page, a SPARQL row) and cite it with its `generation.id`
   (and `version_iri` when present), plus the label (`c-1a2b3c4d:N3`). A link you
   inferred yourself from names or proximity is not asserted; say it is your
   inference.
4. **Silence is unknown.** If a healthy call comes back `silent`, or `degraded`,
   or the cited generation is not the one you need, stop and write "unknown":
   the corpus does not say at that generation. Never turn `silent` into "no"
   (ADR-2129), never fill the gap with a plausible link, and do not widen the
   search to find something that fits. Propose instead (`propose`).
5. **Stop on `degraded`.** Carry on ungrounded and say so; do not retry in a loop.

## Quick Start

Everything routes through one wrapper:

```bash
S=/opt/agentbox/skills/ontology-augment/scripts/ontology-augment.sh

$S ask "escrow oracle dispute resolution"      # seeds + bounded expansion
$S search "gaussian splatting" --limit 5       # name/semantic lookup
$S get "Knowledge Graph"                       # one page, whole frontmatter
$S sparql 'SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } LIMIT 20'
$S neighbours knowledge-graph                  # reasoned, else asserted
$S check urn:x:alice urn:x:Person              # entailed | entailed_false | not_asserted
$S validate --vault knowledge                  # OKF conformance, exit 0/1
$S health                                      # is grounding available, how old
```

Or drive `ontomark` directly — the wrapper has no privileges it does not:

```bash
ontomark find --query "knowledge graph" --limit 5 --json
ontomark retrieve "Knowledge Graph" --expand is-a=2,requires=1 --max-documents 12 --json
ontomark tree "Knowledge Graph" --depth 2 --json
ontomark validate --vault all --json
```

## Tool surface — what each retired MCP tool became

| Retired MCP tool | Now |
|---|---|
| `ontology_ask` | `ontomark retrieve <id>… --expand … --max-documents N --json` (the wrapper's `ask` does seed-then-expand) |
| `ontology_search` | `ontomark find --query <q> [--fuzzy] --json` |
| `ontology_class_get` | `ontomark retrieve <id> --json` |
| `ontology_class_list` | `ontomark find --type Class --json` |
| `ontology_graph_query` | `POST http://192.168.2.132:8084/loom/sparql` — the reasoned closure, not the disk |
| `kg_node_search` | `ontomark find` (same door as `ontology_search`; the split was an artefact of two backends) |
| `kg_neighbors` | Loom `/mcp` → `loom.neighbours`; `ontomark tree` only if the Loom did not answer |
| `kg_pathfind` | Loom `/mcp` → `loom.paths`; **no corpus fallback**, by design — see below |
| `ontology_validate` | `ontomark validate` — OKF v0.2 + `vocabulary.yaml` + link integrity |
| `ontology_propose` | `vault propose <iri> --level content\|schema` |
| `ontology_axiom_add` | **gone.** Axioms are not hand-added; they fall out of `ontomark build` from the frontmatter |
| `ontology_health` | `GET http://192.168.2.132:8084/health` |

### `neighbours` and `paths` ride the Loom's `/mcp`

`loom.neighbours` and `loom.paths` have no REST route of their own, so the
wrapper POSTs JSON-RPC 2.0 to `http://192.168.2.132:8084/mcp` (loom ADR-140 P0,
live; probed 2026-10-13). That is not "MCP inside the estate": no client, no
server registration, no tool grant — just a JSON body on a LAN URL.

- **Titles work, exactly.** A page title is resolved to its Loom IRI by an exact,
  case-insensitive title match in `loom.browse`; it is never slugified. A slug or
  `urn:ngm:class:<slug>` passes through. No exact match is sent verbatim.
- **`found: false` is `silent`**, not a negative: the corpus does not say.
- **If the Loom does not answer** (unreachable, non-200, or a JSON-RPC protocol
  error), `neighbours` falls back to `ontomark tree` (asserted edges only, announced
  on stderr, `fallback.loom_status` names why), and `paths` stays `degraded`
  rather than passing a walk over asserted wikilinks off as a shortest path in
  the reasoned graph. Those are different answers and only one was asked for.

## Budget and fail-open (ADR-112)

The budget is in the **arguments**:

- `--max-documents N` is a hard cap on what comes back. Default 12.
- `--expand <edge>=<depth>` bounds expansion per edge type, so a dense hub cannot
  starve the thing you actually asked about.
- Every Loom call carries a timeout and degrades to a marked-empty result.

An agent should be able to call `ask` reflexively without first thinking about
the context window. If it cannot, the default budget is wrong — change the
default, not the habit.

## Writes are still governed

`vault propose` builds a `PatchProposal`, runs Whelk and the conflict detector as
**blockers**, and posts a forum 31402 for a human signature. It does not write
the page. A non-empty `blockers` array means nothing was posted at all.

Direct page mutation exists (`ontomark edit`) but refuses to run without
`--expect docs=N,blocks=M` — a declared blast radius. That guard is the point: an
edit touching more than you predicted is a bug, and it should stop.

## Reference & Examples

- Full flags, the two-authority model, the output envelope and generation
  resolution, degradation semantics, the exact `/mcp` request bodies, governance: **[references/REFERENCE.md](references/REFERENCE.md)**
- Worked examples with real captured output: **[references/EXAMPLES.md](references/EXAMPLES.md)**

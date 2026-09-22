---
name: ontology-augment
description: "Ground agent reasoning in DreamLab's sovereign corpus (visionGraph: ~8.4k OKF-typed pages, Whelk-reasoned by the Ontology Loom) through the `vault` CLI and the Loom's HTTP surface. Use when you want to ground or augment thinking in the ontology, check what the corpus says about a concept, retrieve a budget-bounded subgraph, run read-only SPARQL over the reasoned closure, find class neighbours or shortest paths, validate OKF conformance, or propose a governed enrichment. Read-pervasive, write-governed; budget-bounded and fail-open so it never bloats the context window or blocks a turn. Bash only — there is no MCP server for the corpus."
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
| **`vault`** | what a page **says** — frontmatter, types, relations, OKF lifecycle, link integrity | a binary on `PATH` (`/opt/agentbox/bin/vault`) |
| **the Loom** | what the **reasoner concluded** — the Whelk closure, SPARQL, typed neighbours, shortest paths | HTTP on `http://192.168.2.132:8084` (LAN) |

That split is not an implementation detail you can ignore. `vault` reads the
corpus on disk and knows nothing of inference; the Loom serves a *built
generation* and may be hours behind the disk. When the two disagree, say which
one you asked.

## When To Use

- **Yes** — grounding a claim or design in the corpus, "what does our knowledge
  graph say about X", finding related classes, navigating `is-a`/`requires`
  structure, checking a page's `status` before asserting something, or proposing
  a new fact back into the corpus.
- **No** — authoring or exporting corpus pages (use `ontology-core`), validating
  or enriching source markdown (use `ontology-enrich`), or generic RDF unrelated
  to this corpus (use plain SPARQL tools).

## Prerequisites

`vault` is baked into the image by Nix and gated on `[vault].cli` in
`agentbox.toml` (ADR-2108). The boot prints its version in Phase 5d; if it
printed `vault MISSING`, the image predates the key and needs a rebuild.

```
VAULT_ROOT=/home/devuser/workspace/visionGraph/knowledge   # [vault].root, ADR-2028
VAULT_PAGES=$VAULT_ROOT/pages
VAULT_WORKING_ROOT=/home/devuser/workspace/visionGraph/working
LOOM_BASE_URL=http://192.168.2.132:8084                    # the façade, LAN
ONTOLOGY_TIMEOUT_SECS=10                                   # per-Loom-call timeout
```

No token, no bearer, no pubkey: reads are local file access plus a LAN HTTP call.
The VisionClaw round-trip the old bridge made is gone entirely.

**Fail-open.** If the Loom is unreachable, every call that needs it returns a
marked-degraded empty result and exits 0. Grounding is an augmentation, never a
dependency — a turn must continue ungrounded rather than die.

## Quick Start

Everything routes through one wrapper:

```bash
S=/opt/agentbox/skills/ontology-augment/scripts/ontology-augment.sh

$S ask "escrow oracle dispute resolution"      # seeds + bounded expansion
$S search "gaussian splatting" --limit 5       # name/semantic lookup
$S get "Knowledge Graph"                       # one page, whole frontmatter
$S sparql 'SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } LIMIT 20'
$S neighbours knowledge-graph                  # reasoned, else asserted
$S validate --vault knowledge                  # OKF conformance, exit 0/1
$S health                                      # is grounding available, how old
```

Or drive `vault` directly — the wrapper has no privileges it does not:

```bash
vault find --query "knowledge graph" --limit 5 --json
vault retrieve "Knowledge Graph" --expand is-a=2,requires=1 --max-documents 12 --json
vault tree "Knowledge Graph" --depth 2 --json
vault validate --vault all --json
```

## Tool surface — what each retired MCP tool became

| Retired MCP tool | Now |
|---|---|
| `ontology_ask` | `vault retrieve <id>… --expand … --max-documents N --json` (the wrapper's `ask` does seed-then-expand) |
| `ontology_search` | `vault find --query <q> [--fuzzy] --json` |
| `ontology_class_get` | `vault retrieve <id> --json` |
| `ontology_class_list` | `vault find --type Class --json` |
| `ontology_graph_query` | `POST http://192.168.2.132:8084/loom/sparql` — the reasoned closure, not the disk |
| `kg_node_search` | `vault find` (same door as `ontology_search`; the split was an artefact of two backends) |
| `kg_neighbors` | Loom `/mcp` → `loom.neighbours`; falls back to `vault tree` |
| `kg_pathfind` | Loom `/mcp` → `loom.paths`; **no corpus fallback** — see below |
| `ontology_validate` | `vault validate` — OKF v0.2 + `vocabulary.yaml` + link integrity |
| `ontology_propose` | `vault propose <iri> --level content\|schema` |
| `ontology_axiom_add` | **gone.** Axioms are not hand-added; they fall out of `vault build` from the frontmatter |
| `ontology_health` | `GET http://192.168.2.132:8084/health` |

### The `/mcp` caveat, measured

The Loom keeps `/mcp` as the **external-host** door (PRD Q10) — a JSON-RPC 2.0
endpoint an outside MCP client can attach to. `loom.neighbours` and `loom.paths`
have no REST route of their own, so calling them means POSTing JSON-RPC to it
with curl. That is not "MCP inside the estate": no client, no server
registration, no tool grant — just a JSON body on a LAN URL.

**As of 2026-09-22 the generation deployed on `:8084` answers `/mcp` with 404.**
The plane is ADR-140 work that has not shipped. The wrapper checks the status and
degrades: `neighbours` falls back to `vault tree` (asserted edges only, announced
on stderr), and `paths` refuses outright rather than passing a walk over asserted
wikilinks off as a shortest path in the reasoned graph. Those are different
answers and only one of them was asked for.

## Budget and fail-open (ADR-112, unchanged)

The philosophy survives the transport change intact; only where it lives moved.
The budget is now in the **arguments**, not in a server's tier table:

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

Direct page mutation exists (`vault edit`) but refuses to run without
`--expect docs=N,blocks=M` — a declared blast radius. That guard is the point: an
edit touching more than you predicted is a bug, and it should stop.

## Reference & Examples

- Full flags, the two-authority model, degradation semantics, the exact `/mcp`
  request bodies, governance: **[references/REFERENCE.md](references/REFERENCE.md)**
- Worked examples with real captured output: **[references/EXAMPLES.md](references/EXAMPLES.md)**

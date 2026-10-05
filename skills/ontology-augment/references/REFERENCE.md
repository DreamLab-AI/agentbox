# Ontology Augment — Reference

Full spec for the consumption side of the sovereign corpus
(PRD-sovereign-corpus Q10/Q11; ADR-2107 / ADR-2108; ADR-112 for the budget and
fail-open philosophy, which survives unchanged).

Architecture, in one sentence: **there is no service in the middle any more.**
The old binding ran every read through an in-process retrieval library inside an
MCP server that proxied VisionClaw's Oxigraph. Now an agent runs a binary against
files, or POSTs to the Loom. Two processes fewer, one fewer place for the corpus
to disagree with itself.

---

## The two authorities

| | `vault` | the Loom |
|---|---|---|
| Reads | `visionGraph/{knowledge,working}/pages/**.md` on disk | a built generation (`vault build` output) |
| Knows | frontmatter: `type`, `resource`, `status`, relation keys, OKF trust fields | the Whelk EL++ closure: inferred ancestors, backlinks, derived edges |
| Freshness | the working tree, this instant | whatever generation is promoted — possibly hours old |
| Fails by | exiting non-zero with a report | degrading to a marked-empty result |
| Network | none | LAN HTTP |

A question about *what an author wrote* goes to `vault`. A question about *what
follows from what authors wrote* goes to the Loom. Asking the wrong one gets a
confidently wrong answer, which is worse than an error.

Check which generation the Loom is serving before quoting it:

```bash
curl -s http://192.168.2.132:8084/health | jq '{id: .generation.id, classes: .index_classes, promoted: .generation.promoted_at}'
```

---

## `vault` subcommands this skill uses (contract C2)

```
vault find      --query <q> [--type T] [--limit N] [--fuzzy]   → [{id,title,type,score}]
vault retrieve  <id>… [--expand is-a=2,requires=1,…] [--max-documents N]
                                                               → {seeds:[…], expanded:[…]}
vault tree      <id> [--depth N]                               → nested {id, children}
vault validate  [--vault knowledge|working|all] [--strict]     → exit 0/1, report
vault propose   <iri> --level content|schema [--hypothesis "…"] [--dry-run]
vault edit      <id> --set k=v… --expect docs=N,blocks=M       → refused without --expect
```

Every subcommand takes `--json`. **Identity of a page is its vault-relative path
without `.md`**: `knowledge/pages/Knowledge Graph.md` ⇒ id `Knowledge Graph`.
Ids contain spaces; quote them, and never pipe them to `xargs` unquoted.

### `--expand` is the budget

`--expand is-a=2,requires=1,enables=1` means: follow `is-a` two hops, `requires`
and `enables` one, everything else zero. Per-edge depth exists because a page
like *Knowledge Graph* has a handful of parents and dozens of `enables` edges —
one global depth either starves the hierarchy or floods on the dense edge.

`--max-documents N` then caps the merged result. When it bites, `truncated: true`
comes back. Treat that as "there is more", not as "that is all there is".

---

## Loom HTTP surface

### `POST /loom/sparql` (alias `/sparql`) — read-only SPARQL

```bash
curl -sS --max-time 10 -H 'content-type: application/json' \
  -X POST --data '{"query":"SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class> } LIMIT 20"}' \
  http://192.168.2.132:8084/loom/sparql
```

```jsonc
{ "boolean": null, "columns": ["c"], "rows": [["https://narrativegoldmine.com/class/smart-contract"]], "truncated": false }
```

`SELECT`/`ASK`/`CONSTRUCT`/`DESCRIBE` only; a `LIMIT` is enforced server-side. An
`ASK` answers in `boolean` and leaves `rows` empty. A malformed query is a 400; a
graph that is unavailable is a **200 with a degraded body**, so check the shape,
not just the status.

Response headers carry the serving identity — `x-loom-generation`,
`x-loom-content-digest`, `x-loom-atomicity-verified`. The wrapper copies the
first two into every result's `generation` block (see *Output envelope*), so
quoting them is not left to judgement.

A query that uses `FILTER NOT EXISTS` or `MINUS` asks what the closure does
**not** contain. Over an open-world corpus that answer is "not asserted at this
generation", never "false": the wrapper adds a `negation` block saying so, and
the rows must be reported that way.

```bash
# classes with no declared `requires` edge — NOT "classes that require nothing"
$S sparql 'SELECT ?c WHERE { ?c a <http://www.w3.org/2002/07/owl#Class>
  FILTER NOT EXISTS { ?c <https://narrativegoldmine.com/ns/v1#requires> ?x } } LIMIT 20'
# → "negation": {"operators":["FILTER NOT EXISTS"],"reading":"not asserted at this generation", …}
```

### `GET /health` — is grounding available, and how old

Returns the full serving identity: `generation.id`, `index_classes`,
`graph.triples`, `graph.loaded_files`, and `disk_matches_loaded`. `ok: true` with
a months-old `generation.generated_at` is a real condition and a real problem —
the Loom is healthy and the answer is stale. Report both.

### `POST /mcp` — JSON-RPC 2.0, the external-host door

The exact bodies, since they are not guessable:

```bash
# tools/list — what this generation exposes
curl -sS --max-time 10 -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -X POST --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://192.168.2.132:8084/mcp

# loom.neighbours — typed neighbours in the reasoned graph
curl -sS --max-time 10 -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -X POST --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loom.neighbours","arguments":{"iri":"knowledge-graph","limit":25}}}' \
  http://192.168.2.132:8084/mcp

# loom.paths — shortest typed paths between two IRIs
curl -sS --max-time 10 -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -X POST --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loom.paths","arguments":{"from":"knowledge-graph","to":"ontology","max_hops":4}}}' \
  http://192.168.2.132:8084/mcp
```

`iri` takes a full `urn:ngm:class:<slug>` or a bare slug. `limit` and `max_hops`
are clamped server-side.

The other tools on that plane — `loom.manifest`, `loom.browse`, `loom.resolve`,
`loom.sparql` — are reachable the same way, but prefer `vault` for browse/resolve:
it reads the working tree, and the Loom reads a promoted generation.

**Measured 2026-09-22: `:8084` answers `/mcp` with `404`.** ADR-140 shipped the
plane in the loom repo; the deployed generation predates it (WS-H owns the
deploy). Until then:

| Want | Today |
|---|---|
| neighbours | `vault tree <id> --depth 1` — asserted edges only, no inferred ancestors or backlinks |
| shortest path | **nothing honest.** Run `neighbours` from each end and say the path is unavailable |

Using `/mcp` over curl is not a breach of "no MCP inside the estate" (ADR-2107).
The rule bans MCP *servers registered in the estate* fronting the corpus — a
process, a registration, a tool grant, a context-window cost on every session.
A curl POST to a LAN URL has none of those.

---

## Output envelope (ADR-2129)

Every subcommand prints exactly one JSON object; the Loom or `vault` body is
kept verbatim under `result`, so a former parser of the raw body reads
`.result` instead of `.`.

```jsonc
{
  "grounding": "silent",              // answered | silent | degraded | contradicted
  "degraded": false,                  // kept for older parsers; true iff grounding == degraded
  "source": "loom",                   // loom | vault | visionclaw — which authority answered
  "generation": {
    "id": "visionGraph@ae913f93…",    // the generation the answer belongs to
    "content_digest": "6afcf4aa…",
    "version_iri": null,              // owl:versionIRI (VisionClaw ADR-2128) when carried
    "from": "x-loom-generation header"
  },
  "negation": { … },                  // only for FILTER NOT EXISTS / MINUS
  "shape": "unrecognised",            // only when a healthy body could not be counted
  "note": "healthy call, nothing asserted or inferred matched: …",
  "fallback": { … },                  // only when neighbours fell back to vault tree
  "result": { "boolean": null, "columns": ["c"], "rows": [], "truncated": false }
}
```

### How the state is decided

Evaluated in order; the first that holds wins.

1. **`degraded`** — the body has `degraded: true` (unreachable, non-200, or the
   Loom's own 200-with-degraded-body), a JSON-RPC `error`, or an MCP
   `result.isError: true`; for `check`, also a 200 with no verdict. `generation.id` is
   null: nobody answered, so there is nothing to cite.
2. **`contradicted`** — some object in the body has a value `entailed_false`
   (`verdict: "entailed_false"` from `check`, VisionClaw ADR-2127). The wrapper
   never infers this; it needs disjointness in the corpus (VisionClaw ADR-2125).
3. **`silent`** — a query call whose count is not positive: SPARQL `rows`
   empty, an `ASK` that answered `false`, `vault find` returning `[]`, `ask` or
   `get` with no seed (`missing` lists unmatched ids), a `vault tree` node with
   no `children` (vault omits the key when empty), MCP `tools/call` content
   whose text items parse to empty JSON, or a `check` verdict `not_asserted`.
   An `ASK` false is silent, not contradicted: no match in the closure is not
   entailed falsity. A healthy body with **no countable shape** (prose MCP text,
   an unknown object) is also `silent`, flagged `shape: "unrecognised"`: the
   count is unknown, so it is never promoted to `answered`.
4. **`answered`** — a query call with a positive count (`check` `entailed`
   counts 1), and the reports `validate`, `propose` and `health`, which are
   never `silent`.

`silent` is the open-world answer: the corpus does not say. It is a reason to
`propose` a fact, never to assert its negation.

### Where the generation comes from

| Call | `generation` |
|---|---|
| Loom (`sparql`, `neighbours`, `paths`) | `x-loom-generation`, `x-loom-content-digest` headers; `version_iri` from an `x-loom-version-iri` header or a `version_iri` / `versionIRI` / `owl:versionIRI` body field |
| `health` | the body's `generation.id` / `content_digest` |
| `check` | VisionClaw's `check.scope.generation` as `id`, and as `version_iri` when it is an IRI (ADR-2128) |
| `vault` (`ask`, `search`, `get`, `classes`, `validate`, `propose`, the `neighbours` fallback) | the newest `.generation.json` among `<repo>/<vault.toml [build].out>`, `<repo>/site-data`, `<repo>/www`; `version_iri` = `https://narrativegoldmine.com/ontology/<ontology_digest>` once the build records one (ADR-2128); plus `working_tree_commit`, because `vault` reads the working tree, not the build |

The vault repo is `VAULT_REPO` (exported at boot), else `[vault].repo` in
`AGENTBOX_CONFIG` (default `/etc/agentbox.toml`), else derived from
`[vault].root`. Every `vault` call is pinned to it with `--repo`, so the wrapper
works from any directory. With no marker found, `generation.id` is null and
`generation.reason` says why; the call still succeeds.

## `check` — VisionClaw tri-valued membership (ADR-2127)

```bash
$S check <subject> <class>                         # POST {subject, class}
$S check <subject> --property <p> --object <o>     # POST {subject, property, object}
```

`POST $VISIONCLAW_API_URL/api/ontology-agent/check`; the reply is
`{success, check: {verdict, basis, witness, scope: {closure, generation}}}`.

| `verdict` | `grounding` |
|---|---|
| `entailed` | `answered` (`basis`: asserted / inferred) |
| `entailed_false` | `contradicted` (`witness`: the disjointness) |
| `not_asserted` | `silent` (open world) |
| unreachable, non-200, no verdict | `degraded`, exit 0 (`reason`: `visionclaw_unreachable`, `visionclaw_http_<code>`, `visionclaw_no_verdict`) |

## Degradation semantics

`scripts/ontology-augment.sh` distinguishes three states, because they have three
different fixes:

| stderr | `reason` | Means | Fix |
|---|---|---|---|
| `Loom unreachable` | `loom_unreachable` | no route, DNS, or timeout | the network, usually the `.48`-is-dead trap |
| `returned HTTP 404` | `loom_http_404` | route absent on this generation | deploy, not config |
| `returned HTTP 400` | `loom_http_400` | your query | the query |

All three exit **0** with `"grounding": "degraded"` and the reason under
`result.reason`. Never read a degraded empty result as "no such class": it means
nobody answered. A **healthy** empty result is `silent`, the other empty, and is
not "no" either.

`vault` failures are the opposite and deliberately so: a corpus that cannot be
read is not a degraded grounding, it is a broken environment, so `vault` exits
non-zero and the wrapper lets that through unwrapped. A `vault` exit code that
comes with a JSON report (`validate` exits 1 on errors) is kept, and the report
is enveloped.

---

## Governed writeback

Reads are pervasive; **writes are governed**. The gates moved from HTTP
middleware into the binary, and got stricter:

1. `vault propose <iri> --level content|schema` builds a `PatchProposal`
   (contract C4): level, IRI, page, hypothesis, unified frontmatter diff,
   digest, proposer, generation, `stale_after` (now + 14 days).
2. Whelk inconsistency, `SUBCLASS_CYCLE`, `RELATION_CONTRADICTION` and vocabulary
   violations are **blockers**, not warnings. A non-empty `blockers` array means
   the 31402 was never posted. These are automatic refusals and cannot be
   approved around — a human signature settles *whether we want this*, never
   *whether it is consistent*.
3. A human 31403 `Approve` is what writes the page: `status: stable`, `verified`
   gains `human:<npub>`, and the Loom ledger records the case id. `Reject` writes
   nothing. Expiry past `stale_after` returns the proposal to draft.
4. Schema-level proposals are floored at tier High (PRD Q7). You do not choose
   the tier; the panel operator does, and Schema has no lower setting.

`vault edit` is the low-level mutation and refuses without
`--expect docs=N,blocks=M`. Governance decisions apply through it with an exact
expectation; nothing else should call it by hand.

---

## Environment

| Var | Purpose | Default |
|---|---|---|
| `VAULT_ROOT` / `VAULT_PAGES` | corpus path authority, resolved from `[vault]` (ADR-2028) | `…/visionGraph/knowledge[/pages]` |
| `VAULT_WORKING_ROOT` | the working vault | `…/visionGraph/working` |
| `VAULT_REPO` | vault repository root; every `vault` call gets `--repo` | `[vault].repo` from `AGENTBOX_CONFIG` |
| `AGENTBOX_CONFIG` | manifest read when `VAULT_REPO` is unset | `/etc/agentbox.toml` |
| `VAULT_GENERATION_FILE` | pin the `.generation.json` cited for `vault` calls | newest under the repo's build outputs |
| `LOOM_BASE_URL` | Loom façade base | `http://192.168.2.132:8084` |
| `VISIONCLAW_API_URL` | VisionClaw REST base for `check` | `[skills.ontology].visionclaw_api_url`, else `http://visionclaw-server:4000` |
| `ONTOLOGY_TIMEOUT_SECS` | per-Loom-call timeout | `10` |
| `ONTOLOGY_ASK_MAX_DOCUMENTS` | default `ask` budget | `12` |
| `ONTOLOGY_ASK_DEPTH` | default `ask` expansion depth | `1` |

`LOOM_BASE_URL` may be set to the `/v1` chat URL elsewhere in the estate; the
wrapper strips a trailing `/v1`, because the graph routes are not under it.

Never target `192.168.2.48` — that host is dead, and a stale route to it is the
documented cause of whole-session hangs.

## Source map

| Concern | Where |
|---|---|
| corpus CLI | VisionClaw `crates/vault` (baked by `agentbox/lib/vault.nix`) |
| Nix gate | `agentbox/flake.nix` `vaultCliActive` ⇐ `[vault].root` + `[vault].cli` |
| boot liveness gate | `agentbox/config/entrypoint-unified.sh`, Phase 5d(ii) |
| wrapper | `agentbox/skills/ontology-augment/scripts/ontology-augment.sh` |
| wrapper test (stub Loom + stub vault) | `agentbox/tests/skills/ontology-augment-grounding.test.sh` |
| Loom routes | `loom/crates/loom-facade/src/routes/mod.rs` |
| Loom MCP tools | `loom/crates/loom-mcp/src/schema.rs` |
| CLI contract | `VisionFlow/docs/engineering/sovereign-corpus-contracts.md` §C2 |
| proposal shape | same file, §C4; forum events §C5 |

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
`x-loom-content-digest`, `x-loom-atomicity-verified`. Quote them when a result
matters.

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

## Degradation semantics

`scripts/ontology-augment.sh` distinguishes three states, because they have three
different fixes:

| stderr | `reason` | Means | Fix |
|---|---|---|---|
| `Loom unreachable` | `loom_unreachable` | no route, DNS, or timeout | the network, usually the `.48`-is-dead trap |
| `returned HTTP 404` | `loom_http_404` | route absent on this generation | deploy, not config |
| `returned HTTP 400` | `loom_http_400` | your query | the query |

All three exit **0** with a JSON body carrying `"degraded": true`. Never read a
degraded empty result as "no such class" — it means nobody answered.

`vault` failures are the opposite and deliberately so: a corpus that cannot be
read is not a degraded grounding, it is a broken environment, so `vault` exits
non-zero and the wrapper lets that through.

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
| `LOOM_BASE_URL` | Loom façade base | `http://192.168.2.132:8084` |
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
| Loom routes | `loom/crates/loom-facade/src/routes/mod.rs` |
| Loom MCP tools | `loom/crates/loom-mcp/src/schema.rs` |
| CLI contract | `VisionFlow/docs/engineering/sovereign-corpus-contracts.md` §C2 |
| proposal shape | same file, §C4; forum events §C5 |

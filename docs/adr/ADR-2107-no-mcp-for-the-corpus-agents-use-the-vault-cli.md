---
id: ADR-2107
title: No MCP inside the estate for the corpus; agents use the vault CLI
date: 2026-09-22
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 4fb44b789fa51f31b380dfbe7a0f79ebaf87ff67
verified_paths: []               # armed in the landing commit — see Verification
owner: jjohare
review_trigger: a request to register any MCP server that reads or writes visionGraph, the ADR-140 /mcp plane reaching the deployed Loom, or the first `vault` subcommand an agent cannot express
repo: agentbox
domain: BASELINE-container
lineage: ADR-2104 (a crate is the control surface, an MCP server a disposable adapter), ADR-112 (budget-bounded fail-open grounding), ADR-2028 ([vault] path authority), VisionFlow PRD-sovereign-corpus Q10/Q11
---

# ADR-2107 — No MCP inside the estate for the corpus; agents use the vault CLI

## Context

The estate had one corpus and four doors that disagreed about its size: raw disk
said 8,433 classes, the Loom's bundle 8,146, VisionClaw's live parse 4,167, and
`ontology-bridge` silently read the raw disk after its VisionClaw URL died.
Nobody could say which number was right.

`ontology-bridge` was the agent-facing door. It cost a registration, a Node
process, twelve tool schemas in every session's context window, and a
VisionClaw round-trip — to deliver reads that are file access. ADR-2104 already
found that MCP hides failure: that bridge answered from a fallback for weeks
without any caller noticing the backend was gone.

EvoOntology measured −15.0 for static context injection against +20.0 for
exposing tools the agent drives. The lesson is about agency, not transport: a
door an agent can drive beats a context it is handed. A CLI is such a door.

## Decision

**No MCP server inside the estate fronts the sovereign corpus.** Agents reach it
two ways, both from Bash:

1. **`vault`** — the CLI (VisionClaw `crates/vault`, contract C2) for everything
   the corpus itself can answer: `find`, `retrieve`, `tree`, `validate`,
   `propose`, `edit --expect`, `gate`, `conflicts`, `build`.
2. **The Loom over HTTP** — `http://192.168.2.132:8084` for everything that
   needs the reasoned closure: `POST /loom/sparql`, `GET /health`, and the
   `/mcp` JSON-RPC plane for `loom.neighbours` / `loom.paths`.

The Loom's `/mcp` remains, as the **external-host** door. Reaching it with curl
is not a breach of this ADR: what is banned is an MCP *server registered in the
estate* — a process, a registration, a tool grant and a per-session context cost.
A JSON body on a LAN URL has none of those.

`ontology-augment`, `podcast-knowledge-ingest`, `podcast-bulk-ingest`,
`ontology-core`, `ontology-enrich`, `web-summary` and the `ontology-curator`
agent are rewritten against those two doors. `ontology-curator`'s tool grant becomes
`Read, Bash`. IWE is a source of ideas (`--expect` blast radius), never a
dependency.

ADR-112's contract is preserved and relocated, not weakened: the budget now
lives in the **arguments** (`--max-documents`, per-edge `--expand` depths) rather
than a server-side tier table, and fail-open is the wrapper degrading a Loom
failure to a marked-empty result with exit 0.

## Consequences

**Easier.** One implementation parses the corpus, so the four-way class-count
disagreement cannot recur by construction. Reads cost no session context.
`vault validate` and `vault gate` run in CI the same way an agent runs them —
the agent's door and the build's door are one binary.

**Harder.** An agent must compose Bash rather than call a typed tool, and must
now know *which* authority it asked: `vault` reads the working tree this instant,
the Loom serves a promoted generation that may be weeks old. Skill prose carries
that distinction explicitly because getting it wrong yields a confidently wrong
answer, which is worse than an error.

**Forbidden.** Registering any MCP server that reads or writes visionGraph.
Re-adding `ontology_axiom_add` in any form: axioms fall out of `vault build`
from frontmatter, they are not hand-added. A *second* CLI over the same corpus
is forbidden too, which is why `ontology-local.cjs` went with the bridge
(ADR-2108): the rule is one implementation, not one transport.

**One deliberate non-change.** `skills/system-one/references/data-boundary.md`
still says "the private Logseq graph", and that is correct: the owner's
`personal-context-portfolio` is a real Logseq graph and is not the corpus. A
`grep -ri logseq` residue sweep must not "fix" it, so the line now says so.

**Measured gap, 2026-09-22.** The generation deployed on `:8084` answers `/mcp`
with 404 — the plane is ADR-140 work that has not shipped (WS-H owns the
deploy). Until it does, `neighbours` falls back to `vault tree` (asserted edges
only, announced on stderr) and `paths` refuses outright rather than passing a
walk over asserted wikilinks off as a shortest path in the reasoned graph.
Refusing was chosen over a plausible-looking substitute: the two are different
answers, and nothing downstream could tell them apart.

**Follow-on.** WS-F rewires `handleGovernanceDecision` onto `vault edit`; the
management API's KG-elevation route still posts to VisionClaw's
`/api/ontology-agent/propose` and is the last non-`vault` propose path in this
repo (see ADR-2108).

## Verification

`implementation_status: partial` — the prose, skills, agent and registrations are
done in this repo; the binary they call is WS-C's and not yet built, and the
`/mcp` plane is not yet deployed.

`verified_commit` names the tree this work was written against (4fb44b789fa5); the
work itself is uncommitted, so `verified_paths` is left EMPTY and the staleness
gate stays inert. **In the landing commit, set `verified_paths` to
`[skills/ontology-augment, skills/podcast-knowledge-ingest, agents/ontology-curator.md, mcp/mcp.json, agentbox.toml]` and bump `verified_commit` to that commit.** Arming it now would
fire a false STALE on the commit that lands the change.

Established by:

- `grep -rn "ontology-bridge" skills/ agents/ mcp/ config/ flake.nix agentbox.toml`
  returns only retirement notes and ADR references.
- `bash skills/lint-skills.sh --check` → clean (127 skills, 0 warnings).
- `node skills/gen-routing-table.mjs` regenerated; the router no longer claims an
  MCP dependency for `ontology-augment`.
- `skills/ontology-augment/scripts/ontology-augment.sh` exercised against a stub
  `vault` on PATH (all subcommands) **and** the live Loom: `/health` and
  `/loom/sparql` returned real data; `/mcp` returned 404 and the documented
  fallbacks fired.

---
id: ADR-2107
title: No MCP inside the estate for the corpus; agents use the vault CLI
date: 2026-09-22
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: c1b0c700c42596d35a1faba3074b667c1928d8fb
verified_paths: [skills/ontology-augment, skills/podcast-knowledge-ingest, agents/ontology-curator.md, mcp/mcp.json, agentbox.toml, AGENTS.md]
owner: jjohare
review_trigger: a request to register any MCP server that reads or writes visionGraph, the ADR-140 /mcp plane reaching the deployed Loom, or the first `vault` subcommand an agent cannot express
repo: agentbox
domain: BASELINE-container
lineage: ADR-2104 (a crate is the control surface, an MCP server a disposable adapter), ADR-112 (budget-bounded fail-open grounding), ADR-2028 ([vault] path authority), VisionFlow PRD-sovereign-corpus Q10/Q11
evidence_class: source+test
acceptance_boundary: ontomark and vault --help verb checks at 3e3e09b1d, a grep for stale vault verbs returning nothing, 95 + 24 node tests passing, skills lint clean. Live image behaviour is not verified; the Loom /mcp plane on the deployed Loom was observed once on 2026-10-30 (park-2026-10-30.md:182) and not re-verified on 2026-10-31; the running image predates the re-point until the owner rebuilds
---

# ADR-2107 — No MCP inside the estate for the corpus; agents use the vault CLI

> Current amendment (2026-10-31, below): the corpus CLI is `ontomark`; `vault` keeps `propose` and `panel publish`.

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

## Amendment — 2026-10-31: the corpus CLI is `ontomark`

Today's commits: `2d49681bf` (management API), `b7a1d0955` (ontology-augment), `f4beec643` (skills and docs), `7aa9365d4` (path tiers), `6aaf3bb46` (podcast submitter), `eff6c29c1`, `4a07fbfb3` (ontomark v0.6.1 pin). Owner decision 2026-10-31 (Ontomark DEPRECATION §14): `ontomark` is the one corpus CLI; `vault` keeps only the governance transport, `propose` and `panel publish`, per Ontomark ADR-OM-005 decisions 5-6.

The decision stands: no MCP server inside the estate fronts the corpus, and agents reach it from Bash. The CLI named in Decision 1 is now `ontomark` for `find`, `retrieve`, `tree`, `edit`, `create`, `apply`, `validate`, `gate`, `conflicts` and `build`; `vault` remains for `propose` and `panel publish` only. Skills, `agents/ontology-curator.md`, `AGENTS.md` and the management API call `ontomark` (`f4beec643`, `2d49681bf`). `ontology-augment.sh` has no `vault` fallback (`b7a1d0955`), and its `neighbours` fallback when the Loom does not answer is `ontomark tree`. Read every `vault <verb>` above as `ontomark <verb>` except `propose`. No `verified_paths` are armed on this record, so the ledger gate did not flag it; this note is the re-verification.

## Close-out 2026-10-31

Status moves to `accepted / complete / staged`. The two gaps named at the 2026-10-30 park are closed: the binary exists (`vault` and `ontomark` are baked) and the Loom `/mcp` plane lists `loom.neighbours` / `loom.paths` (observed 2026-10-30, park-2026-10-30.md:182). The park's remaining item, that `agents/ontology-curator.md` and `AGENTS.md` still taught `vault find/retrieve/tree/edit`, had already been fixed by the 2026-10-31 amendment (`f4beec643`); this pass re-verified it and swept the last residues (`3e3e09b1d`: `runtime-files.md:127`, two stale comments in `ontology-apply.js`).

`verified_paths` is armed with the ADR's prescribed set plus `AGENTS.md`, each confirmed to exist. Activation stays `staged`: the running image predates the re-point until the owner rebuilds.

Executed at `3e3e09b1d` (binaries on PATH: `vault 0.1.0`, `ontomark 0.7.0`):

- `ontomark --help` lists `find retrieve tree edit create apply validate gate conflicts build repair`; `vault --help` lists `validate propose rank panel gate conflicts build certify repair` and ends `Moved: find, retrieve, tree, edit, create and apply now live in the ontomark CLI`. The curator's examples (`ontomark find|retrieve|tree|validate|conflicts`, `ontomark edit --expect`, `vault propose`, `vault panel publish`) each name a verb that binary has.
- `grep -rnE "\bvault (find|retrieve|tree|edit|create|apply)"` over `agents/ skills/ config/ docs/reference/ management-api/ AGENTS.md CLAUDE.md flake.nix lib/` (excluding tests and ADRs) returns nothing.
- `bash skills/lint-skills.sh --check` → `OK — skills estate clean (131 skills, 0 errors)`.
- `node --test management-api/tests/{ontology-apply,ontology-propose-vault,elevation-stage}.test.js` → 95 pass, 0 fail; `node --test tests/contract/governance-flow.spec.js` → 24 pass, 0 fail (the spec uses `node:test`, not jest).

Not re-verified: the live-image behaviour (needs the owner's rebuild) and the `/mcp` plane against the deployed Loom.

Left as is on purpose: the `flake.nix` ontomark note (it omits `apply` from its verb list) and `skills/ontology-augment/references/REFERENCE.md:263` ("`vault` reads the working tree"). Both are governed paths of other ADRs; editing `flake.nix` stales 23 records at once and editing `REFERENCE.md` stales ADR-2028, ADR-2129 and ADR-2140, so they wait for a batch that re-verifies those records. `REFERENCE.md` lines 265–268 are equally stale and are deferred with line 263. Neither teaches an unavailable verb.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `3e3e09b1d`: `agentbox.toml`: additive only: `state_budget_tokens` on the system_one backend (ADR-2139), `bypass_projects = []` (ADR-2090), the four diagram routes (ADR-2130) and their comments; no `[vault]` or corpus key is touched. Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 3e3e09b1d..2f15c531b -- agentbox.toml`.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `2f15c531b` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.
- `mcp/mcp.json`: `${RUVECTOR_PG_CONNINFO}` env entries become the parts plus the password-file path.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 2f15c531b..cc949bb79 -- agentbox.toml mcp/mcp.json`.

## Scoped source re-verification — 2026-11-03

Verified source commit `c1b0c700c42596d35a1faba3074b667c1928d8fb`.

Only agentbox.toml changed: the optional direct AQE toolchain is enabled and Deepsec comments name VisionCraft. The [vault] corpus configuration, corpus skills, mcp/mcp.json and ontology-curator registration are unchanged. AQE is a quality-engineering MCP, not a corpus reader/writer; this amendment adds no ontology MCP. Manifest/configuration checks and the enabled/disabled AQE projection cases pass. Existing corpus activation limits remain.

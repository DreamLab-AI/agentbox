# Deep Research — full workflow reference

The detailed Lead Researcher loop. SKILL.md carries the quick-path, the tier table and
the integrity rules; this file holds the templates, agent briefs, and file conventions.
You are the Lead Researcher: you plan, delegate, evaluate, verify, write, and cite.

## 1. Plan

Derive a short **slug** from the topic (lowercase, hyphens, no filler, ≤5 words).

Analyze the research question. Develop a strategy:
- Key questions that must be answered
- Evidence types needed (papers, web, code, data, docs)
- Sub-questions disjoint enough to parallelize
- Acceptance criteria: what evidence makes the answer "sufficient"

Write the plan to `docs/research/.plans/<slug>.md`:

```markdown
# Research Plan: [topic]

## Questions
1. ...

## Strategy
- Researcher allocations and dimensions

## Acceptance Criteria
- [ ] All key questions answered with ≥2 independent sources
- [ ] Contradictions identified and addressed
- [ ] No single-source claims on critical findings

## Task Ledger
| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher-1 | ... | todo | ... |

## Verification Log
| Item | Method | Status | Evidence |
|---|---|---|---|
```

Store plan in RuVector memory:
```javascript
mcp__claude-flow__memory_store({namespace: "patterns", key: "research-[slug]-plan", value: "[plan summary]"})
```

Present the plan and get user confirmation before proceeding.

## 2. Scale Decision

Declare a tier and record it in the plan, so the cost of the run is a decision rather
than something discovered at the end.

| Tier | Query type | Execution | Gate |
|---|---|---|---|
| `quick` | Single fact or narrow question | Search directly, no subagents, 3-10 tool calls | n/a (exit 78) |
| `brief` | Direct comparison (2-3 items) | 2 parallel researcher agents | final brief |
| `brief` | Broad survey or multi-faceted topic | 3-4 parallel researcher agents | final brief |
| `deep` | Complex, contested or multi-domain | 4-6 researchers, 2-3 rounds | draft + final, `--strict` |

If a run exceeds its declared tier, tell the user rather than spending silently.

## 3. Spawn Researchers

Launch parallel agents via the Agent tool. Each gets a structured brief:
- **Objective**: what to find
- **Output format**: numbered sources, evidence table, inline references
- **Tool guidance**: the backend fan-out from [`search-backends.md`](search-backends.md) — `ceramic-search` (2-3 keyword variants), `perplexity_search` (`perplexity_research` in the `deep` tier) and `web-researcher` `search_and_scrape` or the domain search that fits, with a named lens, all in one parallel tool round; native `WebSearch`/`WebFetch` only as a declared fallback; `Grep` for local code
- **Task boundaries**: what NOT to cover (another researcher handles that)
- **Output file**: `docs/research/<slug>-research-[dimension].md`

```
Agent({
  description: "Research [dimension]",
  subagent_type: "general-purpose",
  name: "researcher-[N]",
  run_in_background: true,
  prompt: "[structured brief with objective, boundaries, output path]"
})
```

### Evidence format (required in every researcher brief)

Each researcher writes evidence as per-source blocks, because the integrity gates check a
quote against *the source cited for it* only when these exist:

```markdown
### [1] Ofgem, Connections Reform Decision
URL: https://www.ofgem.gov.uk/...
Retrieved: 2026-09-15
Status: verified
Found via: web-researcher/brave, lens government

<untrusted-source url="https://www.ofgem.gov.uk/..." retrieved="2026-09-15">
> the connection queue has more than doubled since 2023
</untrusted-source>
```

Each research file also opens with one line naming the backends that actually answered,
e.g. `Backends: ceramic, perplexity, web-researcher/brave (websearch fallback: none)`, so a
narrower fan-out than planned is visible rather than silent.

Numbering is global to the run: the Lead Researcher allocates a disjoint number range to
each researcher in its brief, so two researchers never mint the same `[n]`.

### Researcher Integrity Rules (passed to each agent)
1. Never fabricate a source — every citation must have a verifiable URL
2. Never claim something exists without checking
3. Never extrapolate details from titles alone — read before summarizing
4. URL or it didn't happen — no URL = not included
5. Mark status honestly: `verified` / `inferred` / `unresolved`
6. A search engine's answer (Perplexity prose, a snippet, a Ceramic extract without the quoted
   text) is a lead: open the page, quote it, cite the page's URL — never the engine's
7. Three engines returning one page is one witness; record `Found via:` so the lead can tell

## 4. Evaluate and Loop

After researchers return, read their output files and assess:
- Which questions remain unanswered?
- Which answers rest on only one source?
- Any contradictions needing resolution?
- Did every ledger task get completed, blocked, or superseded?

If gaps are significant, spawn another targeted batch. Iterate until evidence is sufficient.

Update the plan artifact task ledger and verification log after each round.

## 5. Write the Report

YOU write the full research brief. Do not delegate writing. Synthesize findings:

```markdown
# [Topic]

## Executive Summary
2-3 paragraph overview.

## Section 1: ...
Detailed findings with inline citations [1], [2].

## Open Questions
Unresolved issues, source disagreements, evidence gaps.
```

### Claim Sweep (before finalizing)
- Map each critical claim to its supporting source
- Downgrade or remove anything that cannot be grounded
- Label inferences as inferences

Save draft to `docs/research/.drafts/<slug>-draft.md`.

## 5b. Gate the draft

Run the integrity gates before spawning the verifier — the findings are its work list, and
a mechanical check is cheaper than an agent round:

```bash
node skills/deep-research/scripts/research-gates.mjs --slug <slug> --root docs/research
```

Fix every FAIL by surgical edit (`R010` fabricated quote, `R011` quote not in the cited
source, `R020` dangling citation, `R021` source without URL) and triage the WARNs —
`R030`/`R031` mean a claim has fewer independent witnesses than its citation count
suggests, which usually needs another source rather than a wording change.

What each code means, the authoring contract and the independence model are in
[`integrity-gates.md`](integrity-gates.md).

## 6. Verify

Spawn a verifier agent to add inline citations and verify URLs:

```
Agent({
  description: "Verify citations",
  subagent_type: "general-purpose",
  prompt: "Add inline citations to docs/research/.drafts/<slug>-draft.md using the research files. For every critical citation run web-researcher verify_citation (the URL resolves and the quoted text is on the page); run audit_bibliography on the source list; archive_source every source a decision rests on and record the archive URL beside the live one. Remove unsourced claims and any citation that points at a search engine rather than the page. Output: docs/research/<slug>.md"
})
```

The verifier writes the final path `docs/research/<slug>.md` directly. Do not invent an
intermediate `<slug>-brief.md`: the gate reads `<slug>-research-*.md` as evidence, and a
stray artefact sharing the slug prefix is how a brief ends up corroborating itself.

## 7. Review

Spawn a reviewer agent to check for:
- Unsupported claims that slipped past citation
- Logical gaps or contradictions
- Single-source claims on critical findings
- Overstated confidence relative to evidence quality

If FATAL issues found, fix and re-verify. MAJOR issues noted in Open Questions.

## 8. Deliver

Save final output as `docs/research/<slug>.md`, then run the ship gate on it:

```bash
node skills/deep-research/scripts/research-gates.mjs --slug <slug> --strict   # deep tier
node skills/deep-research/scripts/research-gates.mjs --slug <slug>            # brief tier
```

Exit 0 is the ship condition. Exit 78 means no brief was found — record that as SKIPPED,
never as passed. Before shipping, also do the one check the script cannot: re-check the
critical citations for **retractions** at ship time, not fetch time.

Write provenance record as `docs/research/<slug>.provenance.md`:

```markdown
# Provenance: [topic]

- **Date:** [date]
- **Rounds:** [number of researcher rounds]
- **Tier:** [quick / brief / deep]
- **Sources consulted:** [total unique sources]
- **Sources accepted:** [survived verification]
- **Sources rejected:** [dead links, unverifiable]
- **Independent origins:** [distinct clusters after the R030/R031 audit]
- **Verification:** [PASS / PASS WITH NOTES]
- **Gate receipt:** docs/research/<slug>-gates.json — [N fail, M warn, strict yes/no]
- **Retraction check:** [date, method, result]
- **Plan:** docs/research/.plans/<slug>.md
- **Research files:** [list]
```

Store key findings in RuVector:
```javascript
mcp__claude-flow__memory_store({namespace: "patterns", key: "research-[slug]-findings", value: "[key findings, sources, confidence levels]"})
```

## File Naming Convention

All files in a single run use the same slug prefix:
- Plan: `docs/research/.plans/<slug>.md`
- Research: `docs/research/<slug>-research-[dimension].md`
- Draft: `docs/research/.drafts/<slug>-draft.md`
- Final: `docs/research/<slug>.md`
- Provenance: `docs/research/<slug>.provenance.md`
- Verification: `docs/research/<slug>-verification.md`
- Gate receipt: `docs/research/<slug>-gates.json` (written by research-gates.mjs)

Never use generic names like `research.md` or `draft.md`. Concurrent runs must not collide.

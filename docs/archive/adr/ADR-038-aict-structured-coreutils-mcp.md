---
id: ADR-038
title: "AICT structured-coreutils MCP — trial, do not bake"
status: proposed
date: 2026-07-15
type: architecture
author: Dr John O'Hare
depends_on: [ADR-011, ADR-015, ADR-027]
related: [ADR-018, ADR-025]
review_trigger: a bounded trial measures a net token/accuracy win over Claude Code's native tools on real agent tasks AND a shell-heavy non-Claude harness becomes a routine workload; or AICT clears a maturity bar (independent adoption, more than one maintainer, a security-relevant release cadence); or a second structured-coreutils tool emerges that shifts the adopt-vs-ignore calculus
"@context": https://schema.org
"@type": TechArticle
---

# ADR-038 — AICT Structured-Coreutils MCP: Trial, Do Not Bake

**Status:** Proposed (suggestion)
**Date:** 2026-07-15
**Repo:** DreamLab-AI/agentbox
**Local antecedents:** ADR-011 (named consultants over a meta-router — the precedent for *whether* a new MCP earns a slot), ADR-015 (MCP/RuVector mandate — tool discipline), ADR-027 (default-secure posture — the bar for baking third-party binaries into the immutable image)
**Trigger:** External suggestion to evaluate [`synseqack/aict`](https://github.com/synseqack/aict) for deep integration in the next agentbox rebuild.

## Context

AICT is a single Go binary (MIT, standard-library-only bar the MCP Go SDK) that reimplements 33 Unix utilities (`cat`, `head`, `grep`, `find`, `ls`, `sort`, `jq`, `awk`, `sed`, `git`, `stat`, `df`…) with **structured output** — XML (default) or JSON — plus semantic enrichment: language detection, MIME typing, absolute paths, Unix-epoch timestamps with relative time, and byte/human sizes. Its stated purpose: *"Unix coreutils with XML/JSON output — built for AI agents, not humans."* It ships an MCP server via `aict mcp`, so it drops into `.mcp.json` and becomes callable by any agent.

The premise is genuinely aligned with this repo's philosophy — deterministic, machine-first tool output to cut agent parse-errors and multi-turn re-reads. The self-reported evaluation claims 46% fewer output tokens and higher accuracy on a real agent task. Two facts constrain whether that premise pays off *here*:

1. **Redundancy with the dominant harness.** The agentbox's primary agents run under Claude Code, whose native `Read`/`Grep`/`Glob` tools already return agent-optimised, structured-ish results, and whose guidance actively discourages shelling out to raw coreutils (`cat`/`grep`/`sed`). AICT's biggest wins — structured file/dir/git inspection — are the exact surface the native tools already cover. Its marginal value is concentrated in workloads that *do* shell out heavily: non-Claude harnesses (ADR-025) and shell-piping sub-agents.

2. **Immaturity vs the immutability bar.** agentbox bakes into a digest-pinned, immutable Nix image (ADR-006, ADR-027). "Deep integration for the next rebuild" means committing a tool into that image and wiring it as a standard MCP for every agent. AICT is early: ~6 stars, ~51 commits, v2.1.0, effectively single-author. The *dependency* risk is low (MIT, Go-stdlib, auditable single binary), but the *adoption/maintenance* risk of baking it into the platform every agent depends on is not.

The token economics also deserve scrutiny rather than acceptance: AICT's own docs record each tool's output at **1.1–7.8× more** tokens than GNU; the net saving is asserted to come from fewer multi-turn calls and less re-parsing. Whether that nets out positive is entirely workload-dependent, and the supporting evidence is the project's own single evaluation.

## Decision

**Trial AICT as an *optional*, non-baked MCP; gate any deep integration on measured evidence. Do not bake it into the next rebuild's image on current information.**

Concretely: install the binary in a developer/agent scratch location (or a non-default overlay), add an *optional* `aict` stanza to `.mcp.json` that a chosen agent or harness can opt into, and measure token/accuracy delta against the native tools on two or three representative real tasks — ideally including one shell-heavy non-Claude harness path where the upside should be largest. Promote to a baked, default MCP only if the measured net win is real **and** a shell-heavy workload is routine.

### Alternatives considered

| Alternative | Verdict | Rationale |
|---|---|---|
| **Deep-bake now** — add AICT to the sidecar/base image and wire it as a default MCP for all agents in the next rebuild | Rejected | Commits an early, single-author, ~6-star tool into the immutable image (ADR-027 bar) before any in-house evidence exists. Its headline win overlaps the native Claude Code tools the primary harness already uses, and the net-token claim is self-reported (n≈1) against a workload profile (heavy coreutils shelling) that is not ours. Baking first inverts the register's own lesson that unwired/unmeasured capabilities rot. |
| **Ignore entirely** | Rejected | The structured-output-for-agents idea is directionally right and the tool is cheap to try (one MIT binary, built-in MCP server). Dismissing it forgoes a low-cost measurement that could inform both an adoption decision *and* whether to build an equivalent in-house for the non-Claude harnesses. |
| **Trial as optional MCP, then decide** | **Chosen** | Near-zero integration and removal cost; keeps the immutable image clean; produces the missing evidence (our workload, not the author's) before any irreversible commitment. Matches ADR-011's posture: a new MCP earns a permanent slot by demonstrated value, not by plausible pitch. |
| **Adopt the idea, build in-house** — a minimal structured-output shim for the shell-heavy harness paths only | Deferred | Only worth considering if the trial shows the *idea* helps here but AICT's maturity/scope is the blocker. Premature to decide before the trial quantifies the benefit. |

## Consequences

- **If the trial shows a net win on a routine workload:** revisit with a follow-up ADR to bake AICT (or an in-house equivalent) as a default MCP, at which point the ADR-027 supply-chain review (pinning, provenance, update cadence) applies in full.
- **If it does not:** the optional stanza is removed at zero cost; the measurement itself is the deliverable and informs whether the structured-coreutils pattern is worth building narrowly for non-Claude harnesses.
- **No image or default-MCP change ships from this ADR.** It authorises a bounded, reversible trial only. The immutable image and the default agent tool surface are untouched until evidence justifies a follow-up decision.
- **Scope boundary:** this ADR concerns tool-output ergonomics for agents. It does not touch the RuVector/MCP memory mandate (ADR-015) or the consultation-MCP roster (ADR-011); AICT is a file/text utility surface, not a knowledge or reasoning capability.

## See also

- [Reference hub](../README.md) — full decision-chain matrix
- ADR-011 (named consultants over meta-router) · ADR-015 (MCP/RuVector mandate) · ADR-027 (default-secure posture)

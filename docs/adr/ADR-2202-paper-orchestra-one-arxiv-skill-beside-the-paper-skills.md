---
id: ADR-2202
title: PaperOrchestra is one arXiv-only skill that sits beside the existing paper skills
date: 2026-11-14
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 573e0900ffc202580ddf3ae8f630158127fd753e
verified_paths: [skills/paper-orchestra, services/skill-tools, lib/skill-tools.nix]
owner: jjohare
review_trigger: the next image build (confirm `paper-orchestra --help` on PATH and the skill under /opt/agentbox/skills); arXiv changing its TeX submission or metadata rules (skills/paper-orchestra/references/arxiv.md carries the date they were read); a routed turn about compiling LaTeX, a book manuscript or a white paper landing on paper-orchestra in ~/.claude/skill-route.jsonl; an upstream PaperOrchestra release that changes a verbatim prompt
repo: agentbox
domain: GOVERNANCE-capabilities
relates: [ADR-2083, ADR-2091, ADR-2192, ADR-2196]
evidence_class: test+runtime
acceptance_boundary: Skill lint, count and routing-table checks pass; the Nix skill-tools build passes 275 tests, and the deployed image exposes the helper on PATH and offers the skill to the router. Earlier live Jev prompts show wiring, not routing accuracy. The full routing corpus still has disabled cad-print expectations; no all-corpus pass is claimed.
---

# ADR-2202 — PaperOrchestra is one arXiv-only skill that sits beside the existing paper skills

## Context

Upstream PaperOrchestra (`Ar9av/PaperOrchestra`, MIT, commit `6a31913`) implements arXiv:2604.05018 as nine skill directories and 51 Python scripts for any coding agent and any conference. The estate already owns LaTeX compilation (`latex-documents`), researched reports (`report-builder`), book manuscripts (`book-publishing`), citation discovery and verification (`web-researcher`, `deep-research`), diagrams and prose checks. The router offers every skill directory as a candidate and cuts each description to about 192 characters for its first pick (ADR-2192). Two of upstream's Python dependencies are not in the image, and its PaperBanana renderer was deleted by ADR-2196. The operator publishes papers to arXiv only.

## Decision

1. **One skill, `paper-orchestra`.** Each upstream agent is a file under `references/`; the paper's prompts are kept verbatim as `references/prompt-*.md`. Its description names both modes (write from an idea and results; refine an existing paper) in the first sentence.
2. **It adds and delegates; it replaces nothing.** It owns the outline schema, the evidence and citation gates, the reviewer loop, blind side-by-side judging and the arXiv preflight. Compiling goes to `latex-documents`, search and citation existence to `web-researcher` and `deep-research`, diagrams to `diagram-design` and `mermaid-diagrams`, prose to `prose-sanitiser`, books to `book-publishing`, white papers to `report-builder`. Those skills gain one pointer each; `latex-documents` also gains the arXiv template. Nothing else in them changes, and `book-publishing` keeps its opening phrase about arXiv submissions: live routing did not confuse the two, so there was no reason to narrow it.
3. **arXiv is the only target.** The template is added to `latex-documents` (`templates/arxiv/`), which owns templates; the rules and the preflight live in this skill, and the preflight detects the engine so the book pipeline can use the same command. The template and rules are fixed; there is no conference template, page limit or anonymisation. The rules file states the date arXiv's help pages were read.
4. **Helpers are one Rust binary**, `paper-orchestra`, in `services/skill-tools`: seventeen subcommands. The outline is validated by typed structures, not JSON Schema. `claim-evidence` gains a results-ledger mode and `arxiv-preflight` is new.
5. **Not ported:** search-API clients, PDF and LaTeX lints, snapshotting, the PaperBanana and graphviz renderers, the Citation F1 rater, the benchmark builder, the agent-log aggregator and the per-host integration guides. `references/upstream.md` lists each with its reason.
6. **One upstream rule is reversed.** "Never explicitly state a limitation" becomes: never remove or weaken a stated limitation, and never invent one. The upstream rule defends a benchmark score and would remove honest disclosure from a real paper.
7. **Not registered** in `registered-skills.txt` or the Codex manifest. It is reached by routing.

## Consequences

- 124 skills. A paper task now has a first-choice skill, and the three older paper skills keep their territory; ten labelled cases in `tests/system-one/routing-cases.json` hold the boundary.
- The 2026-11-14 image build puts the helper on PATH and bakes the skill. It remains routing-only, not always registered.
- The baked descriptions are updated. The full routing-corpus test still expects `cad-print` although `cad_print = false` excludes it from the live candidates; its availability assertion and dependent subgroup checks fail. Do not re-enable the expensive slicer/WebKit closure to satisfy this fixture.
- `book-publishing` still carries an older arXiv checklist (`\pdfoutput=1` required, `.bbl` required). arXiv no longer requires either. That file is not changed here; it is a follow-up for that skill's owner.
- The reviewer loop's scores steer revision and are not evidence of improvement. The skill says so and requires a blind comparison by judges outside the loop.
- Upstream prompt updates are a manual diff of seven files.

## Verification

- After a real prompt about replacing an arXiv submission with a v2 was routed to `book-publishing`, the description's first sentence was reworded to name revising and new versions. Live Jev then routed 16 of 16: the ten labelled cases, three real prompts, and existing cases for the three neighbours.

Initial verification was on `feat/paper-orchestra-skill`; the merged source is now re-verified at `verified_commit` above.

- `bash skills/lint-skills.sh`: clean, 124 skills. `bash tests/config/skill-lint.test.sh`: 30 passed. `node scripts/skill-count-check.js`: ok, no divergences. `node skills/gen-routing-table.mjs --check`: current.
- Live Jev through the loopback proxy, scope `all`, 136 candidates, against the source tree: the nine new cases 9 of 9; seven existing cases labelled for the neighbouring skills, plus two fresh prompts, 9 of 9. Cost $0.013. Citation discovery goes through `web-researcher`, an existing egress route; no backend is added.
- `services/skill-tools`: `cargo test --release` 275 passed (236 unit, 23 binary integration, 16 doc tests), 0 failed; `cargo clippy --all-targets -- -D warnings` clean; `cargo doc --no-deps` raises no warning in `paper_orchestra` (three older warnings in `docs_alignment` and `wardley` remain). No dependency was added and `Cargo.lock` is unchanged. After review the gates fail closed: `score-delta`, `score-trajectory`, `worklog` and `concession-guard` exit 3 on a missing or non-numeric score, an unknown severity or a non-integer round instead of reading a zero; usage errors exit 64; `arxiv-preflight` rejects graphics and bibliography paths outside `--source`; the citation extractor matches only real cite commands.
- Used end to end on a real 58-page ledger-built preprint in a scratch copy: `arxiv-preflight`, `orphan-cites`, `claim-evidence --ledger` and `reverse-outline` ran on the submitted and a revised source; the preflight reported the one 40 pt overfull table the build log holds and no error.
- Deployment verification, 2026-11-14: Nix built `skill-tools` with 236 library tests, 23 CLI integration tests and 16 doc tests passing. The build phase took 44 seconds with dependency caches warm. Image `sha256:ceeb743c024961d0d0e19a271737bd20b2b20b8c647f5361ff4eea206d94117f` passes an offline `paper-orchestra --help` and a 124-skill inventory check. After activation, the helper is on PATH and the actual router offers `paper-orchestra`, while `cad-print` remains gated off. Persistent mounts are unchanged; readiness and all expected long-running supervisor programs settle healthy. This does not establish independent routing accuracy or execute an arXiv submission.

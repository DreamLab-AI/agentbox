---
id: ADR-2202
title: PaperOrchestra is one arXiv-only skill that sits beside the existing paper skills
date: 2026-11-14
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 4a2bd7ec304cd34279c51ddef6e431958e37b3a9
verified_paths: []
owner: jjohare
review_trigger: the next image build (confirm `paper-orchestra --help` on PATH and the skill under /opt/agentbox/skills); arXiv changing its TeX submission or metadata rules (skills/paper-orchestra/references/arxiv.md carries the date they were read); a routed turn about compiling LaTeX, a book manuscript or a white paper landing on paper-orchestra in ~/.claude/skill-route.jsonl; an upstream PaperOrchestra release that changes a verbatim prompt
repo: agentbox
domain: GOVERNANCE-capabilities
relates: [ADR-2083, ADR-2091, ADR-2192, ADR-2196]
evidence_class: test+runtime
acceptance_boundary: Lint, count, corpus and crate tests pass in source, and eighteen prompts were routed through live Jev against the source tree by calling the router library directly. The helper binary was built with cargo, not by Nix, and nothing here is in a built image. The routing prompts were written by the author of the description they test, so they show the wiring works and are not a measure of routing accuracy.
---

# ADR-2202 — PaperOrchestra is one arXiv-only skill that sits beside the existing paper skills

## Context

Upstream PaperOrchestra (`Ar9av/PaperOrchestra`, MIT, commit `6a31913`) implements arXiv:2604.05018 as nine skill directories and 51 Python scripts for any coding agent and any conference. The estate already owns LaTeX compilation (`latex-documents`), researched reports (`report-builder`), book manuscripts (`book-publishing`), citation discovery and verification (`web-researcher`, `deep-research`), diagrams and prose checks. The router offers every skill directory as a candidate and cuts each description to about 192 characters for its first pick (ADR-2192). Two of upstream's Python dependencies are not in the image, and its PaperBanana renderer was deleted by ADR-2196. The operator publishes papers to arXiv only.

## Decision

1. **One skill, `paper-orchestra`.** Each upstream agent is a file under `references/`; the paper's prompts are kept verbatim as `references/prompt-*.md`. Its description names both modes (write from an idea and results; refine an existing paper) in the first sentence.
2. **It adds and delegates; it replaces nothing.** It owns the outline schema, the evidence and citation gates, the reviewer loop, blind side-by-side judging and the arXiv preflight. Compiling goes to `latex-documents`, search and citation existence to `web-researcher` and `deep-research`, diagrams to `diagram-design` and `mermaid-diagrams`, prose to `prose-sanitiser`, books to `book-publishing`, white papers to `report-builder`. Those skills gain one pointer each; `latex-documents` also gains the arXiv template. Nothing else in them changes, and `book-publishing` keeps its opening phrase about arXiv submissions: live routing did not confuse the two, so there was no reason to narrow it.
3. **arXiv is the only target.** The template is added to `latex-documents` (`templates/arxiv/`), which owns templates; the rules and the preflight live in this skill, and the preflight detects the engine so the book pipeline can use the same command. The template and rules are fixed; there is no conference template, page limit or anonymisation. The rules file states the date arXiv's help pages were read.
4. **Helpers are one Rust binary**, `paper-orchestra`, in `services/skill-tools`: sixteen subcommands. The outline is validated by typed structures, not JSON Schema. `claim-evidence` gains a results-ledger mode and `arxiv-preflight` is new.
5. **Not ported:** search-API clients, PDF and LaTeX lints, snapshotting, the PaperBanana and graphviz renderers, the Citation F1 rater, the benchmark builder, the agent-log aggregator and the per-host integration guides. `references/upstream.md` lists each with its reason.
6. **One upstream rule is reversed.** "Never explicitly state a limitation" becomes: never remove or weaken a stated limitation, and never invent one. The upstream rule defends a benchmark score and would remove honest disclosure from a real paper.
7. **Not registered** in `registered-skills.txt` or the Codex manifest. It is reached by routing.

## Consequences

- 124 skills. A paper task now has a first-choice skill, and the three older paper skills keep their territory; nine labelled cases in `tests/system-one/routing-cases.json` hold the boundary.
- The skill is inert until the next image build puts the binary on PATH. Until then the binary can be built with `cargo build --release` in `services/skill-tools`.
- `tests/system-one/routing-corpus.test.mjs` "repo and baked trees agree" fails until that build, because three neighbour descriptions changed. It fails the same way for any description edit.
- `book-publishing` still carries an older arXiv checklist (`\pdfoutput=1` required, `.bbl` required). arXiv no longer requires either. That file is not changed here; it is a follow-up for that skill's owner.
- The reviewer loop's scores steer revision and are not evidence of improvement. The skill says so and requires a blind comparison by judges outside the loop.
- Upstream prompt updates are a manual diff of seven files.

## Verification

Verified on the branch `feat/paper-orchestra-skill`, on top of the base commit named in `verified_commit`; `verified_paths` is empty until the branch is merged and the record re-stamped at its own commit.

- `bash skills/lint-skills.sh`: clean, 124 skills. `bash tests/config/skill-lint.test.sh`: 30 passed. `node scripts/skill-count-check.js`: ok, no divergences. `node skills/gen-routing-table.mjs --check`: current.
- Live Jev through the loopback proxy, scope `all`, 136 candidates, against the source tree: the nine new cases 9 of 9; seven existing cases labelled for the neighbouring skills, plus two fresh prompts, 9 of 9. Cost $0.013. Citation discovery goes through `web-researcher`, an existing egress route; no backend is added.
- `services/skill-tools`: `cargo test --release` 250 passed, 0 failed; `cargo clippy --all-targets -- -D warnings` clean; `cargo doc --no-deps` raises no warning in `paper_orchestra` (three older warnings in `docs_alignment` and `wardley` remain). No dependency was added and `Cargo.lock` is unchanged.
- Used end to end on a real 58-page ledger-built preprint in a scratch copy: `arxiv-preflight`, `orphan-cites`, `claim-evidence --ledger` and `reverse-outline` ran on the submitted and a revised source; the preflight reported the one 40 pt overfull table the build log holds and no error.
- Not verified: the Nix build of `skill-tools`, and the skill in a rebuilt image.

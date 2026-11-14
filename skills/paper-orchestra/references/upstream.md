# Upstream: what was kept, changed and dropped

Source: `github.com/Ar9av/PaperOrchestra` at commit
`6a319132932ee031e2d759b0f7f5075cf77bd1cf` (MIT; licence text in
`LICENSE-UPSTREAM` at the skill root), which implements Song, Song, Pfister and
Yoon, *PaperOrchestra: A Multi-Agent Framework for Automated AI Research Paper
Writing*, arXiv:2604.05018.

Upstream is nine skill directories and 51 Python scripts for any coding
agent and any conference. This is one skill, one Rust binary, and one target.

## Kept

- The five-step pipeline, the outline schema and its allowed values.
- The paper's prompts, verbatim, as `prompt-*.md`.
- Citation rules: title similarity above 70, strict cutoff, deduplication,
  90% coverage, no orphan keys.
- The refinement loop: accept, revert and halt rules, decision bands, plateau
  and target halts, the devil's advocate and its concession guard, critique
  memory, the reverse outline, the claim-evidence gate.
- The blind side-by-side rater and the literature-review quality rater.

## Changed

| Upstream | Here | Why |
|---|---|---|
| Nine skills | One skill, each agent a reference file | The router offers every skill directory as a candidate; eight sub-agent names would compete with the estate's own paper skills |
| `template.tex` and `conference_guidelines.md` as inputs | A fixed arXiv template and rules | arXiv is the only target |
| "Never explicitly state a limitation" | Limitations stay; none is invented or removed | Upstream's rule stops a benchmark agent gaming an automated score; on a real preprint it removes honest disclosure |
| Reviewer framed as a conference committee with a page limit | Reviewer framed as a reader of a preprint | No page limit, no anonymity |
| Numbers checked against a markdown log by pattern | The same, plus a ledger mode for papers whose results are substituted at build time | The estate's papers are ledger-built |
| 51 Python scripts, `jsonschema`, `python-Levenshtein` | 17 subcommands of one Rust binary in `services/skill-tools` | Estate rule for CLIs and evaluators; neither Python package is in the image |
| Outline validated by JSON Schema | Typed structures that reject unknown fields | Better error paths, no schema dependency |

## Delegated to an existing skill

| Upstream part | Owner here |
|---|---|
| `build_pdf.py`, `check_tex_packages.py`, `latex_sanity.py`, `table_lint.py` | `latex-documents` and the build log read by `arxiv-preflight` |
| Semantic Scholar, Exa, Tavily, Serply, Keenable, Crossref and OpenAlex clients; cross-index verification; BibTeX formatting | `web-researcher` (`academic_search`, `verify_citation`, `audit_bibliography`, `format_bibliography`), `deep-research` |
| PaperBanana and graphviz renderers | `diagram-design`, `mermaid-diagrams`; matplotlib directly for charts |
| AI-failure-mode and writing-quality checklists | `prose-sanitiser` |
| Workspace snapshots | git, or a plain copy |

## Dropped

- **Citation F1 and `paper-writing-bench`**: they score the method against a
  benchmark of known papers. Nothing here consumes that.
- **`agent-research-aggregator`**: mining agent session caches into inputs.
  [pipeline.md](pipeline.md) covers the case in a paragraph: write the inputs
  from the sources and cite each number.
- **Host integration guides** for other coding agents.

## Added

- `arxiv-preflight`, from arXiv's current help pages ([arxiv.md](arxiv.md)).
- Refine mode as a first-class entry point ([existing-paper.md](existing-paper.md)).
- The blind-judging protocol's independence rules ([autoraters.md](autoraters.md)).

## Updating from upstream

Diff upstream's `skills/*/references/prompt.md` and the two rater prompts
against `prompt-*.md` here; those are the files meant to track the paper.
Everything else is this estate's adaptation and is edited here.

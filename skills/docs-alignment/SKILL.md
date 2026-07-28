---
name: docs-alignment
description: "Validate and align a whole documentation corpus against the codebase — broken-link/orphan detection, Diataxis structure, front-matter metadata, Mermaid diagram compliance (ASCII→Mermaid), UK-English spelling, and navigation/index generation — optionally via an agent swarm. Use when auditing or modernising a full /docs corpus, enforcing Diataxis, fixing link coverage, or preparing docs for a release. Not for writing a single README (write markdown directly), LaTeX reports (report-builder), or standalone diagrams (mermaid-diagrams)."
---

# Documentation Alignment Skill

Modernise and validate a project's documentation corpus so it stays consistent
with the codebase: links, front matter, diagrams, spelling, Diataxis structure,
navigation, and CI. Runs as standalone scripts or as a 15-agent swarm for
large corpora.

## When to use / not use

Use for whole-corpus work: auditing, modernising, aligning docs to code, or
release/onboarding prep.

Skip in favour of a more direct path when:
- Writing a single markdown file or README — just write markdown.
- Generating a LaTeX report with charts/bibliography — use `report-builder`.
- Creating a diagram from text — use `mermaid-diagrams`.
- Generating API docs from code — use code-level doc tools directly.
- General code quality/testing workflows — use `build-with-quality`.

## Prerequisites

- Python 3.10+ with pip; Node.js 18+ (Mermaid validation); Git.
- A git repo with docs in `/docs` and a codebase to validate against.
- Claude Code Task tool (only for swarm orchestration).

## Quick start

Script path — run the whole alignment in one command:

```bash
pip install -r scripts/requirements.txt
npm install -g @mermaid-js/mermaid-cli

python scripts/docs_alignment.py \
  --project-root /path/to/project \
  --docs-dir ./docs \
  --codebase-dir ./src \
  --output-dir ./docs/working
```

Individual validators (each supports `--json`):

```bash
./scripts/validate-all.sh          # runs every check below
./scripts/validate-links.sh        # link integrity + orphans
./scripts/validate-frontmatter.sh  # YAML metadata
./scripts/validate-mermaid.sh      # diagram syntax / Git compliance
./scripts/detect-ascii.sh          # ASCII art to convert
./scripts/validate-spelling.sh     # UK English
./scripts/validate-structure.sh    # naming / layout
./scripts/generate-reports.sh      # quality scorecard
```

Full flag set for a strict pass:

```bash
python scripts/docs_alignment.py --project-root . --docs-dir ./docs \
  --codebase-dir ./src --output-dir ./docs/working \
  --full-validation --git-compliant --uk-english --diataxis-strict
```

## Swarm path (large corpora)

For a comprehensive modernisation, deploy the 15-agent swarm via the Task tool:

```bash
claude-code << 'EOF'
Task("Documentation Alignment Swarm", `
  Execute documentation alignment using a 15-agent swarm.
  Project: /home/devuser/workspace/project
  Docs: ./docs   Output: ./docs/working
  Waves: inventory → IA design → modernisation → consolidation → QA/CI.
`, "system-architect")
EOF
```

The five-wave agent roster, per-phase execution detail, topology config, and
memory-coordination keys are in [`references/swarm.md`](references/swarm.md).

## References

- [`references/swarm.md`](references/swarm.md) — 15-agent composition, five-wave
  execution phases, topology, memory coordination.
- [`references/standards.md`](references/standards.md) — full validation-standards
  catalog (links, diagrams, front matter, spelling, content, structure,
  coverage), the A–F quality-scoring rubric, all output deliverables, and
  success-metric targets. Treat thresholds as tunable per project.
- [`docs/ADVANCED.md`](docs/ADVANCED.md) — custom topologies, validation-rule
  config, CI/CD (GitHub Actions / GitLab), custom report templates, large-codebase
  performance tuning.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — install/validation/permission/
  performance/swarm failure modes and fixes.

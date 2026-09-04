# Lineage: Repo-Explainer, and what was kept

`github.com/ruvnet/Repo-Explainer` (Stuart Kerr, Isovision; last push 2026-06-27) turns
a public GitHub URL into a visual explainer site plus a "smart zip" for agents. It is
**not** part of the metaharness plugin (`ruflo-metaharness` ships harness-* skills only),
and it is **not** in the ruvbrain corpus as of v4.3.9.

| Repo-Explainer | This skill |
|---|---|
| Hosted pipeline: Vercel form → GitHub Actions, 9 phases, ~6 min | Run locally in the session; nothing leaves the box |
| Publishes to `stuinfla/<repo>-explainer` + public domain; PRs a badge onto the source repo | Private bundle inside the repo's docs; private Artifact; sharing is the owner's call |
| Phase 2: walk tree → `repo-analysis.json` (README excerpt, symbols, manifests) | Orient by reading, run the project's gates, search memory and ruvbrain |
| Phase 4: one gpt-4o prompt per section over that JSON | Three forks, each grounded in files it opens, each returning a claims ledger |
| Phase 5: gpt-image-1 hero and section images | Diagrams of the actual mechanism (mermaid / inline SVG), real screenshots |
| Phase 6 gates: structural (files exist, > 5,000 chars, no secrets, no broken anchors) | Gates A–E: graded KB, comprehension audit, ledgered consistency, visuals |
| AI half: single-file `.rvf` (RVF HNSW) + MCP server | RuVector namespace `<repo>-kb` in the shared memory sidecar; `.rvf` export optional |
| Human half media: NotebookLM audio/slides, hand-authored | Out of scope unless asked |

Kept verbatim: the seven-question arc; the dual-half bundle; the scope boundary via
`.gitmodules`; "done = proven, with evidence"; the R/C/O diagnosis loop; the tuned vs
held-out question discipline. Its `kb/` engine and ADR-0001 are worth reading once for
the reasoning; the scripts themselves are small enough to reimplement to our substrate.

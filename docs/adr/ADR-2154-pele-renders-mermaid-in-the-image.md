---
id: ADR-2154
title: Render Mermaid in the image with a pinned Pele, replacing the browsercontainer renderer
date: 2026-10-29
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: [ADR-2152]
superseded_by: []
verified_commit: d1dd896f4a790762b150d81a94a03b268b04c543
verified_paths: ["lib/pele.nix", "scripts/pele-render.cjs", "scripts/mmdc-pele.cjs", "skills/diagrams-as-code/scripts/vendor/pele"]
owner: jjohare
review_trigger: a Pele release we adopt, a diagram Mermaid 11 accepts and Pele rejects, or any surface in this repo that renders Mermaid through a browser, a sidecar or a CDN script
repo: agentbox
domain: BASELINE-container
---

# ADR-2154: Render Mermaid in the image with a pinned Pele, replacing the browsercontainer renderer

## Context

ADR-2152 moved Mermaid rendering to browsercontainer's headless Chromium and left an
`mmdc` HTTP client in the image. That keeps a sidecar, a shared volume and a browser in the
render path, and the client probe could not tell a healthy renderer from a missing one. The
estate decision, VisionFlow ADR-2020, renders every Mermaid diagram with one pinned
[Pele](https://github.com/obsidianmd/pele) (MIT, no dependencies, Mermaid 12.1 syntax,
synchronous in Node). Measured there on 2026-10-28: 1,490 of 1,495 corpus blocks rendered in
1.6 s, and every block Pele rejected is also rejected by Mermaid 11.

## Decision

- **Pele 1.12.0 is the only Mermaid renderer in Agentbox; Mermaid stays the source syntax.**
  Pinned by npm integrity `sha512-3OdOK6rv…BiQ==` (`lib/pele.nix`) and by the sha256 of
  `dist/pele.js` in `VERSION`, which `skills/diagrams-as-code/scripts/lib/pele-static.cjs`
  checks before every import. npm `pele` 1.0.0 is an unrelated 2020 package and is never accepted.
- **`pele-render`** (`scripts/pele-render.cjs`, run with the image's Node) renders a `.mmd`, or
  every fenced `mermaid` block of a `.md`, to static SVG: every Pele CSS variable is replaced by
  its declared default, so the file needs no stylesheet. Options: `--check` (parse only), `-o`,
  `-t light|dark`, `-b`, `-w`, `-q`, `-V`. Failures exit non-zero with `file:line` and Pele's caret
  snippet. PNG goes through the image's ImageMagick (`[media].imagemagick`) or is refused; PDF has no renderer (convert the SVG).
- **`mmdc` stays as a name, not an engine.** `scripts/mmdc-pele.cjs` accepts `-i -o -e -t -w -b -q`
  and refuses by name the options Pele cannot honour (`-H -s -c -C -I -p -f`, themes `forest` and
  `neutral`, pdf output). `[skills.docs].mermaid` gates both commands.
- **browsercontainer no longer renders Mermaid.** `@mermaid-js/mermaid-cli`, its Puppeteer config
  and `/render-mermaid` are removed; the exchange volume stays. This takes effect at the
  operator's next rebuild of that sidecar; until then the old endpoint exists and nothing calls it.
- **Gate renders use `{ responsive: false, autoDirection: false }`** and the 4500 px ceiling stays,
  measured on Pele's layout. The diagrams-as-code generator carries its own vendored copy
  (`scripts/vendor/pele`, `scripts/lib/pele-static.cjs`) so it stays zero-dependency when copied.
- A bare `;` in sequence text is rejected by Pele and by Mermaid 11 alike.

## Consequences

- No browser, Puppeteer, sidecar or exchange-volume hop in the render path; `--check` makes a
  rendering probe cheap, so the artifact probe now parses a trivial diagram instead of `--help`.
- Layout and style are Pele's own and differ from GitHub's native Mermaid rendering; widths are not
  comparable with earlier `mmdc` numbers. A Pele-only gate cannot catch a 12.1 construct that GitHub's
  older Mermaid rejects.
- The mermaid-cli lockfile, its Renovate rule and its upstream-release checks are gone. A Pele bump is
  deliberate: change `lib/pele.nix` and the vendored copy together, then rerun the corpus gate and
  `tests/cli/pele-render.test.mjs`.
- Nix derivation (`lib/pele.nix`) and the browsercontainer image change need the operator's rebuild; the
  scripts, skills and tests work from the repository today.

## Verification

Partial, staged. At the implementing commits (verified_commit): `node --test tests/cli/pele-render.test.mjs`
(9 pass), `node --test skills/diagrams-as-code/scripts/diagram-index-gen.test.cjs` (23 pass, including `--render`
through Pele and a Pele parse error), `node --test` over `skills/sealmap-review/scripts/*.test.cjs` (15, 9 and 43
pass), `cargo test` in `services/skill-tools` (98) and `services/agentbox-ops` (212), `bash skills/lint-skills.sh`,
`node scripts/adr-index-gen.js docs/adr --check`, and `ENABLE_MERMAID=true bash tests/artifact-probes/mermaid-probe.sh`
with the scripts on `PATH`. Not verified: `nix build` of `lib/pele.nix` and the rebuilt browsercontainer image (no Nix
evaluator in the authoring environment). ADR-2152 is superseded; its verified_commit is the last commit where its
partial claim held. Cites VisionFlow ADR-2020.

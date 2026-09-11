# Skills-estate audit — live probe fact sheet (2026-09-09, queen-verified)

Scope: MASTER COPY ONLY at /home/devuser/workspace/project/agentbox/skills (bakes to /opt/agentbox/skills on the
next image build). Do NOT touch /opt/agentbox/skills, ~/.claude/skills, ~/.codex/skills (running copies).

## Estate shape
- 128 skill dirs with SKILL.md. Headline counts drifted: SKILL-DIRECTORY.md + agentbox CLAUDE.md say 127,
  registered-skills.txt prose says "115 baked", ADR-2056 says 126. `node scripts/skill-count-check.js` is RED (exit 1).
- Registration model: registered-skills.txt lists 22 skills that are symlinked into ~/.claude/skills at boot
  (always in the Claude Code native Skill list). The other 106 are "reference-only", reached via
  SKILL-DIRECTORY.md → skill-router (/route) → references/routing-table.md → lazy-fetch.
- Codex (GPT-6 Astra) side: ~/.codex/skills holds ONLY two hand-made symlinks (codebase-video, repo-education)
  pointing at the workspace tree, not the baked tree. No reconciler, no manifest, no parity with Claude registration.
  Codex CLI runs baked at /opt/agentbox/plugins/codex-plugin-cc; ~/.codex/AGENTS.md is the Codex global prompt.
- lint: `bash skills/lint-skills.sh` (exec lint-skills.mjs) → currently OK, 40 suppressed. Checks only: banned
  stale strings, ~/.claude/skills abs paths, /workspace path, frontmatter name+description non-empty, >250-line
  entry needs non-empty references/, cited references|scripts|assets paths exist. It does NOT check: name==dir,
  description length/quality, cross-skill references, model-name staleness, key vocabulary, duplication.
- Governance: ADR-2021 (skills are JIT context; depth in references/), ADR-2056 (facts must be checkable;
  router fixture tests/fixtures/skill-router-prompts.json has a consumer test which passes 4/4).
- Discovery docs: SKILL-DIRECTORY.md (916 lines, "Updated 2026-07-22" header, 25 categories + decision tree).
  5 skills on disk never named in it: payment-router, podcast-bulk-ingest, podcast-knowledge-ingest,
  repo-education, youtube-transcript-archiver. 15 deprecated names listed there have no dir (fine, they're the
  deprecated table). skill-router/references/routing-table.md claims to be "generated" but NO generator script
  exists; it is missing 38 skills (agentdb-learning autoresearch bencium-impact-designer
  bencium-innovative-ux-designer book-publishing ceramic-search codeact deep-research diagram-design dream-machine
  email-search expel-lesson-extractor gcloud godot-development hermes-scheduler latex-book leptos meta-xr-sdk
  ontology-augment open-design payment-router pdf-signing podcast-bulk-ingest podcast-knowledge-ingest
  prose-sanitiser provenance-tracking repo-education ruvnet-brain security-testing skill-tuning spark-scene
  token-audit tree-search-coder uk-solar-planner voyager-skill-library web-researcher youtube-transcript-archiver).

## Contract contradictions already verified
- skill-builder/SKILL.md (the meta-skill that teaches authoring) says: name = "Title Case" display name max 64
  chars; "no other frontmatter fields are recognised"; layout uses sibling REFERENCE.md/EXAMPLES.md/resources/;
  directory "must sit directly under ~/.claude/skills". ALL of that contradicts the estate's own lint/ADR-2021
  (depth lives in references/, skills bake at /opt/agentbox/skills), the ruflo SKILL.md validator
  (name must match /^[a-z][a-z0-9-]*$/ and equal the directory name; recommends version/author/tags), and the
  agentskills.io open standard (lowercase-hyphen name matching dir; optional license/compatibility/metadata/
  allowed-tools). Fable/Codex both consume the standard frontmatter.
- 7 skills carry Title-Case names ≠ dir: cost-estimation("Cost Estimation"), leptos("Leptos"),
  ontology-augment("Ontology Augment"), paperbanana("PaperBanana"), rust-development("Rust Development"),
  skill-builder("Skill Builder"), skill-tuning("Skill Tuning").
- Frontmatter key vocabulary is uncontrolled: 50 distinct keys. version(58) author(36) tags(32) mcp_server(21)
  protocol(19) entry_point(19) triggers(16) env_vars(15) dependencies(15) category(12) related_skills(7)
  status(5) metadata(5) license(5) depends_on_mcps(5) user-invocable(4) compatibility(4) … and 25 singletons
  (cron, gate, layer, port, priority, difficulty, estimated_time, authority_class, …). allowed-tools: none.
- Descriptions: 1041 chars max (explainer), many folded `>` blocks; agentskills.io caps description at 1024
  and name at 64. Descriptions are the ONLY always-loaded text for the 22 registered skills, and the routing
  substrate for the rest.

## Divergence / duplication clusters (lexical + structural signals; auditors must judge)
- "Explain this codebase" cluster, all authored 2026-09-05..09 in three different shapes with no shared
  contract: explainer (docs bundle + RuVector kb, forks, gates A–E), codebase-video (MP4 + ComfyUI hero clips,
  Kokoro TTS), repo-education (microsite, pins DIRECT the connected node Qwen on ${CONNECTED_NODE_HOST} bypassing the Loom façade on
  :8084 — the workspace CLAUDE.md says consumers must hold the Loom façade, not the raw model port), plus
  open-montage (vendored generic video pipeline, 11 pipelines/49 tools, premium API keys) and docs-alignment.
  explainer and repo-education are ISOLATED in the cross-reference graph (no skill links to them).
- Browser: browser, browser-automation, chrome-cdp, playwright, qe-browser (5 skills, Jaccard 0.50 for the
  top pair) — all registered; agentbox.toml says playwright=false/superseded.
- Research: perplexity-research, ceramic-search, web-researcher, deep-research, web-summary,
  gemini-url-context, scrapling, notebooklm.
- Diagrams: diagram-design(566 lines), mermaid-diagrams, fossflow, paperbanana, art.
- Documents: report-builder, latex-documents, latex-book, book-publishing.
- Design: open-design, design-audit, ui-ux-pro-max-skill, typography, daisyui, bencium-* (6, incl. 2
  deprecated stubs still on disk), relationship-design, renaissance-architecture.
- Orchestration: swarm-advanced, hive-mind-advanced, stream-chain, hooks-automation, sparc-methodology,
  build-with-quality, performance-analysis.
- Memory: agentdb-advanced, agentdb-learning(deprecated stub), agentdb-memory-patterns, agentdb-vector-search,
  ruvector-catalog, ruvnet-brain, lazy-fetch, codebase-memory.
- Podcast: podcast-bulk-ingest vs podcast-knowledge-ingest (Jaccard 0.50), youtube-transcript-archiver.
- Cloud stubs: flow-nexus-neural/platform/swarm ("NOT INSTALLED").
- Codex: openai-codex (MCP bridge) vs codex-companion (vendored openai/codex-plugin-cc copy; the SAME plugin is
  separately baked at /opt/agentbox/plugins/codex-plugin-cc). codex-companion carries a nested skill
  skills/gpt-5-4-prompting (name says GPT-5.4; estate model is gpt-6-astra) and ~1,976 stale model-name hits
  under promotions/ (rejects/proposals) — check whether that tree is vendored data or rot.
- 24 skills are isolated in the cross-reference graph: adaptive-communication art bencium-code-conventions
  bencium-impact-designer bencium-innovative-ux-designer cost-estimation diagram-design email-search explainer
  flow-nexus-platform fossflow gcloud hermes-scheduler hooks-automation jupyter-notebooks negentropy-lens
  payment-router pdf-signing prose-sanitiser repo-education ruvector-catalog token-audit uk-solar-planner
  youtube-transcript-archiver.
- SKILL.md files that themselves carry stale model ids: codex-companion, explainer (lineage note about
  gpt-4o — factual), youtube-transcript-archiver, skill-tuning.

## Live infrastructure facts (so staleness is evidence, not guesswork)
- Current models: Claude Fable 5.1 (claude-fable-5-1, adaptive thinking always on), Opus 5, Sonnet 5,
  Haiku 4.5; OpenAI GPT-6 Astra (gpt-6-astra) via baked Codex CLI; DeepSeek; Z.AI glm-5.3 consultant.
  Any "Opus 4.x / Sonnet 4.x / GPT-5.x / gpt-4o / o3" as a CURRENT model is stale (historical mentions OK).
- LLM endpoints: Ontology Loom façade ${LOOM_BASE_URL} (the door consumers must hold);
  raw model 127.0.0.1:8085 ON the connected node ONLY (not a consumer target); embeddings bge-small-en-v1.5 384-dim via
  Xinference ${EMBEDDINGS_HOST}; the connected node's old a retired address is DEAD. Memory access is mcp__claude-flow__memory_*
  ONLY (CLI/SQL bypass embeddings).
- Browser automation: browsercontainer sidecar, MCP SSE http://browsercontainer:8931/sse (registered as
  browser-gpu), CDP browsercontainer:9223 via socat (agentbox.toml still says 9222), VNC :5903.
  Local Playwright/agent-browser are deprecated.
- Runtime: HOME=/home/devuser, $WORKSPACE=/home/devuser/workspace; literal /workspace retired; no pseudo-users
  (openai-user etc. retired); supervisord runs programs as devuser; python3 not a boot dependency.
- MCP registry skills/mcp.json: 28 servers (aci-shell code-interpreter claude-flow ruv-swarm imagemagick qgis
  browser-gpu web-summary comfyui blender gemini-url-context notebooklm linkedin defense-security reddit
  meta-xr-sdk unreal-engine clipcannon scrapling context7 codebase-memory consultant-codex consultant-antigravity
  consultant-zai consultant-perplexity web-researcher consultant-deepseek perplexity).
- Manifest gates (agentbox.toml [skills.*]): browser.agent_browser=true(!) playwright=false qe_browser=true;
  media ffmpeg=true imagemagick=true comfyui_builtin=false; spatial qgis=true blender=true
  gaussian_splatting=false; data_science pytorch=true jupyter=true; docs latex/report_builder/mermaid=true;
  design.open_design=true; research.web_researcher=true; code_interpreter.enabled=true.

## Model-fit lens (what "works well with Fable and GPT-6 Astra" means here)
- Fable 5.1: adaptive thinking always on; wants concise directive prose, explicit GOAL/CONSTRAINTS/VERIFY
  blocks for complex work, permission to batch independent tool calls, no forced tool choice, targeted edits
  over whole-file rewrites, "search memory before / store after". Skills that narrate at length, restate
  generic engineering advice, or hard-code an older model's quirks waste the entry budget.
- GPT-6 Astra via Codex: consumes the same SKILL.md (agentskills.io standard); prefers structured XML-tagged
  prompts with explicit output contracts and verification loops; does NOT have Claude-only affordances
  (Agent/fork tool, Artifact tool, Skill tool, `/route`, claude-flow hooks). A skill that is Claude-only should
  say so in one line; a skill meant for both must not assume Claude-only tools without a fallback.
- Both: a description is a trigger contract — what + when + when-not, keywords front-loaded, ≤1024 chars,
  no marketing.

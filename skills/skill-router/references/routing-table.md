# skill-router — Routing Table (generated)

> **Generated artefact — do not hand-edit.** Produced by `skills/gen-routing-table.mjs`
> from every skill's frontmatter `description` and `skill-router/references/section-map.json`.
> Regenerate after any description change: `node skills/gen-routing-table.mjs`.
> `bash skills/lint-skills.sh` fails when this file is stale (`--check`).
>
> This table covers the skills estate. Consultant MCP tools (consultant-codex,
> consultant-deepseek, consultant-perplexity, consultant-zai, consultant-antigravity) are
> not skills; route to them directly via their `consult` tool when a second model opinion is wanted.

Skills: 123 active, 5 deprecated redirects. Sections mirror SKILL-DIRECTORY.md Artefact 1.

## How to route

1. Classify the request against the section headings below.
2. Within the section, match the request against each row's description (the same text the skill self-triggers on).
3. Clear match → dispatch. Two plausible rows → ask one question. Multi-step → name the sequence and start the first.

## 3D and Game Development

| Skill | Route when (from the skill's own description) |
|---|---|
| `blender` | Meta-skill for driving Blender via BlenderMCP: 3D modelling (box, hard-surface, boolean), digital sculpting, PBR material authoring, lighting, rendering, and … |
| `game-dev` | Game development studio for Godot (native), Unity, and Unreal projects — design, programming, art, audio, QA, production, and multi-agent team orchestration. … |
| `godot-development` | Single-agent Godot 4 work: write/debug GDScript or C# scripts, edit scenes and node systems, wire signals, physics, navigation, shaders, export builds, … |
| `lichtfeld-studio` | Drive LichtFeld Studio (native C++/CUDA 3D Gaussian Splatting workstation) via its built-in MCP server. Use when training, rendering, editing, or exporting 3D … |
| `meta-xr-sdk` | Build VR/AR apps for Meta Quest (2/3/3S/Pro) — WebXR in the browser and Quest-native spatial apps. Use when building immersive WebXR with Three.js or React … |
| `spark-scene` | Integrate Spark Gaussian splats into a Three.js browser scene with spatial annotations, evidence links, or graph overlays. Use for viewing trained captures … |
| `terracraft` | Generate Minecraft Java Edition worlds from real-world geographic data. Converts OpenStreetMap buildings, roads, water, and terrain into playable Minecraft … |
| `unreal-engine` | Unreal Engine 5 automation via 60+ MCP tools. Spawn actors, edit Blueprints, inspect materials, run PIE sessions, capture screenshots, profile performance, … |

## AI/ML and Neural Networks

| Skill | Route when (from the skill's own description) |
|---|---|
| `codex-companion` | OpenAI Codex / GPT-6 Astra integration for Claude Code. Use when the user says "consult with openai", "talk to codex", "ask gpt-6", "get a second opinion from … |
| `cuda` | AI-powered CUDA development with 4 specialist agents (General, Optimizer, Debugger, Analyzer) plus an MCP toolset. Use when writing CUDA kernels (.cu/.cuh), … |
| `deepseek-reasoning` | Use when the user says "ask deepseek", "consult deepseek", "delegate reasoning to deepseek", or wants a second opinion / an explicit chain-of-thought reasoning … |
| `flow-nexus-neural` | Train distributed neural networks (feedforward, LSTM, GAN, transformer) in E2B cloud sandboxes via Flow Nexus, no local GPU. Use when a task needs cloud-fleet … |
| `openai-codex` | Delegate a coding or reasoning task to OpenAI Codex (GPT-6 Astra) via MCP for a second opinion from a non-Claude model. Use when you want to cross-check a hard … |
| `pytorch-ml` | Train and fine-tune deep learning models in PyTorch with CUDA GPU acceleration — nn.Module definition, training loops, DataLoaders, checkpointing, … |

## Browser Automation and Web

| Skill | Route when (from the skill's own description) |
|---|---|
| `browser` | Drive a real Chrome via the browsercontainer sidecar over MCP SSE. Use when a task needs a live browser — navigate, click, fill forms, screenshot, read the … |
| `browser-automation` | Router for browser-automation tasks — picks the right tool and points to the canonical sidecar setup. Use when driving a real browser: navigating pages, … |
| `chrome-cdp` | Raw Chrome DevTools Protocol scripting against a live Chrome session — direct WebSocket, no Puppeteer. Use when you need low-level CDP access: WebGPU/WebGL GPU … |
| `host-webserver-debug` | Trigger on "https bridge", "CORS error accessing host", "debug host webserver", "reach host dev server from container", or needing a secure-context (HTTPS) … |
| `playwright` | Browser automation, web scraping, visual testing, and WebGPU validation via the browsercontainer sidecar (chrome-devtools-mcp, 40+ tools). Use for navigating … |
| `qe-browser` | QE-grade browser testing with WebDriver BiDi (Vibium). 16 typed assertion kinds, pixel-perfect visual-diff baselines, 14-pattern prompt-injection scanner, … |
| `scrapling` | Adaptive web scraping framework with built-in MCP server (9 tools). Use when asked to scrape, crawl, or extract data from websites; when web_fetch fails; when … |

## Code Execution and Experiential Learning

| Skill | Route when (from the skill's own description) |
|---|---|
| `codeact` | Plan-execute-reflect loop over a persistent Python kernel (the `code-interpreter` MCP): write Python, execute, observe the returned trace (stdout / exception / … |
| `expel-lesson-extractor` | Fires as a post-task hook after a non-trivial completed task (3+ tool calls, observable terminal outcome) to distil 0-N generalisable IF/THEN lessons from the … |
| `tree-search-coder` | Execution-gated branching code generation (ADR-020 Surface 2). Generate N candidate solutions (default ≤5) by invoking `sparc:coder` with varied … |
| `voyager-skill-library` | Store and retrieve verified, executable Python skill primitives (a function plus assertions plus at least one example) in the code-harness procedural memory … |

## Code Quality, Review, and Verification

| Skill | Route when (from the skill's own description) |
|---|---|
| `docs-alignment` | Validate and align a whole documentation corpus against the codebase — broken-link/orphan detection, Diataxis structure, front-matter metadata, Mermaid diagram … |
| `explainer` | Turn a codebase into a proven, grounded explainer for people who did not build it: a docs bundle (three audience documents, a visual page, a queryable RuVector … |
| `prose-sanitiser` | De-slop prose for AI writing tells (lexical, structural, narrative), strip invisible-Unicode carriers and container provenance metadata (C2PA, EXIF, XMP, … |
| `security-testing` | Application security testing: OWASP Top 10 validation, authentication/authorisation testing, API security, dependency vulnerability scanning, secrets … |
| `verification-quality` | Verify an installed artifact against the signed witness manifest via `ruflo verify`, and read the real in-CI regression-guard stack (smoke tests, … |

## Communication & Decision Support

| Skill | Route when (from the skill's own description) |
|---|---|
| `adaptive-communication` | Calibrate response style to the user's communication register — transactional/direct vs relational/high-context — and decide whether to answer, explore, or ask … |
| `negentropy-lens` | Evaluate systems, architectures, and strategies through the entropy (decay) vs negentropy (growth) lens, surfacing tacit-knowledge gaps and unstated … |

## Context, Discovery, and Session Management

| Skill | Route when (from the skill's own description) |
|---|---|
| `codebase-memory` | Structural code-intelligence MCP for large codebases — trace call graphs, get architecture overviews, score git-diff impact, search symbols, and manage ADRs … |
| `lazy-fetch` | Context, persistence, and process-tracking companion for single-agent Claude Code sessions. Use when hydrating session context (git/plan/memory), tracking … |
| `skill-builder` | Author a new Claude Code / Codex Agent Skill or audit an existing one against the estate's adopted authoring contract: correct frontmatter (name/description … |
| `skill-router` | Unified dispatcher for the full skills estate. Use when you don't know which skill to invoke — describe your task and get routed to the optimal skill, agent … |
| `skill-tuning` | Empirically optimize any existing Claude skill against a measurable reward signal using a closed SkillOpt loop (rollout → reflect → aggregate → select → … |

## Data Science and Notebooks

| Skill | Route when (from the skill's own description) |
|---|---|
| `jupyter-notebooks` | Programmatically build and run Jupyter .ipynb notebooks end-to-end via the jupyter-notebooks MCP server — add/delete/move/update cells, execute cells or whole … |

## Development Methodology and Meta-Skills

| Skill | Route when (from the skill's own description) |
|---|---|
| `bhil-methodology` | AI-first development methodology with specification-driven artifact traceability. PRD → SPEC → ADR → TASK → CODE → REVIEW → DEPLOY pipeline with AI-native ADRs … |
| `build-with-quality` | Implement features with tests and quality gates, debug hard bugs, and stress-test designs. Use when building a feature with TDD/EDD, chasing a stubborn … |
| `prd2build` | PRD to complete documentation in a single command. Use when you have a PRD and need specs, DDD domain model, ADRs, and an implementation plan generated from it. |
| `sparc-methodology` | SPARC — a systematic 5-phase development lifecycle (Specification, Pseudocode, Architecture, Refinement, Completion) run through Claude Flow multi-agent … |

## Documentation and Reports

| Skill | Route when (from the skill's own description) |
|---|---|
| `art` | Complete visual content system for Claude Code. Use when generating blog headers, infographics, editorial art, diagrams, or comics. Default aesthetic: light … |
| `book-publishing` | Use when publishing a book, preparing an arXiv submission, formatting a manuscript for KDP, or turning a markdown manuscript into a print-ready PDF. End-to-end … |
| `diagram-design` | Create branded architecture, IT current-state, flowchart, sequence, state machine, ER/data model, timeline, swimlane, quadrant, radar/spider, loop/flywheel, … |
| `fossflow` | Generate isometric network-topology, infrastructure, and architecture diagrams as FossFLOW JSON (compact LLM-optimised format or full verbose SVG/JSON with … |
| `latex-documents` | Compile LaTeX documents to PDF - academic papers, theses, Beamer presentations, technical docs with math, bibliographies, and multi-file projects. Use when … |
| `mermaid-diagrams` | Diagrams-as-code routing hub. Two engines: (1) diagram-design — editorial-quality self-contained HTML/SVG diagrams with 28 visual types, branded design system, … |
| `paperbanana` | Generate publication-quality academic diagrams and statistical plots from text via a multi-agent VLM pipeline with iterative refinement (OpenAI or Google … |
| `pdf-signing` | Cryptographically sign PDFs (invoices, contracts, letters, forms) with open-source tooling — pyHanko applying a PAdES/eIDAS-aligned digital signature plus an … |
| `report-builder` | Generate publication-quality LaTeX reports — white papers, sector analyses, policy briefs, technical documentation — with data-driven charts, diagrams-as-code, … |
| `wardley-maps` | Comprehensive Wardley mapping toolkit that transforms any input (structured data, unstructured text, business descriptions, technical architectures, … |

## Geospatial

| Skill | Route when (from the skill's own description) |
|---|---|
| `qgis` | Geospatial analysis and GIS operations via QGIS. 51 MCP tools covering layer management, feature editing, processing algorithms, rendering, styling, plugin … |
| `uk-solar-planner` | Plan UK ground-mounted (utility-scale) solar farms end-to-end: site suitability, tilt and inter-row spacing, array capacity and annual yield, 3D layout with … |

## GitHub and CI/CD

| Skill | Route when (from the skill's own description) |
|---|---|
| `github-code-review` | Multi-agent code review for GitHub PRs. Use when reviewing a pull request, running security/performance/architecture/style checks on a diff, or coordinating … |
| `github-multi-repo` | Coordinate work across many GitHub repositories at once — org-wide dependency/security updates, package and doc version alignment, cross-repo refactors, and … |
| `github-project-management` | Use when creating GitHub issues, managing project boards, planning sprints, decomposing work into vertical-slice tracer bullets, or triaging an issue backlog … |
| `github-release-management` | Orchestrate GitHub releases end-to-end: version bumps, changelog/release-note generation, multi-platform builds, staged deployment, and rollback. Use when … |
| `github-workflow-automation` | Automate GitHub Actions workflows and CI/CD pipelines with claude-flow swarm coordination. Use when creating, optimizing, or debugging GitHub Actions workflow … |

## Media Processing

| Skill | Route when (from the skill's own description) |
|---|---|
| `clipcannon` | Local-GPU video understanding and editing via MCP — analyse footage, find the best moments, cut highlight reels, add captions, render platform-ready clips … |
| `codebase-video` | Create a complete audience-targeted video explainer of the current codebase, combining verified screenshots, diagrams, animation, locally generated ComfyUI … |
| `comfyui` | Generate AI images and video with ComfyUI's node-based workflows (FLUX, Stable Diffusion, video models) on a local GPU or distributed Salad Cloud compute. Use … |
| `echoloop` | Real-time AI meeting copilot. Dual audio capture (system + mic), live transcription (faster-whisper local or Deepgram cloud), LLM coaching loop (Claude/GPT … |
| `ffmpeg-processing` | Professional video and audio processing - transcode, edit, stream, and analyze media files. Use when transcoding, editing, streaming, or analysing video and … |
| `imagemagick` | Process and manipulate images with format conversion (PNG→JPG→WebP→GIF), resizing, cropping, filtering, batch operations, and image metadata extraction. Use … |
| `open-montage` | Agentic video production system. Describe a video idea in natural language; the agent orchestrates research, scripting, asset generation, editing, and … |

## Memory, Learning, and Intelligence

| Skill | Route when (from the skill's own description) |
|---|---|
| `agentdb-advanced` | Advanced AgentDB beyond single-database vector search: distributed QUIC sync across nodes, multi-database coordination and sharding, custom distance metrics, … |
| `agentdb-memory-patterns` | Implement persistent memory patterns for AI agents using AgentDB — session memory, long-term storage, pattern learning, hierarchical memory, consolidation, … |
| `agentdb-vector-search` | Use when building RAG pipelines, running semantic/similarity vector search, optimising search speed, tuning HNSW indexing or quantization, or scaling to … |
| `ruvector-catalog` | Architect's playbook and capability catalog for the RuVector monorepo (Rust crates, npm packages, WASM builds). Use when a task could be served by a RuVector … |
| `ruvnet-brain` | Source-grounded answers about the RuvNet ecosystem — ruflo, ruvector, safla, agentdb, agentic-flow, sparc and ~21 sibling repos. Use whenever a task asks how a … |
| `token-audit` | Use when the user asks where their Claude Code usage/tokens are going, is burning through their plan unexpectedly fast, hitting limits, or wants a breakdown of … |

## Ontology and Knowledge Graphs

| Skill | Route when (from the skill's own description) |
|---|---|
| `ontology-augment` | Ground agent reasoning in DreamLab's formal knowledge graph (5,975 OWL classes, Oxigraph/Whelk) via the pervasive ontology binding (PRD-020/ADR-112). Use when … |
| `ontology-core` | Author the vault knowledge-graph ontology (OntologyBlock entries) for OWL2 DL / VisionClaw. Use when writing or fixing OntologyBlock entries, sanitizing IRI … |
| `ontology-enrich` | Validate and enrich the vault knowledge-graph ontology. Use when fixing source-domain prefixes (ai/bc/mv/rb/tc/ngm), checking orphan is-subclass-of targets, or … |

## Performance

| Skill | Route when (from the skill's own description) |
|---|---|
| `performance-analysis` | Performance analysis, bottleneck detection, and optimisation for Claude Flow swarms. Use when profiling swarm performance, diagnosing slow agents, or tuning … |

## Platform Management

| Skill | Route when (from the skill's own description) |
|---|---|
| `cost-estimation` | Estimate GPU endpoint costs, agent job costs, and MRC20 token operations for the DreamLab AI ecosystem. Use when pricing inference/image-gen/analytics … |
| `dream-machine` | Control and inspect the nightly dream machine — the dream-engine loop that runs evidence-gated repository evolution overnight (ADR-052). Use when the user says … |
| `flow-nexus-platform` | Manage Flow Nexus cloud platform resources — authentication, E2B sandboxes, app/marketplace deployment, credits & billing, coding challenges. Use when a task … |
| `gcloud` | Google Cloud CLI (gcloud/gsutil/bq) for GCP operations from agentbox: Compute Engine VMs, Identity-Aware Proxy (IAP), Secret Manager, Cloud Run, Artifact … |
| `hermes-scheduler` | Schedule recurring agent tasks on cron/interval/one-shot schedules — start with /hermes-scheduler. Triggers: 'run this every 30m', 'schedule a daily 9am job', … |
| `payment-router` | Wrap outbound fetch with a transparent HTTP 402 detect-classify-pay-retry loop so a skill or adapter can call cost-gated external resources without inline … |

## Research Workflows (adapted from Feynman methodology)

| Skill | Route when (from the skill's own description) |
|---|---|
| `autoresearch` | Autonomous experiment loop that tries ideas, measures results, keeps what works, and discards what doesn't. Use when the user asks to optimize a metric, run an … |
| `deep-research` | Fan-out multi-agent web research that cross-checks claims against independent sources and produces a cited research brief with a verifier and reviewer pass. … |
| `provenance-tracking` | Add provenance tracking to any research or analysis output. Use when you need source verification, citation tracking, or evidence chains. Creates a … |

## Security and Compliance

| Skill | Route when (from the skill's own description) |
|---|---|
| `defense-security` | Linux defensive security with 31 modules and 250+ actions. Firewall management, system hardening, compliance auditing (CIS/HIPAA/SOC2), malware scanning, … |

## Software Architecture and Strategic Review

| Skill | Route when (from the skill's own description) |
|---|---|
| `architecture-studio` | AEC (Architecture, Engineering, Construction) studio for building and site work. Use when designing a building, planning or assessing a site, running NYC … |
| `bencium-aeo` | Generate AEO-optimized content (Answer Engine Optimization) for AI search visibility - ChatGPT, Claude, Gemini, AI Overviews. Use when optimizing websites for … |
| `bencium-code-conventions` | Bence's personal code style, tech stack, and workflow conventions for his own projects. Use ONLY when the active project is identified as Bence's own … |
| `human-architect-mindset` | Systematic architectural thinking for the decisions AI can't own — domain modeling, systems thinking, constraint navigation, AI-aware decomposition. Use when … |
| `renaissance-architecture` | First-principles architecture and UI/UX guidance for building genuinely new software rather than derivative "X-but-for-Y" work. Use when designing or … |
| `vanity-engineering-review` | Identifies code, architecture, and technical decisions built to impress rather than to ship. Use when checking for over-engineering, unnecessary complexity, or … |

## Swarm and Multi-Agent Orchestration

| Skill | Route when (from the skill's own description) |
|---|---|
| `flow-nexus-swarm` | Deploy and coordinate cloud AI swarms on Flow Nexus infrastructure (event-driven workflows, message-queue processing, scale-out agent coordination). Use when a … |
| `hive-mind-advanced` | Queen-led multi-agent coordination in Claude Flow — one strategic queen directs specialized workers through structured voting and shared persistent memory. Use … |
| `hooks-automation` | Automate coordination, formatting, and learning around Claude Code operations with claude-flow hooks. Use when setting up pre/post task hooks, session handoffs … |
| `stream-chain` | Sequential multi-agent pipelines and data transformation via Claude Flow MCP workflow tools. Use when step N's output must feed step N+1's input … |
| `swarm-advanced` | Advanced swarm orchestration patterns for research, development, testing, and complex distributed workflows. Use when: (1) running 3+ parallel agents locally, … |

## Systems Programming

| Skill | Route when (from the skill's own description) |
|---|---|
| `leptos` | Opinionated playbook and current reference for building full-stack web apps in Leptos (the Rust fine-grained-reactive framework). Use whenever the task … |
| `rust-development` | Complete Rust toolchain with cargo, rustfmt, clippy, and WASM support. Use when writing Rust code, running cargo build/test/clippy, compiling to WASM, or … |
| `wasm-js` | High-performance WebAssembly graphics with JavaScript interoperability. Use when building performance-critical web graphics, real-time animations, … |

## UI/UX Design

| Skill | Route when (from the skill's own description) |
|---|---|
| `bencium-controlled-ux-designer` | Collaborative UI/UX design guidance for building unique, accessible, non-generic web interfaces. Use when building or styling web components, pages, or apps … |
| `bencium-creative` | Consolidated creative UI/UX skill combining design vision and production-grade implementation. Two modes: --design (ask-first, bold creative direction) and … |
| `daisyui` | Build UI components with daisyUI (Tailwind CSS component library). Provides theme configuration, component patterns, and MCP server integration for accurate … |
| `design-audit` | Systematic visual UI/UX audit that produces phased, implementation-ready design plans, plus focused single-objective refinement passes ("lenses"). Use when the … |
| `open-design` | Generate brand-constrained, quality-gated visual artifacts instead of freestyle output. Use when the user asks for a web prototype, landing/marketing page, … |
| `relationship-design` | Design AI-first interfaces around ongoing user relationships — persistent memory, graduated trust, and human+AI collaborative planning — instead of isolated … |
| `typography` | Correct typographic detail — curly quotes, en/em dashes, single spacing, hierarchy, line length, and layout — in generated or reviewed UI code. Use when … |
| `ui-ux-pro-max-skill` | UI/UX design intelligence for web and mobile: recommends styles, colour palettes, font pairings, layouts, and chart types, plus stack-specific implementation … |

## Version Control (AI-Native)

| Skill | Route when (from the skill's own description) |
|---|---|
| `agentic-jujutsu` | Lock-free version control for multiple AI agents committing concurrently to the same repo, built on Jujutsu (jj). Use when several agents need to … |

## Web Research and Content

| Skill | Route when (from the skill's own description) |
|---|---|
| `ceramic-search` | Keyword web search that returns long page extracts for grounding an LLM in dense source context rather than a synthesized answer. Use when you need exact-match … |
| `context7` | Version-specific documentation for 800+ libraries via Context7 MCP. Two tools: resolve-library-id (library name → canonical ID) and query-docs (ID + query → … |
| `email-search` | Search and answer questions about the owner's private personal email archive via the local Private Email MCP Gateway. Use when the user asks anything that … |
| `gemini-url-context` | Expand and analyze URLs using Google Gemini 3.8 Flash URL Context API. Efficiently fetches, summarizes, and extracts information from up to 20 URLs per request … |
| `linkedin` | LinkedIn integration via MCP for profile scraping, job search, messaging, company analysis, and people search. Uses Patchright browser automation with … |
| `notebooklm` | Trigger when creating Google NotebookLM notebooks, ingesting sources (URLs, PDFs, YouTube, Drive, text), chatting with those sources, or generating NotebookLM … |
| `perplexity-research` | Live web research through Perplexity's closed synthesis engine — structured web results, deep multi-step investigations with reasoning, and quick sonar … |
| `podcast-bulk-ingest` | Bulk backfill markdown transcript files for a YouTube podcast series. Downloads transcripts, show notes, and links for all episodes in a date range, then runs … |
| `podcast-knowledge-ingest` | Trigger on "/podcast-ingest", "weekly podcast ingest", "process new podcast episodes into the ontology", or setting up/debugging the podcast-cron schedule. … |
| `reddit` | Reddit integration for browsing subreddits, searching content, analyzing user profiles, and fetching post details with comment threads. Supports anonymous, … |
| `toprank` | AI-powered SEO/SEM automation suite with 6 specialised skills. Google Search Console integration, content writing (E-E-A-T), keyword research, meta tag … |
| `web-researcher` | Multi-source web research via the web-researcher-mcp Go server — you pick the search ENGINE and the trusted SOURCES, and every citation is a real, checkable … |
| `web-summary` | Summarise a single web page or YouTube video into short/medium/long notes and extract semantic topic links for an Obsidian vault. Trigger when the user says … |
| `youtube-transcript-archiver` | Batch-download YouTube channel transcripts, show notes, and links as markdown files. Enriches each file with source extraction from transcripts, cross-checked … |

## Deprecated redirects

| Skill | Use instead |
|---|---|
| `agentdb-learning` | `agentdb-advanced` |
| `bencium-impact-designer` | `bencium-creative` |
| `bencium-innovative-ux-designer` | `bencium-creative` |
| `latex-book` | `book-publishing` |
| `repo-education` | `explainer` |

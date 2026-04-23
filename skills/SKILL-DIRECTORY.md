# Skill Directory -- Comprehensive Inventory and Decision Tree

> **92 active skills**. 18 formerly deprecated/archived skills removed (see table below for history).
> Updated 2026-04-13. Reference this file from CLAUDE.md for intelligent routing.

---

## Deprecated and Archived Skills (DO NOT USE)

| Skill | Status | Replacement |
|-------|--------|-------------|
| `agentdb-learning` | DEPRECATED | `agentdb-advanced` (RL section) |
| `agentdb-optimization` | DEPRECATED | `agentdb-vector-search` |
| `bencium-impact-designer` | DEPRECATED | `bencium-creative` |
| `bencium-innovative-ux-designer` | DEPRECATED | `bencium-creative` |
| `pair-programming` | DEPRECATED | `build-with-quality` |
| `perplexity` | DEPRECATED | `perplexity-research` |
| `reasoningbank-agentdb` | DEPRECATED | `build-with-quality` |
| `reasoningbank-intelligence` | DEPRECATED | `build-with-quality` |
| `swarm-orchestration` | DEPRECATED | `swarm-advanced` |
| `v3-cli-modernization` | ARCHIVED | Reference only (v3 shipped) |
| `v3-core-implementation` | ARCHIVED | Reference only (v3 shipped) |
| `v3-ddd-architecture` | ARCHIVED | Reference only (v3 shipped) |
| `v3-integration-deep` | ARCHIVED | Reference only (v3 shipped) |
| `v3-mcp-optimization` | ARCHIVED | Reference only (v3 shipped) |
| `v3-memory-unification` | ARCHIVED | Reference only (v3 shipped) |
| `v3-performance-optimization` | ARCHIVED | Reference only (v3 shipped) |
| `v3-security-overhaul` | ARCHIVED | Reference only (v3 shipped) |
| `v3-swarm-coordination` | ARCHIVED | Reference only (v3 shipped) |

---

## Artefact 1: Categorised Skill Inventory (88 Active Skills)

### Context, Discovery, and Session Management

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `skill-router` | No | **Unified dispatcher** for 89 skills. `/route [task]` classifies intent and routes to optimal skill. Single entry point | Don't know which skill to use — describe your task and get routed |
| `lazy-fetch` | Yes | 25 MCP tools: context hydration, plan tracking, blueprints, PRD-to-sprints, security scanning, persistent memory | Starting a new session, managing context across tasks, tracking phased plans, running autonomous PRD execution |
| `skill-builder` | No | Create new Claude Code skills with YAML frontmatter and progressive disclosure | Building new custom skills for the skills directory |
| `codebase-memory` | Yes | 14 MCP tools: call graph tracing, architecture overview, git diff risk scoring, symbol search. 99.2% token reduction vs grep. Persistent SQLite index. **One-time index → permanent session upgrade** | Large codebase structural analysis (500+ files), call chains, diff blast radius, architecture overview |

### Development Methodology and Meta-Skills

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `build-with-quality` | No | 111+ agents, unified dev+QE, TDD, ADR, quality gates, SONA learning, TinyDancer routing. **Supersedes** pair-programming, reasoningbank-*, agentic-qe | Any multi-file feature, refactor, or project needing quality gates, coverage, and testing |
| `sparc-methodology` | No | SPARC 5-phase development (Specification, Pseudocode, Architecture, Refinement, Completion), 17 modes | Systematic multi-phase development from spec through deployment |
| `prd2build` | No | PRD to complete documentation in a single command | Generating full project documentation from a product requirements document |
| `bhil-methodology` | No | AI-first specification-driven methodology: PRD→SPEC→ADR→TASK traceability, AI-native ADRs (model/prompt/agent), eval suites, guardrails | Starting new features, architecture decisions, sprint planning, quality gates, artifact traceability |

### Code Quality, Review, and Verification

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `github-code-review` | No | Multi-agent AI code review, security/performance analysis, quality gates | Reviewing PRs on GitHub with specialised review agents |
| `verification-quality` | No | Truth scoring (0.0-1.0), automatic rollback at 0.95 threshold, CI/CD export | Ensuring code correctness with truth-score verification and auto-rollback |
| `docs-alignment` | No | 15-agent swarm for documentation validation, Diataxis framework, link coverage, Mermaid diagrams | Validating and modernising project documentation against codebase |

### Testing and QA

Testing is integrated into `build-with-quality` (TDD agents) and `sparc-methodology` (TDD mode). No standalone testing skill exists. For truth-score verification, use `verification-quality`.

### GitHub and CI/CD

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `github-code-review` | No | Swarm-coordinated PR review, security/performance analysis | Reviewing pull requests |
| `github-multi-repo` | No | Cross-repo coordination, package sync, architecture management | Managing multiple repositories in an organisation |
| `github-project-management` | No | Issue tracking, project boards, sprint planning with swarm agents | Agile project management on GitHub |
| `github-release-management` | No | Automated versioning, changelog, multi-platform deployment, rollback | Cutting releases and managing deployments |
| `github-workflow-automation` | No | GitHub Actions CI/CD pipeline creation and management | Creating or modifying GitHub Actions workflows |

### Swarm and Multi-Agent Orchestration

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `swarm-advanced` | No | Advanced swarm patterns: mesh, hierarchical, adaptive topologies, fault tolerance | Local multi-agent orchestration for research, dev, and testing |
| `hive-mind-advanced` | No | Queen-led hierarchical coordination, Byzantine consensus, collective memory | When you need consensus-driven multi-agent decisions |
| `flow-nexus-swarm` | No | Cloud-based AI swarm deployment, event-driven workflows, message queues | Deploying swarms on Flow Nexus cloud infrastructure |
| `stream-chain` | No | Sequential multi-agent pipelines where output chains between steps | When each agent's output feeds the next (sequential, not parallel) |
| `hooks-automation` | No | Pre/post task hooks, session management, Git hooks, neural training | Automating development operations with intelligent hooks |

### Memory, Learning, and Intelligence

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `agentdb-advanced` | No | QUIC sync, multi-database, custom distance metrics, hybrid search, MMR diversity, **9 RL algorithms** (Decision Transformer, Q-Learning, SARSA, Actor-Critic, Federated, etc.) | Distributed AI systems, cross-network AgentDB sync, self-learning agents with RL |
| `ruvector-catalog` | No | Architect's playbook for 200+ RuVector capabilities across 14 domains, migration paths, 3 access paths (npm/WASM/NAPI) | "What RuVector tools can help with X?", technology recommendations, migration from aging tech |
| `agentdb-memory-patterns` | No | Session memory, long-term storage, pattern learning, context management | Stateful agents, chat systems, intelligent assistants |
| `agentdb-vector-search` | No | HNSW indexing (150x faster), quantization, caching, batch ops, RAG pipelines | Semantic search, RAG systems, scaling to millions of vectors |

### AI/ML and Neural Networks

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `pytorch-ml` | No | PyTorch, CUDA GPU, data science stack, distributed training | Deep learning model training and research |
| `cuda` | Yes | 4 specialist agents, kernel optimisation, compilation, GPU profiling | Custom CUDA kernel development and GPU programming |
| `flow-nexus-neural` | Yes | Distributed neural network training in E2B sandboxes (feedforward, LSTM, GAN, transformer) | Training models in cloud sandboxes via Flow Nexus |
| `deepseek-reasoning` | Yes | DeepSeek special model endpoint, structured chain-of-thought, multi-step reasoning | Complex reasoning tasks requiring DeepSeek's reasoning model |
| `openai-codex` | Yes | GPT-5.4 code generation and review via MCP bridge | Delegating specific tasks to GPT-5.4 capabilities |
| `codex-companion` | No | Full OpenAI Codex plugin: code review, adversarial review, rescue agent, GPT-5.4 structured prompting, stop-review gate | Cross-model validation, when Claude is stuck, adversarial design review, substantial code delegation |

### Browser Automation and Web

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `browser-automation` | No | **Meta-skill**: decision framework for choosing between 6 browser tools + Claude in Chrome (official) | Unsure which browser tool to use -- start here |
| `browser` | No | agent-browser with AI-optimised snapshots, 93% context reduction via @refs | Quick form filling, scraping, navigation with minimal context |
| `playwright` | Yes | Full Playwright API, screenshots, visual testing on Display :1 via VNC | Visual testing, complex automation, screenshot verification |
| `qe-browser` | No | **Vibium** (WebDriver BiDi, W3C standard, 10MB vs 300MB Playwright). 16 typed assertion kinds, multi-step batch pre-validation, pixel-perfect visual-diff baselines, 14-pattern prompt-injection scanner, 15-intent semantic element finder (`submit_form`, `accept_cookies`, `primary_cta`, …). Part of AQE fleet — installed via `aqe init`. 11 QE skills delegate to it (a11y, visual, security, localization, etc.) | QE-grade browser testing with typed assertions and visual regression; AQE fleet integration; when Playwright is too heavy |
| `chrome-cdp` | No | CDP CLI for live Chromium sessions, 100+ tabs, no Puppeteer dependency | Inspecting already-open browser tabs, logged-in sessions |
| `host-webserver-debug` | Yes | HTTPS-to-HTTP bridge for debugging host web servers from Docker | Cross-origin/CORS issues when accessing host dev servers |
| `scrapling` | Yes | Adaptive web scraping: 9 MCP tools, Cloudflare Turnstile bypass, stealth browser, spider framework with pause/resume | Web scraping, internal infra monitoring, authorized client scraping, anti-bot bypass |

### Research Workflows (adapted from Feynman methodology)

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `deep-research` | No | Multi-source cited investigation with parallel researcher agents, provenance tracking, verification pass | Thorough research briefs, multi-source investigations, cited reports |
| `autoresearch` | No | Autonomous experiment loop: try ideas, measure results, keep what works, discard what doesn't | GPU kernel optimization, benchmark sweeps, performance tuning, iterative improvement |
| `provenance-tracking` | No | Source chain verification with .provenance.md sidecar, URL checking, confidence scoring | Adding citations and verification to any research output |

### Web Research and Content

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `perplexity-research` | No | Real-time web search via Perplexity API with citations | Current information, market research, live web data |
| `gemini-url-context` | Yes | Gemini 2.5 Flash URL expansion, up to 20 URLs per request, grounding metadata | Analysing or summarising specific known URLs |
| `web-summary` | Yes | URL summarisation, YouTube transcript extraction, Logseq/Obsidian topic links | Summarising articles, YouTube videos, generating note links |
| `notebooklm` | Yes | Google NotebookLM SDK: notebooks, sources, chat, audio/video/slides/quiz/report generation | Research automation, podcast generation, study material creation, knowledge management |
| `linkedin` | Yes | LinkedIn profile/job/company scraping, messaging, people search via browser automation | LinkedIn research, recruitment, networking, company analysis |
| `reddit` | Yes | Reddit browsing, search, user analysis, post details with comment threads | Reddit research, community analysis, content discovery |
| `toprank` | No | 6 SEO sub-skills: GSC audit, E-E-A-T content writing, keyword research, meta tags, schema markup, GEO | SEO audit, content optimisation, keyword research, schema markup, AI search visibility |
| `context7` | Yes | Version-specific documentation for 800+ libraries (Next.js, Supabase, React, etc.). `resolve-library-id` + `query-docs`. Eliminates hallucination from stale training data | Writing code with external libraries, "use context7", needing current API docs |

### Security and Compliance

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `defense-security` | Yes | 31 Linux security modules, 250+ actions: firewall, hardening, CIS/HIPAA/SOC2, malware, forensics | Linux security audit, system hardening, compliance checking, incident response |

### Documentation and Reports

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `report-builder` | No | LaTeX reports, Python analytics, Wardley maps, TikZ+Mermaid diagrams, multi-LLM research | Research reports, white papers, sector analyses, policy briefs |
| `latex-documents` | No | TeX Live toolchain, Beamer presentations, BibTeX, mathematical typesetting | Academic papers, presentations, publication-quality documents |
| `mermaid-diagrams` | No | 25 diagram types, PNG/SVG/PDF export, dark/light themes | System architecture, flowcharts, ER models, Gantt charts, mindmaps |
| `paperbanana` | No | Publication-quality academic figures via multi-agent VLM pipeline (Gemini/OpenAI) | Research paper figures, methodology diagrams, statistical plots |
| `art` | No | Nano Banana 2 AI art: 16 workflows (editorial, technical diagrams, comics, maps, stats, sketchnotes), style transfer, text rendering | Blog headers, infographics, technical illustrations, editorial art, image editing |
| `fossflow` | No | Isometric network/architecture diagrams, compact LLM-optimised format | Network topology diagrams and infrastructure maps |
| `wardley-maps` | No | Strategic Wardley mapping from any input, component evolution, value chain visualisation | Competitive positioning, strategic analysis, technology evolution mapping |

### UI/UX Design

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `ui-ux-pro-max-skill` | No | 50 styles, 97 palettes, 57 font pairings, 9 tech stacks, shadcn/ui MCP | Designing UI components, choosing palettes/typography, reviewing UX |
| `daisyui` | No | daisyUI 5 components, theme configuration, Tailwind CSS patterns | Building web interfaces specifically with daisyUI components |
| `bencium-controlled-ux-designer` | No | WCAG 2.1 AA, mathematical scales, always-ask-first protocol, design system templates | Enterprise/regulated UX design with accessibility-first approach |
| `bencium-creative` | No | Consolidated bold creative + production frontend. Two modes: `--design` (ask→commit boldly) and `--build` (shadcn/Tailwind/Phosphor implementation). Anti-AI-slop, 25+ tone options. Replaces bencium-innovative + bencium-impact | Creative landing pages, campaigns, product UIs needing distinctive aesthetics AND working code |
| `design-audit` | No | Systematic visual UI/UX audits, phased implementation-ready design plans | Visual design review, polishing existing interfaces |
| `typography` | No | Professional typography: proper quotes, dashes, spacing, hierarchy (Butterick rules) | Auto-enforced typography in any HTML/CSS/React code generation |
| `relationship-design` | No | AI-first interfaces, memory-aware UX, trust evolution, collaborative planning | Designing agentic/AI apps with ongoing user relationships |

### Communication & Decision Support

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `adaptive-communication` | No | Detects relational vs transactional communication style, adapts responses | Ambiguous user intent, hedging language, relational conversations |
| `negentropy-lens` | No | Entropy vs negentropy evaluation framework, surfaces tacit knowledge gaps | Architecture decisions, system evaluation, strategy review |

### Software Architecture & Code Quality (Bencium)

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `renaissance-architecture` | No | First-principles architecture, simplicity-first, building new vs derivative | Designing genuinely new features/products, avoiding over-engineering |
| `human-architect-mindset` | No | Domain modeling, systems thinking, constraint navigation, AI-aware decomposition | Multi-component architecture, integration planning, breaking changes |
| `vanity-engineering-review` | No | Detects ego-driven engineering: unnecessary abstractions, resume-driven tech choices | Code review, architecture review, complexity audit |
| `bencium-code-conventions` | No | React/Next.js/TypeScript/TailwindCSS stack conventions, style guide | Projects using Bencium's preferred tech stack |
| `bencium-aeo` | No | Answer Engine Optimisation for AI search visibility (ChatGPT, Claude, Gemini) | Optimising content for AI citations, not traditional SEO |
| `architecture-studio` | No | AEC studio: 36 skills, 7 agents — site planning, NYC zoning, sustainability (EPD), materials, FF&E, specs, presentations. `/studio` dispatcher | Architecture/construction: site analysis, zoning, sustainability, materials research, specifications |

### Media Processing

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `ffmpeg-processing` | No | FFmpeg 8.0: transcode, edit, stream, filter, HLS/DASH/RTMP, CUDA acceleration | Video/audio conversion, editing, streaming, batch processing |
| `echoloop` | No | Real-time meeting copilot: dual audio capture, faster-whisper/Deepgram transcription, Claude/GPT coaching loop, session logging | Live meeting coaching, transcription, meeting recap, negotiation support |
| `imagemagick` | Yes | Format conversion, resize, crop, filter, batch ops, watermarks, metadata | Image format conversion, thumbnails, batch image processing |
| `comfyui` | Yes | Stable Diffusion, FLUX, node-based workflows, distributed GPU (Salad Cloud) | AI image/video generation from prompts or workflows |
| `open-montage` | No | Agentic video production: 11 pipelines, 49 tools, TTS, avatar, music, zero-key mode. On-demand clone | "Make a video", explainers, trailers, podcast-to-video, avatar presentations |
| `clipcannon` | Yes | AI video editor: 51 MCP tools (12 categories), 22-stage analysis DAG, 14 ML models, 5 embedding spaces, voice clone (Qwen3-TTS), lip-sync (LatentSync 1.6), AI music (ACE-Step), text-to-video gen, Voice Agent ("Jarvis"), 7 platform renders, credit billing. Local GPU | Edit existing video, find moments, highlight reels, captions, voice clone, lip-sync, TikTok/Reels render, text-to-video, voice agent |

### 3D and Game Development

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `game-dev` | No | 48 agents, 38 commands across Godot/Unity/Unreal, design/programming/art/audio/QA | Full game development projects across any major engine |
| `unreal-engine` | Yes | UE5 automation: 60+ MCP tools for actors, Blueprints, materials, PIE, profiling, assets, StateTrees | Direct UE5 editor control, Blueprint automation, PIE sessions, asset management |
| `terracraft` | No | OSM + elevation + arnis pipeline: real-world locations to Minecraft Java worlds. QGIS/Blender/GDAL integration | Generating Minecraft worlds from real geography, geospatial-to-game conversion |
| `blender` | No | 3D modelling, scene creation, rendering, material PBR, import/export via socket | Programmatic 3D modelling, automated Blender workflows |
| `lichtfeld-studio` | Yes | 3D Gaussian Splatting training, visualisation, editing, export (70+ MCP tools), SplatReady COLMAP | 3DGS scene capture, splat editing, radiance field workflows |
| `meta-xr-sdk` | Yes | Meta VR/AR ecosystem: WebXR (IWER, RATK, @react-three/xr), Spatial SDK, hzdb CLI (40+ MCP tools), hand tracking, passthrough, plane/mesh detection, anchors | Quest WebXR apps, mixed reality, spatial computing, VR device management, agentic VR development |

### Geospatial

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `qgis` | Yes | 51 MCP tools: layer management, geoprocessing, rendering, styling, CRS transforms | GIS operations, geospatial analysis, map generation |

### Version Control (AI-Native)

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `agentic-jujutsu` | No | Lock-free VCS (23x faster than Git), auto conflict resolution (87%), multi-agent coordination | Multiple AI agents modifying code simultaneously |

### Ontology and Knowledge Graphs

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `ontology-core` | No | Logseq ontology parsing, OWL2 DL TTL export, WebVOWL compatibility | Creating new ontology schemas from Logseq data |
| `ontology-enrich` | No | Validation, enrichment, TTL generation for existing ontology data | Enriching or validating existing ontology datasets |

### Platform Management

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `flow-nexus-platform` | No | Authentication, sandboxes, app deployment, payments, challenges on Flow Nexus | Managing Flow Nexus accounts, sandboxes, and deployments |

### Systems Programming

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `rust-development` | No | Cargo, rustfmt, clippy, rust-analyzer, WASM compilation, cross-compilation | Rust systems programming, CLI tools, network services |
| `wasm-js` | No | High-performance WASM graphics, JS interop, Canvas/WebGL with WASM compute | Performance-critical web graphics, real-time animations, hybrid JS/WASM |

### Performance

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `performance-analysis` | No | Bottleneck detection, profiling, reporting, optimisation recommendations for swarms | Profiling swarm operations and identifying performance issues |

### Data Science and Notebooks

| Skill | MCP | Key Capability | When to Choose |
|-------|-----|----------------|----------------|
| `jupyter-notebooks` | No | Full Jupyter MCP: create, execute, manipulate cells, access outputs | Interactive data analysis, ML experiments, reproducible research |

---

## Artefact 2: Decision Tree

> **Don't know which skill?** Use `/route [describe your task]` — the unified dispatcher
> classifies your intent and routes you automatically. Only read further if you want to
> understand the full routing logic.

Answer these questions in order. Stop at the first match.

```
Q0: Unsure which skill handles your task?
    --> /route [describe task]  (skill-router — intelligent dispatcher for all 89 skills)

Q1: Is the task about an EXISTING skill that is deprecated?
    YES --> Use its replacement (see Deprecated table above)

Q2: What is the primary domain?

    [A] CODE DEVELOPMENT (write, refactor, test, review code)
    [B] GITHUB OPERATIONS (PRs, issues, releases, workflows, multi-repo)
    [C] MULTI-AGENT / SWARM COORDINATION
    [D] RESEARCH, WEB, and CONTENT (fetch URLs, search web, summarise, NotebookLM)
    [E] DOCUMENTS and REPORTS (LaTeX, diagrams, docs validation)
    [F] MEDIA (image, video, audio, 3D, AI generation)
    [G] BROWSER AUTOMATION (scrape, test UI, debug web apps)
    [H] AI/ML MODEL WORK (train, deploy, reason)
    [I] MEMORY and LEARNING (store, search, vector DB, RL)
    [J] INFRASTRUCTURE / PLATFORM / DEVOPS
    [K] UI/UX DESIGN (interfaces, components, audit, typography)
    [L] SOFTWARE ARCHITECTURE (first-principles, review, domain modelling)
    [M] DOMAIN-SPECIFIC (GIS, ontology, game dev, SEO/AEO)
    [N] SECURITY AND COMPLIANCE (hardening, audit, forensics)
    [O] AEC / BUILDING ARCHITECTURE (site planning, zoning, sustainability, materials)
```

### [A] Code Development

#### Methodology Disambiguation

Four methodology skills exist at different phases of the development lifecycle. **They are sequential, not competing**:

```
PHASE 1 — SPECIFICATION
  You have a PRD and need all docs generated                → prd2build
    (outputs: 8 spec files, 27+ ADRs, 11 DDD files, 20+ tasks)
    (optional --build flag hands off to build-with-quality)

  You need artifact traceability + sprint scaffolding       → bhil-methodology
    (outputs: PRD-NNN → SPEC-NNN → ADR-NNN → TASK-NNN chain)
    (does NOT execute code — specification-only)

PHASE 2 — IMPLEMENTATION
  Systematic 5-phase development (spec→pseudo→arch→refine→complete)  → sparc-methodology
    (17 modes; delegates to sub-agents per phase)

  Multi-file feature with quality gates, TDD, coverage             → build-with-quality
    (111+ agents; dev + QE unified; SONA learning; truth scoring)

PHASE 3 — VERIFICATION
  Truth-score verification only, no full pipeline needed    → verification-quality
    (0.0–1.0 truth scoring, automatic rollback at 0.95)
```

**Common flow**: `prd2build` → (docs) → `bhil-methodology` → (traceability artifacts) → `build-with-quality` → (code + tests) → `verification-quality` → (confidence score)

#### Complexity Decision Tree

```
Q3: How complex is the task?
    |
    +-- Single file, quick fix --> Edit directly (no skill needed)
    |
    +-- You have a PRD → need all documentation + optional build execution
    |   --> prd2build  [see Methodology Disambiguation above]
    |
    +-- Need artifact traceability chain (PRD→SPEC→ADR→TASK) across a sprint
    |   --> bhil-methodology  [specification-only, no code execution]
    |
    +-- Multi-file feature with quality gates, TDD, coverage, 111+ agents
    |   --> build-with-quality
    |
    +-- Systematic multi-phase (spec -> pseudo -> arch -> refine -> complete)
    |   --> sparc-methodology
    |
    +-- Just need truth-score verification and rollback safety
    |   --> verification-quality
    |
    +-- Large codebase (500+ files): call graphs, architecture, diff impact, symbol search
    |   --> codebase-memory (index once → permanent CLAUDE.md upgrade for this project)
    |
    +-- Need version-specific docs for external library while coding
    |   --> context7 ("use context7" / "check docs for X")
    |
    +-- Rust systems programming
    |   --> rust-development
    |
    +-- WASM + JS graphics interop
    |   --> wasm-js
    |
    +-- CUDA GPU kernel development
    |   --> cuda
    |
    +-- React/Next.js/TypeScript/Tailwind stack conventions
    |   --> bencium-code-conventions
    |
    +-- Validate documentation against the codebase
        --> docs-alignment
```

### [B] GitHub Operations

```
Q3: What GitHub operation?
    |
    +-- Review a PR with AI agents
    |   --> github-code-review
    |
    +-- Cut a release, changelog, deploy
    |   --> github-release-management
    |
    +-- Create/modify GitHub Actions workflows
    |   --> github-workflow-automation
    |
    +-- Manage issues, project boards, sprints
    |   --> github-project-management
    |
    +-- Cross-repo sync, architecture, org-wide automation
        --> github-multi-repo
```

### [C] Multi-Agent / Swarm Coordination

```
Q3: What coordination pattern?
    |
    +-- Local swarm with parallel agents (mesh, hierarchical, adaptive)
    |   --> swarm-advanced
    |
    +-- Queen-led consensus with Byzantine fault tolerance
    |   --> hive-mind-advanced
    |
    +-- Cloud-based swarm on Flow Nexus
    |   --> flow-nexus-swarm
    |
    +-- Sequential pipeline (output of step N feeds step N+1)
    |   --> stream-chain
    |
    +-- Automated hooks for pre/post operations and session management
    |   --> hooks-automation
    |
    +-- Multiple AI agents editing code simultaneously (lock-free VCS)
        --> agentic-jujutsu
```

### [D] Research, Web, and Content

```
Q3: What do you need?
    |
    +-- Live web search with citations
    |   --> perplexity-research
    |
    +-- Analyse/summarise specific URLs (up to 20)
    |   --> gemini-url-context
    |
    +-- Summarise articles or YouTube videos for notes
    |   --> web-summary
    |
    +-- NotebookLM: ingest sources, generate podcasts/slides/quizzes
    |   --> notebooklm
    |
    +-- LinkedIn profiles, jobs, companies, messaging
    |   --> linkedin
    |
    +-- Reddit browsing, search, user analysis
    |   --> reddit
    |
    +-- SEO audit, keyword research, content optimisation, schema markup
        --> toprank
```

### [E] Documents and Reports

```
Q3: What kind of document?
    |
    +-- Full research report / white paper / policy brief
    |   --> report-builder
    |
    +-- Academic paper, Beamer presentation, math typesetting
    |   --> latex-documents
    |
    +-- Diagrams only (flowchart, ER, sequence, Gantt, mindmap)
    |   --> mermaid-diagrams
    |
    +-- Publication-quality academic figures (methodology, stats plots)
    |   --> paperbanana
    |
    +-- Isometric network / infrastructure diagrams
    |   --> fossflow
    |
    +-- Validate existing docs against codebase
    |   --> docs-alignment
    |
    +-- Generate project docs from a PRD (spec/ADR/DDD/tasks in one command)
    |   --> prd2build  [see [A] Methodology Disambiguation for full context]
    |
    +-- Strategic Wardley maps (competitive positioning, evolution)
        --> wardley-maps
```

### [F] Media Processing

```
Q3: What media type?
    |
    +-- Video/audio transcode, edit, stream
    |   --> ffmpeg-processing
    |
    +-- Image format conversion, resize, crop, batch processing
    |   --> imagemagick
    |
    +-- AI image/video generation (Stable Diffusion, FLUX)
    |   --> comfyui
    |
    +-- 3D modelling and rendering
    |   --> blender
    |
    +-- Game assets and full game dev pipeline
    |   --> game-dev
    |
    +-- UE5 editor automation (actors, Blueprints, PIE, profiling)
    |   --> unreal-engine (60+ MCP tools)
    |
    +-- 3D Gaussian Splatting (training, editing, export)
    |   --> lichtfeld-studio
    |
    +-- Meta Quest VR/AR (WebXR, hand tracking, passthrough, spatial anchors, device mgmt)
    |   --> meta-xr-sdk (40+ MCP tools)
    |
    +-- AI art (Nano Banana 2): blog headers, infographics, technical illustrations, comics
    |   --> art
    |
    +-- Full video production (explainers, trailers, podcasts, avatars, TTS)
    |   --> open-montage
    |
    +-- Real-time meeting copilot (transcription, coaching, recap)
    |   --> echoloop
    |
    +-- AI video editor (51 MCP tools, 12 categories, 14 ML models, voice clone, lip-sync, voice agent, text-to-video)
        --> clipcannon
```

### [G] Browser Automation

```
Q3: Do you know which tool you need?
    |
    +-- No / unsure --> browser-automation (meta-skill, guides selection)
    |
    +-- Desktop Chrome with login state, GIF recording (official beta)
    |   --> claude --chrome (not a skill — built into Claude Code 2.0.73+)
    |
    +-- Quick scrape/form-fill with minimal context
    |   --> browser (agent-browser, @ref snapshots)
    |
    +-- Full API, screenshots, visual testing on Display :1
    |   --> playwright
    |
    +-- QE-grade assertions (typed checks, visual-diff baselines, injection scan), AQE fleet
    |   --> qe-browser  (Vibium: WebDriver BiDi, 10MB, 16 assertion kinds, `aqe init` to install)
    |   NOTE: also used internally by a11y-ally, visual-testing, security-visual-testing,
    |   compatibility-testing, localization-testing and 6 other QE fleet skills
    |
    +-- Inspect live Chromium tabs already open
    |   --> chrome-cdp
    |
    +-- Debug host web server from inside Docker (CORS/HTTPS)
    |   --> host-webserver-debug
    |
    +-- Web scraping, crawling, anti-bot bypass, infra monitoring
        --> scrapling (MCP: 9 tools, or CLI: scrapling extract)
```

### [H] AI/ML Model Work

```
Q3: What ML task?
    |
    +-- PyTorch model training (local GPU)
    |   --> pytorch-ml
    |
    +-- Custom CUDA kernels
    |   --> cuda
    |
    +-- Distributed training in cloud sandboxes
    |   --> flow-nexus-neural
    |
    +-- Interactive notebook-based experiments
    |   --> jupyter-notebooks
    |
    +-- Self-learning agents with RL algorithms (Decision Transformer, Q-Learning, SARSA, etc.)
    |   --> agentdb-advanced (RL Plugins section)
    |
    +-- Delegate reasoning to DeepSeek R1
    |   --> deepseek-reasoning
    |
    +-- Delegate coding to GPT-5.4
        --> openai-codex or codex-companion (/codex:rescue for full Codex plugin)
```

### [I] Memory and Learning

```
Q3: What memory operation?
    |
    +-- Session/long-term agent memory patterns
    |   --> agentdb-memory-patterns
    |
    +-- Semantic vector search, RAG, HNSW tuning
    |   --> agentdb-vector-search
    |
    +-- Distributed multi-DB sync, QUIC, hybrid search
    |   --> agentdb-advanced
    |
    +-- Reinforcement learning (Decision Transformer, Q-Learning, SARSA, Actor-Critic, etc.)
    |   --> agentdb-advanced (RL Plugins section)  [also appears in [H]]
    |
    +-- Session context and plan tracking (single session only — not cross-session)
    |   --> lazy-fetch  [for persistent cross-session memory use agentdb-* or ruvector-catalog]
    |
    +-- "What RuVector tool helps with X?" (200+ capabilities across 14 domains)
        --> ruvector-catalog  [broader than agentdb-*; covers all RuVector access patterns]
```

### [J] Infrastructure / Platform / DevOps

```
Q3: What infrastructure task?
    |
    +-- Flow Nexus account, sandbox, app deployment, payments
    |   --> flow-nexus-platform
    |
    +-- Swarm performance profiling and bottleneck detection
    |   --> performance-analysis
    |
    +-- GitHub Actions CI/CD pipelines
    |   --> github-workflow-automation
    |
    +-- Creating new skills for this system
        --> skill-builder
```

### [K] UI/UX Design

```
Q3: What kind of design work?
    |
    +-- General UI/UX (50 styles, palettes, fonts, accessibility)
    |   --> ui-ux-pro-max-skill
    |
    +-- daisyUI / Tailwind components specifically
    |   --> daisyui
    |
    +-- Enterprise UX (WCAG 2.1 AA, regulated, ask-first protocol)
    |   --> bencium-controlled-ux-designer
    |
    +-- Bold creative UX OR production frontend implementation (or both)
    |   --> bencium-creative
    |       --design flag: ask-first, commit boldly, pick aesthetic direction
    |       --build flag: production code with shadcn/Tailwind/Phosphor
    |       default: full pipeline (design questions → implement)
    |
    +-- Audit / polish existing UI (visual review, no functionality)
    |   --> design-audit
    |
    +-- Typography enforcement (quotes, dashes, spacing, hierarchy)
    |   --> typography
    |
    +-- AI-first relationship interfaces (memory, trust, planning)
        --> relationship-design
```

### [L] Software Architecture and Review

```
Q3: What architecture need?
    |
    +-- First-principles thinking, build genuinely new things
    |   --> renaissance-architecture
    |
    +-- Domain modelling, systems thinking, constraint navigation
    |   --> human-architect-mindset
    |
    +-- Over-engineering / vanity check on existing code
    |   --> vanity-engineering-review
    |
    +-- Entropy vs negentropy evaluation of systems/decisions
    |   --> negentropy-lens
    |
    +-- Detect relational vs transactional communication style
        --> adaptive-communication
```

### [M] Domain-Specific Tools

```
Q3: Which domain?
    |
    +-- Geospatial analysis, GIS, maps
    |   --> qgis
    |
    +-- Ontology creation (Logseq -> OWL2 TTL)
    |   --> ontology-core
    |
    +-- Ontology validation and enrichment
    |   --> ontology-enrich
    |
    +-- Game development (Godot/Unity/Unreal)
    |   --> game-dev
    |
    +-- Geospatial-to-game conversion (real-world to Minecraft)
    |   --> terracraft
    |
    +-- Content optimisation for AI search citations (AEO)
    |   --> bencium-aeo
    |
    +-- AEC (architecture, construction, site planning, zoning, sustainability)
        --> architecture-studio (/studio [task] as entry point)
```

### [N] Security and Compliance

```
Q3: What security task?
    |
    +-- Linux system hardening, firewall, compliance audit
    |   --> defense-security
    |
    +-- Security testing (OWASP, auth, vulns)
        --> security-testing (QE skill)
```

---

## Skill Composition Patterns

Some tasks benefit from combining skills. Common compositions:

| Task Pattern | Primary Skill | Supporting Skill(s) |
|--------------|---------------|---------------------|
| Feature with tests and PR review | `build-with-quality` | `github-code-review` |
| Research report with diagrams | `report-builder` | `mermaid-diagrams`, `paperbanana` |
| Full game project with 3D assets | `game-dev` | `blender`, `comfyui` |
| Multi-repo release with CI/CD | `github-release-management` | `github-workflow-automation`, `github-multi-repo` |
| ML model with custom CUDA kernels | `pytorch-ml` | `cuda` |
| Ontology pipeline (create + enrich) | `ontology-core` | `ontology-enrich` |
| PRD to working implementation | `prd2build` | `build-with-quality` |
| Documentation with live web research | `report-builder` | `perplexity-research`, `gemini-url-context` |
| Visual UI testing after building components | `daisyui` or `ui-ux-pro-max-skill` | `playwright` |
| Academic paper with AI-generated figures | `latex-documents` | `paperbanana`, `mermaid-diagrams` |
| Creative landing page with proper typography | `bencium-creative` | `typography` |
| Enterprise app with accessibility audit | `bencium-controlled-ux-designer` | `design-audit` |
| Architecture review before major refactor | `vanity-engineering-review` | `human-architect-mindset`, `negentropy-lens` |
| Research with NotebookLM podcast + report | `notebooklm` | `report-builder`, `perplexity-research` |
| AI-first product with relationship UX | `relationship-design` | `bencium-creative` |
| Content optimised for AI search engines | `bencium-aeo` | `perplexity-research` |
| Debug web app from Docker | `host-webserver-debug` | `chrome-cdp`, `playwright` |
| Swarm with automated hooks | `swarm-advanced` | `hooks-automation` |
| 3DGS with Blender scene prep | `lichtfeld-studio` | `blender` |
| Architecture review before feature build | `human-architect-mindset` | `build-with-quality` |

---

## MCP Server Summary

18 skills provide MCP servers (registered in `skills/mcp.json` or invocable via skill config):

| Skill | Protocol | Entry Point |
|-------|----------|-------------|
| `lazy-fetch` | stdio | `mcp-server/dist/mcp-server.js` |
| `cuda` | stdio | `mcp-server/server.py` |
| `deepseek-reasoning` | mcp-sdk | `mcp-server/server.js` |
| `flow-nexus-neural` | flow-nexus | via `npx flow-nexus@latest` |
| `gemini-url-context` | fastmcp | `mcp-server/server.py` |
| `host-webserver-debug` | mcp-sdk | `mcp-server/server.js` |
| `imagemagick` | fastmcp | `mcp-server/server.py` |
| `notebooklm` | fastmcp | `mcp-server/server.py` |
| `openai-codex` | stdio | `mcp-server/server.js` |
| `playwright` | mcp-sdk | `mcp-server/server.js` |
| `qgis` | fastmcp | `mcp-server/server.py` |
| `web-summary` | fastmcp | `mcp-server/server.py` |
| `comfyui` | fastmcp | `mcp-server/server.py` |
| `blender` | stdio | `mcp-server/server.py` |
| `lichtfeld-studio` | stdio | `mcp-server/server.js` |
| `perplexity` | mcp-sdk | `mcp-server/server.js` (DEPRECATED -- use perplexity-research) |
| `linkedin` | stdio | via uvx linkedin-scraper-mcp |
| `defense-security` | stdio | via npx defense-mcp-server |
| `reddit` | stdio | via npx reddit-mcp-buddy |

---

## Overlap Analysis and Recommendations

### Overlapping Skill Groups

**1. Perplexity**: `perplexity` is deprecated; `perplexity-research` is the active replacement. Complete.

**2. Swarm Orchestration**: `swarm-orchestration` is deprecated; `swarm-advanced` is the active replacement. Complete.

**3. AgentDB Optimization**: `agentdb-optimization` is deprecated; merged into `agentdb-vector-search`. Complete.

**4. ReasoningBank + Pair Programming**: Both `reasoningbank-agentdb`, `reasoningbank-intelligence`, and `pair-programming` are deprecated; all merged into `build-with-quality`. Complete.

**5. AgentDB Learning → Advanced**: `agentdb-learning` deprecated; RL Plugins section added to `agentdb-advanced`. All 9 algorithms accessible from a single skill. Complete.

**6. Bencium Creative Consolidation**: `bencium-innovative-ux-designer` and `bencium-impact-designer` deprecated; merged into `bencium-creative` with `--design`/`--build` modes. Complete.

**7. Browser Tools (4 active + 1 meta)**: Well-differentiated. `browser-automation` serves as the meta-skill decision layer. No merge needed.

**8. V3 Implementation Skills (9 archived)**: All archived. Serve as reference only. Could be moved to a `/skills/archive/` subdirectory to reduce clutter.

**9. Development Meta-Skills**: `build-with-quality` vs `sparc-methodology` -- distinct. BWQ focuses on quality engineering with 111+ agents; SPARC focuses on phased methodology. Both are needed.

**10. Flow Nexus Trio**: `flow-nexus-platform`, `flow-nexus-neural`, `flow-nexus-swarm` -- well-separated by concern (platform admin vs ML training vs swarm deployment). No merge needed.

### Potential Future Consolidation

- **AgentDB family** (4 skills): Consider a meta-skill `agentdb` that routes to the correct sub-skill, similar to how `browser-automation` routes browser tools.
- **GitHub family** (5 skills): Consider a meta-skill `github` that routes based on the operation type.

# Agent Skills authoring standards — evidence brief (September 2026)

Scope: how to author SKILL.md so it works well under Claude Fable 5.1 / Claude Code and OpenAI GPT‑6 Astra / Codex CLI, for re-normalising the ~130-skill agentbox estate. Primary sources only where available; secondary/community sources are flagged.

## 1. The agentskills.io open standard

The canonical spec is `agentskills.io/specification` [1], mirrored/forked at agentskills.me, openagentskills.dev and agentskills.my [confirms multi-site ecosystem uptake, but agentskills.io is the source both Anthropic and OpenAI point to — see §2, §3].

**Directory layout** (required minimum: `SKILL.md` only):
```
skill-name/
├── SKILL.md      # required: YAML frontmatter + Markdown body
├── scripts/      # optional: executable code
├── references/   # optional: documentation, loaded on demand
└── assets/       # optional: templates, images, data files
```

**Frontmatter fields** [1]:
| Field | Required | Constraints |
|---|---|---|
| `name` | Yes | 1–64 chars, lowercase unicode alphanumerics + hyphens only, no leading/trailing/consecutive hyphens, **must match the parent directory name** |
| `description` | Yes | 1–1024 chars, non-empty, must state both *what* and *when* |
| `license` | No | short name or pointer to a bundled licence file |
| `compatibility` | No | ≤500 chars; environment requirements (product, packages, network); "most skills do not need" it |
| `metadata` | No | arbitrary string→string map for client-specific extensions; keys should be namespaced to avoid collisions |
| `allowed-tools` | No | space-separated pre-approved tools; explicitly marked **Experimental**, support varies by implementation |

**Progressive disclosure** is a three-tier, token-budgeted model [1][2]:
1. **Metadata** (~100 tokens/skill): `name`+`description`, always loaded.
2. **Instructions** (<5,000 tokens recommended): full `SKILL.md` body, loaded only when triggered.
3. **Resources**: `scripts/`, `references/`, `assets/`, loaded/executed on demand, no context cost until accessed.

Structural rule: keep `SKILL.md` under 500 lines; keep file references **one level deep** from `SKILL.md` (Claude has been observed to `head -100` rather than fully read nested reference chains) [3]. Validation tooling exists: `skills-ref validate ./my-skill` [1].

**Adoption**: Anthropic (Claude API, claude.ai, Claude Code) [2][4] and OpenAI (ChatGPT, Codex CLI/IDE) [7] both explicitly build on this standard rather than defining their own. Both extend it with vendor-specific frontmatter (§2, §3).

## 2. Claude Code / Claude Fable 5.1 specifics

**Frontmatter Claude Code honours today** (all optional except that `description` is "recommended") [4]: `name`, `description`, `when_to_use` (appended to description, combined text truncated at 1,536 chars in the listing — front-load the key use case), `argument-hint`, `arguments`, `disable-model-invocation` (blocks auto-trigger and subagent preload), `user-invocable` (default true; false hides from `/` menu), `allowed-tools` / `disallowed-tools` (turn-scoped grants, space/comma/YAML-list), `model` (per-invocation override, accepts `/model` values or `inherit`), `effort` (`low|medium|high|xhigh|max`), `context: fork` (runs in a subagent), `agent` (subagent type for fork), `background` (default true for forked skills), `hooks` (session-scoped hook registration), `paths` (glob-gated auto-activation), `shell` (`bash`|`powershell`). Booleans accept `yes/no/on/off/1/0` since v2.1.218.

**Discovery locations and precedence** [4]: enterprise (managed settings) > personal (`~/.claude/skills/`) > project (`.claude/skills/`, walked from CWD up to repo root); nested `.claude/skills/` below CWD load lazily on first file touch in that subtree; `--add-dir` loads that directory's `.claude/skills/`; plugin skills are namespaced `/plugin:skill` and never collide; claude.ai-synced skills land in the reserved `~/.claude/skills/synced/` and only via `CLAUDE_CODE_SYNC_SKILLS=1` non-interactive runs. Symlinked skill directories are explicitly supported and de-duplicated by target.

**Description-writing guidance** [3]: always third person ("Processes X…", never "I can help…" — descriptions are injected into the system prompt and POV inconsistency hurts discovery); be specific, front-load keywords/triggers; avoid vague descriptions ("Helps with documents"). Set "appropriate degrees of freedom" — high freedom (prose heuristics) for judgment-dependent tasks, low freedom (exact scripts, "do not modify the command") for fragile/deterministic ones. Default assumption: "Claude is already very smart" — cut any explanation Claude doesn't need; every token in a triggered skill competes with conversation history.

**Eval workflow**: the bundled `skill-creator` skill [6] (open-sourced at `github.com/anthropics/skills`) drives an interview → draft → parallel with-skill/without-skill (or old-version/new-version) subagent runs → timing capture (`total_tokens`, `duration_ms`) → assertion grading → `scripts.aggregate_benchmark` → an HTML `eval-viewer` with pass-rate, mean±stddev, and time/token deltas. It explicitly documents that **Claude currently under-triggers skills by default** and instructs authors to write descriptions that are "a little bit pushy" (e.g. "Make sure to use this skill whenever the user mentions X, even if they don't explicitly ask for it") [6]. `/skill-doctor` and `claude plugin eval` exist as a documented workflow per Claude Code's own agent-routing metadata surfaced in this session, but no public `docs.claude.com`/`code.claude.com` page for `/skill-doctor` specifically was located in this search — **UNCONFIRMED as a citable public doc**, though `claude plugin eval` is referenced by the built-in `claude-code-guide` agent's own tool description.

**Claude Fable 5.1**: confirmed shipping (Sep 1 2026), API id `claude-fable-5-1`, priced $10/$50 per M input/output tokens, cache reads $0.25/M (75% cheaper than Fable 5) [11]. Customer testimonials describe it staying "readable over long, multi-step tasks" and communicating "more concise[ly] and easier to follow" than prior Anthropic models [11]. Claude Code exposes a discrete `effort` control (`low|medium|high|xhigh|max`) as skill/session frontmatter [4]. **The specific claim that Fable 5.1 uses "always-on adaptive thinking" (no explicit extended-thinking toggle) was not found in Anthropic's own public marketing/docs pages searched** (`anthropic.com/claude/fable`, `docs.claude.com`) — this is an internal/project-level characterisation in this environment's own configuration, not an externally citable Anthropic claim. **Flag as UNCONFIRMED against primary Anthropic sources**; treat the project's existing prompting guidance (append-only histories, replay thinking blocks, don't force tool choice, batch independent calls) as a working assumption, not a verified vendor spec.

## 3. OpenAI Codex CLI skills

Codex **does** support Agent Skills natively, confirmed at `developers.openai.com/codex/skills` [7], which explicitly states skills "build on the open agent skills standard" [1]. The `github.com/openai/codex/docs/skills.md` file is a one-line pointer to that same page [12].

**Discovery paths and precedence** [7], scanned from most to least specific:
| Scope | Location |
|---|---|
| REPO | `$CWD/.agents/skills` |
| REPO | `$CWD/../.agents/skills` (parent, when inside a git repo) |
| REPO | `$REPO_ROOT/.agents/skills` |
| USER | `$HOME/.agents/skills` |
| ADMIN | `/etc/codex/skills` |
| SYSTEM | bundled with Codex (e.g. `skill-creator`, plan skills) |

Same-name skills across scopes are **not merged** — both remain selectable. Symlinked skill folders are followed. `$skill-installer` fetches curated/third-party skills locally; `[[skills.config]]` in `~/.codex/config.toml` can disable a skill by path without deleting it.

**AGENTS.md vs. skills**: distinct mechanisms. `AGENTS.md` (global at `$CODEX_HOME`, default `~/.codex`, override via `CODEX_HOME`; project-level walked root→CWD with `AGENTS.override.md` taking precedence per directory) is auto-injected as **separate user-role messages**, one per directory, in root-to-leaf order, capped at `project_doc_max_bytes` (32 KiB default) [8][9]. Skills are a **separate, later-loaded capability layer** — not folded into the AGENTS.md instruction chain [7].

**Surfacing model**: an always-loaded *index* of name+description+file-path per skill, capped at **2% of context window or 8,000 characters** (whichever is defined) — Codex shortens descriptions first under pressure, and may drop skills from the index entirely for very large libraries, with a warning [7]. Full `SKILL.md` is read only on selection (implicit match to description, or explicit `$skill-name` / `/skills`). Codex-specific extension: `agents/openai.yaml` inside a skill directory adds UI metadata (`display_name`, icon, `brand_color`), an `allow_implicit_invocation: false` policy switch, and declared tool dependencies (MCP server bindings) — none of this is in the agentskills.io spec [1][7].

**Plugins**: `codex-plugin-cc`-style bundling isn't separately documented here, but Codex's own plugin system bundles ≥1 skills plus MCP connectors and presentation assets, shared with the ChatGPT plugin directory across Chat, Work and Codex CLI/IDE [7].

**Model / prompting**: the flagship model announced Sep 2026 is **GPT‑6 Astra**, API id `gpt-6-astra`, $10/$50 per M input/output tokens (Fast mode 2× price/2× speed) [10]. The Codex-*tuned* coding model referenced in OpenAI's own Codex prompting guide (dated to this generation) is `gpt-5.3-codex`, built from a `gpt-5.1-codex-max` base prompt [9] — **the two model-id lineages (Astra vs. codex-tuned GPT‑5.x) are documented separately by OpenAI; which one Codex CLI defaults to was not confirmed in this search** (mark UNCONFIRMED — worth a follow-up check of `codex --version`/`config.toml` `model` default in situ).

OpenAI's published Codex prompting guidance [9], directly relevant to skill body prose: use `apply_patch` (not ad hoc diffs) and the documented `shell_command`/`update_plan`/`view_image` tool schemas; batch independent tool/file reads via a single parallel call, never sequential one-by-ones "unless logically unavoidable"; truncate tool output to ~10k tokens, keeping head+tail with a `…N tokens truncated…` marker; **do not** prompt for upfront plans/preambles/status updates when migrating a harness (can cause premature stopping) unless targeting `gpt-5.3-codex`'s newer `phase` field (`commentary`/`final_answer`) which is required to avoid "significant performance degradation" if omitted; prefer a "bias to action" default-assumption framing over asking clarifying questions; keep final-answer formatting plain-text, minimal headers, backticked file/paths with `:line[:column]`, no nested bullets. Two selectable "personality" presets (Friendly vs. Pragmatic) are shipped as example system-prompt snippets, not skill-level constructs [9].

## 4. Cross-harness portability

Both vendors point at the same upstream spec [1][2][7], so the **safe portable subset** of frontmatter is: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (all agentskills.io-standard, per [1]). Everything else is a harness extension and risks silent mishandling on the other side: Claude Code's `context`, `hooks`, `disable-model-invocation`, `user-invocable`, `effort`, `model`, `paths`, `shell`, `arguments`/`argument-hint`, `when_to_use` are Claude-only [4]; Codex's per-skill `agents/openai.yaml` (policy, UI, MCP dependencies) is a **sibling file**, not frontmatter, so it doesn't collide with SKILL.md parsing on either side [7] — this is itself a portability pattern worth copying: put harness-specific config in a harness-named companion file, never in shared frontmatter, since Claude Code's own validator has been reported to silently reject unrecognised frontmatter keys (community bug report, secondary source, not independently verified here) [13].

Structural compatibility is strong: both harnesses use identical `scripts/`, `references/`, `assets/` conventions [1][4][7], both explicitly support **symlinked skill directories** and resolve to the target [4][7] — meaning a single canonical skill directory can be symlinked into `~/.claude/skills/<name>` and `~/.agents/skills/<name>` (or Codex's other scopes) without duplication, and both vendors document this independently. For tool-name portability, no vendor publishes an "if you have tool X else Y" pattern verbatim in these docs; Claude's own best-practice guidance to always fully-qualify MCP tools as `ServerName:tool_name` [3] and to explicitly declare/install dependencies rather than assume them generalises directly to a Codex/Gemini-CLI-portable phrasing: name the concrete tool/command your harness exposes, and fall back to a documented shell command when it's absent, keeping any harness-specific tool syntax in `references/` rather than the shared `SKILL.md` body.

## 5. Failure modes at 100+ skills, and mitigations

Documented, vendor-adjacent failure modes:
- **Silent load failure**: filename must be exactly `SKILL.md` (case-sensitive) — `skill.md` fails to load with **no error or warning** (GitHub issue on `anthropics/skills`, secondary/community source) [13].
- **Unsupported-frontmatter silent rejection**: a reported Claude Code validator bug drops extra attributes (`allowed-tools`, `hooks`) outside a small supported set without surfacing an error (community bug report) [13].
- **Under-triggering** is called out by Anthropic's own `skill-creator` as the default failure mode, not over-triggering — hence its "pushy description" guidance [6].
- **Index token cost is bounded, not unbounded, by design in Codex**: the always-loaded skill index is explicitly capped at 2% of context window / 8,000 characters, with automatic description-shortening and skill-omission-with-warning once a library is too large [7] — i.e. OpenAI has already engineered the mitigation Claude Code leaves to author discipline (500-line/5,000-token/100-token budgets are recommendations, not enforced caps, per [1][2][3]).
- **Description-overlap / mis-triggering at scale**: not documented by Anthropic or OpenAI with hard numbers in the sources reviewed here; secondary community analysis of function-calling in general (not skills specifically) describes accuracy degrading sharply past roughly 50 tools due to name/description overlap ("tool-space interference"), and estimates ~586 tokens/tool-schema average, scaling to multi-million-token indexes at 10,000 tools — **both figures are from independent blogs, not OpenAI/Anthropic, and are about function-calling tool schemas, not SKILL.md specifically; treat as directional, not authoritative** [secondary sources, unnamed in numbered list per policy of flagging non-primary].

Recommended mitigations, cross-referencing what's actually documented: (a) curated per-project/per-profile subsets rather than one global registration — Claude Code's enterprise/personal/project/nested/`--add-dir` layering already supports this natively [4]; (b) a router/dispatch skill pattern, informally analogous to Codex's own built-in `skill-creator`/`skill-installer` system skills acting as meta-dispatchers [7]; (c) lint/CI gates — `skills-ref validate` for spec conformance [1], plus a repo-local check for exact `SKILL.md` casing and directory-name/`name`-field match [1][13]; (d) held-out description-trigger evals — this is precisely what Anthropic's `skill-creator` workflow automates (parallel with/without-skill runs, graded assertions, benchmark aggregation) [6], and should be run per-skill before and after any bulk re-normalisation pass.

---

## Implications for the agentbox estate

1. Adopt the agentskills.io required pair (`name`, `description`) plus only `license`/`compatibility`/`metadata`/`allowed-tools` as the **portable frontmatter core**; move every Claude-only (`context`, `hooks`, `effort`, `model`, `paths`, `disable-model-invocation`, `user-invocable`) and Codex-only (`agents/openai.yaml`) construct out of shared frontmatter into harness-specific companion files [1][4][7].
2. Enforce `name` == directory name, lowercase-hyphen-only, ≤64 chars, no leading/trailing/double hyphens — a mechanical lint, not a style suggestion [1].
3. Rewrite every description in third person, "what + when", front-loaded keywords, and deliberately "pushy" triggers per Anthropic's own `skill-creator` guidance, since under-triggering (not over-triggering) is the documented default failure [3][6].
4. Cap description+`when_to_use` combined length awareness at 1,536 chars (Claude Code's listing truncation point) even though the spec allows 1,024 for `description` alone [1][4].
5. Enforce SKILL.md body <500 lines / <5,000 tokens across the whole estate; anything longer must be split into `references/`, one level deep only from SKILL.md [1][3].
6. Add a CI lint step checking exact `SKILL.md` casing and rejecting any unsupported/unknown frontmatter key before merge, rather than relying on silent harness-side rejection [1][13].
7. For any skill needed on both Claude Code and Codex, symlink one canonical directory into both `~/.claude/skills/<name>` and the appropriate `.agents/skills` scope — both harnesses independently document following symlinks [4][7].
8. Where a skill needs tool access control, use the shared `allowed-tools` field (marked Experimental by the spec) but do not rely on it as a security boundary on either harness without checking current enforcement behaviour per harness [1].
9. Build a held-out description-trigger eval set (3+ realistic prompts per skill) and run Anthropic's `skill-creator` with/without-skill benchmark workflow across the estate before and after any bulk re-normalisation, to catch both under-triggering and newly introduced description overlap [6].
10. Given Codex's hard 2%-of-context/8,000-char index cap with automatic shortening and skill-omission at scale, treat 130 skills as approaching a real ceiling on the Codex side specifically — prioritise the shortest, most discriminative descriptions and consider curated per-profile subsets rather than registering all 130 skills into every session [7].
11. Do not encode "always-on adaptive thinking" assumptions about Claude Fable 5.1 into skill prose as if vendor-documented; it is not confirmed in Anthropic's public Fable 5.1 materials as of this search — keep such prompting-style guidance in this project's own CLAUDE.md tier, not asserted as external fact inside shared skills [11].
12. For Codex-side skills needing UI/policy metadata or explicit non-triggering, use the documented `agents/openai.yaml` sibling file (`allow_implicit_invocation: false`, tool dependency declarations) rather than inventing custom frontmatter [7].

## Sources
[1] https://agentskills.io/specification
[2] https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview.md
[3] https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices.md
[4] https://code.claude.com/docs/en/skills
[5] https://code.claude.com/docs/en/commands
[6] https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
[7] https://developers.openai.com/codex/skills
[8] https://developers.openai.com/codex/agent-configuration/agents-md
[9] https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide
[10] https://openai.com/index/gpt-6-astra/
[11] https://www.anthropic.com/claude/fable
[12] https://github.com/openai/codex/blob/main/docs/skills.md
[13] Secondary/community sources (not independently verified against a vendor primary source): github.com/anthropics/skills/issues/314 (SKILL.md case-sensitivity); github.com/anthropics/claude-code/issues/25380 (frontmatter validator rejecting unsupported keys) — cited via third-party aggregation, treat as PLAUSIBLE not CONFIRMED.

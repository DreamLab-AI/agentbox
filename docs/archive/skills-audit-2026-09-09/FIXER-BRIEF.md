# Fixer brief — skills estate re-normalisation (queen-issued, 2026-09-09)

You are a FIXER in a ruflo mesh under a Fable 5.1 queen. You edit the MASTER COPY at
/home/devuser/workspace/project/agentbox/skills ONLY. Never touch /opt/agentbox/skills,
~/.claude/skills, ~/.codex/skills (running copies). Use Bash (cat/sed/heredoc/python3 for edits),
absolute paths, batch independent reads, do not re-ask for authorisation, UK English.
An adversarial VERIFIER will re-open every file you touch and re-run the lint; make their job easy.

## Inputs
1. /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/6aaaa96d-e4fe-4674-b639-1a5c879eba6f/scratchpad/FACT-SHEET.md — live infrastructure truth.
2. Your batch findings JSON (path given in your task). Each finding has evidence (file:line), a proposed fix,
   and cross_skill links. Apply every high and med finding. Apply low findings when they are cheap
   (a line or two). Where the QUEEN DECISIONS in your task contradict a JSON fix, the queen wins.
3. /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/6aaaa96d-e4fe-4674-b639-1a5c879eba6f/scratchpad/research/standards.md — cited external standards (agentskills.io, Claude Code, Codex).

## The contract every edited skill must satisfy (estate-wide, adopted by the queen)
C1  frontmatter `name` == directory basename, lowercase, hyphens only (agentskills.io §name; ruflo validator).
C2  `description`: ≤ 1024 chars, third person, states WHAT + WHEN + WHEN-NOT, keywords front-loaded, no marketing,
    honest about anything not baked into the image. It is the always-loaded trigger contract for both Claude and Codex.
C3  Keep existing extra frontmatter keys (do not mass-migrate); do not add new keys; drop only `estimated_time`
    and `difficulty` if present. Deprecated redirect stubs carry exactly: name, description (starts "DEPRECATED — merged
    into <x>."), deprecated: true, replacement: <x>.
C4  Depth lives in `references/` (one level below SKILL.md), executables in `scripts/`, data in `assets/`. Entry
    SKILL.md ≤ 250 lines. Sibling REFERENCE.md/EXAMPLES.md/docs-at-root move into references/ (update links).
C5  Every `claude-flow`/`ruflo` CLI example must be verified against the installed binary
    (`claude-flow <cmd> --help`, `claude-flow --help`); write `claude-flow …` (baked on PATH), never
    `npx claude-flow …` (resolves a stale cached version). MCP tools are named `mcp__claude-flow__<tool>`.
C6  Model names: current lineup is Claude Fable 5.1 (claude-fable-5-1), Opus 5, Sonnet 5, Haiku 4.5; OpenAI GPT-6 Astra
    (gpt-6-astra) via the baked Codex CLI; DeepSeek; Z.AI glm-5.3. Older ids may stay only in clearly historical
    context with a dateline ("(2026-05 example, not current)").
C7  Model-fit line: if a skill needs a Claude-Code-only affordance (Agent/fork/Task tool, Artifact, Skill tool,
    /route, claude-flow hooks, `claude mcp add`), add ONE sentence: "Claude Code only: <what>. On Codex / GPT-6 Astra:
    <fallback: run phases sequentially in one session / write the file and report its path / register the MCP server
    in ~/.codex/config.toml>." Do not pad.
C8  Not-baked tools: say so once, near the setup step ("not baked into this image; install with … / runs host-side").
C9  Endpoints/paths per the fact sheet: browsercontainer 8931 SSE, CDP 9223 in-network (9222 is host-mapped only),
    Loom façade ${LOOM_BASE_URL} is the consumer door, a retired address is dead, no `~/.claude/skills/…` or
    `/home/devuser/.claude/skills/…` absolute paths in skill docs (skill-relative paths or /opt/agentbox/skills),
    no literal `/workspace/`, memory via mcp__claude-flow__memory_* only.
C10 Cross-links: every skill that names a sibling gets a reciprocal mention in that sibling's "Related skills" /
    "When not to use" section. Add a short "Related skills" section where none exists.
C11 Prose: plain, one idea per sentence, prefer plain punctuation over em-dashes in NEW text, no superlatives,
    no "comprehensive/seamless/powerful". Targeted edits over whole-file rewrites unless the task says rewrite.

## Merge procedure (when your task says MERGE a → b)
1. Read both trees fully. Move a's unique depth into b/references/<topic>.md (one level), rewriting links.
2. Fold a's unique trigger phrases into b's description (respect the 1024 cap) and b's "When to use" body.
3. Replace a/SKILL.md with a ≤ 12-line redirect stub (C3 format) pointing at b and the moved reference; delete a's
   other files (they now live under b/references/). Keep the directory (the stub keeps direct invocations working
   for one bake cycle).
4. Fix every other skill that named a (grep -rl "\`a\`" skills/*/SKILL.md) to name b.

## Do NOT touch (queen-owned; report needed changes in your final message instead)
skills/SKILL-DIRECTORY.md · skills/skill-router/** · skills/registered-skills*.txt · skills/lint-skills.* ·
skills/mcp.json · agentbox.toml · CLAUDE.md · docs/** · scripts/** · .github/**

## Finish
1. `cd /home/devuser/workspace/project/agentbox && bash skills/lint-skills.sh` → must exit 0 (paste the last line).
2. `git -C /home/devuser/workspace/project/agentbox status --short skills/ | head -40` → paste.
3. Final message ≤ 350 words: what you changed per skill (one line each), any JSON finding you deliberately did
   NOT apply and why, and the exact directory/router/registry edits you need the queen to make.
   Do not commit.

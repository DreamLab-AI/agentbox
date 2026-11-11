# Skill Selection Diagrams

How a user turn becomes a skill recommendation, and which skills are allowed to be candidates.
References are to `config/hooks/lib/skill-route.cjs` unless noted, at the revision this file was
last edited with (2026-11-11, ADR-2196). Decisions: ADR-2091 (the live router), ADR-2192 (scope
`all`), ADR-2196 (gates, no half-installed skills).

---

## 1. Flow: one user turn through the routing hook

The entrypoint registers `config/hooks/skill-route.cjs` on `UserPromptSubmit` with an 8 s timeout
(`config/entrypoint-unified.sh:2767`), with the `[skills.routing]` settings inlined as environment
variables. The hook calls `route()` (`:701`) once per turn, logs the outcome (`appendLog`, `:905`;
metadata only, never the prompt) and injects at most 300 characters of advice
(`formatContext`, `:851`; `MAX_CONTEXT_CHARS`, `:54`). It never loads a skill itself: the model
decides.

```mermaid
flowchart TD
    T["User turn<br/>(UserPromptSubmit)"] --> H["skill-route.cjs hook<br/>config/hooks/skill-route.cjs:38"]
    H --> R{"route() :701"}
    R -- "router off, no key,<br/>slash command, under 24 chars" --> SK["skip: nothing injected"]
    R --> C["Candidate map<br/>(section 2)"]
    C --> B{"project bypassed?<br/>:762"}
    B -- yes --> SK
    B -- no --> CL["clampPrompt :545"]
    CL --> J["System One Choice<br/>all candidates + none<br/>(loopback proxy :8094)"]
    J -- "timeout (timer armed until<br/>body parsed :777-810),<br/>429/529, error" --> FO["fail open:<br/>nothing injected"]
    J -- "pick = none" --> SK
    J -- "pick = skill" --> V["verify shortlist<br/>jevPlan :619 / applyJev :654"]
    V --> F["formatContext :851<br/>at most 300 chars"]
    F --> M["model sees advice<br/>and may Read the SKILL.md"]
    R -.-> L["appendLog :905<br/>~/.claude/skill-route.jsonl"]
```

`skill_intent` is off (`agentbox.toml`, `[system_one.consumers]`), which halves each turn's input
for identical picks (measured 2026-11-11); `skill_verify` stays on
(`services/agentbox-manifest/src/system_one.rs:476-480`).

## 2. Flow: which skills may be candidates

`loadCandidates` (`:235`) reads every `skills/<name>/SKILL.md` in the baked tree
(`/opt/agentbox/skills`), using only the leading frontmatter block (`frontmatterBlock`, `:188`).
Extras come from enabled plugins and account-synced skills (`loadLoadableExtras`, `:328`), minus
those that need the Claude desktop app (`DESKTOP_ONLY_SYNCED`, `:304`), and a baked skill always
beats an extra of the same bare name (`dedupeExtras`, `:388`).

```mermaid
flowchart TD
    S["skills/name/SKILL.md<br/>(frontmatter only, :188)"] --> D{"has a description?"}
    D -- no --> X["not a candidate"]
    D -- yes --> G{"names a gate?"}
    G -- yes --> GO{"gate literally true in<br/>agentbox.toml beside the tree?<br/>gateOpen :220"}
    GO -- "false, absent,<br/>unreadable" --> X
    GO -- true --> OK["candidate<br/>(routed as live)"]
    G -- no --> ST{"status"}
    ST -- "deprecated, superseded,<br/>not-installed, router-only<br/>EXCLUDED_STATUS :93" --> X
    ST -- "live or absent" --> OK
    P["plugin and synced skills<br/>loadLoadableExtras :328"] --> DO{"desktop-only?<br/>:304"}
    DO -- yes --> X
    DO -- no --> DD{"baked skill with the<br/>same bare name?<br/>dedupeExtras :388"}
    DD -- yes --> X
    DD -- no --> OK2["candidate (extra)"]
```

Since ADR-2196 no skill in the tree carries `not-installed` or `superseded`: a skill whose tool is
missing is either baked (semgrep, gitleaks, trivy, jj) or deleted. `router-only` remains for index
skills that sit behind another (`skill-router`, `browser-automation`), and `gate:` is the only way
to ship a skill that is deliberately off (`payment-router`, gate off; `voyager-skill-library`,
gate on).

## 3. How accuracy is measured

The labelled corpus is `tests/system-one/routing-cases.json` (184 cases; the original 86 are the
regression gate, the 98 added on 2026-11-11 were co-written with the descriptions they score). It
is scored through `lib.route` itself, not through `skills/system-one/scripts/route-eval.mjs`,
whose instrument has no `none` option and no plugin or synced extras. Two identical runs differ by
about one case, so a change of one case is noise.

```mermaid
flowchart LR
    CASES["routing-cases.json<br/>184 cases"] --> RT["lib.route<br/>scope all, intent off"]
    RT --> JUDGE["System One judge"]
    JUDGE --> SCORE["exact-match score<br/>original 86: 83<br/>new 98: 98"]
    CASES --> CT["routing-corpus.test.mjs<br/>schema, none share,<br/>late-discriminative flag,<br/>repo = baked descriptions"]
```

The last assertion in `tests/system-one/routing-corpus.test.mjs` (repo descriptions equal the
baked ones) fails inside a running container after any description edit until the next rebuild;
CI has no baked tree and skips it.

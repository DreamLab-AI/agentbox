---
id: ADR-2091
title: Route each turn to a skill with one typed judgement, failing open to the table
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: b680a7aeef604276af73e00e1eb5156f379530ae
verified_paths: [config/hooks/lib/skill-route.cjs, config/hooks/skill-route.cjs, skills/skill-router/scripts/route.mjs, config/entrypoint-unified.sh, tests/config/skill-route.test.js]
owner: jjohare
review_trigger: the first project that needs a per-project routing bypass (ADR-2090), a Jev model change, or a measured runtime-path accuracy below 85% on the 40-item set
repo: agentbox
---

# ADR-2091 — Route each turn to a skill with one typed judgement, failing open to the table

## Context

Skill discovery was two mechanisms: twenty always-loaded descriptions (~2,900 tokens per
turn, $0.0014 in Opus cache reads) and `/route` reading a 127-row table into context
(~$0.08). ADR-2089 measured that a System One Choice over the full fleet routes at 90% soft
accuracy for $0.00066; ADR-2090 accepted the egress of the routing prompt for this use only.
What remained was the runtime: where the judgement plugs in, how it is switched, and what
happens when the judge is slow, rate-limited or absent. The estate already has the seam — a
`UserPromptSubmit` hook registered by the entrypoint from a manifest gate, off by default and
byte-identical when off (ADR-2020, ADR-2068).

## Decision

1. **`[skills.routing].router` is the switch: `"jev"` (default) or `"table"`.** `"table"` is
   the pre-2091 system exactly — always-loaded descriptions self-trigger, `/route` reads
   `routing-table.md` — and it is never removed, because it is also the fallback.
2. **One library, two consumers.** `config/hooks/lib/skill-route.cjs` owns the candidate map,
   the wire shape, the outcome vocabulary (`routed` / `skipped` / `failed`) and the log line.
   `config/hooks/skill-route.cjs` (the per-turn hook, `hook = true`) and
   `skills/skill-router/scripts/route.mjs` (the `/route` command) do nothing but call it.
3. **The judgement is one Choice per turn.** Every routable skill's frontmatter
   `description` is its option rubric; ADR-2089 `status` is composed at the point of use
   (`gated` annotated; `deprecated`, `superseded`, `not-installed`, `router-only` never
   offered — `skill-router` itself now carries `router-only`); a `none` option lets the judge
   decline conversational turns. The user's turn is the state, clamped head+tail at 12k chars
   to stay inside the judge's budget.
4. **Fail-open is the contract.** Timeout, 429/529, any HTTP or parse error, a missing
   `TYPESAFE_API_KEY`, a turn under `min_prompt_chars`, a slash command, or a `none` pick ⇒
   `{result:"continue"}` with no injection. The hook never retries; `/route` retries twice
   because a human asked and is waiting. A fallback is the normal path, reported as
   `router: table (fallback: <reason>)`, not an error.
5. **The pick is advisory; its probability is not a gate.** The injected line is one short
   ranking — `[route] x 0.91 · y 0.05 · z 0.02 — advisory; load a skill only if it fits this
   turn.` (~33 tokens, paid in the primary model's input on every routed turn) — whose job is
   to surface the options, not to argue for one. A wrong pick was measured at 0.94
   (ADR-2089); no threshold rule exists in this design and none may be added without a
   measured local calibration.
6. **BOOT-class, inlined.** The entrypoint reads the section with `_ab_toml_*`, inlines
   model/timeout/min-chars into the registered command as `AGENTBOX_SKILL_ROUTE_*`, publishes
   the same to `runtime-env.sh` for shells, and on `"table"` or `hook = false` filters the
   registration back out. Schema block, E073 (enum) and W071 (jev without key), and a
   catalogue entry (`skill-router`, gate `skills.routing`, `boot`) accompany it.
7. **The log never carries the prompt.** `~/.claude/skill-route.jsonl` records outcome,
   reason, model, pick, confidence, candidate count, prompt length, latency, input tokens and
   cost. The prompt left the network by decision (ADR-2090); it does not also get persisted.

## Consequences

- Routing sees all routable skills on every turn instead of a curated twenty, at less than
  half of one turn's residency tax for those twenty. Per-turn latency rises by ~0.7–1.1 s
  when the judge is asked; short and slash turns are never sent.
- Runtime-path measurement (2026-09-16, 3 reps × 40 items, 115 candidates + `none`): 36.0/40
  soft (90%), 3 `none` picks, 0 failed calls in 120, 676 ms and $0.00062 per route — the same
  headline as the offline rig, so the exclusions and `none` cost nothing measurable.
- The rig and the runtime are measured separately and must stay so: `route-eval.mjs` answers
  "how well do descriptions discriminate", `route.mjs --eval` answers "what does a turn get".
- Per-project bypass remains the open debt (ADR-2090). `[skills.routing]` has no per-project
  key; the first project that cannot accept egress needs one before it runs.
- `activation_status: staged`: the hook is registered in the running container on the repo
  path and becomes the baked path at the next boot; nothing here needs a rebuild.
- Build order item 1 (re-choose the always-loaded twenty by measurement) is unchanged and
  still cheaper than anything else on the list.
- **Mid-run routing is analysed, not built.** Routing every model step is bounded against
  recursion only by an event blocklist and inject-on-change, and its cost is dominated by the
  injected lines' context residency (~$0.19 re-read vs $0.09 judge on a 150-step turn), not
  by the judge. The plan — replay recorded trajectories offline first, then a default-off
  `mid_run` gate on `PostToolUse` — is in
  `skills/system-one/references/routing-cost-and-scope.md` §Mid-run routing.

## Verification

At `verified_commit`:

- `HOME=<scratch> node_modules/.bin/jest tests/config/skill-route.test.js` → 23 passed:
  off-by-default (no env / `table` / no key / short / slash), routed (injection text, one
  Choice with `none`, log without prompt, model honoured, clamping), fail-open (timeout,
  429, 529, 500, malformed JSON, wrong shape, unreachable, no retry), CLI (ranked output,
  `--router table`, degrade with reason after retrying, `--json`, manifest read in an
  unbooted shell). The fake judge is a local `http.Server`; nothing leaves the machine.
- `node scripts/agentbox-config-validate.js agentbox.toml` → no new findings; a `router =
  "jevv"` copy → `E073`; the same manifest without `TYPESAFE_API_KEY` → `W071`.
- `bash -n config/entrypoint-unified.sh` → clean. `bash skills/lint-skills.sh` → `OK — skills
  estate clean (127 skills … 0 warnings)` with `skill-router` at `status: router-only` and the
  routing table regenerated.
- Live: `echo '{"prompt":"…diagrams…"}' | AGENTBOX_SKILL_ROUTER=jev node config/hooks/skill-route.cjs`
  → `[SKILL ROUTE] jev-1.13.0 picked \`diagrams-as-code\` … (p=1.00 …)` in 1.16 s; the
  conversational turn → `{"result":"continue"}` (`none` at 0.98); gate off → no request.
- `node skills/skill-router/scripts/route.mjs --eval skills/system-one/scripts/items.json
  --reps 3` → `36.0/40 (90%) · none-picks 3 · failed calls 0/120 · 676 ms/call ·
  $0.000620/call`.
- First real dispatch: a standing project-state item (nested `block_on` in the ontology
  query handlers) routed to `rust-development` at 0.92 with `build-with-quality` at 0.07.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by `config/entrypoint-unified.sh` alone (`0950527d3`, ADR-2093, purely additive elsewhere in the file); the four other governed paths are unchanged since the previous anchor. Decision point 6 re-established at `HEAD`: the section is read with `_ab_toml_val` / `_ab_toml_bool` / `_ab_toml_int` (`:2037-2042`), `AGENTBOX_SKILL_ROUTER` / `_ROUTE_MODEL` / `_ROUTE_TIMEOUT_MS` / `_ROUTE_MIN_CHARS` are inlined into the registered command (`:2051-2052`) and published to the runtime-env file for shells (`:2660-2663`), and `router = "table"` or `hook = false` still filters the registration back out (`:2065-2078`, logging "de-registered routing hook"). Claim STILL TRUE. Verified against committed `HEAD` deliberately: `config/hooks/lib/skill-route.cjs` carries uncommitted working-tree changes that this record does not cover.

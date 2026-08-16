# ADR-055: Dream cockpit panel — surface the nightly dream loop on the operator console

- **Status:** Accepted
- **Date:** 2026-08-16
- **Relates to:** [ADR-044](ADR-044-operator-console.md) (operator cockpit `:8444`),
  [ADR-052](ADR-052-dream-machine-hp-annexe.md) (dream engine + HP annexe),
  [ADR-045](ADR-045-sovereign-ingress-npub-front-door.md) (ingress posture)

## Context

The dream engine (`services/dream-engine`, ADR-052) runs a nightly evidence-gated
evolution cycle per nominated repo and appends a verdict row to that repo's
`docs/dream-cycle/LEDGER.md`. Today its only surfaces are headless: a background
loop (tmux/supervisord) and the `/dream` slash command. There is **no browser
surface** — nothing an operator opens to see recent nights, verdict distribution,
or the draft PRs a night produced.

The operator cockpit (`:8444`, ADR-044) is exactly where that belongs. Its remit is
the human **judgment-broker** surface — sessions, approvals, governance — the place a
human acts on what the machines proposed. The dream engine's core invariant is
*evaluation is not promotion — a human merges the draft PR*. That merge **is** an
approval; showing the pending draft PRs on the cockpit makes the judgment-broker
action first-class, consistent with `/approvals`.

## Decision

Add a **read-only** `/dream` surface to the cockpit:

1. **Data** — a management-api (`:9090`, Fastify) route plugin `routes/dream.js`
   exposing `GET /dream/status`: discover nominated repos (`$WORKSPACE/*/dream.config.json`,
   the same single-level scan the engine uses), parse each repo's ledger, and return
   aggregated JSON — per-repo recent nights, verdict distribution, last-night date, and
   the Issue/PR references each row already carries. Parsing lives in a pure, tested
   `lib/dream-ledger.js`.
2. **Auth** — operator-gated, **not** public. `/dream/*` is absent from the
   management-api auth-skip allowlist, so the existing `preValidation` auth applies
   exactly as it does for `/approvals` and `/mgmt`. The estate's repo-evolution state
   is operator-only.
3. **View** — a static page `voice/console/site/dream.html` (served by the console's
   static handler at `/dream.html`) that fetches `/dream/status` and renders the ledger
   with links **out to GitHub** for the merge. A nav entry is added to `#surface-nav`.
4. **Route** — one Caddy block `handle /dream/*` reverse-proxying to `agentbox:9090`
   with `header_up Authorization` (no path strip, mirroring `/lo` + the `/approvals`
   auth forwarding). The API path is `/dream/*`; the view is `/dream.html` — distinct,
   no collision with the static catch-all.

### Boundaries (deliberate)

- **Read + link, never act.** The cockpit shows the ledger and links to the GitHub PR;
  the merge stays on GitHub under the existing gate. No new write path, no widened
  trust surface — the same posture as the linked-object viewer.
- **Byte-identical when off.** The panel reads ledgers that may not exist; with no
  nominated repos or `[dream_machine].enabled = false`, `GET /dream/status` returns an
  empty, well-formed payload and the nav entry is inert. No new manifest gate is
  required — it is a read-only view over files that are already there.
- **Path safety.** `ledgerPath` from a repo's `dream.config.json` is rejected if it
  escapes the repo directory — lexically (no absolute paths, no `..` traversal) **and**
  on the real path (`realpathSync` containment, so a symlink cannot point the read
  outside the repo), with a read-size cap. Estate-controlled files, but this is the
  defence the panel advertises, so it is enforced, not assumed.

## Consequences

- The operator gains a browser view of the mesh's self-improvement and the draft PRs
  awaiting their signature — closing the judgment-broker loop the cockpit exists for.
- Additive and honest: read-only, operator-gated, no write surface. If the dream engine
  is disabled or a repo has no ledger, the panel is simply empty.
- Follow-on (not in scope): a live count of open `dream/*` draft PRs via the git bridge,
  and a `did:nostr`-signed per-cycle identity so a dream row links to its signed actor.

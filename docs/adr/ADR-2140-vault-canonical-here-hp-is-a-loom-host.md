---
id: ADR-2140
title: Keep the vault canonical on this host, reconcile the HP Loom to it at every boot, and retire the HP agentbox
date: 2026-10-13
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: da588dfc9de94753ea700774eacaea3ebffd1fa9
verified_paths: []
owner: jjohare
review_trigger: the first rebuilt image has booted and written a reload receipt (then re-verify, fill verified_paths and set verified_commit); any proposal to run an agentbox on the HP again; any proposal for the HP to read the vault directly; a second consumer of the built generation
repo: agentbox
---

# ADR-2140 — Keep the vault canonical on this host, reconcile the HP Loom to it at every boot, and retire the HP agentbox

## Context

The vault source is the `visionGraph` git repository on this host (`[vault].repo`, ADR-2028). On
2026-10-13 the HP held no copy of it. It held the Loom's *built* bundle (`~/githubs/loom/data`,
generation `visionGraph@45976a8c7`), served by `loom-facade-a`, and a user timer
(`loom-generation-reload`) that verifies and reloads whatever lands in `data/`. A Logseq-era copy had
drifted on this host (`workspace/vault`, `workspace/vault-working`, 2.2 GB, untouched since
2026-09-02), and the HP ran a second agentbox (`docker-compose.hp.yml`) built for federation work
that was drifting from this node.

loom ADR-141 fixes a generation's identity as `visionGraph@<sha>` plus a content digest; loom ADR-135
and ADR-136 D4 require that a generation is never half-written. Loom's own
`docs/published-generation-reload.md` already documents the pipeline that produces one: build from a
clean checkout with a released `ontomark`, promote and verify the bundle, copy it to the HP under an
in-flight marker without `--delete` (the directory also holds `ledger.jsonl`), and let the HP timer
reload. It was a manual procedure, which is why the HP drifted behind the vault whenever nobody ran
it. An earlier draft of this ADR proposed an NFS export so the HP could build from the vault. That was
withdrawn on reading that procedure: the HP has neither `ontomark` nor a use for the vault, and
exporting the object store would have exposed every committed `working/` page to it.

## Decision

1. **D1 — One canonical vault, here.** The `visionGraph` repository on this host is the only source.
   Nothing on the HP, and no stale local directory, holds a second copy. `[vault]` stays the single
   path authority.
2. **D2 — The HP serves a built generation, never the vault.** The only thing that crosses to the HP
   is the output of `ontomark build` for a *committed* HEAD, after `promote_vault_build` and the
   `reload_published_generation verify` check have passed. The HP never reads the repository, so the
   private `working/` pages and the git history stay on this host.
3. **D3 — Automate the documented pipeline; add nothing to it.** `scripts/hp-loom-reconcile.sh` does
   exactly what the loom document describes. It compares the vault HEAD with the id the Loom serves at
   `/loom/generation`. If they agree it does nothing at all (no build, no ssh, no Loom recreate). If
   they differ, in `full` mode, it builds HEAD from a clean **detached worktree** (so uncommitted edits
   can never be served), promotes and verifies, streams the bundle to the HP, swaps it into `data/`
   under the in-flight marker with a `data.rollback` copy and a restore-on-error trap, starts the HP's
   own verifying reload, and waits for the Loom to serve the new id. A bundle that does not verify as
   `visionGraph@<HEAD>` is never sent.
4. **D4 — A rebuild reconciles implicitly.** The entrypoint (Phase 5d(iii)) prints the previous
   receipt and starts the script in the background on every boot, so rebuilding the image re-checks,
   updates and reconnects the HP without a step to remember. It is fail-open: every problem is recorded
   in `~/.local/state/agentbox/hp-loom-reconcile.json` and the script exits 0; a `timeout` bounds a
   wedged ssh or build; a lock allows one run at a time. `[vault].loom_sync` is `off | check | full`;
   `loom_url` and `loom_host` carry the estate addresses, so the script hardcodes none.
5. **D5 — Retire the HP agentbox.** `docker-compose.hp.yml` and `docs/developer/hp-peer-node.md` are
   deleted. The HP node's `agentbox-core` pubkey is removed from
   `[interaction_plane.proxy].allowed_pubkeys`, because that identity was destroyed with its volumes.
   Federation work restarts from a clean node under a new record if it resumes. The dream-engine annexe
   (ADR-052) is a separate SSH working directory and is unaffected. On the HP itself, the agentbox and
   campaignbuilder containers, volumes, images and checkouts were removed on 2026-10-13 after confirming
   the campaignbuilder history was on GitHub and the HP ruvector database was empty.
6. **D6 — Use the Loom's live `/mcp`.** loom ADR-140 phase P0 is shipped and answering on `:8084`.
   `skills/ontology-augment` calls `loom.neighbours`, `loom.paths` and `loom.browse` over it, resolves a
   page title by exact title match through `loom.browse` (never by slugifying), counts the real result
   shapes, and falls back to `vault tree` only when the Loom did not answer. The owner overrides loom
   ADR-140's P1 measurement gate to start P2; that override is to be recorded in the loom repository's
   disposition and is not yet (see Consequences).

## Consequences

- One source and one write path: nothing on the HP can diverge, and a generation id names exactly one
  commit. A vault edit reaches the Loom only after it is committed, and then only at the next boot or
  the next manual run of the script.
- `ontomark` baked here is 0.2.0 while loom's `deploy/ontomark-release.env` pins the `v0.1.0-rc.1`
  asset (CLI 0.1.0). The reconcile does not enforce either pin; the promote and verify steps are the
  compatibility gate, and a bundle they refuse is never sent. Aligning the two pins is a separate
  change.
- A `full` run builds for about two minutes on this host. It runs in the background, so it never
  delays a boot, but the Loom lags the vault by that long after a rebuild that follows a commit.
- The reconcile needs `promote_vault_build` and `reload_published_generation` at `LOOM_BIN_DIR`
  (default `~/workspace/loom/target/release`) and a direct ssh path to `loom_host`. Without them it
  records `degraded` and does nothing.
- The loom repository still tracks `data/ontology-corpus.rvdb*`, which dirties the HP checkout on every
  promotion. Untracking them, amending loom ADR-140's status and recording the P1-gate override are
  loom changes, not yet made. The reconcile never runs `git pull` on the HP, so it is unaffected.
- ADR-2118 and ADR-2122 list `docker-compose.hp.yml` in `verified_paths`. Their decisions stand; their
  staleness is cleared by the ADR-pack re-verification.

## Verification

- HP inventory, 2026-10-13: no vault copy, no Logseq tree and no GitHub data sync existed on the HP;
  the only recurring job was `loom-generation-reload.timer`; `loom-facade-a` was healthy before and
  after every removal.
- A snapshot build of the committed HEAD from a detached worktree took 2 min 16 s, promoted 9,244
  records in 6 s and verified as `visionGraph@45976a8c7…`, the id and class count the HP already serves
  (so the build is reproducible).
- `tests/config/hp-loom-reconcile.test.sh`: 30 passed, 0 failed, against a stubbed `ontomark`, Loom
  binaries, `ssh` and Loom. It covers: idempotence, fail-open for every failure, the clean-worktree
  guarantee, nothing uploaded on a promote refusal, the restore trap, the lock, and no hardcoded
  estate address.
- `scripts/hp-loom-reconcile.sh --mode check` against the real Loom and vault: `current`, with the 13
  uncommitted files correctly ignored.
- `tests/skills/ontology-augment-grounding.test.sh`: 86 passed, 1 failed. The failure (`validate:
  still enveloped with generation`) also fails on `main` and is not caused by this change.
- Not verified: a full-mode run against the real HP (the HP is already current, so a real push needs
  a new commit), the entrypoint phase in a booted image, and the Nix image. `verified_commit` is the base commit (da588dfc9) the change was made on, and `verified_paths` is empty
  on purpose: both are to be set once the first rebuilt image has booted and written a receipt.

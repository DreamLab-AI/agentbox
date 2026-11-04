# J2 verdict: foundations and risk

Judge: Opus lead, lens FOUNDATIONS AND RISK. Written 2026-09-21 from the five researcher
reports plus my own read-only verification. Where I cite a report I also say whether I
reproduced it, because three of the load-bearing claims in the pack are wrong and two of
them change a candidate's rank.

The question this lens answers: what is quietly costing the estate every day, what bites
first, and which single fix removes the most drag from every other programme.

---

## 0. What I verified myself, and what changed

Everything below was run read-only from this container on 2026-09-21. The corrections
matter more than the confirmations, so they come first.

### 0.1 Corrections to the researcher pack

**(a) RB-health-debt §5 and §2.2 are wrong about ADR staleness, and wrong in a way that
inverts the finding.** RB reports "2 stale, not 15" and calls the brief's figure
historical. I ran both gates:

```
project (host):     node scripts/adr-index-gen.js docs/adr --check
                    -> error: 15 validation error(s); README not generated
project/agentbox:   node scripts/adr-index-gen.js docs/adr --check
                    -> ok: 96 ADR(s) valid
```

RB ran the agentbox gate and reported the result as the host's. The host is at 15 stale;
agentbox is at zero, because commit `b7b1ab81a` (today) re-verified ADR-2009 and ADR-2010.
So the true picture is the reverse of RB's: the repo that has the discipline has it
working, and the host ledger, the larger of the two at 108 records, cannot regenerate its
own README. RA-ledgers §2 has this right and lists all fifteen, six of which amend
`src/main.rs` alone. Believe RA.

**(b) RB's "shared 2026-09-15 cause" behind the five red repos is falsified.** I pulled
the per-workflow runs out of `VisionFlow/website/static/data/estate-health.json`:

| Repo | Failing workflow(s) | When | Same-batch workflows that PASSED |
|---|---|---|---|
| VisionFlow | Diagrams-as-code index gate | 09-15T22:20 | Copyright Source Guard, Harness Fitness Gates (run ids 350304345xx, same push) |
| VisionClaw | CI 09-16, Documentation Quality 09-15 | two pushes | Ontology Federation CI/CD, XR Godot CI |
| agentbox | CI, Security Invariants, ShellCheck, TUI tests | **09-21T07:4x, today** | Contract tests, Manifest validate, Secret Scan |
| nostr-rust-forum | CI, Security Audit | 09-15T22:21 | none |
| loom | Rust contracts | 09-13T17:37 | none |

If a shared action pin or runner image had broken, it would have taken the green
workflows in the same run batch with it. It did not. These are five independent, small,
per-repo failures that cluster on 09-15 only because that is when several repos last
pushed. Cost of the set is hours, not a sprint, but there is no single fix.

**(c) RB is wrong that agentbox's four same-day reds are pre-existing rot re-surfaced by a
docs-only commit.** Today's agentbox history contains real code: `6fbbb43eb feat(system-one)`,
`b3425865b fix(router,compaction)`, plus new `services/laya-engine/entrypoint.sh` and
`services/openjev-engine/entrypoint.sh`, and edits to `agentbox.sh` and
`config/entrypoint-unified.sh`. I reproduced one of the failures locally:

```
node scripts/ci/check-manifest-catalogue.js   -> exit 1
FAIL: 3 toml boolean key(s) with no catalogue entry:
   skills.colloquy.reflect_candidates
   features.jev_compaction.enabled_by_default
   interaction_plane.proxy.preserve_host
```

That is the ADR-039 gate-path parity rule, failing because today's feature landing added
gates without catalogue entries. The gate is working. The commit discipline is not. This
is a better diagnosis than RB's: it means agentbox's red is a fifteen-minute fix, and it
means the estate is landing features faster than it is honouring its own invariants, on
the same day it wrote twelve new settlement ADRs.

For the record, every other cheap invariant I could run locally is green:
`--check-index` in sync, `skill-count-check` ok, `gen-routing-table --check` current,
`check-crate-licensing` ok, `federation-fixture-check` PASS, `lint-skills` clean.

**(d) RD's "57 registered / 137 baked / 23 live" skills gap does not exist.**
`skills/registered-skills.txt` is 57 lines, of which 37 are comments and blanks. There are
**20** registered names. I diffed them against `~/.claude/skills`:

```
registered but missing live: (none)
live but not registered:     SKILL-DIRECTORY.md, env.sample, synced
```

The reconciler is doing exactly what ADR-2092's sibling is meant to do. The only residue
is a count drift (`lint-skills.sh` says 127 skills, `/opt/agentbox/skills` has 137
directories). Strike "the 57/137/23 skills gap" from the candidate list: it is a counting
artefact, not debt. RD's other findings held up.

### 0.2 Confirmations, with new evidence

**The MCP hub is the best finding in the pack, and it is worse than RB says.** Confirmed:
`supervisorctl status agentbox-mcp-hub` reports RUNNING with four minutes of uptime; there
is no listener on 9720 in `ss -tlnp`; the error log is an unbroken ladder of
`waiting for hub config path=/run/agentbox/mcp-hub.json waited_s=...`. The new evidence is
in the directory listing:

```
/run/agentbox/bootstrap.done   Sep 18 13:32
/run/agentbox/mcp-hub.json     (absent)
```

The boot marked itself **done** on 18 September while one of its own projections had
silently not happened, and the hub has crash-looped for three days behind a green status
line. That is not a missing feature, it is the boot path failing soft in a codebase whose
owner's first stated framework is "fail hard not soft", and whose own
`BASELINE-container.md` invariant presents the bounded wait as resilience. Seven MCP
servers have been dark in every session since. RD is also right that six of the seven are
additionally un-gated (`AGENTBOX_CONSULTANTS_ENABLED` unset) and that
`~/.claude/settings.json` pins `consultant-codex` to a stale `/nix/store` path, breaking
the estate's own written rule. Both are true at once: the catalogue is off and the proxy
that would serve it is broken.

**Voice.** `agentbox.toml:1681` `[voice] enabled = false`; `docker ps` shows
`agentbox-voice-frontend-1`, `agentbox-voice-backend-1`, `voice-console` and
`agentbox-voice-traefik-1` up 9 to 11 days, healthy, on `:8444`/`:8443`. The manifest
under-reports live attack surface. Confirmed.

**Autonomy is live and unjournalled.** Four unattended schedulers have been running for
three days: `dream-engine`, `forum-backup-cron`, `ontology-condense-scheduler`,
`podcast-cron`. Code execution is live (the code-interpreter MCP is in this session's tool
list). `docs/GOVERNANCE-capabilities.md:261-266` names this as its own TOP OPEN RISK in
first-party words, and `ADR-2071` (journal the nightly dream cycle) has sat
`decision_status: proposed / implementation_status: none` since 05 September. Confirmed.

**The payments loop is hollow, and it is the foundation PRD-024 wants to build on.**
`docs/proposals/sovereign-settlement.md:61` names three independent did:nostr-keyed sats
ledgers (solid-pod-rs `StoragePaymentStore`, host `FsPaymentStore`, forum `pod-worker` D1),
"None synced; the host's `.deposit` is a 501 stub". I confirmed the 501 at
`src/handlers/pay_handler.rs:487`. And the authority class that is supposed to gate
irreversible spend is inert: `payment_settlement = "zero-tolerance"` exists at
`agentbox.toml:980` and `:1028`, but `grep` for production callers of `classifyAction` /
`actionClass` returns only `broker-bridge.js` and `llm-marketplace.js` (`mandate_revoke`),
plus the test suite. Nothing in production ever classifies an action as
`payment_settlement`. Confirmed: the gate gates nothing.

**VisionFlow's unwired flags, with a correction.** RB says two. There are five warnings at
`src/app_state.rs:930-943`: `enableTls`, `enableHttp2`, `enableRateLimiting`,
`enableMetrics`, `enableRequestValidation`. Two are security-relevant, which is RB's point,
but an operator has five ways to believe they configured something that does nothing.
Three live 501 handlers confirmed (`graph_export_handler.rs:272,309`, `pay_handler.rs:487`).

**Contamination.** 13 stashes, all in `project`, five explicitly agent-contamination
rescues (`stash@{0,1,4,5,6}`). RE has this right and it is the constraint on how the next
cycle is executed, not just a finding. See §5.

**solid-pod-rs.** `README.md:240` states `cargo audit --deny warnings` fails on
`RUSTSEC-2026-0258` in both shipped crates, while estate-health shows the repo green.
Green CI here means "the suite that is wired passes", not "audited". Confirmed.

---

## 1. Ranked table

Scoring 1 to 5. **Cost is inverted** (5 = cheapest) so that a high total is a better bet.
"Unblocks" is what it frees for other programmes. "Fit" is against the owner's stated
frameworks: fail hard not soft, re-engineer do not patch, deprecate by removing, iteration
over perfection, directional alignment, Wardley, DDD, big jobs in one shot.

| # | Candidate | Value (lens) | Cost (5=cheap) | Risk if NOT done | Unblocks | Fit | Total |
|---|---|---|---|---|---|---|---|
| **1** | **C1' Signal floor and safety floor** (my narrowing of C1, absorbing C6-min and C8g; §2) | 5 | 4 | 5 | 5 | 5 | **24** |
| 2 | C6-min Execution journal over the four live schedulers only, no policy pipeline | 5 | 4 | 5 | 3 | 5 | 22 |
| 3 | C8g Correct the three overstated public claims (my addition; RC §2.2) | 4 | 5 | 5 | 2 | 5 | 21 |
| 4 | C7 Wire `payment_settlement` and collapse the three ledgers to one writer | 4 | 4 | 4 | 4 | 4 | 20 |
| 5 | C6 Full governance debt (journal ADR-057 plus policy pipeline ADR-059) | 5 | 2 | 5 | 3 | 5 | 20 |
| 6 | C1 as briefed (broad hygiene sprint plus an ADR freeze by promise) | 4 | 3 | 4 | 4 | 2 | 17 |
| 7 | C8a Unblock campaignbuilder's second tenant (five admin items, zero engineering) | 3 | 4 | 4 | 3 | 3 | 17 |
| 8 | C4 Loom PRD-028 **pilot only** (400-800 units, not the 200-hour study) | 3 | 3 | 3 | 3 | 5 | 17 |
| 9 | C8e Resona commercial negotiation (no engineering moves it) | 2 | 5 | 3 | 2 | 3 | 15 |
| 10 | C9 Finish-what-is-partial (AoE plane or XR; skills is already finished, see §0.1d) | 3 | 3 | 2 | 3 | 4 | 15 |
| 11 | C8d Publish personal-context-portfolio (no counterparty needed) | 2 | 5 | 1 | 2 | 4 | 14 |
| 12 | C8f UKRI IRIS letter of support | 2 | 4 | 3 | 2 | 3 | 14 |
| 13 | C5 PRD-023 façade (full) / C5-min the one ADR-2095 measurement run | 2 / 3 | 3 / 5 | 2 | 2 | 3 | 12 / 16 |
| 14 | C8b docBox plus ACHD as one NHS pitch | 2 | 2 | 3 | 2 | 3 | 12 |
| 15 | C8c Productise Pingle BNG | 2 | 3 | 2 | 2 | 3 | 12 |
| 16 | C2 Sovereign settlement P0 (sidestr) | 2 | 1 | 2 | 2 | 2 | 9 |
| 17 | C3 Federation layer and repo | 1 | 1 | 1 | 1 | 1 | 5 |

Notes on the two lowest. **C2 scores 2 on value through this lens not because sidestr is a
bad idea but because it would be built on three unsynced JSON ledgers, a 501 deposit
endpoint and an authority class with no production caller (§0.2). Fit scores 2 because
"directional alignment" fails when the direction rests on an unbuilt floor, and because
PRD-024 reopens four previously ratified positions (RA §5.3) while twenty-five
proposed-but-unbuilt records already sit in the estate (RA §6).** **C3 scores 5 total
because the owner's own closeout already froze it** ("declare standalone-first as the
supported deployment mode; mesh federation is designed, not shipped and parked",
RC §4 citing `ecosystem-map.md:132`), no external party is recorded asking for it
(RC §4), and the estate currently markets it as `integrated`. Building it now would
resolve a marketing claim by engineering rather than by correction, which is the most
expensive possible way to be honest.

---

## 2. The single best next-cycle focus

**C1', two to four weeks: make the estate's own signals load-bearing again, and journal
the autonomy that is already running.**

This is C1 narrowed until it stops being a mop, plus the cheapest half of C6, plus the one
external-risk item from C8. Three workstreams, in order.

**W1, days 1 to 4: the signal floor.**
- Fix the five reds as five separate small fixes (they are not one cause, §0.1b).
  agentbox first, and specifically the three uncatalogued keys I reproduced.
- Re-verify the 15 host ADRs against current `src/main.rs`, `binary_protocol.rs`,
  `docker-compose.unified.yml`, `ci.yml` and the two `.gd` files, by reading them, not by
  bumping hashes. Regenerate `docs/adr/README.md`.
- Unstick the MCP hub, then make it fail hard: a `startretries` ceiling that goes FATAL,
  and a boot-path assertion so `bootstrap.done` cannot be written while a projection is
  missing. Delete the stale `consultant-codex` entry from `~/.claude/settings.json` and
  decide the `AGENTBOX_CONSULTANTS_ENABLED` gate one way or the other.
- Manifest truth: reconcile `[voice].enabled` with the four running containers, fix
  `BASELINE-container.md:54` (9090, not 4000), reconcile the 127 vs 137 skills count.

**W2, days 5 to 12: the safety floor (C6-min).**
- Append-only execution journal over the four live schedulers only. Every run writes one
  record: trigger, inputs, side effects, branches created, exit. URN minted through
  `uris.js`. No policy engine, no approver, no monotonic pipeline: those stay parked.
- Move ADR-2071 from proposed/none to accepted/complete/live, and amend
  `GOVERNANCE-capabilities.md` in the same change, per the estate's own ADR process.

**W3, days 13 to 18: the external risk item (C8g) and the ratchets.**
- Correct or evidence the three overstated public claims (cross-org federation marketed as
  `integrated`; the Judgment Broker UX the PRD itself calls "cryptographically complete and
  semantically hollow"; the Salford/THG "World Record" strip, which RC found has zero
  corroboration anywhere in the honesty ledger).
- Ship each fix with a mechanism, not a promise. That is what makes this a focus rather
  than a hygiene sprint (§6).

### Exit evidence (all checkable by a third party)

1. `node scripts/adr-index-gen.js docs/adr --check` exits 0 in **project**, and
   `docs/adr/README.md` is regenerated and committed.
2. The host repo gains the `--check` CI step agentbox already has, and the merge gate in
   §4 is live in all five ledger repos.
3. Nightly estate-health reports 12/14 or better for three consecutive nights, with no
   `unknown` row: visionGraph is either readable by the collector or explicitly declared
   out of scope in the collector config, and WasmVOWL's `none` is declared frozen by
   design rather than left blank.
4. `ss -tlnp` shows a listener on 9720, a fresh session reports zero MCP
   ConnectionRefused, and a deliberate `rm /run/agentbox/mcp-hub.json` plus restart drives
   the hub to FATAL within two supervisor cycles instead of looping. The failure is loud.
5. `agentbox.toml` `[voice].enabled` matches `docker ps`, and a `scripts/ci/` check exists
   that diffs declared sidecars against running ones.
6. Each of the four schedulers has at least three journal records readable at a stable
   path, and ADR-2071 is accepted/complete/live with `verified_paths` populated.
7. Zero new ADRs merged in any repo during the cycle except records that close an existing
   proposed record or that document the work above. This is a countable number, not a vow.

### Why this one and not a more exciting one

Through this lens the ranking is not close. Every other candidate is read through signals
that are currently lying: a green supervisor line over a three-day crash loop, a green
solid-pod-rs badge over a failing `cargo audit`, a manifest that disclaims a live voice
stack, a host ledger that cannot render itself, a settlement class that gates nothing, and
a public site claiming a frozen capability is integrated. You cannot pick a next
architecture from instruments that read wrong. The drag is daily and compounding: seven
MCP servers dark in every session for three days, a host ADR index that no agent or human
can navigate, and four autonomous schedulers whose side effects nobody can replay. Fix the
instruments, then choose.

---

## 3. Runner-up, and what to park

### Runner-up: C7, wire the settlement gate and collapse the three ledgers

Not as a payments feature but as the cheapest falsification of the sidestr temptation.
Wire `payment_settlement` into a real production path, make one of the three ledgers the
single writer and the other two derived views, and replace the 501 `.deposit`. If that
lands cleanly, PRD-024 has a real seam to attach to and the owner can judge sidestr on its
merits. If it does not, the estate has learned in two weeks and for very little money that
the "almost complete payments loop" is not almost complete, which is exactly the finding
that should precede eight new settlement ADRs rather than follow them.

RA's own pick, **ADR-2078 (provision the pods signer from sovereign identity)**, is the
right *architectural* answer and I would make it the first item of the cycle after this
one. I rank it below the signal floor only because a real signer wired into a runtime
whose hub is dark and whose gates are red adds one more claim nobody can verify.

### Park list, with durations

| Park | For how long | Why |
|---|---|---|
| **C2 sidestr / PRD-024** | 8 weeks, or until C7 lands and ADR-2078 exists | No named external stakeholder (RC §4). Twelve records, zero code, reopening four settled positions (RA §5.3). The owner is tempted; that is the reason to time-box it, not to start it. |
| **C3 federation** | 12 weeks, no review | The owner's own FREEZE decision stands and nothing external asks for it. Correct the marketing claim instead (that is C8g, inside the focus). |
| **C4 Loom PRD-028** | Pilot allowed after the focus exits; the full 200-reviewer-hour study parked 12 weeks | The pilot is genuinely aligned with "deprecate by removing" and could retire a large investment, which is why it scores 17. It is still a research programme, and starting one while the instruments lie is how side quests begin. |
| **C5 PRD-023 façade** | Park the programme; run **C5-min** inside the focus | One day: run the ADR-2095 measurement against the ADR-2094 façade. PRD-023's own `review_trigger` names that run, and it has not happened (RA §3). It converts a self-chasing programme into a closed leaf or a falsified one. Cheapest possible resolution of a live side quest. |
| **C6 policy pipeline (ADR-059)** | Until the journal has 4 weeks of records | You cannot write a policy over side effects you have never recorded. ADR-2071's own title says this. |
| **C8b, C8c, C8f** | Not parked, but not this cycle's focus | They are owner-calendar and commercial items. They consume no engineering and should proceed in parallel. |
| **C8a, C8d, C8e** | Run in parallel now | C8a is five administrative items on live client production; C8d is a push and an announcement; C8e is a negotiation. None competes for the engineering cycle, and C8a is the only item in the pack with a real customer currently blocked. |
| **C9 finish-what-is-partial** | Next cycle | Skills is already finished (§0.1d). AoE and XR are both leaves that block nothing (RA §3), so closing them is tidy rather than urgent. |

---

## 4. The one ledger-hygiene action I would insist on

Not "freeze new ADRs until green", which is a promise, and promises are what produced
twenty-five proposed-but-unbuilt records. One mechanism:

> **A new ADR may not merge into a repo whose own `adr-index-gen --check` is failing.**

Implemented as a required CI step in all five ledger repos (agentbox already runs it inside
Security Invariants; the host demonstrably does not, or it would not be at 15 stale). The
effect is a natural rate limiter with exactly the right shape: writing a new decision costs
you re-verifying the records your last change invalidated. It is the ADR-2092 move applied
one level up, and the owner has already accepted that trade once, in his own words, because
the previous cost of adding one was zero, which is precisely how ninety-seven accumulated.

Second-order and cheap: make `--check-index` mandatory too, so the README cannot drift from
the records, and add `verified_paths` globbing where it is missing so that re-verification
is a read rather than an archaeology exercise.

---

## 5. Stopping rule for the nightly schedulers

Four unattended schedulers are live today with no journal and no termination condition. RE
§5 shows what that produces: unmerged `dream/*` branches in VisionFlow and loom, an estate
review pass sequence past pass109 that never narrows, and a nightly health check plateaued
at 10/14 for weeks. The rule I would adopt, in four clauses:

1. **Journal or die.** A scheduler that cannot write its execution record does not run.
   No record, no side effect. This is the "fail hard not soft" clause and it is the reason
   the journal is inside the focus rather than after it.
2. **Three sterile runs and you stop.** If three consecutive runs produce no merged change,
   the scheduler disables itself and files one issue naming what it kept proposing. It does
   not keep proposing into the void.
3. **Branches are merged or deleted at cycle end.** A `dream/*` branch older than seven days
   is deleted automatically. The cycle does not get to leave litter as a side effect of
   having run.
4. **Unbounded goals get an acceptance test or they stop being goals.** "Estate review" and
   "explainer microsite" are not tasks, they are appetites. Each gets a closeable definition
   (for example, estate-health at 14/14 for three consecutive nights) and when it is met the
   programme is declared complete; new asks open a new, separately scoped goal.

Clause 4 is the one that actually addresses the owner's stated worry. The ADR sprawl is the
symptom; unbounded goals running on a scheduler are the mechanism.

---

## 6. Is a "hygiene sprint" a real focus, or an avoidance of one?

Honestly: **as briefed, C1 is an avoidance.** "Fix the reds, fix the hub, fix the flag, fix
the doc, freeze new ADRs" is a to-do list of chores with no acceptance test, and a freeze
enforced by intention rather than by CI is exactly the kind of soft failure the owner's own
frameworks reject. Run that way it becomes a fortnight of going green, followed by the same
five reds in three weeks, and it scores 17 in my table for precisely that reason.

C1' earns the word "focus" only if three conditions hold, and they are falsifiable at day 5:

- **Every fix ships a ratchet.** Not "the hub is running" but "the hub goes FATAL when its
  config is missing". Not "the ADRs are re-verified" but "you cannot merge an ADR into a
  stale ledger". Not "the voice flag is corrected" but "a check diffs the manifest against
  `docker ps`". Fixes without ratchets are patches, and "re-engineer, do not patch" is the
  owner's rule, not mine.
- **It contains a genuine build.** The execution journal is real engineering against the
  estate's own named top risk, not tidying. If it is dropped, the cycle reverts to a mop.
- **It is bounded by exit evidence, not by feeling finished.** The seven items in §2 are all
  third-party checkable, including the one that counts new ADRs merged.

Day-5 abort test: if the journal has not started and the only closed items are red gates,
stop the cycle and pick C7 instead. A fortnight of green badges is worse than nothing,
because it restores confidence in instruments that are still lying.

One constraint on execution, from RE and confirmed by me: **do not run this cycle as a
large parallel agent fan-out inside `project`'s main worktree.** Thirteen stashes sit in
that one repo and five are explicitly agent cross-contamination rescues. Worktree isolation
is not holding there, and a cycle whose whole purpose is to make signals trustworthy cannot
afford to be the sixth rescue stash. Use isolated worktrees per agent, or run it serially.

---

## 7. Where I disagree with the researchers

| Disagreement | Who | My position and evidence |
|---|---|---|
| ADR staleness: 2 or 15 | RB §5 says 2 and calls 15 historical; RA §2 says 15 in the host | **RA.** I ran both gates. Host: 15 errors, README not generated. agentbox: 96 valid, 0 stale (fixed today by `b7b1ab81a`). RB checked the wrong repo and drew the opposite conclusion. |
| One shared 2026-09-15 cause for the five reds | RB top-debt #4 | **Falsified.** Green workflows ran in the same push batches. Five independent fixes. This makes C1 cheaper per item but removes the "one fix, five repos" upside that made it attractive. |
| agentbox reds are pre-existing rot | RB §1 | **No.** Today's commits include a feature landing, two new shell entrypoints and edits to `agentbox.sh`. I reproduced a concrete failure (three uncatalogued TOML gate keys, ADR-039). The gates are healthy; the landing skipped them. |
| The 57/137/23 skills gap | RD §2.6 | **Does not exist.** 20 registered names, 20 present, plus three non-skill files. 57 is a line count. Strike it from C1. |
| Settlement has external pull | RA is neutral; RC §4 says internal preference | **RC**, and more strongly. Beyond the absent stakeholder, the floor is missing: three unsynced ledgers, a 501 deposit, and an authority class with zero production callers. That is a foundations objection, not a demand objection. |
| ADR-2078 is the single highest-leverage unblock | RA §7.1 | **Agree on leverage, disagree on sequence.** It is the only node with edges into two live programmes, and it should open the cycle after this one. Wiring a real signer into a runtime with a dark hub and red gates produces another unverifiable claim. |
| solid-pod-rs is green | estate-health | **Both are true and that is the problem.** `README.md:240` records `cargo audit --deny warnings` failing on `RUSTSEC-2026-0258` while the dashboard shows green, because the audit gate is not the gate that runs. RB §3.6 has this right and it belongs in the same class as the hub: a signal that reads healthy over a known failure. |
| VisionFlow has two unwired flags | RB §3.7 | **Five.** `app_state.rs:930-943` warns on TLS, HTTP/2, rate limiting, metrics and request validation. Two are security-relevant; five are ways to believe a setting did something. |

---

## 8. One-paragraph summary

The estate does not have a strategy problem, it has an instrumentation problem, and the
strategy problem is downstream of it. Five repos are red for five unrelated small reasons;
the host's 108-record ledger cannot regenerate its own index; the MCP hub has crash-looped
for three days behind a green supervisor line after a boot that wrote `bootstrap.done`
while one of its own projections silently failed; the manifest disclaims a voice stack that
has been live for eleven days; a green CI badge sits over a failing `cargo audit`; a
zero-tolerance settlement class gates nothing because no production path ever names it; and
four autonomous schedulers have run unjournalled for three days against a governing
document that names exactly that as its own top risk. Sidestr, federation and the Loom
study are all decisions that would be taken from these instruments. Spend one cycle making
the instruments true and loud, journal the autonomy that is already running, correct the
three public claims that outrun the code, and put a merge gate on the ledgers so that
writing a new decision costs re-verifying the last one. Then pick the exciting thing, with
working eyes.

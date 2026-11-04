# Trajectory audit: where effort went, 2026-07-23 to 2026-09-21

Method: `git log --since='60 days ago'` in each of eight repos (proton-drive-sdk excluded - not a git
repo at this mount), classified by conventional-commit prefix, cross-checked against `git branch -a
--no-merged main` and `git stash list`, and against RuVector `project-state` session summaries
(queries: goal active, progress, not complete, blocked, deferred) and `personal-context` frameworks.
1,201 commits total. Raw logs: `gitlogs.txt`, `branches_stashes.txt` in this directory.

Caveat on the numbers: conventional-commit prefixes undercount tests specifically - many repos bundle
test changes inside a `fix:`/`feat:` commit rather than a standalone `test:` commit, so the test column
is a floor, not a true measure of coverage discipline. Docs and code counts are prefix-literal and more
reliable.

## 1. Effort table

| Repo (programme) | Commits | Weeks active (of ~9) | docs:code:test | Finished? |
|---|---|---|---|---|
| campaignbuilder | 353 | 3 (bursty) | 120:228:5 | Partial - high-volume, no completion claim in any session summary in the window |
| project (host, docs/adr + XR + ontology) | 257 | 12 (sparse tail, dense core) | 82:167:8 | Partial - latest cycle (sovereign settlement) freshly proposed, zero implementation yet |
| loom (paper/eval) | 162 | 6 | 30:131:1 | Yes, for its actual deliverable - paper converged to a tagged v9.2 release |
| dreamlab-cumbria (Fairfield design) | 104 | 7 | 6:98:0 | No single finish - legitimately iterative design work, not a defect |
| VisionFlow (estate) | 107 | 10 | 40:67:0 | No - chronic audit loop, nightly health check never reached full green |
| nostr-rust-forum | 99 | 9 | 20:77:2 | Yes, for the 2026-09-15 feature bundle; Partial overall |
| agentbox-of-empires | 98 | 3 (then silence) | 3:93:2 | Abandoned - no close-out commit, just stops |
| solid-pod-rs | 21 | 8 | 11:10:0 | Partial - three discrete alpha releases shipped, grand ADR items still proposed |
| **Total** | **1,201** | - | **312:871:18** | - |

Overall docs:code:test split is roughly 26%:73%:1.5%. The test-commit share is the standout number:
across 1,201 commits in an estate whose global instructions mandate "ship complete, working
implementations" and whose project skill set defaults to a TDD-first build skill
(`build-with-quality`), only 18 commits carry an explicit `test:` prefix. Given the bundling caveat
above this is not proof tests aren't being written, but it is a visible gap in how the work is
recorded, and three of the eight repos (dreamlab-cumbria, VisionFlow, agentbox-of-empires-partially)
show effectively zero standalone test commits over nine weeks.

### Weekly shape (commits by ISO week, 2026)

```
project             wk20:1 wk29:1 wk30:1 wk31:2 wk32:18 wk33:21 wk34:19 wk35:29 wk36:119 wk37:32 wk38:13 wk39:1
VisionFlow                              wk30:1 wk31:1  wk32:3  wk33:24 wk34:6  wk35:4  wk36:32  wk37:26 wk38:8  wk39:2
solid-pod-rs                            wk30:2         wk31:1          wk33:2  wk34:7  wk35:2  wk36:5   wk37:1          wk39:1
nostr-rust-forum                        wk30:8 wk31:1          wk33:12 wk34:13 wk35:3  wk36:6   wk37:13 wk38:42 wk39:1
dreamlab-cumbria                                wk31:4 wk32:25 wk33:21         wk34:3  wk35:3   wk36:14         wk38:34
campaignbuilder                                 wk31:107                                                wk37:222 wk38:24
agentbox-of-empires                             wk30:22 wk31:58 wk32:18
loom                                                                    wk33:38 wk34:67 wk35:12 wk36:8  wk37:16          wk39:21
```

Three patterns jump out before any deeper reading:

- **project week 36 (119 commits, roughly half its 60-day total in one week)**: this is the XR/GPU/
  wire-ABI programme (ADR-134 to ADR-142, ADR-2053 to ADR-2081) landing in a single dense sprint -
  genuinely high-throughput work, not sprawl, because it converged to accepted-status ADRs with
  verified_paths.
- **campaignbuilder week 31 (107) then five silent weeks then week 37 (222)**: worked hard for five
  days (2026-07-28 to 08-01), went completely dark 08-02 to 09-07, then came back with the biggest
  single-week commit count in the whole estate. The RuVector session summaries in that second burst
  (`repo-education-*`, `campaignbuilder-*` keys) show an explainer-microsite programme that never
  declares itself finished; see §5.
- **agentbox-of-empires stops entirely at week 32** (last commit 2026-08-04) and never resumes. Not a
  slow tail-off - the last five commits are mid-feature ACP/session-lifecycle fixes, then nothing for
  48 days through to today.

## 1a. Per-repo detail

**project** (host repo; docs/adr corpus, XR/GPU programme, ontology/vault work). 257 commits is the
second-highest volume in the estate and the only repo with meaningful activity outside the
July-September core window (a single commit each in week 20 and week 29, most likely late-arriving
backdated documentation rather than a genuinely separate cycle). The `docs` share (82, 32%) is the
highest proportion of any repo bar campaignbuilder, consistent with this being the estate's ADR ledger:
113 new ADR files landed here in the window (§3). The dominant single event is week 36 (119 commits,
just under half the repo's total), which the ADR-number sweep identifies as the XR/GPU/wire-ABI
programme (ADR-134 to ADR-142 for the immersive-interaction/XR side, ADR-2053 to ADR-2081 for the
GPU-coordinator and dead-code-removal side) landing as one dense, converged sprint. `security` and `ci`
prefixes are thin (2 and 6 commits) relative to the size of the repo, which tracks with this being
primarily a documentation and architecture-decision repo rather than a shipping surface.

**VisionFlow** (estate review, diagrams-as-code, nightly health). 107 commits split almost evenly
between `docs` (40, including 37 explicitly `docs(...)`) and `code`/`chore` (67), with the `chore`
share dominated by the 17 nightly `estate-health` snapshots. This is the repo where the RuVector
session-summary evidence is most damning in volume: of the ten highest-scoring `project-state` hits for
"progress" and "not complete", six are VisionFlow "estate review pass" records (pass15, pass19, pass21,
pass31, pass52, pass53, pass55, pass58, pass59, pass62, pass109 are all attested in the search results
used for this report), each independently timestamped 2026-09-04 or 2026-09-05, i.e. the pass sequence
ran through at least 90-plus numbered iterations in a single week without the underlying goal
narrowing. The most recent VisionFlow commits (2026-09-15 to 2026-09-21) shift into the sovereign
settlement / augmentation-conditions programme, so the repo appears to be pivoting off the audit loop
into new decision-writing - worth watching whether that pivot actually retires the old loop or simply
adds a second one alongside it.

**solid-pod-rs** (Rust Solid pod, did:nostr, WebLedger). The smallest repo by commit count (21) and the
cleanest per-commit signal: three version releases (`0.5.0-alpha.7`, `.8`, `.9`), each preceded by a CI
or doc fix that unblocks it, and a late pivot into the ADR corpus (`ADR-061` LAN Bitcoin node posture,
then the settlement-programme `ADR-2008`). No stashes, one unmerged branch (an agent-generated QE
install branch), and the lowest test-commit count of any active repo (0 explicit `test:` commits, though
`feat: OIDC compatibility matrix, WAC policy outcomes, provenance receipts...` bundles test work per its
own message).

**nostr-rust-forum** (Nostr-based BBS/forum client and relay gate). 99 commits with the highest `fix`
share of any repo (22, 22%) alongside a healthy `feat` share (20) - a repo doing real maintenance
against real user feedback rather than pure feature accretion. The 2026-09-14/15 sequence is the
clearest "shipped" moment in the whole audit: a security gate run, a governance fix (NIP-33
replaceability), then the `merge: forum user feedback 2026-09` bundle covering eight distinct
user-facing fixes in one merge, followed by a second documented security-gate pass the same day. Four
unmerged branches remain, two of them repeat attempts at the same NIP-07 session-restore problem
(`fix/nip07-restore-clean` and `fix/nip07-session-restore-cold-load`), suggesting the first fix did not
hold and was retried under a new branch name rather than being reopened on the original.

**dreamlab-cumbria** (Fairfield House site design: solar array, landscape, outbuildings). 104 commits,
almost entirely uncategorised by conventional-commit prefix (`none`: 50) because this repo's commit
style is descriptive prose ("Render a lit, metadata-carrying review set...", "Fit Fairfield and grass
bench to owner-described ground levels") rather than `type(scope):` - appropriate for a design/CAD
repo, not a defect. Activity is genuinely iterative physical-design work: terrain fitting, solar-row
alignment against shading models, landscape rendering, planning-proposal assembly. One commit message
reads `interupted codex run` (2026-09-18), a rare direct admission of a broken session rather than a
polished retrospective summary. One unmerged branch (`reorganise/file-moves-and-renames`) is the only
open thread.

**campaignbuilder** (multi-tenant campaign/explainer product plus an embedded developer-education
microsite programme). 353 commits, the largest in the estate, concentrated in two bursts (§1) with five
silent weeks between them. `docs` (120) and `feat`+`fix` (98) run close together; the repo carries the
estate's heaviest security-hardening thread visible in raw subjects (`security(enclosure): remove
break-glass injection`, `fix(enclosure): wire the FS-ACL gate - it was never loaded`, F028 firewall
work). The RuVector evidence in §5 shows this repo's explainer sub-programme cycling through session
after session of real, verified work that never converges to a stated finish.

**agentbox-of-empires** (ACP/session-lifecycle CLI tooling - worktree picker, compaction handling,
REST dispatch). 98 commits across three weeks, then total silence for 48 days. The `fix` share (55, the
highest proportion of any repo at 56%) and near-absent `docs` (3) mark this as pure maintenance-mode
engineering on infrastructure other tools depend on, cut off mid-stream with no visible cause in the
commit history itself - the cause, if there is one, lives outside git (a reprioritisation, a blocker,
simple attention moving elsewhere) and is not recoverable from this audit's sources.

**loom** (Ontology Loom evidence/evaluation paper and harness). 162 commits, almost entirely `docs` (30)
and uncategorised research/`rust` prefixes (48 `none`, 12 `rust`, 9 `research`, 8 `eval`), telling the
story of a paper moving through seven major version rewrites (v7 through v9.2) driven by two rounds of
external review, each one shrinking the claimed scope rather than growing it - the opposite direction
to every other repo's docs-volume story in this audit.

## 2. Abandonment list

Evidence classes: unmerged branches (`--no-merged main`), stashes, and repo-level activity cliffs.

| Date (last activity) | Repo | What | Evidence |
|---|---|---|---|
| 2026-08-04 | agentbox-of-empires | Whole-repo abandonment mid-stream: ACP compaction/session fixes stop with no close-out commit, 48 days of silence to date | Log tail: `#3221`..`#3236` fix/feat commits, then nothing |
| ongoing (branch never merged) | project | 13 stashes, several explicitly rescue operations: `rescue: extraction dir residue`, `rescue: F5 DPoP agent contamination in main worktree`, `rescue: server-nostr agent contamination`, `rescue: ontology-pipeline agent contamination`, `rescue: agent cross-contamination into main worktree (auth-plumber + workspace-scaffolder inflight)` | `git stash list` - five of thirteen stashes are contamination rescues, i.e. parallel agents writing into the same worktree and needing manual untangling |
| stale, no date recorded | project | `stash@{11}: WIP on main: Initial commit: Logseq Publisher with Rust + WASM` - an entire sub-project's initial commit sitting in the stash, never landed or discarded | `git stash list` |
| stale | project | `stash@{9}: On merge-hive-mind-integration: GPU feature flag fixes` - a merge-in-progress with flag fixes stashed and abandoned | `git stash list` |
| 2026-09-10 (branch date) / never merged | VisionFlow | `dream/seo-and-meta-2026-09-10` - a nightly dream-cycle branch never merged back | `git branch -a --no-merged main` |
| never merged | VisionFlow | `feat/augmentation-conditions` - the six-augmentation-conditions theme shipped instead via a `docs(canon)` commit on 2026-09-15 directly to main; the feature branch itself is stranded, suggesting the branch was superseded rather than landed | branch list vs. log |
| never merged (4 branches) | nostr-rust-forum | `fix/new-topic-mentions-and-admin-direct-load`, `fix/nip07-restore-clean`, `fix/nip07-session-restore-cold-load`, `w4/notif-producer` - two separate unmerged attempts at NIP-07 (browser-extension auth) session restore is a specific signal of a fix that didn't stick twice | `git branch -a --no-merged main` |
| currently checked out, unmerged | nostr-rust-forum | `feat/augmentation-conditions-client` (marked `+` = current HEAD) - the client-side half of the same programme VisionFlow already landed via docs; still mid-flight | branch list |
| never merged | dreamlab-cumbria | `reorganise/file-moves-and-renames` - a repo reorganisation started and stranded | `git branch -a --no-merged main` |
| never merged (2 local + duplicate remote) | loom | `dream/model-facade-2026-08-29` (nightly dream-cycle touched loom and left a branch), `feat/confidence-contract`; a stray local `master` branch also sits unmerged alongside `main` | `git branch -a --no-merged main` |
| never merged | solid-pod-rs | `claude/agentic-qe-global-install-l20lwk` - an agent-generated QE-tooling install branch, never merged | `git branch -a --no-merged main` |

Two structural observations from this list alone: first, the nightly "dream cycle" automation
(mentioned in project/CLAUDE.md skill routing and confirmed live via `dream-cycle:` commits in
solid-pod-rs and campaignbuilder) leaves an unmerged branch in at least two repos (VisionFlow, loom) -
it proposes changes it does not land itself. Second, every stash in the whole estate (13 of 13) sits in
one repo, `project`, and five of those are explicitly agent-contamination rescues - parallel-agent
worktree writes colliding in the same repo. That is a concrete, repo-scoped tooling risk, not a general
estate pattern.

## 3. Decision records vs. decisions implemented

In `project` alone, 113 ADR files were added in the 60-day window (`docs/adr/ADR-*.md`, git
`--diff-filter=A`). Status-field greps across the same diffs show:

- 92 occurrences of `decision_status: accepted` (or `**Status:** Accepted`) written into ADR bodies
  during the window
- 15 occurrences of `decision_status: proposed` (or `**Status:** Proposed`) still open at time of
  writing
- A visible sub-pattern of ADRs that flip status mid-window: `2015-derived-writeback-fence`,
  `2078-ts-decoder-fails-closed`, and several XR ADRs move `proposed` → `accepted` with an execution
  receipt cited in the same commit, i.e. the accept event is gated on verified evidence, not vibes.

Read generously, roughly 4 in 5 decisions written in the window reached "accepted" status somewhere in
the same window. But "accepted" in this corpus is closer to "the reasoning and acceptance test are
locked" than "the code shipped" - several accepted ADRs explicitly carry qualifiers: `ADR-2061` is
"complete/staged" pending four GPU fixture conformance checks; `ADR-2037` is "proposed partial/staged,
not ratified"; `ADR-2006` regresses from "complete" to "partial" mid-window per the ACSP RuVector
session summary. The honest ratio of decisions-written to decisions-fully-implemented-and-verified is
lower than 92/113 and the corpus does not currently let you compute it precisely without reading every
ADR's `implementation_status` field individually.

The sharpest data point is timing: the eight newest ADRs in the entire estate - `ADR-2096` through
`ADR-2103`, the "sovereign settlement" pack (our own sidestr sidechains as the sole value instrument,
per the git history at the top of this session) - landed in the final 24 hours of the window, fanned
out in lockstep across `project`, `VisionFlow` (`ADR-2012`), `solid-pod-rs` (`ADR-2008`), and
`nostr-rust-forum` (`ADR-2012`), and every one of them is status `proposed`. That is the leading edge
of the next cycle: a four-repo simultaneous decision-writing burst with zero implementation yet. It is
exactly the shape the memory search was asked to find ("what does the last 60 days say about the next
cycle") - the next cycle's opening move has already been made, in docs only.

## 4. Best and worst finished-per-effort

**Best three:**

1. **solid-pod-rs** - 21 commits, the fewest of any repo, but three discrete version releases in the
   window (`0.5.0-alpha.7`, `alpha.8`, `alpha.9`), each with its own CI-gate fix and doc repair. Low
   commit volume, high density of actually-shipped, versioned artefacts. The most recent commit is
   itself a proposed ADR for the settlement programme, so it is not "finished" as a project, but every
   unit of work inside the window that was started was also closed.
2. **nostr-rust-forum** - 99 commits culminating in a genuinely closed feature bundle
   (`merge: forum user feedback 2026-09` - PWA icon, mobile compaction, custom emoji, DM history,
   reaction affordance, search, mentions, unread ingress, 2026-09-15) plus two logged security-gate
   passes the same day. A messy middle (four unmerged NIP-07 branches) but a real, user-facing,
   ship-dated close.
3. **loom** - 162 commits, almost entirely docs/research prefixes, that converge on a tagged release
   (`paper-v9.2`) with earlier versions explicitly archived rather than left to rot in branches. The
   commit stream itself narrates the convergence: v7 "rewrite to the smallest paper the record
   supports, after the second external review", v8 "tighten to the core after the first external
   review", v9 "the smallest paper the record supports", v9.1 correcting overclaimed statistics, v9.2
   fixing a clipped figure. That is iteration converging to a stated, evidenced end-state - the
   "iteration over perfection" framework working as intended, on a document rather than on code.

**Worst three:**

1. **VisionFlow** - 107 commits, and the single clearest chronic-non-completion signal in the whole
   estate: 17 automated `chore(estate-health): nightly snapshot` commits in the window, and not one of
   them reports full green. The distribution is 8× at 7/14, 3× at 8/14, 1× at 9/14, 5× at 10/14 - the
   health check plateaus around 10/14 for the second half of the window and never closes the gap. The
   RuVector session summaries independently confirm this from the inside: a numbered "estate review
   pass" sequence (pass15, pass19, pass21, pass31, pass52, pass53, pass55, pass58, pass59, pass62,
   pass109…) runs across the window, and essentially every single pass record ends with the phrase
   "goal not complete" or "goal unfinished" or "do not mark goal complete/blocked" - an audit loop that
   both produces real findings (each pass genuinely surfaces a bug, a doc drift, a stub) and never
   terminates.
2. **campaignbuilder** - the single largest commit count in the estate (353) and, per the same memory
   search, a project that repeatedly tells itself not to claim completion: `repo-education-overview-
   final-export-2026-09-09` records the user "strongly wants done" against a goal recorded as "far from
   full completion"; `campaignbuilder-push-checkpoint-20260909` explicitly notes "no completion claim";
   `campaignbuilder-provider-http-checkpoint-20260909` opens with "User tokenallowance runninglow…
   focus outstanding requirements not exploration" - a user actively trying to arrest scope growth
   mid-session. Some concrete things did land inside this volume (F028 firewall hardening marked
   COMPLETE and pushed with an image-build receipt is a genuine close), which is why this is "worst
   finished-per-effort" rather than "abandoned" - the ratio is bad, not zero.
3. **agentbox-of-empires** - by commit count this looks mid-tier (98 commits, three active weeks), but
   the finished-per-effort ratio is the worst possible: the programme simply stops on 2026-08-04 with
   no close-out, no final ADR, no "shipped" commit, 48 days before today. Every commit in this repo's
   window was real, shipped, tested work on a CLI/ACP session-lifecycle tool (worktree isolation,
   compaction handling, elicitation parsing) - the deficiency isn't quality, it's that the whole
   programme went cold with nothing marking why.

## 5. The sprawl pattern, and what the owner's own frameworks say about it

The pattern, stated from evidence rather than blame: **open-ended verification work does not have a
stopping rule, and the estate has built infrastructure that runs it anyway.** Three separate mechanisms
produce the same shape:

- The nightly dream-cycle (`dream-cycle:` commits in solid-pod-rs and campaignbuilder, `dream/*`
  branches left unmerged in VisionFlow and loom) nominates a repo each night and proposes work - but
  the proposing act itself is a scheduled job with no completion criterion, so it accumulates unmerged
  branches as a side effect of running at all.
- The VisionFlow "estate review pass" sequence is, by its own internal accounting, an unbounded
  user-goal auditing every ADR, doc, and code path against every other one. Each pass is individually
  disciplined - every summary cites source hashes, receipt files, and explicit "no completion claim" -
  but the object being audited (the whole estate) grows faster than the audit can close it, so the
  nightly health check has plateaued at 10/14 for weeks rather than trending to 14/14.
- The campaignbuilder explainer-microsite programme shows the same shape at project scale: each session
  produces genuine, evidenced work (browser-verified screenshots, hash-checked exports, passing test
  suites) and each session also explicitly declines to claim the parent goal is done, because the goal
  itself ("full cold-start paranoid developer instructional microsite… for people who did not build
  it") has no natural boundary - it can always cover one more journey, one more diagram, one more
  accessibility pass.

None of this is commits without content - the striking thing reading the raw session summaries is how
rigorous each individual pass is (source hashes, receipts, explicit "not a completion proof" caveats
throughout). The sprawl isn't sloppy work; it's disciplined work applied to goals that were never given
a finish line, running on a scheduler that doesn't ask whether finishing is still the point.

Tested against the owner's own stated frameworks (personal-context, `personal-context-research-
themes` and `personal-context-preferences-constraints`):

- **"Iteration over perfection"** - loom's paper programme is the one place in the whole 60-day window
  that actually practises this: seven rewrites, each shipping a smaller, more defensible artefact than
  the last, converging to a tagged release. VisionFlow's estate-review passes and campaignbuilder's
  explainer sessions do the opposite of "over perfection" (they explicitly refuse to claim
  perfection) but they also never converge - there's no v9.2-style narrowing happening at estate scale,
  only fresh passes finding fresh gaps at a rate that doesn't shrink.
- **"Fail hard not soft"** - the five agent-contamination rescue stashes in `project` are the system
  failing soft: parallel worktree writes collided and got quietly stashed rather than the run stopping
  hard at the point of collision. This is the one finding in the whole audit that reads as a tooling
  gap rather than a scope gap, and it is the most actionable: worktree isolation for concurrent agents
  in `project` is not holding, contrary to what `AR-AI-Knowledge-Graph`'s multi-repo swarm tooling is
  meant to provide.
- **"Re-engineer don't patch"** - mostly honoured at the ADR level: 92 of 113 ADRs in the window
  reference concrete removals or re-architectures (`ADR-2045 remove dead supervision machinery`,
  `ADR-2054 remove dead GPU and analytics code`, `ADR-2065 remove dead ontology validation code`,
  `ADR-2077 delete dead client surfaces`, `ADR-2081 remove dead browser XR surface`) rather than
  incremental patches. This is the healthiest signal in the whole dataset - the estate is visibly
  practising subtraction, not just addition, and doing it via ADR rather than silently.
- **"Deprecate by removing"** - same evidence as above; the density of `remove-dead-*` and
  `delete-*` ADR titles in the `project` window (at least eight in 60 days) shows this is a live habit,
  not an aspiration.
- **"Directional alignment: everything benefits everything else"** - this is the framework the
  sovereign-settlement burst (§3) is implicitly testing right now. Landing the same decision
  simultaneously across four repos (project, VisionFlow, solid-pod-rs, nostr-rust-forum) in the last
  day of the window is exactly "fast and dirty is fine as long as everything benefits everything else"
  in practice - a single architectural move propagated estate-wide before any one repo implements it.
  Whether it actually holds depends on whether the next cycle closes those four `proposed` ADRs
  together or lets them drift out of lockstep, which is the one thing this audit cannot yet see.

**What the frameworks would say to do next**, read straight: the owner's own "fail hard not soft" and
"deprecate by removing" instincts are already the antidote to the two worst-scoring items above - apply
them one level up, to programmes, not just to code. VisionFlow's estate-review pass sequence and
campaignbuilder's explainer programme are both unbounded user-goals with no stated acceptance test;
give each an explicit, small, closeable definition of done (e.g., "estate-health hits 14/14 for three
consecutive nights" or "N named curriculum chapters ship, then the programme is declared complete and
new asks open a fresh, separately-scoped goal") rather than letting nightly automation keep proposing
against them indefinitely. The dream-cycle scheduler should either merge its own branches or delete
them at cycle-end rather than leaving `dream/*` branches to accumulate as unmerged litter. And the
agent-contamination rescue stashes in `project` are the one item that is a "fail hard not soft"
violation in the owner's own terms today - that is where re-engineering worktree isolation, not another
rescue stash, is the honest next move.

## Sources

- `git log --since='60 days ago'` in project, VisionFlow, solid-pod-rs, nostr-rust-forum,
  dreamlab-cumbria, campaignbuilder, agentbox-of-empires, loom (proton-drive-sdk: not a git repo at
  this mount, skipped per instruction)
- `git branch -a --no-merged main` and `git stash list` in the same eight repos
- `git log --diff-filter=A -- docs/adr/ADR-*.md` and status-field greps in `project`
- RuVector `mcp__claude-flow__memory_search`, namespace `project-state`, queries: goal active,
  progress, not complete, blocked, deferred
- RuVector `mcp__claude-flow__memory_search`, namespace `personal-context`, queries: the five named
  frameworks, and `personal-context-portfolio-index`

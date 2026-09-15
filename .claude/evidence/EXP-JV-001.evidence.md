---
expectation_id: EXP-JV-001
git_sha: 1f204a3c1178c15dcaca5f6e5b3eb025d8cd468b
produced_by: agent:claude-opus-5
produced_at: 2026-09-15T21:02:00Z
audited_by: none (UNAUDITED — no independent auditor was run for this change; the counter-example probes below were written and run by the producer)
audited_at:
auditor_verdict: unaudited
auditor_counter_examples_attempted: 9
auditor_counter_examples_found: 1
---

# Evidence — EXP-JV-001 (clarify-before-acting on the forum-suggestions ingest path)

**Scope note.** This covers the ingest path only: the clarity check, the question
generator, the DM body, the `awaiting-clarification` state machine, reply matching, the
re-check, the shared NIP-59 send/unwrap helpers, and the manifest gate. It does **NOT**
cover a live end-to-end run against the relay — `[sovereign_mesh].junkiejarvis = false`
in this container, so the tenant has never executed here; the wiring in
`scripts/dream-forum-suggestions.mjs` is evidenced by syntax check and code reading, not
by execution. It does **NOT** cover the agent's live DM/kind-42 conversational paths,
which are deliberately unchanged, nor the triage brain's action/defer/reject policy.

## The change

`management-api/lib/junkiejarvis-clarify.js` (new, 420 lines) holds the gate. Four pure
signals — `looksLikeBugReport`, `hasReproSteps`, `hasSurface`, `hasConcreteTarget` — plus
`specificityScore`, a 0..1 composite of length (words/40, capped) and up to four concrete
anchors (a number, a path/URL, a quoted or backticked name, a named surface, enumerated
steps, an expectation contrast). `assessClarity` requires repro **only** of something
that reads as a defect report, and requires a surface, a target and
`score >= MIN_SPECIFICITY` (0.45) of everything. `clarityQuestions` emits at most three,
in the fixed priority order `repro → target → surface → specificity`.

The state machine is a plain `{ pending: {} }` ledger with `openClarification` (idempotent
— a second call for the same item returns the state unchanged, which *is* the rate limit),
`applyReply`, `expireStale`, `matchReplyToPending` and `composeForRecheck`. Every
transition clones rather than mutates, and every one takes `now` as an argument.

`sendGiftWrappedDm` and `unwrapDmRumor` were added to
`management-api/lib/junkiejarvis-agent.js`; `JunkieJarvisAgent._sendDm` now delegates to
the former, so the JunkieJarvis surface has exactly one `nip59.wrapEvent` call site and
one `nip59.unwrapEvent` call site. Other surfaces keep theirs (see the counter-example
table below) — this was not an estate-wide consolidation.

`scripts/dream-forum-suggestions.mjs` expires stragglers, pulls gift wraps addressed to
JunkieJarvis since the oldest parked ask, attaches matching replies, excludes parked items
**before** the nightly cap (so a backlog cannot starve new suggestions of slots), and
gates each remaining post: unclear → DM + park + `awaiting-clarification` ledger row +
`continue`, never `triage()`.

## Test run

```
$ cd management-api && ./node_modules/.bin/jest ../tests/sovereign/junkiejarvis
PASS ../tests/sovereign/junkiejarvis-dm-send.test.js
PASS ../tests/sovereign/junkiejarvis-clarify.test.js
PASS ../tests/sovereign/junkiejarvis-agent.test.js
Test Suites: 3 passed, 3 total
Tests:       141 passed, 141 total
```

The whole suite, to show nothing else moved:

```
$ cd management-api && ./node_modules/.bin/jest ../tests/sovereign/
Test Suites: 50 passed, 50 total
Tests:       3 skipped, 730 passed, 733 total
```

Config and manifest gates:

```
$ ./management-api/node_modules/.bin/jest tests/config/semantic-rules.test.js --rootDir . --testEnvironment node
Tests:       1 skipped, 67 passed, 68 total

$ node scripts/ci/check-manifest-catalogue.js
FAIL (check-manifest-catalogue): 2 toml boolean key(s) with no catalogue entry
    skills.colloquy.reflect_candidates
    interaction_plane.proxy.preserve_host
```

Both failures are pre-existing keys from other branches
(`skills.colloquy.*`, `interaction_plane.proxy.preserve_host`);
`sovereign_mesh.junkiejarvis_clarify_before_acting` is catalogued in the BASELINE's
"sub-option of a catalogued capability" group and does not appear in the failure list.
`node scripts/agentbox-config-validate.js` reports no error for the new key (its four
`E016`s are the same pre-existing `colloquy` / `preserve_host` keys plus a `loom_url`
pattern violation).

```
$ node --check scripts/dream-forum-suggestions.mjs
(clean, exit 0)
```

TDD order is in the transcript, not inferable from the tree: both test files were written
and run **before** the module existed (first run: `Cannot find module
'management-api/lib/junkiejarvis-clarify'`; second: 48 passed / 5 failed on the
not-yet-written `sendGiftWrappedDm`).

## Counter-examples re-checked

| Counter-example (from EXP-JV-001) | Status |
|---|---|
| An unclear item reaching `triage()` or producing an action/defer/reject row | Covered — the gate `continue`s before `triage()`; asserted at the unit level by `assessClarity — table` (10 cases) and the `clarify-before-acting lifecycle` test. NOT executed end-to-end (see scope note). |
| A second clarification DM for an already-asked item | Covered — `rate limit: one clarification DM per item` (dmCount stays 1, original dmEventId retained) and `a reply that is still vague does not unlock action` |
| A reply from a different pubkey resuming an item | Covered — `does not match a different pubkey` |
| A pre-DM reply with no e-tag resuming an item | Covered — `does not match a reply older than the clarification DM` |
| A stale item revived by a late reply, or actioned anyway | Covered — `applyReply on an expired item does not resume it`, `silence for 7 days ends in stale, never in action` |
| A vague reply unlocking action | Covered — `a waffly reply leaves the item unclear (no free pass for replying)` |
| A second gift-wrap construction site | Covered **on the JunkieJarvis surface only**. `grep -rn "wrapEvent\|unwrapEvent" management-api mcp scripts config` returns one wrap site in `junkiejarvis-agent.js` (`sendGiftWrappedDm`) and one unwrap site (`unwrapDmRumor`) for this surface — but also pre-existing sites in `per-user-agent.js:522,561`, `config/hooks/nostr-live-mirror.cjs:468` and `config/nostr-gateway/{gateway.cjs:279,705,nostr-send.cjs:57}`. My first draft of this evidence and of the ADR claimed "exactly one place" estate-wide; that was an overclaim, corrected in both. |
| The gate throwing on malformed content, or a DM publish failure crashing the run | Covered — `never throws on malformed input` (6 shapes), `fails open: a publish error returns null rather than throwing`, and the tenant logs + `continue`s when `sendGiftWrappedDm` returns null |
| Gate defaulting OFF when the manifest is absent | Covered — `defaults to true when nothing is configured`, and the tenant's manifest load is wrapped in try/catch falling back to `{}` |

## Adversarial probes (producer-run — NOT an independent audit)

**Probe 1 — does a parked backlog starve new suggestions of their nightly slots?**
It did. `MAX_PER_NIGHT` slicing happened before the gate, so eight parked items would
consume the whole cap and no new suggestion would ever be triaged. **Counter-example
found and fixed**: parked items are now filtered out of `candidates` before `.slice()`
(`scripts/dream-forum-suggestions.mjs`, the `candidates` filter). This is the one real
defect this pass surfaced.

**Probe 2 — can `specificityScore` exceed its documented range or blow up?**
`specificityScore('a '.repeat(500))` = 0.4, `''` = 0, single char ≈ 0.01. Asserted by
`score is a finite 0..1 number`. **No counter-example.**

**Probe 3 — can an author with several parked items have a reply attached to the wrong
one?** `picks the OLDEST matching pending item when the author has several` pins the
behaviour deliberately; a reply genuinely ambiguous between two parked items is attached
to the older ask. That is a choice, not a guarantee of correctness — a member answering
their *second* question set will have the answer filed against their first. **Known
limitation, not fixed** (fixing it properly needs the member to quote the thread, which
NIP-17 clients do inconsistently).

**Probe 4 — is the 7-day boundary inclusive or off-by-one?**
`expireStale flips to stale exactly after 7 days, not before` asserts both sides:
`CLARIFY_EXPIRY_MS - 1` does not expire, `CLARIFY_EXPIRY_MS` does. **No counter-example.**

## deepsec gate (ADR-2033)

```
$ /home/devuser/.claude/skills/build-with-quality/scripts/deepsec-gate.sh --diff 70d017a3b21e8a8aa802556210f6ce87501c43f3
deepsec-gate: BLOCK — 26 finding(s) {'CRITICAL': 0, 'HIGH': 2, 'MEDIUM': 21, 'BUG': 3}, 2 at/above HIGH
receipt: .deepsec-gate/reports/20260915T205907Z/receipt.json   (exit 1)
```

**Exit 1 / BLOCK, and not a clean bill of health — but no finding is attributable to code
written here.** The nine findings of the final run are all pre-existing properties of
files this change touches, surfaced because the file entered the diff:

- `setup/agentbox.default.toml` — six findings (HIGH: the fresh-install template bakes
  vendor operator/relay pubkeys; plus tailscale-on-by-default, `trust_remote_code`,
  `audit_acknowledged=true`, marketplace auto-advertise, template polluted with live
  values). This change adds a thirteen-line comment block and one boolean to that file.
- `management-api/lib/junkiejarvis-agent.js` — two findings (the DM path lets the LLM
  directive choose a privileged calendar zone; no per-sender rate limit on paid-LLM
  calls). Both predate this change; `_sendDm` is the only line of that file's behaviour
  touched, and it was made a delegation.
- `scripts/dream-forum-suggestions.mjs` — one finding: an attacker-controlled forum post
  can steer triage-LLM prose that is auto-posted under the JunkieJarvis identity. This is
  the tenant's pre-existing design. This change *narrows* the surface — an unclear post
  never reaches the triage LLM at all — but does not close it.

The earlier run additionally reported a HIGH ("arbitrary file write via unsanitised
`panel_id`/`case_id`") which belongs to another session's work: `main` advanced from
`70d017a3b` to `17c957a05` mid-task, so the first `--diff main` invocation scanned 60-odd
unrelated files. The scoped re-run against the true branch point is the receipt cited
above. Note the gate's aggregate counter (26) accumulates across runs in this worktree;
the per-run comment is `.deepsec-gate/reports/20260915T205907Z/comment.md`.

One gate finding WAS in a hunk this change wrote, and was fixed: a dead
`(capped at …)` log condition comparing the post-slice length against the cap it was
already clamped to, hiding a real backlog from the operator.

## Not covered

- **No independent audit.** The EDD convention is a second model adversarially re-checking
  the counter-examples; that did not happen here. `auditor_verdict: unaudited`.
- **No live execution.** The tenant is gated off in this container
  (`[sovereign_mesh].junkiejarvis = false`), so the DM actually reaching a member, the
  gift wrap actually arriving, and the ledger row actually appearing are unproven by
  execution. The relay I/O is exercised only through mocks.
- **`docs/adr/README.md` was not regenerated.** `node scripts/adr-index-gen.js docs/adr`
  refuses to write the index while 19 pre-existing ADRs fail staleness validation
  (ADR-2082, ADR-2084 and others, all unrelated to this change). ADR-2088 itself raises no
  validation error. The index therefore does not yet list it.
- **The clarity signals are heuristics.** They will occasionally question a terse but
  clear suggestion and occasionally pass a verbose vague one. The bias is deliberate
  (a needless question costs a member seconds; a wrong action costs an engineering night)
  but it is a bias, not a proof.
- The reply-ambiguity limitation in Probe 3.

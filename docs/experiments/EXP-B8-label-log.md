# EXP-B8 — Does the routing judge beat its copy ceiling on real turns?

Pre-registered 2026-10-02, before any label was recorded. Owner decision 2026-10-02 R5b
("turn on the log and run it as a bounded test … turn it off once the data is statistically
significant"). Records: ADR-2110 (the label log), ADR-2095 (the copy-ceiling rule), ADR-2094
(the façade), cycle plan Track B item 8. Nothing below may change once the first row exists;
a change is a new experiment with a new id.

**Hypothesis.** On the estate's own traffic, the live typed-decision judge (`[skills.routing]`,
today `jev-latest`; the ADR-2094 façade is off, so this tests the judge the façade would front)
picks the skill the main model then uses more often than the strongest judge-free procedure over
the same options. H0: the two are equally often right.

**Unit and arms.** One analysable turn = one `routing_labels` row whose teacher label is a
routable skill or `none` (rows labelled `other` are excluded), and which carries both a judge pick
(`router_pick`) and a shadow BM25 pick (`bm25_pick`, `bm25_score`). The BM25 arm is the hook's own
ranker (`localRank`, the port held to the rig by `cascade-parity.test.mjs`) run over the same
candidate map in the same call. It is computed only while `label_log` is on, never shown to the
model, and stores a skill name and a number, never text. Names are compared without a `plugin:`
qualifier.

**Primary metric (ADR-2095).** Top-1 agreement with the teacher label, judge against copy ceiling.
The ceiling is BM25 with a "decline to `none` below t" rule, t chosen over **every observed score
breakpoint** (rule 1) to maximise its own agreement. The ceiling is oracle-tuned on the test rows,
so it is optimistic for the baseline and the test is conservative for the judge.

**Test.** One exact two-sided McNemar test on the discordant pairs: b = judge right, ceiling
wrong; c = ceiling right, judge wrong; p = min(1, 2·P[X ≤ min(b, c)]), X ~ Bin(b + c, ½). α = 0.05.
No interim tests. The tick counts rows; it never computes p before the stop.

**Minimum detectable effect and sample size.** MDE δ = 5 percentage points of agreement. The
discordant share ψ is taken from the ADR-2095 corpus: Jev against the BM25 ceiling, 11 v 3 of 86,
ψ = 14/86 = 0.163. Connor (1987), α = 0.05 two-sided (z = 1.960), power 0.80 (z = 0.842):

    n = [1.960·√ψ + 0.842·√(ψ − δ²)]² / δ²
      = [1.960·0.4035 + 0.842·0.4004]² / 0.0025 = (0.7908 + 0.3371)² / 0.0025 = 508.7 → **510**

If the observed ψ exceeds 0.163 the achieved power is below 0.80; the report states the observed ψ.

**Stopping rule.** Stop at the first tick (every 30 minutes) at which **510 analysable rows**
exist **or** the UTC date is **2026-10-20** (cycle exit) or later, whichever is first. At the
historical 82 routed turns a day the sample is expected around 10–12 October.

**Verdict → action on ADR-2110.**

| Result | Verdict | Action |
|---|---|---|
| p < 0.05 and b > c | **KEEP** — the judge beats its copy ceiling | ADR-2110 stays accepted; next is open question 1 (embedding retention) to the owner |
| p < 0.05 and c > b | **WITHDRAW** — the ceiling beats the judge | ADR-2110 → rejected; the façade programme's routing premise is falsified |
| p ≥ 0.05 with n ≥ 510 | **WITHDRAW** — no gain of 5 points detectable | as above: the leaf closes |
| p ≥ 0.05 with n < 510 (date stop) | **INCONCLUSIVE** — underpowered | ADR-2110 → rejected: the burden of proof is on the record, and the cycle rule closes it |

Every verdict also turns the log off: `label_log = false` on a branch, a pull request (never
merged automatically), the verdict in ADR-2110's Disposition, and one plain-English forum post as
JunkieJarvis in the dream digest's channel.

**Known bias, stated in advance.** The judge's pick is injected into the main model's context, and
the model can follow it (ADR-2110 open question 2), so judge–teacher agreement is inflated. A KEEP
is therefore an upper bound; a WITHDRAW is robust to this bias.

**Privacy bound.** No prompt text is stored (ADR-2090; ADR-2110 Decision 4): the row holds a
LAN-computed embedding, skill names, the shadow pick and its score, and the prompt's length.
Email-gateway turns are never recorded. The table is kept after the stop pending open question 1.

**Machinery.** `scripts/experiments/exp-b8-label-log.cjs` (pure analysis, tested in
`tests/config/exp-b8-label-log.test.js`), ticked by `skills/podcast-knowledge-ingest/crontab`.
State: `~/workspace/.agentbox/exp-b8/state.json`. `--status` prints the count; `--dry-run`
composes the report without posting or committing.

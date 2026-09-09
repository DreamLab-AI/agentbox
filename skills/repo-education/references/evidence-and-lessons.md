# Evidence and lessons

## Evidence record

For each chapter maintain a compact claim ledger: the reader's question, the
assertion, the exact source path/range and hash, runtime/test evidence where
needed, limitations and review status. Useful evidence classes are source-backed,
test-observed, runtime-observed and unverified. They are different types of support,
not successive scores on a confidence scale.

Capture receipts should identify command or URL, application mode, screenshot
hash and actual pixel dimensions. Record authentication bypass separately from
engine and data mode. Preserve only the relevant application's outputs; shared
browser tabs and environment dumps can contain unrelated private information.

A changed file can invalidate line references even when its name and exported
function are unchanged. Check hashes before final delivery. Do not silently update
a claim's provenance while retaining old runtime observations as if they were
fresh. Keep observations dated and scoped to the inputs they actually exercised.

## End-to-end analysis while teaching

Teaching exposes inconsistencies: terminology that no longer matches the UI,
diagrams whose arrows skip a gate, stale configuration assumptions and failure
paths hidden by successful demonstrations. Reproduce an issue before asserting a
bug. The skill's default is to stop the affected work and ask the user before
changing product code; follow the entrypoint's stop-and-ask rule. After an explicit
session override authorises a correction, verify its result. Version control aids recovery but is
not evidence that a change is correct or that a production mutation is reversible.

Keep before/after evidence for findings in internal investigation records, not in
the delivered reader's teaching path. Refresh affected screenshots, narration
and line references after a fix. Existing tests can be sufficient for copy changes;
behaviour changes need checks that exercise the trigger and meaningful failure
cases, not tests that repeat implementation expressions.

## Lessons established in the Campaignbuilder pilot

- A nested product repository can differ from the engagement/tracker repo. Locate
  the authoritative source and delivery tree before writing artifacts.
- Experienced developers still need a cold start: explain design intent, actors
  and terms, then provide multiple independently useful entry points.
- A first-run screenshot revealed stale tab counts and future-milestone wording.
  A live screen is evidence to inspect, not merely an attractive illustration.
- Transport, data provenance and engine mode are separate dimensions. Demonstration
  badges must not be treated as proof of production operation.
- Freeze test evidence in the pack. A subsequent non-coverage test run removed a
  package's normal coverage directory and broke a generator that read it directly.
- Users can revise delivery policy mid-production. Keep final media paths and Git
  ignore rules consistent with the latest policy, and test a clean local copy.

- The split source pane passed browser checks for full-file rendering, cited-line
  selection, file switching, history/deep links, missing-file handling and mobile
  return focus. Visual inspection found an offset error that numeric checks alone
  missed: verify that the highlighted source is actually visible.

- A bundled local launcher can stay dependency-free with Python while providing
  byte-range delivery for video seeking, SVG/HTML diagrams and indexed source.
  Check media MIME types and range responses, not only successful HTML loads.
- Adjustable reading/source panes need explicit pixel minima, keyboard controls
  and saved preferences; validate them on real pointer input and on a fresh
  browser context so a prior mobile emulation does not contaminate desktop checks.

- A first narrated four-scene clip was compressed to 1.73 MB for 93 seconds at
  1600×900 with H.264 CRF 23 and AAC 96 kbit/s. Every scene was visually inspected;
  local-browser playback, five seeks and WebVTT loading passed. This is a measured
  example, not a size target for footage with more motion or detail.
- Reset capture scroll position explicitly. A correct viewport size and complete
  DOM text did not stop a source slide from being captured at a stale scroll offset.
- Convert SRT timestamp punctuation only; a global comma replacement also changes
  the spoken text. Treat subtitle-format conversion as structured text handling.
- Distinguish audio decoding and muted playback checks from listening. Passing
  either cannot establish pronunciation, pacing or caption alignment.

- Full-page screenshot bounds do not trigger viewport-dependent content. In the
  pilot, scrolling and settling exposed missing sections and a previously unseen
  iframe policy error. Inspect the full image and keep newly observed errors;
  a passing headline assertion is not a complete visual check.

- Inspect the substitutions inside an integration test before borrowing its claim.
  A real wrapper and Git workspace can still call stub compiler/test binaries.
  For a teaching drill about compiler refusal, run the installed compiler, retain
  its actual diagnostic and exit code, and independently compare the restored
  file and Git status. Label scripted edits separately from real verification.
- Scope restart evidence to the specific store. A persistent proposal ledger
  does not establish persistence of an engineering request held in another
  component's memory map. Map each durable and ephemeral record independently.

- Check the rehearsal engine at every lifecycle phase, including planning. In the
  pilot, a prepared-change engine wrote its files on a describe-only turn before
  the restore point, making the proposed edit part of the baseline. Assert an
  unchanged workspace and no consumed implementation attempt after planning;
  then resume through real checks and independently verify restoration. A green
  rehearsal is only evidence if its substitutions preserve the lifecycle being
  taught. Likewise, distinguish approval of a plan from approval of an already
  implemented draft even when both use the same review-state name.

- Follow a decision across sibling UI panels, not just its success toast. A real
  approval moved a row out of review while the reported queue stayed empty until
  reload; isolated panel tests missed the handoff. Compare the fresh API row,
  the source panel and the destination panel in one browser journey. Check the
  status sentence too: a bound review approval was incorrectly presented as
  publication underway, although no publish action had occurred.

- Verify rollback separately at each side-effect destination. A failed PR-opening
  step after a real Git push restored the local workspace but left the remote
  draft branch intact. Record local files, current branch, remote draft and base
  branch independently. A disposable bare remote can prove Git effects; an
  injected forge response cannot prove authentication, branch protection, PR
  creation, merge or a healthy hosting deployment.

- Check the state after a successful recovery command, including newly created
  objects. In the pilot, restoring a database dump recovered an existing row but
  left a table created by the failed migration; a zero exit status had been
  reported as complete rollback. Exercise both modifications to existing objects
  and additions absent from the backup. Keep residual state and operator recovery
  visible even when the workspace itself is clean.

- Distinguish the version displayed for review from a binding recorded after the
  approval arrives. The pilot accepted changed migration SQL from a stale screen.
  An actual browser drill revised the server row after the read, submitted the
  earlier review version and verified refusal before database or approval-audit
  effects; a refreshed review then reached execution. Explain what the fingerprint
  covers and what it cannot observe, such as unrecorded filesystem changes.
  Inspect awaited boundaries too: a healthy audit preflight did not guarantee the
  approval append succeeded, and its returned failure needed to stop execution.

- Follow edited code into verification subprocesses as well as the model worker.
  The pilot's worker UID could not read private files, but its test runner still
  ran as the control-plane UID and could. Environment filtering did not prevent
  that read. After restricting the runner, verify legitimate checks too: build
  tools need writable scratch output without gaining write access to governing
  configuration or dependencies. Use the deployed ownership pattern in rehearsal
  fixtures; a same-user temporary directory missed a prepared-copy failure.

- Extend a minimal demonstration to the full checkout before borrowing its
  conclusion. The pilot's small TypeScript fixture passed while the tenant had
  120 compiler errors, even though its production build and runtime tests passed.
  Distinguish a gate that accepts no new diagnostics from a completely passing
  check. Preserve complete diagnostics when the displayed output is truncated.
  When repairing schema drift in tests, retain assertions and intentional legacy
  inputs; supply current defaults or explicitly construct the malformed runtime
  record rather than weakening production schemas to fit an old fixture.

- Trace a successful form beyond its confirmation screen. In the pilot, a page
  and its submission handler resolved different legacy field IDs; unit suites
  passed while a filled browser form failed. Check stored page overrides as well
  as composed defaults, preserve server-side required-field checks, and join the
  resulting contact to its submission in the database. Exercise a native form
  separately when the product promises operation without JavaScript.

- Verify that automation actually entered the values the application received.
  A native input setter did not reliably update the pilot's reactive form state;
  browser text-input events plus a retained-value assertion produced a reliable
  capture. Treat a failed capture script separately from a reproduced product
  failure. A database clone also has a scope: copying only the public schema
  omitted reporting views and broke the dashboard, even though the inbox worked.
  Record those exclusions before claiming a complete local installation.

- Budget generated media from a measured production shot, not the smoke test.
  The pilot's H3 smoke completed in 47.73 seconds; its larger 8.708-second shot
  took 23 minutes 45 seconds on the available A6000. A busy default GPU did not
  require disturbing the shared service: an isolated worker reused verified
  weights read-only on the free card, retained queue/history receipts, and was
  stopped after download. Check progress on the same job after observation
  timeouts. Keep the compressed illustrative source with the editable project,
  and keep its provenance separate from factual screenshots and narration.

- For browser persistence proofs, wait for the new document before checking its
  fields; a navigation command can return while the old DOM is still visible.
  Select the intended record by stable identity after reload, rather than assuming
  database row order. The brand pilot needed both corrections before its capture
  reliably matched the saved record. Verify a reversible edit through the API
  response, reloaded UI and independent storage read, then restore it through the
  same surface. If the API submits a full record, limit restoration claims to the
  fields actually compared.

- Prefer simplification while repairing the paths uncovered by the walkthrough.
  Reuse the existing source of truth for a contract instead of adding another
  registry or parallel implementation. Preserve useful features and authored data;
  do not confuse smaller code with removed behaviour. The pilot's fallback/save
  mismatch was repaired by sharing layout rules, and its autosave deadlock by
  checking the already available page configuration. Neither needed a new subsystem.
  Keep unrelated findings in the review backlog instead of expanding each repair.

- When an agent runtime supports custom providers, a small deterministic provider
  can emit fixed tool calls through the real executor and extension loader. The
  Pi pilot verified allowed writes, policy refusals and an OS permission failure
  this way, then checked filesystem state and loaded-source hashes. Call this a
  scripted-provider runtime test, not a model-judgement test; keep any unexercised
  control-plane transport and audit path explicit.

- A clean dependency check needs an empty dependency store, not an unusable host
  toolchain. Preserve the host's certificate and package-manager bootstrap settings
  while isolating the install cache. The pilot first lost registry verification by
  dropping CA settings, then hit a noexec home cache; neither required weakening
  signature verification or changing the product lockfile. Report bootstrap,
  dependency installation, application build and full deployment as separate scopes.

## Still being validated in the pilot

Narration editorial acceptance, remaining runtime journeys, manual accessibility
review and full deployment verification remain under active development. The workflow in this skill specifies their required outcomes;
it does not assert the pilot has already achieved them. Update this section after
verified results and move only reusable lessons into the established list.

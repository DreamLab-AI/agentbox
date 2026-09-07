# sovereign-mesh-bridge evaluator: vacuous PASS on annexe nights (2026-09-01 → 2026-09-07) — RESOLVED

Recorded 2026-09-06 by the dream night (deep: sovereign-mesh, slot 2, PR #4, closed unmerged);
corrected and closed by the operator 2026-09-07.

## What the night found

The `sovereign-mesh-bridge` evaluator (`cd services/nostr-pod-bridge && cargo build --release
2>&1 | tail -12`) returned `outcome=PASSED exit=0` on every annexe night from 2026-09-01 to
2026-09-07 while its stdout carried a cargo manifest-resolution abort:

    error: failed to load manifest for dependency `nostr-bbs-core`
    Caused by:
      failed to read `~/dream-annexe/nostr-rust-forum/crates/nostr-bbs-core/Cargo.toml`

The gate (`gate.json`, 2026-09-06) upheld an ACCEPT over that failing build: "3 required
evaluator(s) passed on candidate tree 77e53dfaba4c". The REQUIRED sovereign-mesh gate was
vacuous — it could not veto anything.

## Mechanism (fact, not inference)

Two independent defects, one root cause: agentbox is nested two levels below the workspace
locally (`workspace/project/agentbox`) but sat one level below the night dir on the annexe.

1. **Sibling placement** — `services/dream-engine/src/engine.rs` (`clone_repo_and_siblings`)
   shipped the target to `remote_dir/agentbox` and, per ADR-060, siblings to `remote_dir/<name>`.
   `services/nostr-pod-bridge/Cargo.toml:21,22,65` climb four levels (`../../../../`), which from
   `remote_dir/agentbox/services/nostr-pod-bridge` lands one directory *above* the night dir —
   exactly the path cargo reports.
2. **Pipe masking** — `services/dream-engine/src/runner.rs` (`timeout_wrapped`) ran evaluators
   under bare `bash -c`, so the pipeline's status was `tail`'s 0 and the receipt classified as
   `Passed` (`receipts.rs::classify`, exit 0 + non-empty stdout + no FAIL marker).

## Fix (landed 2026-09-07, `services/dream-engine`)

- `engine::annexe_subpath` mirrors the repo's canonical depth under the workspace on the annexe:
  target at `remote_dir/project/agentbox`, siblings at `remote_dir/nostr-rust-forum` and
  `remote_dir/solid-pod-rs`, so `../../../../` resolves to the night dir as it resolves to the
  workspace root locally. Unit-tested through the `workspace/agentbox` symlink.
- Both runners execute under `bash -o pipefail -c`; a failing producer piped through `tail`
  now surfaces its own exit code (regression test `local_runner_does_not_let_a_tail_pipe_mask_a_failure`).

The night's own warning — "do not ship pipefail alone" — was correct and is why the two changes
land together: pipefail with the siblings still absent would have vetoed every annexe ACCEPT.

## Standing rule (superseded)

The FALLBACK rule PR #4 proposed (treat the bridge PASS as vacuous, rest ACCEPTs on the other two
evaluators) is withdrawn: the evaluator is honest again and REQUIRED. If a future night sees the
cargo manifest error above, it is a real regression in sibling shipping (`annexe_include` warn
"sibling not found locally" in the engine log), not a known-vacuous pass.

Related: `docs/developer/dream-engine.md` (§annexeInclude, §Declaring evaluators).

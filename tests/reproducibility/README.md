# tests/reproducibility

Reproducibility tests for the agentbox runtime image.

## PRD-001 predicate satisfied

**M1-f-hash**: two consecutive `nix build .#runtime` invocations from identical inputs
must produce bit-for-bit identical output (same sha256 digest across all files in the
store path).

## Scripts

### `nix-build-hash.sh`

Runs `nix build .#runtime --print-out-paths` twice and compares the sha256 digest of
all files in the resulting store paths.

**Run from the repo root:**

```bash
bash tests/reproducibility/nix-build-hash.sh
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0`  | Both builds match — image is reproducible |
| `1`  | Builds diverge — non-determinism detected; hashes are printed for diagnosis |
| `77` | `nix` binary not found — test skipped (standard TAP skip convention) |

## What a failure means

A non-zero exit (code `1`) means the Nix flake produced different store paths on two
consecutive builds from the same source tree. Common causes:

- Timestamps or build metadata embedded in the image
- A dependency whose `src` uses an impure fetch (URL without `sha256`)
- A generator that writes the current date into a file

The printed hashes identify which build produced which digest. Bisect by isolating
which layer or package changed between runs.

## References

- ADR-001 — Nix flakes as the reproducible build foundation
- PRD-001 — Goal #2: reproducibility guarantee

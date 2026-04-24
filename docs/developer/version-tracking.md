# Version tracking

Agentbox pins every upstream dependency by exact version or commit SHA. This guide explains how bumps flow through the repo.

## Context in one paragraph

Every input to the build is pinned to an exact version or content hash so a rebuild of the same repo state produces the same image byte-for-byte. That property — reproducibility — is load-bearing: it is how [PRD-002](../reference/prd/PRD-002-immutable-runtime-bootstrap.md) makes "immutable boot" a meaningful claim, and how [ADR-001](../reference/adr/ADR-001-nixos-flakes.md) justifies the Nix flake (a pure hermetic build descriptor — inputs + lockfile fully determine outputs) as the build graph. Upgrading a pin is therefore a first-class action: it is a PR, it runs through CI, it ships as a reviewable diff. [ADR-004](../reference/adr/ADR-004-upstream-sync.md) is the policy governing which upstreams may be synced mechanically and which require human review; the mechanics below implement that policy.

## Glossary

- **Renovate** — a bot that opens PRs on an interval to bump dependency versions; configured in `renovate.json`.
- **`flake.lock`** — the Nix lockfile; each input entry carries `rev` (commit SHA) and `narHash` (content hash of the unpacked tree). A lockfile diff is the primary review artefact for Nix input bumps.
- **Custom-manager** — a Renovate feature letting you define regex-based pins for versions that live outside package manifests (e.g. a version string in a shell script or a Nix file).

## What gets tracked

| Ecosystem | Pin lives in | Updated by |
|---|---|---|
| Nix inputs (nixpkgs, flake-utils, nix2container, rust-overlay, skills) | `flake.lock` | `nix-flake-update.yml` weekly workflow |
| npm packages in `management-api/`, `mcp/`, `aisp/`, skills | `package.json` / `package-lock.json` | Renovate |
| Rust/Cargo (if any lands) | `Cargo.lock` | Renovate |
| GitHub Actions versions | `.github/workflows/*.yml` | Renovate (grouped PRs) |
| Codex Rust CLI version | `lib/codex-binary.nix` (`codexVersion` + per-arch sha256) | Renovate custom-manager + manual sha256 rotation |
| ComfyUI upstream rev | `flake.nix` (`comfyuiRev` + hash) | Renovate custom-manager + manual hash rotation |
| LichtFeld upstream rev | `lib/3dgs-stack.nix` (`lichtfeldRev` + sha256) | Manual until upstream is pinned |
| `@google/gemini-cli` version | `flake.nix` + `config/agentbox-aliases.sh` comment | Renovate custom-manager |
| `@anthropic-ai/claude-code` version | `claude-zai/Dockerfile` | Renovate (security-sensitive, manual review) |
| Nostr crypto (`nostr-tools`, `@noble/curves`) | `mcp/package.json` | Renovate (security-sensitive, manual review) |

## Three update channels

### 1. Renovate (`renovate.json`)

Install the Renovate GitHub App on `DreamLab-AI/agentbox`. It opens PRs Monday mornings for:

- **npm packages** — minor/patch auto-merge after a 3-day cool-off; major bumps require manual review.
- **GitHub Actions** — grouped into one PR per week.
- **Custom regex pins** — Codex, ComfyUI, Gemini CLI, gitleaks-action version strings.
- **Lock-file maintenance** — rewrites `package-lock.json` to pick up transitive upstream fixes without version changes.

Security-sensitive packages (`@anthropic-ai/claude-code`, `nostr-tools`, `@noble/curves`) never auto-merge; human review required.

### Why not: an all-auto-merge policy?

Rejected for the security-sensitive set above. The crypto libraries (`nostr-tools`, `@noble/curves`) underpin the sovereign mesh ([sovereign-mesh.md](sovereign-mesh.md)) — a silent regression here compromises the auth layer. `@anthropic-ai/claude-code` executes agent-authored prompts; version drift can change sandbox behaviour subtly. For everything else, auto-merge after cool-off gives the team a background upgrade signal without paper-cut noise.

### 2. `nix-flake-update.yml`

`.github/workflows/nix-flake-update.yml` runs weekly (Mondays 06:00 UTC) and on-demand via `workflow_dispatch`:

1. `nix flake update` — bumps every input.
2. If `flake.lock` changed: `nix flake check --no-build` as a sanity gate.
3. Opens PR `deps/nix-flake-update` with the diff.
4. Pre-merge checklist covers both Linux archs + contract harness + image-size check.

### 3. `scripts/check-upstream-releases.sh` — human dashboard

```sh
./scripts/check-upstream-releases.sh
```

Prints a colourised table comparing each pinned version to the latest upstream release. Green = current; red = bump available; yellow = unknown pin (drift indicator). Requires `gh`, `jq`, `curl`.

## Bumping Codex (worked example)

Renovate opens a PR changing `codexVersion` in `lib/codex-binary.nix` but **cannot compute new per-arch sha256s**. The PR lands with placeholder hashes and a CI failure. Resolve in-PR:

```sh
curl -sL "https://github.com/openai/codex/releases/download/rust-v<NEW>/codex-x86_64-unknown-linux-musl.tar.gz" | sha256sum
curl -sL "https://github.com/openai/codex/releases/download/rust-v<NEW>/codex-aarch64-unknown-linux-musl.tar.gz" | sha256sum
```

Paste both hex strings into the `assets` attrset in `lib/codex-binary.nix`, push, let `flake-check.yml` pass, merge.

Same pattern for ComfyUI (`comfyuiHash` in `flake.nix`) and LichtFeld (`lichtfeldSha256` in `lib/3dgs-stack.nix`).

## Adding a new ecosystem

For a pin that Renovate doesn't handle natively (e.g. a tarball URL in a shell script), add a `customManagers` entry to `renovate.json` with a regex matching the pin site. The existing Codex / ComfyUI / Gemini entries are the pattern.

For security-sensitive additions (crypto libs, signed-artefact sources), also add the package to the `packageRules` block with `"automerge": false` and a reviewer list.

## When upstream breaks

- **Codex ships a breaking CLI flag** — `tests/cli/smoke.sh` catches it on the Renovate PR (asserts `codex --help` + `--version` exit 0).
- **ComfyUI ships a breaking API** — manifest parse still passes; image-build tests catch surface changes.
- **A Nix input drops an attribute we use** — `flake-check.yml` fails the PR at eval time.
- **Security advisory** — Renovate's `vulnerabilityAlerts` (on by default) opens a high-priority PR; GitHub Dependabot Alerts provide a parallel surface.

## Rollback

Every bump is one PR. Revert with `git revert <sha>`.

## See also

- [`skills-upgrade.md`](skills-upgrade.md) — moving skills from in-tree to a standalone Nix input.
- [`../reference/adr/ADR-001-nixos-flakes.md`](../reference/adr/ADR-001-nixos-flakes.md) — why Nix flakes and what reproducibility buys us.
- [`../reference/adr/ADR-004-upstream-sync.md`](../reference/adr/ADR-004-upstream-sync.md) — policy for what may and may not be synced.
- [`../reference/prd/PRD-002-immutable-runtime-bootstrap.md`](../reference/prd/PRD-002-immutable-runtime-bootstrap.md) — immutable-boot constraint that pinning enforces.
- [`../../renovate.json`](../../renovate.json) — Renovate config.
- [`../../.github/workflows/nix-flake-update.yml`](../../.github/workflows/nix-flake-update.yml) — the weekly workflow.
- [`../../scripts/check-upstream-releases.sh`](../../scripts/check-upstream-releases.sh) — the human dashboard.

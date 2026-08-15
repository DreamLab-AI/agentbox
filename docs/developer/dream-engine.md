# Dream engine — nightly evidence-gated repo evolution

The dream engine is agentbox's "dream machine": an overnight batch that picks one nominated repository, has an LLM propose and justify one evolution against **real evaluator evidence**, records an ACCEPT / REJECT / INCONCLUSIVE verdict in that repo's ledger, and remembers the decisive ones. It runs when `[dream_machine].enabled = true` in `agentbox.toml`.

## Context in one paragraph

Left to itself, an LLM asked to "improve this repo" hallucinates plausible-sounding changes it never ran. The dream engine removes the hallucination surface by splitting the work across two planes: the **control plane** (this container) compiles a deterministic prompt and orchestrates; the **execution plane** (an SSH-reachable annexe host — HP-Desktop on the DreamLab estate, [ADR-052](../reference/adr/ADR-052-dream-machine-hp-annexe.md)) actually clones, builds, and runs the target repo's own evaluators. The evaluator receipts are appended to the prompt, so the model reasons over output it did not invent. A verdict is parsed deterministically, a ledger row is appended in the target repo, and a tamper-evident witness binds the report to the exact commit it judged. It is the Rust rewrite of `scripts/dream-machine-nightly.mjs`; the `.mjs` orchestrator is now the legacy fallback (see [below](#legacy-mjs-fallback)).

The engine holds **zero estate credentials on the annexe host**: it is a pull-nothing, push-work model. The control plane opens an outbound SSH session, ships a `git archive` of HEAD, runs commands, reads stdout back. The annexe never calls into agentbox, never holds an API key, and never sees the RuVector database. Secrets (the Z.AI key, the Postgres conninfo) live only in the control-plane process environment.

## Why an optional, host-specific feature?

`[dream_machine]` gates both the Nix package set and the supervisor block, following the general rule in [CLAUDE.md](../../CLAUDE.md): optional features are byte-identical-when-off. With `enabled = false`, `lib/dream-engine.nix` is never imported, the `dream-engine` binary is not in the image, and no `[program:dream-engine]` block is generated — the manifest and image outputs are unchanged. It is also host-specific: it needs an SSH-reachable annexe host and an LLM endpoint, so the shipped `setup/agentbox.default.toml` carries the section commented out. The live estate manifest enables it.

## Architecture

```mermaid
flowchart LR
    subgraph CP["Control plane — agentbox container"]
        DISC["discover repos<br/>(dream.config.json)"]
        COMP["compile deterministic prompt"]
        LLM["LLM call<br/>Z.AI GLM / Loom"]
        VERD["parse verdict"]
        PERSIST["ledger row + witness<br/>+ RuVector store"]
    end
    subgraph EP["Execution plane — annexe host (SSH)"]
        BUILD["clone HEAD + build"]
        EVAL["run repo's own evaluators"]
    end
    DISC --> COMP --> BUILD
    BUILD --> EVAL
    EVAL -->|"receipts appended to prompt"| LLM
    LLM --> VERD --> PERSIST
```

* **Control plane** (`services/dream-engine`, this container): discovery, prompt compilation, LLM dispatch, verdict parsing, ledger/witness/memory persistence.
* **Execution plane** (annexe host, over SSH): `git archive` of HEAD is shipped and extracted remotely (uncommitted changes are deliberately excluded so the witness commit always matches the evaluated tree), then the build step and each evaluator run inside the annexe working dir. Remote commands are wrapped in `bash -lc` because the annexe login shell is fish.

## Nominating a repo — `dream.config.json`

Any repository under the workspace root is nominated by dropping a `dream.config.json` marker in its root. Discovery is a single-level scan of the workspace directory; nominated repos are processed in sorted order and tonight's repo is picked by day-of-year rotation (or forced with `--target`).

| Field | Type | Meaning |
|---|---|---|
| `repo` | string (required) | Human name of the repo, e.g. `"DreamLab-AI/agentbox"`. |
| `slots` | array (required) | Rotating focus areas. Each is `{ "deep": "<theme>", "scan": ["<area>", …] }`. Tonight's slot = `dayInt % slots.length`. |
| `bonusModuli` | map | `{ "<modulus>": "<extra dive>" }`. A dive fires when `dayInt % modulus == 0` — periodic deep passes layered on the daily slot. |
| `buildStep` | object | `{ "cmd": "<build command>", "degradeOnWasmFailure": false }`. Run on the annexe before evaluators. |
| `evaluatorEntrypoints` | map | `{ "<name>": "<command>" }`. Each is run on the annexe; its stdout tail becomes evidence. **This is the load-bearing field** — see [evaluator liveness](#evaluator-liveness-the-1-failure-mode). |
| `competitors` | array | Named comparators the prompt asks the model to beat. |
| `adrConvention` | string | ADR numbering convention (default `"4-digit"`). |
| `extraDisciplines` | array | Extra review lenses folded into the prompt. |
| `ledgerPath` | string | Where the ledger row is appended, relative to the repo (default `docs/dream-cycle/LEDGER.md`). |
| `branchPrefix` | string | Branch namespace for proposed work (default `dream/`). |
| `autoMerge` | bool | **Recommend `false`.** Accepted findings are evidence for a human to act on, not an instruction to merge unattended. |

Only `repo` and a non-empty `slots` (each with a non-empty `deep`) are validated; everything else defaults.

## Nightly pipeline

One cycle (`run_cycle`) is a fixed sequence:

1. **Discover** nominated repos under the workspace.
2. **Select** tonight's repo — `--target` override, else day rotation.
3. **Load + compile** — read `dream.config.json`, pick tonight's slot + bonus dives, compile the deterministic prompt.
4. **Dispatch** — `git archive HEAD` → SCP to the annexe → extract → run `buildStep` then each evaluator; capture stdout.
5. **Evidence** — append the build-output tail and each evaluator's output tail to the prompt, so the model reasons over receipts, not imagination.
6. **LLM call** — Z.AI GLM by default, Loom fallback. A failed call degrades to an `INCONCLUSIVE` night rather than aborting.
7. **Verdict + finding** — parse the verdict, sanitise a one-line finding for the ledger cell.
8. **Witness** — bind the report to the repo's current commit.
9. **Persist report** locally under the artefact dir.
10. **Ledger row** — append to the repo's `ledgerPath`.
11. **RuVector store** — significant findings only; fail-open (a memory failure never fails the night).

`--dry-run` stops after step 3 (compile + select only; no dispatch, no LLM).

## Verdict semantics + significance bar

The verdict is parsed deterministically from the LLM's free-form markdown. A strict priority order ensures a stray keyword in the body can never override an explicit trailing `VERDICT:` line (a false positive that bit us in production — it has a regression test). Three outcomes:

| Verdict | Meaning | Persistence |
|---|---|---|
| `ACCEPT` | The experiment is justified by the evidence. | Ledger row **and** RuVector (`[dream_machine].memory_namespace`, default `dream-cycle`). |
| `REJECT` | The experiment is refuted by the evidence. | Ledger row **and** RuVector — a refutation is as valuable as an acceptance. |
| `INCONCLUSIVE` | No decisive evidence (or a degraded/failed night). | Ledger row **only** — not memorable enough to store. |

The significance bar is exactly `ACCEPT || REJECT`: `store_finding` returns early (`Ok(false)`) for `INCONCLUSIVE`, so the memory namespace only ever accumulates decisive verdicts.

## Witness recipe

Every ledger row carries a compact witness that makes the chain tamper-evident. The binding is a double SHA-256:

```text
witness = sha256_hex( sha256_hex(report) ++ commit )
```

where `++` is ASCII concatenation of the 64-char lowercase report hash and the normalised (trimmed, lowercased, 7–64 hex) commit. A single changed byte in either the report or the commit yields a different witness; the ledger shows the first 12 characters. If the commit is missing or malformed the witness is recorded as `BLOCKED` rather than a bogus hash.

## Evaluator liveness — the #1 failure mode

**Silent no-op evaluators are the single biggest historical failure of the dream machine.** An evaluator that always emits the same output regardless of the code under test gives the LLM constant "evidence", so the night silently no-ops: it produces verdicts that look real but are surface-independent. Two concrete incidents:

* **redblue, night 1** — an evaluator entrypoint that classified as a silent no-op, producing identical output on every run.
* **darwin, ADR-099 (upstream `@metaharness/darwin`)** — a `@metaharness/darwin` entrypoint invoked with the default `--sandbox real`, which is *documented surface-independent*: it emits the same result regardless of the code under test.

The discipline is a hard criterion: **every evaluator entrypoint must provably produce surface-dependent output** — output that changes when the code under test changes. Two ways to satisfy it:

* Wire a real measurement. A `criterion`-style benchmark whose numbers move with the code is surface-dependent by construction.
* For `@metaharness/darwin` entrypoints, **always pass `--sandbox mock` or `--sandbox agent`** — never the default `real`. The `mock`/`agent` sandboxes route the evaluation through the actual code path; `real` is surface-independent and no-ops.

A quick self-check for any entrypoint you add to `evaluatorEntrypoints`: run it against two different commits and confirm the output differs. If it does not, it is a no-op and the night is worthless.

## Operations

**Today (pre-rebuild):** run the loop by hand in a tmux tab —

```bash
dream-engine --loop --agentbox-toml /etc/agentbox.toml
```

**After the next rebuild:** the `[program:dream-engine]` supervisor block runs the loop as a supervised background service (priority 230, background batch tier). `--loop` runs at most one cycle per UTC night inside `window_start..window_end` and exits cleanly if `enabled = false`.

**Manual runs:**

```bash
dream-engine --once                       # one cycle now, ignoring the window
dream-engine --dry-run                     # compile + select only; no dispatch, no LLM
dream-engine --once --target <repo>        # force a specific nominated repo
dream-engine --once --workspace <path> --artefact-dir <path>
```

Night artefacts (reports, receipts) are written under `workspace/.tmp/dream-annexe-artefacts/<date>-<repo>/`.

### How the manifest reaches the binary

The binary reads the `[dream_machine]` table (window, HP host, annexe dir, model names) from the file passed to `--agentbox-toml`. The image materialises the full manifest at the stable path `/etc/agentbox.toml`, which is what the supervisor block passes. The `environment=` line adds only the Nix-known LLM selection (`DREAM_LLM_PROVIDER`, `ZAI_MODEL`, `LOOM_URL`, `LOOM_MODEL`) so the provider is visible in the supervisor block; secrets are inherited from the entrypoint environment, never written into generated text.

### Environment variables

| Variable | Purpose | Source |
|---|---|---|
| `ZAI_ANTHROPIC_API_KEY` | Z.AI credential (GLM via the Anthropic Messages API). **Secret.** | Entrypoint env — never in the manifest or supervisor block. |
| `DREAM_LLM_PROVIDER` | `zai` (default) or `loom`. Overrides `[dream_machine].llm_provider`. | Supervisor block / shell. |
| `ZAI_URL`, `ZAI_MODEL` | Z.AI endpoint + model override. | Supervisor block / shell. |
| `LOOM_URL`, `LOOM_MODEL` | Loom façade endpoint + model override. | Supervisor block / shell. |
| `RUVECTOR_PG_URL` / `RUVECTOR_PG_CONNINFO` | Memory Postgres DSN (URL form, or libpq conninfo which is converted). **Secret-bearing.** | Container env. |
| `XINFERENCE_URL` | Embedding endpoint (default `http://192.168.2.132:9997`). | Container env. |
| `RUST_LOG` | Log filter (default `info`). | Supervisor block / shell. |

## Legacy `.mjs` fallback

`scripts/dream-machine-nightly.mjs` is the original Node orchestrator. It is retained as a manual fallback and rollback path only — the supervised, first-party path is the Rust `dream-engine` binary. Reach for the `.mjs` script only if the binary is unavailable; new behaviour lands in the crate.

## Related

* [ADR-052 — HP annexe execution plane](../reference/adr/ADR-052-dream-machine-hp-annexe.md)
* [Architecture overview](architecture.md) — manifest → flake → image → runtime
* `lib/dream-engine.nix` — the buildRustPackage derivation
* `services/dream-engine/` — the crate (48 hermetic tests)

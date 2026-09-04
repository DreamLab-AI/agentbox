---
title: September upstream upgrade assessment and rebuild handoff
status: implemented-awaiting-rebuild
last_updated: 2026-09-04
---

# September upstream upgrades

Agentbox adopts a Gemini default update, more conservative Rust daemon
identification, and a Spark integration skill. The larger orchestration,
knowledge-store and forecasting integrations remain deferred for the reasons
below. No new daemon or model download is introduced.

| Candidate | Decision | Delivered or next requirement |
| --- | --- | --- |
| [Utopia](upgrades-orchestration-2026-09.md) | Retain as a design reference | Temporal provenance is promising; a second ontology/vector store duplicates existing authorities. Prototype as-of evidence through the governed knowledge boundary first. |
| [NEEDLE](upgrades-orchestration-2026-09.md) | Adopt conservative process identification | Rust daemon discovery now uses argument boundaries and validates registry PIDs. Whole-orchestrator adoption needs a demonstrated queue use case and adapter contracts. |
| [Spark](upgrades-spark-2026-09.md) | Adopt a browser integration skill | Registered for Claude Code and Codex; explains capture/data registration and host-renderer integration. No host viewer has been deployed. |
| [TimesFM-3](upgrades-timesfm-2026-09.md) | Defer production integration | Published weight restrictions and lack of verified retained monitor history prevent a production rollout. Evaluate against simple baselines under appropriate rights. |
| Gemini 3.8 Flash | Update general-purpose Google defaults | Manifest, setup template, schema, consultant, URL-context MCP and new AoE session seeds align on the released model. |

## Gemini selection and limits

Google's [model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
confirms the stable identifier `gemini-3.8-flash`, URL context and text output.
It does not support image generation or the Live API. The specialised image
endpoint and podcast judge remain separately selected. The legacy OpenRouter
alias also retains its existing provider-specific identifier; Google API release
does not establish that route's availability.

For the Antigravity consultant, a non-empty `AGENTBOX_ANTIGRAVITY_MODEL` takes
precedence over `[consultants.antigravity].model`, followed by the registry's
`gemini-3.8-flash` fallback. Boot reads the manifest through the Rust
`agentbox-manifest toml-string` command before projecting MCP configuration.
The TUI preserves an existing operator model unless its input explicitly changes
that model. Fresh manifests select 3.8. URL context accepts `GEMINI_MODEL`.

New declarative Antigravity sessions carry an explicit 3.8 model argument.
Already-running sessions are not recreated or interrupted; inspect their model
when testing the rebuilt image.

Consultant costs are approximate API-equivalent estimates from character counts,
not subscription invoices or provider-reported usage. The
[release announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/)
publishes introductory rates through 2026-12-31 and higher rates from 2027-01-01;
the estimator selects those rates at call time. For an override with no configured
tariff, consultation returns `cost_usd: null` and `cost_estimate` reports the
missing tariff. The restricted Cyber model is not a general default.

## Local verification

- `agentbox-manifest`: 108 tests passed, including model precedence, boot
  projection and golden outputs; Clippy with warnings denied passed.
- `agentbox-mcp`: 61 tests passed, including default and model override behaviour.
- `agentbox-ops`: 141 tests passed; read-only daemon discovery found six live
  daemons and signalled none. An earlier run encountered the existing tick-lock
  timing failure; the subsequent full run passed.
- Consultant tests cover CLI model arguments and the tariff date boundary.
- Both live and setup manifests validate with five advisory warnings; skill
  count and estate lint pass. Rust formatting and shell syntax checks pass.
- The broader configuration suite reports 63 passed, three failed and one
  skipped. Replaying the three failing fixtures with the original schema gives
  the same results: E009/E017 tests expect errors where the unchanged validator
  emits W017; the W038 fixture lacks its required consultant exception (E021).
  These existing fixture failures were not changed by this upgrade.

`lib/agentbox-manifest.nix` stages the new boot test fixture for isolated
Nix builds; the equivalent staging passed in a temporary crate copy. Nix is unavailable in this authoring container, so image evaluation
and boot remain unverified. No authenticated Gemini call, TimesFM inference or
Spark GPU rendering was used as a local test.

## Rebuild request

Rebuild this working tree on the host, then test the new image. New upgrade
files have been added to the Git index so a Git-backed flake includes them; no
commit was created. Preserve them when preparing the build source snapshot.
Concurrent Codex and telemetry repairs also exist in the checkout; this document
claims validation only for the upgrade changes described above.

```bash
./agentbox.sh rebuild
./agentbox.sh up
```

In the rebuilt container:

1. Run `agentbox-manifest toml-string --manifest /etc/agentbox.toml --path
   consultants.antigravity.model`; expect `gemini-3.8-flash` for the updated
   manifest. Inspect only the model field of the projected consultant entry,
   without printing MCP credentials. Check an explicit override survives boot.
2. Run the Antigravity consultant health tool and a short consultation. Confirm
   its reported model and account access. For URL context, run its health tool
   and one public-URL request; confirm model and retrieval metadata.
3. Inspect a newly created disposable Antigravity session's model argument.
   Existing sessions need an explicit operator update if they retain older
   configuration.
4. Run `ruflo-daemon-gc --json` and `token-audit --help`. Check discovery against
   a known disposable daemon; keep the smoke check read-only.
5. Confirm `spark-scene` appears in both harness skill surfaces and its reference
   resolves. Follow the [Spark acceptance criteria](../../skills/spark-scene/references/integration.md#acceptance-after-integration)
   only after implementing the host layer with an authorised calibrated capture.

Record the image identity, CLI/model results and any failures against this
handoff. A successful rebuild does not by itself validate a scene renderer or
forecast accuracy.

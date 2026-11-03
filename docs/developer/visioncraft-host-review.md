# VisionCraft host review dispositions — 3 November 2026

The independent Claude/Deepsec review examined the Agentbox host policy adapter,
release snapshot checker, MCP projector, CLI dispatch and host wrapper. Its
model analyses emitted three findings. The encompassing adapter receipt was
`ERROR` because descendants remained after the review command; these findings
are useful review evidence, not a successful overall gate receipt.

The original report and receipt are retained under
`workspace/evidence/visioncraft-20261103/host-adversarial/attempt-1/`.

| Finding | Disposition | Evidence and boundary |
|---|---|---|
| `other-policy-override-fail-open` | Documented caller-authority boundary; not a vulnerability under this local CLI contract | The caller already owns argv, environment, manifest and PATH. Overrides are an intentional compatibility feature. Tests retain explicit missing-manifest refusal, typed policy, credential-name-only projection and ordinary flag precedence. A disabled/unavailable review cannot earn PASS. CI must supply scoped credentials; this command is not a privileged service interface. |
| `other-insecure-file-permissions` | Confirmed; source repaired | A regression placed a symlink at the old predictable temporary name and reproduced an unrelated-file overwrite. A separate regression reproduced an unchanged mirror retaining mode 0644. `jsonio::write_atomic` now uses exclusive `NamedTempFile` creation, mode 0600 before writing, file sync and atomic persist. All MCP JSON mutations use that writer. Failure preserves the target and removes staged files. |
| `other-logic-bug` | Confirmed; source repaired | Regressions reproduced erased shell defaults and a malformed opener swallowing a later JSON field/valid placeholder. Only exact `${NAME}` tokens with ASCII shell-variable names are expanded. Shell operators, invalid names and unmatched openers remain literal; valid unset names still become empty strings. Existing quote/backslash escaping controls remain. |

`jsonio::write_atomic` callers also include per-user model routing, permissions
settings and MCP hub configuration. They all require private configuration;
replacement intentionally narrows broad modes instead of copying mode 0644 from
a secret-bearing destination. Existing boot ownership reconciliation remains in
place. The change retains byte-for-byte JSON output and the existing newline
contract. Non-atomic writes for unrelated public/generated artefacts are outside
this private-writer contract.

The consumer worktree retains `host-findings-red.log` (four failing reproduction
checks, with the failed-replacement control already passing) and
`host-findings-green.log` (229 passing manifest tests after repair). Clippy with
warnings denied and all three boot projection controls also pass at source
commit `75bd6c7e77fad41b72c8b78703cd7751a0a0d07c`. These and
the original frozen-input hashes are archived with the consumer evidence before
worktree removal. Subsequent independent revalidation and release activation
must have their own receipts; this disposition does not claim either occurred.


## Second review

The second run emitted twelve findings. Its encompassing receipt remains `ERROR`
because the strict reviewer-coverage check found disclosed uninspected neighbour
imports. Preserve that result; the dispositions below do not turn it into PASS.
Original evidence: `host-adversarial/attempt-2/` beside the first run.

| Finding (path distinguishes repeated slugs) | Disposition and evidence |
|---|---|
| `missing-auth` — hub | Existing local trust boundary, not added by this cutover. The actual hub explicitly has no authentication and rejects non-loopback binds (`services/agentbox-mcp/src/hub/mod.rs`). Local-user/role separation is a remaining baseline concern; no hub authentication redesign was made. AQE stays per-session and is explicitly excluded from the hub list. |
| `other-integrity-check-bypass` — inventory | Confirmed and repaired. Unix backslash filenames could collapse onto a slash-separated key. Inventory now constructs keys from normal UTF-8 components, rejects backslashes and rejects any duplicate insertion. Both alias and duplicate-key regressions failed before repair. |
| `other-silent-data-loss` — JSON dumps | No reachable counterexample for serialising a `serde_json::Value`; the report also states that limit. Replaced the misleading `{}` fallback with an explicit serialization invariant, preserving existing golden-byte checks. |
| `other-atomic-write-metadata` — private writer | Caller contract retained. Boot restores the runtime user's ownership after permissions/MCP/hub projection; model-routing projection runs as that user. Mode 0600 is intentional, not copied from a possibly public secret file. The writer promises atomic visibility and synced file bytes, not directory-fsynced power-loss durability or automatic arbitrary UID transfer. Those remain explicit limits. |
| `other-non-atomic-write` — legacy JSON writer | Existing availability risk remains in `proxy.rs` and `plugins.rs`. Their plain writer is unchanged. Moving them to a private writer requires checking their reader UID/public-config contract; it is not necessary to install the new per-session AQE consumer. |
| `other-governance-predicate-weak` — fork cleanup | Confirmed baseline heuristic limitation. A fixture path `/tmp/opt/agentbox/ruvector-mcp.cjs` remains registered. The predicate is byte-identical to main; it is operational cleanup, not a process/credential isolation guarantee. No broad command/shell parser was introduced. |
| `other-data-loss-config-rewrite` — Codex AQE | Confirmed and repaired with `toml_edit`. Existing comments, unrelated values, tool allowlists, custom env, timeouts and required-server policy survive. Managed command/args/transport fields and AQE policy env are reconciled; defaults are added only when absent. Inline tables and an invalid-env preservation control are covered. |
| `other-data-loss-config-rewrite` — set/mirror MCP shape | Confirmed and repaired. Strict reads and mirrored destinations reject a non-object root or non-object `mcpServers` before mutation. Regression cases retain the exact original bytes for arrays and null maps. |
| `other-silent-empty-secret` — unset placeholder | Intended compatibility retained: a syntactically valid unset name expands to empty, as the original projector contract requires. A registration success does not establish authenticated service readiness. Required-secret policy must be declared by its owning caller; the generic placeholder parser cannot infer it from a variable name. |
| `other-data-loss` — corrupt hub sidecar | Confirmed baseline issue remains: the existing projection treats a damaged sidecar as empty and overwrites it. A fixture retains the before/after bytes. This transition code is unchanged by the consumer task. |
| `other-logic-bug` — hub list shrink / URL change | Confirmed baseline issue remains: removing the only hubbed name or changing the hub URL leaves a dangling HTTP registration with an empty runtime server map. The stored definition is retained. The transition code is unchanged and AQE is not on this list. |
| `other-input-validation` — hub server names | Confirmed baseline issue remains: `a/../b` becomes an ambiguous URL path. Names are operator-controlled. No new hub-name input is introduced by the cutover. |

`host-second-review-red.log` retains six failing new regressions.
`host-second-full.log` records 235 passing Rust tests after the repairs;
`host-second-clippy.log` and `host-second-boot.log` record clean Clippy and three
passing boot cases. `hub-baseline/observations.json` retains the five bounded
configuration-only probes and verifies that the relevant hub/predicate sections
are byte-identical to main `ec36ec61a`. These probes launch no MCP server or model.
The production repair files are frozen again for independent revalidation.

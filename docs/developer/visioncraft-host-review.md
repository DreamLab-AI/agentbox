# VisionCraft host review dispositions — 3 November 2026

The independent Claude/Deepsec review examined the Agentbox host policy adapter,
release snapshot checker, MCP projector, CLI dispatch and boot wrapper. Its
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
`host-findings-green.log` (the complete manifest suite after repair). These and
the original frozen-input hashes are archived with the consumer evidence before
worktree removal. Subsequent independent revalidation and release activation
must have their own receipts; this disposition does not claim either occurred.

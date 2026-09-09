# Two consultation paths (addendum 2026-09-08)

The consultant model is **`gpt-6-astra`** (`[consultants.codex] model` in `agentbox.toml`,
the Codex bundled default since 2026-09-03; the `-codex` suffixed IDs are rejected on a
ChatGPT-account harness). Two ways to reach it; pick by how much context the task needs.

| | Path 1: MCP `consultant-codex` → `consult` | Path 2: direct `codex exec` |
|---|---|---|
| Context | Curated `context_excerpt` you paste (keep under ~100k tokens) | The model reads files itself; one-million-token context, whole repositories and bundles |
| File access | None | Everything the container can read |
| Shape | One shot; returns an envelope with model, tokens, cost, citations | Agentic; runs for 5–15 min; final message captured to a file |
| Cost check | `cost_estimate` tool first (about $1.10 per 92k prompt tokens, 2026-09-08) | Same rate; no estimator, so size the bundle with `wc -w` |
| Use for | Second opinion on a snippet, a design note, a short document | Adversarial review of a client package against the full engagement history; audits that must open specs, ADRs, quotes and prior correspondence |

**Path 2 recipe (verified 2026-09-08 on codex-cli 0.153.3):**

```bash
S=/path/to/scratchpad
# 1. Optional: assemble a "golden path" bundle in reading order so the model does not
#    have to discover the history: arc → quotation → client emails → our replies →
#    internal memos → evidence base → prior reviews → the package under review.
{ cat docs/strategy/*.md; cat docs/rfq-source/email-*.md; ...; } > $S/bundle.md
# 2. Brief: task, file paths, output structure, and a closing "Context I still need"
#    section so the model can ask for what it could not find.
# 3. Run detached; -o captures the final message; the log carries the tool trace.
codex exec -m gpt-6-astra -s danger-full-access -C /path/to/repo --skip-git-repo-check \
  -o "$S/review.md" "$(cat $S/brief.md)" > "$S/review.log" 2>&1
# 4. Afterwards: git status must be clean (the brief says do not write).
```

Gotchas that cost a run each:

- **`-s read-only` does not work in this container.** bwrap is unavailable under
  `no-new-privileges`, so a read-only sandbox cannot be set up and every shell call the
  model makes fails; the model then reports the material as "inaccessible" and writes a
  review of nothing. Use `-s danger-full-access` (the container is the sandbox, as
  `~/.codex/config.toml` says) and put the no-write rule in the brief.
- **Approval policy is `never`** in exec mode, so MCP tools that need approval
  (`agentbox-memory/memory_search`) fail. Harmless; tell the model not to call them.
- **Always close stdin: `< /dev/null`.** `codex exec` prints "Reading additional input from
  stdin..." and, if stdin is open but silent, waits on it indefinitely with no tool calls
  and no timeout (a run sat 69 minutes at one log line, 2026-09-09). Redirecting stdin from
  /dev/null makes it proceed at once. Pass the prompt as the argument.
- **Always ask for a "Context I still need" section.** A second pass with the listed
  material is cheaper than a first pass that guessed.

# jev-checkpoints — Claude Code plugin

Jev (TypeSafe System One) used as a cheap **timing judge** for one question: is now
a moment when the expensive Opus advisor (ADR-2134, `advisorModel`) is worth
consulting? The plugin never forces a tool call and never blocks anything. When a
checkpoint fires it adds one short advisory line to what the model reads, and the
model decides what to do with it. Decision record: ADR-2135.

Function hooks need Claude Code ≥ 2.1.294 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
In agentbox the plugin is baked to `/opt/agentbox/config/claude-plugins/jev-checkpoints`,
listed in the `agentbox` directory marketplace and installed as
`jev-checkpoints@agentbox` in the root session only (as factrail is), with its
`userConfig` projected from `[features.jev_checkpoints]`.

## The four checkpoints

| checkpoint | event | asks Jev | injects | where the line lands |
|---|---|---|---|---|
| **done** | `turn.complete` (main loop, `reason: answer`) | Score: "claims the task is done/fixed/passing without a test, build, lint or type-check having run successfully this turn" | at `doneThreshold` (0.9) or above | context of the **next** prompt |
| **repeat** | `tool.call` (after the result) | never: local only | when one failure fingerprint reaches `repeatCount` (2) | context of that failing tool result |
| **plan** | `prompt.submit` | Score: "this request needs a multi-file implementation plan or touches an auth/schema/API/data contract" | at `planThreshold` (0.8) or above | context beside the prompt |
| **spawn** | `agent.spawn` | Choice over `haiku`, `sonnet`, `opus`, `inherit` | never: shadow by default, see below | a rewritten `model` (enforce only) |

The lines, each under 300 characters:

- done: `jev-checkpoints: the last turn claimed done without a verifying run — consult the advisor over the full diff or run the checks before declaring done (ADR-2134 checkpoint 3).`
- repeat: `jev-checkpoints: the same failure has now occurred N times — consult the advisor on the root cause before another fix attempt (ADR-2134 checkpoint 2).`
- plan: `jev-checkpoints: consult the advisor before locking the plan (ADR-2134 checkpoint 1).`

**done.** A local pre-gate runs first: a final text with no completion-like wording
("done", "fixed", "all tests pass", "should now work", "ready to merge" and so on)
sends nothing. The evidence Jev sees is the assistant's final text (its last
12 000 characters) and a compact list of this turn's main-loop tool calls: the tool
name, `ok` or `error`, and for Bash the command's first line. Tool output is never
part of it.

**repeat.** After each failing Bash call, or a failing call of a tool named like a
test, build, lint or check runner, the plugin fingerprints the failure. The
fingerprint is a hash of its error lines (or of its first five lines when none
reads as an error), with the noise a re-run changes replaced first: `file:line:col`,
`line N`, hex addresses and ids, timestamps, durations and pids. A fix attempt that
moves the panic from `parser.rs:118` to `parser.rs:131`, and the run time from 0.53 s
to 1.07 s, still counts as the same failure. A different message or file does not.
Each fingerprint is advised on once for the whole session: the main loop and every
subagent count the same failure together, and one line per prompt is the cap for
all of them. A fingerprint the cap held back speaks on its next occurrence.

**plan.** Slash commands, prompts shorter than `minChars` (24), and prompts that
are not the person's own (task notifications, prompts submitted by plugins) are
never sent. The line is not repeated on the prompt straight after one that carried
it, because a follow-up to a planned request is the same plan.

**spawn.** Jev is asked which tier the subagent task needs, given the agent type,
the description and the prompt's clamped head and tail. Under `spawnMode`:

- `off`: nothing is asked.
- `shadow` (the default): the hook passes the spawn on at once and never waits on
  the judge. Jev is asked afterwards, detached from the spawn, and the pick is
  only logged.
- `enforce`: the spawn waits for the verdict, within `timeoutMs`. The pick replaces the subagent's model only when **all** of these hold:
  the caller named no model; the spawn is not a fork or a workflow agent (neither
  takes a model); Jev's confidence is at least `spawnMinConfidence` (0.8); the pick is
  not `inherit`; the pick is **no larger than the main session's model** (it never
  upgrades); and the agent's definition pins no model. The engine's `agent.spawn`
  input does not carry the definition's frontmatter, so the plugin reads
  `<project>/.claude/agents/<type>.md`, then `~/.claude/agents/<type>.md`. A
  `model:` other than `inherit` there counts as pinned. A type with no definition
  file counts as pinned, so a built-in with its own model, or a plugin's
  `<plugin>:<name>` agent, is left alone; the one exception is `general-purpose`,
  which follows its caller.

Every spawn decision, shadow or enforced, adds one JSON line to the shadow log for
the ADR-2110 teacher labels. `$.fs` has no append, so each session writes its own
files beside `shadowLog`, named from its stem: `shadow.jsonl` gives
`shadow-<session>.jsonl`, then `shadow-<session>.1.jsonl`, `.2`, … A segment is
closed once it would pass 1 MB, and one that cannot be read or is not a file is
left untouched. Either way the line goes to the next segment, so existing lines
are never truncated or rewritten away. Readers glob `<stem>-*.jsonl`.

```json
{"ts":"2026-10-09T14:02:11.120Z","session":"…","subagent_type":"Explore","caller_model":"inherit","jev_choice":"haiku","confidence":0.91,"enforced":false,"ms":412,"usd":0.000034,"prompt_digest":"sha256-12-3fa94c0e5b21"}
```

No prompt text goes into the log; `prompt_digest` is a `sha256-12-<12hex>` digest
of the prompt, for joining.

### Why spawn routing is shadow-only by default

suenot/codex-jev-router measured Jev choosing subagent models per call, and the
routed setup came out about **70% dearer** than one strong agent doing the work. A
router can be right on each call and still be wrong for the task: every cheap
subagent that misreads its brief costs a re-delegation, and the context passed to
it is paid for again. Until this estate's own shadow log shows Jev's picks agreeing
with what the work needed, a pick that changes nothing is the honest default.
`/jev-checkpoints status` reports the agreement rate between Jev's pick and the
caller's own choice (`inherit` when the caller named none).

The plugin draws on pi-warden's idea too: guard done-claims and retry loops rather
than routing every turn.

## Cost

Each Jev request is billed on input only, at `usdPerMTokIn` (Jev: $0.042 per
million input tokens; output is free). A checkpoint request is a few thousand to
about 14 000 input tokens, so **about $0.0006 per request** at most. At most one
request per hook event; repeat never makes one. A busy session that asks plan on
every prompt and done on most turns costs a few cents a day. Every request's cost is
counted per checkpoint and shown by `/jev-checkpoints status`, and each shadow-log
line carries its own `usd`. Set `usdPerMTokIn` to 0 for a self-hosted façade.

## Privacy and egress

- **Never sent:** tool-result contents, file contents, diffs, environment values.
  The only text that leaves is the user prompt (plan), the assistant's final text
  (done), and the subagent's description and prompt (spawn). Each is clamped to its
  first 9 000 and last 3 000 characters (done keeps its last 12 000, where the claim
  is).
- **Email fence.** A session that has called any `mcp__email-gateway__*` or Gmail
  tool, or loaded the `email-search` skill (by the Skill tool or a skill prompt), is
  tainted for the rest of its life, across reloads: it makes no Jev request again
  unless the backend is declared local. `taintTools` and `taintSkills` replace these
  lists in factrail's comma-separated form; an empty value keeps the defaults. A
  tainted session's record is never pruned: past 30 days it shrinks to its taint. The local repeat checkpoint keeps running. If factrail has recorded a
  taint for the same session (`taint:<session>` in its plugin store,
  `~/.claude/plugins/store/factrail_agentbox-<sha12>.json`), that taint is honoured
  too.
- **Local backends are declared, never guessed.** Locality is never inferred from
  the URL (ADR-2094 §5): a LAN or loopback `api` is treated like any other host
  until `backendLocal` is `true`. Only then may a tainted session be judged,
  because nothing leaves the network. This is factrail's key, with the same name
  and meaning.
- **Fail-open.** A missing key, a timeout (`timeoutMs`, 4 000 ms), a 429 or other
  non-2xx status, unparsable JSON or an answer of the wrong shape means no line,
  no block and one `jev-checkpoints:` log line. A missing key is said once per
  session. A thrown error inside a hook is caught by the hook's `.catch`, which
  passes the event through unchanged. There are no retries.

### The API key

The key is never a `userConfig` value. The plugin reads `TYPESAFE_API_KEY` from
Claude Code's own process environment through `$.env.get('TYPESAFE_API_KEY')` at
each request, and sends it as `Authorization: Bearer …` **only to TypeSafe's https
host** (`typesafe.ai` or a subdomain of it) when `backendLocal` is false. It is the same variable
factrail's binary reads: factrail's shim never handles the key itself, and its
`factrail` binary, run by `$.process.run`, inherits `TYPESAFE_API_KEY` (or
`FACTRAIL_API_KEY`) from the Claude Code process. In agentbox that variable comes
from the container environment (`.env`), as for the skill router (ADR-2091) and
factrail (W072 warns at boot when it is unset). A declared-local backend never
receives the key, and neither does any other endpoint: a request there goes
without one, so a key-less façade works and a mistyped `api` cannot leak it.

## Configuration (`userConfig`)

| option | manifest key `[features.jev_checkpoints]` | default | meaning |
|---|---|---|---|
| — | `enabled` | `true` | install/uninstall gate (the entrypoint's, not the plugin's) |
| `api` | `api` | `""` | System One endpoint; empty means `https://api.typesafe.ai/v1/systemone` |
| `backendLocal` | `backend_local` | `false` | declares `api` on this network: tainted sessions may be judged, no key sent; only `true` counts |
| `model` | `model` | `jev-latest` | model id sent with every request |
| `timeoutMs` | `timeout_ms` | `4000` | per-request deadline, clamped to 250–8 000 (a hook's budget is 10 s) |
| `doneCheck` | `done_check` | `true` | the done checkpoint |
| `doneThreshold` | `done_threshold` | `0.9` | score at or above which done injects |
| `claimCheck` | `claim_check` | `false` | AB-08-S1-01: also ask, in the same request, whether the specific claim is covered by a successful verifying call; adds the done line, never removes it |
| `claimThreshold` | `claim_threshold` | `0.9` | probability at or above which an uncovered claim injects the done line (unfitted) |
| `repeatCheck` | `repeat_check` | `true` | the repeat checkpoint |
| `repeatCount` | `repeat_count` | `2` | occurrences before repeat injects (integer ≥ 2) |
| `planCheck` | `plan_check` | `true` | the plan checkpoint |
| `planThreshold` | `plan_threshold` | `0.8` | score at or above which plan injects |
| `minChars` | `min_chars` | `24` | shorter prompts are never planned |
| `spawnMode` | `spawn_mode` | `shadow` | `off`, `shadow` or `enforce` |
| `spawnMinConfidence` | `spawn_min_confidence` | `0.8` | confidence enforce needs |
| `shadowLog` | `shadow_log` | `/home/devuser/.claude/jev-checkpoints/shadow.jsonl` | base path of the spawn decision log: each session writes `<stem>-<session>[.N].jsonl` beside it; empty turns it off; `~/` is the home directory |
| `usdPerMTokIn` | `usd_per_mtok_in` | `0.042` | input price for the cost counters |
| `taintTools` | `taint_tools` | built-in email list | comma-separated tool-name prefixes that taint (factrail's form) |
| `taintSkills` | `taint_skills` | `email-search` | comma-separated skill names whose load taints |

A value that is missing or out of range falls back to its default: a threshold
outside 0–1, an unknown `spawnMode` or a negative price.

A score question has two bands, lowest first ("no", "yes"). Jev's answer `score`
in [0, levels − 1] is divided by `levels − 1`, so it reads as the probability of
"yes" and is compared with the threshold. The spawn question's `confidence` is the
pick's.

## `/jev-checkpoints [status|on|off]`

- `status` (or no argument): whether the checkpoints are on for this session, the
  endpoint (declared local, TypeSafe cloud with or without a key, or another host
  that gets no key), the email taint and its cause, and for
  each checkpoint its requests, cost, injections and last error. It also shows the
  total cost and the spawn agreement rate.
- `off` / `on`: a per-session switch kept in the plugin's `$.store`
  (`switch:<session>`). Off stops every checkpoint, repeat included, until it is
  switched on again.

Per-session state (`session:<id>`: taint, counters, fingerprints, the pending done
line) lives in the plugin's `$.store`, so a hot reload or a resumed session keeps
it. `session:`/`switch:` entries idle for 30 days are pruned at session start,
except that a tainted session keeps a `{at, tainted}` record for good.

## Layout

| file | holds |
|---|---|
| `hooks/register.ts` | the hooks and every `$` call (the engine requires `$` to stay in the module file) |
| `hooks/options.ts` | `userConfig` validation and defaults |
| `hooks/jev.ts` | request shapes, score/choice readers, the TypeSafe-host test, egress decision, the deadline-raced call |
| `hooks/text.ts` | clamps, the completion pre-gate, tool-call evidence, the injected lines |
| `hooks/fingerprint.ts` | failure normalisation and the FNV-1a fingerprint |
| `hooks/taint.ts` | the email fence (default and configured lists) and factrail's store name |
| `hooks/spawn.ts` | the tier question, enforce rule, definition pin, shadow record and segment paths |
| `hooks/state.ts` | the session record, shared first load, injection rule, pruning, status text |
| `types/index.d.ts` | the data contract: shadow-log line and store record |
| `tests/logic.test.ts` | pure-module tests |
| `tests/register.test.ts` | the hooks under the real engine, with the world (fs, env, store, clock, Jev endpoint) mocked beneath them |

## Development

```sh
claude plugin validate config/claude-plugins/jev-checkpoints
claude plugin test config/claude-plugins/jev-checkpoints
```

`tsc` needs the engine's declarations. Once Claude Code has loaded the plugin from a
folder you own, they are in `.claude-plugin/types/` (gitignored) and `tsc -p .`
works. Before that, use a `tsconfig.json` outside this folder whose `include` names
the engine's `claude-code.d.ts` (the plugin-authoring skill writes it) and this
plugin's `hooks`, `types` and `tests`, with the compiler options of `tsconfig.json`
here minus `typeRoots`/`types`. Tested under Claude Code 2.1.294.

Licence: MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`).

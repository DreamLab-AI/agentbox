# Optional testing tools from Agentic QE

[Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) is a separate
upstream quality-engineering package. VisionCraft can use its direct MCP tools
for candidate tests, coverage gaps and quality observations. It does not copy
AQE's agents, turn role names into executed workers, or require AQE to develop
and test an ordinary project. Missing AQE leaves native tests and source review
available; a specifically required AQE observation remains unavailable.

This reference inspects the npm `agentic-qe@3.15.10` package. Discover the actual
host MCP tool names and input schemas before calling them. A configured server
name, a coordination record or a newer upstream README is not proof that a tool
is callable. Do not invent a `visioncraft aqe` command. The host owns installation,
the pinned dependency closure, model/provider policy and external effects.

## Direct tools and the useful boundary

| Need | Upstream tool name and input | Evidence to retain |
|---|---|---|
| Candidate tests | `test_generate_enhanced`: `sourceCode`, `filePath`, explicit `language`, `framework`, `testType`, optional trusted `behaviorExamples`, `aiEnhancement`, `saveResults` | Generated source, `generationMode`/limits, `llmEnhanced`, actual subsequent test execution |
| Coverage gaps | `coverage_analyze_sublinear`: required `target`, `detectGaps`, `saveResults` | `measured`, `estimated`, `coverageMethod`, nullable metrics, collected-metric flags, source/report identity and gaps |
| Scoped static metrics | `quality_assess`: `runGate:false`, `target` or `sourceFiles`, `metrics`, `saveResults` | Requested and unmeasured metrics, exclusions, parse limits, measured failures; `gateEvaluated:false` remains analysis |
| AQE's measured gate | `quality_assess`: `runGate:true`, `saveResults` | Its canonical measured checks, freshness, `gateEvaluated`, `passed`, insufficient-evidence details |

Names above are upstream names; a host may prefix them during MCP registration.
Use only parameters in the discovered schema. For example, internal handler
options are not automatically public MCP arguments. Native test tools remain
the authority for whether generated code compiles and its assertions pass.

AQE's test-generation response can contain scaffolding and predicted coverage.
Neither is executed coverage. Trusted `behaviorExamples` in this release apply
to named JS/TS functions with simple required parameters and unit tests using
Vitest, Jest or node-test; do not imply that contract covers Rust or every test
framework. Other supported languages still need their real compiler and runner.
Inspect `generationMode`, each returned test body and limitations rather than
assuming that `testsGenerated` or a learning status proves useful tests exist.

Coverage results can be measured, estimated or unmeasured. Keep nulls as nulls.
Require an explicit measurement claim and matching raw instrumentation before
using a percentage in a gate. The tool's name includes “sublinear”; VisionCraft
makes no complexity, speed or gap-detection accuracy claim from that name.

`quality_assess` defaults to analysis. Its `runGate:true` branch requires all
seven canonical measurements in AQE's evidence contract, valid within 24 hours;
missing, malformed or stale measurements produce `insufficient-evidence`.
That fixed upstream policy does not replace a project's declared check set.
The CLI `aqe quality --format json` also evaluates that store, with exits 0
(pass), 1 (failure), 2 (pass near a minimum threshold) and 3 (insufficient
evidence). Errors can also exit 1. In-memory state in one process is not an
evidence store shared with a later CLI process.

## Worked source-to-test flow

This is an invocation example, not an executed success report. In an owned
worktree, first record the source revision, relevant dirty bytes and intended
behaviour. For a named JS function, pass a trusted expectation that does not
derive its answer from the implementation:

```json
{
  "sourceCode": "export function add(a, b) { return a + b; }",
  "filePath": "src/add.js",
  "language": "javascript",
  "framework": "vitest",
  "testType": "unit",
  "behaviorExamples": [
    {"functionName": "add", "args": [2, 3], "expected": 5},
    {"functionName": "add", "args": [-2, 2], "expected": 0}
  ],
  "aiEnhancement": false,
  "saveResults": false
}
```

Call the discovered `test_generate_enhanced` tool with that object. Preserve the
entire original MCP response, including `isError`, content blocks and the JSON
handler envelope. A steering message, truncated response or unrecognised shape
must not be silently converted into an empty success. Discovered schemas are
versioned observations; the package contract file records the consumed subset.

Read the returned `testCode`, check imports and assertions, then deliberately
write appropriate tests into the worktree. Execute the project's real test
command. For an existing Vitest project whose test script supports it, this may
be `npm test -- --run`; inspect that project's scripts first. Retain its exit,
test count and output. Confirm a controlled wrong implementation fails the
intended assertion, restore the candidate, and rerun the valid control. Generated
text or a successful MCP call does not replace these steps.

Run the project's existing instrumentation and retain its actual coverage report.
Then ask the discovered coverage tool to explain that scope:

```json
{"target":"src/add.js","detectGaps":true,"saveResults":false}
```

Compare the tool's measurement/provenance fields against the native report and
current source. Treat static estimates as suggestions for the next test. Finish
with project-specific quality checks. If AQE's measured gate is also required,
call it explicitly and keep its incomplete result visible:

```json
{"runGate":true,"saveResults":false}
```

Do not fill AQE's missing metrics with invented values or copy another run's
result to make this gate green. A maintainer can instead declare that upstream
gate inapplicable and use the project's meaningful checks, with that policy
choice visible before reporting readiness.

## Process state, embeddings and durable lessons

In 3.15.10, `AQE_MEMORY_BACKEND=memory` selects in-memory kernel storage and an
ephemeral SQLite store for internal subsystems; session/result persistence is
also gated. It does **not** turn off learning or all embedding attempts.
Experience capture still calls the embedding code. The optional external
endpoint uses OpenAI-style `/v1/embeddings`; otherwise it tries an optional local
transformer package. Do not install that package or start another embedding
service as a side effect of using the skill.

AQE defaults to `Xenova/all-MiniLM-L6-v2`, with 384 <!-- lint-ok: version-pinned upstream default, not the estate embedding model -->
dimensions. Matching dimensions alone do not make it interchangeable with
another model. Reusing a host endpoint requires a supported model-selection
contract and verified identity, not merely the same vector length. If no valid
runtime exists, describe semantic learning as unavailable. Ordinary successful
test execution does not require a claim that semantic learning worked.

Hosts may set the supported `AQE_WORKERS_ENABLED=false` for task-directed use;
this stops background worker/quality daemons, not every internal learning hook.
Use `saveResults:false` when the host retains the raw response itself. Verify
filesystem effects on a harmless fixture; an environment setting is not proof
that no path was written. No `aqe init`, template dump, model install or global
configuration mutation is required by this workflow.

Retain reusable verified lessons through the host's existing approved memory
interface. In [Agentbox](ecosystem-agentbox.md), that is RuVector through its MCP
embedding pipeline; direct SQL, AQE's memory CLI and a second vector store are
not alternatives. AQE's temporary state can support a task without becoming the
estate's durable source of truth.

## AQE and Ruflo are separate surfaces

Ruflo can coordinate work in a host that provides it. That does not establish
that a direct AQE MCP domain tool ran. Record the actual executor/tool identity,
request, response, source and native test evidence. Prefer a direct discovered
domain tool for one concrete testing task; introduce orchestration only when
the task needs real available participants and the host authorises it.

On upgrades, compare the pinned package schemas, handlers, memory/embedding
behaviour and actual fixture results. Include unsupported version, tool missing,
malformed output, error envelope, estimated coverage, stale cached data and
insufficient evidence controls. Keep upstream source and npm release distinct;
never relax result interpretation to disguise an unavailable capability.

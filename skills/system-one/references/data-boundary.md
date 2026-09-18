# Data boundary — what may leave, and what may not

**Status: foundation. The classification below is the proposal, not a ratified
decision.** No integration ships until the class it touches is settled; an ADR is the
right vehicle (`../../docs/adr/TEMPLATE.md`).

TypeSafe is a cloud API at `api.typesafe.ai`. The entire `state` of every request
leaves this network. That is in direct tension with an estate whose reasoning posture
is deliberately LAN-local — the Ontology Loom exists precisely so that private content
is reasoned over without leaving the LAN, and it is the email privacy system. Adding a
remote judgment API is not a neutral act, and "it's only a classifier" is not an
argument: a classifier still receives the text.

## Classes

**Must not leave — no redaction makes these safe.**

- The owner's personal email archive and anything derived from its contents
  (`email-search`, the email gateway's corpus).
- The private context portfolio (`personal-context` namespace, the private Logseq
  graph). Identity, team, goals, domain expertise.
- Private knowledge-graph contents and any subgraph carrying provenance that
  identifies people or private projects.
- Credentials, key material, identity documents, `identity.env`, anything under a pod.
- Customer or client content held under a confidentiality obligation.

For these the answer is a **local backend** or no judgment at all. See §Local fallback.

**May leave, with the usual care.**

- Public code, public documentation, published artefacts.
- This repository's own source and docs (already on a public remote).
- Synthetic fixtures and evaluation sets built for the purpose.
- Vendor documentation and public web content already fetched from the open internet.

**Middle ground — leaves only redacted, and only when redaction is verifiable.**

- Internal docs and ADRs with names, hostnames or LAN addresses stripped.
- Agent traces and logs, once identifiers and payloads are removed.
- Aggregate or structural facts about private data ("how many threads matched") where
  the underlying text stays home.

Redaction is a code path with its own tests, not a habit. If the redaction cannot be
asserted mechanically, treat the class as must-not-leave.

## Accepted exception 2: context compaction with an email fence (ADR-2093, 2026-09-18)

The `jev-compaction` plugin sends the conversation — user and assistant text, tool
inputs (≤1,000 chars each), tool-result *sizes* — to the judge at every compaction. The
operator accepted that with one standing condition, enforced in code rather than habit:
**a transcript containing any email tool call (`mcp__email-gateway__*`, Gmail) or an
`email-search` Skill load is never sent**; the built-in summary runs instead
(`config/claude-plugins/jev-compaction/hooks/policy.mjs`, tested). The fence is a
tool-name prefix list (`taint_tools`), so any other must-not-leave class above can be
fenced per project by adding its MCP prefix — no code change, and the validator (E074)
refuses a manifest that drops the email prefix. Tool-result contents never leave on this
path at all; the class that does leave is whatever the *model wrote* about them.

## Accepted exception: skill routing (ADR-2090, 2026-09-16)

**Skill routing is exempt from the classification above.** The operator has decided that the
prompt used to choose which skill handles a request may leave the network, and a live router
may send the user's turn text to the judge.

The exemption is narrow and does not travel:

- It covers **choosing a skill**, and nothing else. Every must-not-leave class above stays
  closed for every other purpose.
- It applies to **the router** as a consumer. No other caller inherits it.
- **Per-project gates are deferred, not waived.** There is currently no mechanism to exclude a
  project's content from a routing call. The first project that needs one needs it built
  first — ADR-2090 records that absence as accepted-and-known, not as an oversight.

Note the honest cost: a routing call carries whatever the user typed, and the turns where
routing matters most are the ones most likely to carry real content.

## The standing rule

**Outside skill routing — when the class is not obvious, ask the user before the first call.** One question,
naming exactly what would be sent and to whom. Do not infer consent from the task
having been assigned, and do not treat a request for "Jev" or "TypeSafe" by name as a
waiver — that chooses the backend, not the boundary.

## Key handling

- `TYPESAFE_API_KEY` lives in `.env` at the repo root (the consolidated template is
  `.env.example`; the retired per-skill `env.sample` takes no new keys).
- Server-side only. Never in a browser bundle, a published artifact, a page the model
  writes, or a log line.
- Any web surface calls our own endpoint, which calls the vendor. The key does not
  reach the client.

## Local fallback — open

The estate already runs a LAN model behind a stable façade (the Ontology Loom) and a
local embedding endpoint. A must-not-leave judgment therefore has a plausible local
route, but it is **not built and not measured**:

- A local model can be asked for a constrained answer, but it is not trained for
  calibrated probabilities. Its confidence numbers would not mean what a System One
  model's mean, and treating them as equivalent would be the failure mode.
- Constrained decoding or logit inspection could recover a distribution over options.
  Untested here.
- Latency and cost would differ by orders of magnitude in both directions depending on
  the judgment.

Until measured, the honest position is: for must-not-leave classes, use ordinary code
plus a local model for a *decision*, and do not present its output as a calibrated
probability. `evaluation.md` §Backend comparison is where that gets settled.

## Egress record

Any shipped integration states, at its call site: the data class, the decision that
authorised it, and the redaction applied. A call whose state class cannot be named in
one line is not ready to ship.

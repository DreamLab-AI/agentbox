# Five projects, different evidence needs

These are worked planning examples, not reports of executed projects. Choose
versions and limits from the actual project. Expected behaviours below define
example contracts; they do not claim test output, production readiness or a
universal percentage gate.

An optional [AQE example](agentic-qe.md#worked-source-to-test-flow) shows candidate
generation, native test execution and measured coverage as separate steps.
Apply it where those tools are actually available; these five project examples
do not require an AQE installation or an orchestration service.

## 1. A personal todo application

**Request.** Add creation, editing, completion, deletion, filtering and local
persistence to a small browser app. Existing project conventions choose the UI
shell; the item model, state transitions, filtering and storage schema live in a
Rust crate compiled to WebAssembly ([browser targets](rust/browser-wasm.md)).
No agent fleet or full domain programme is needed.

**Expectation.** A saved item survives reload with its stable identity and
completion state. Editing its text preserves that identity. An empty title is
rejected without changing the previous item. Filtering changes the visible
set without deleting hidden items. Storage failure is reported without claiming
the edit was durably saved.

**Implementation sequence.** Add a failing native Rust test for state
transitions, implement the smallest model change, export it through a thin
`wasm-bindgen` API, then test persistence through the real browser storage
boundary with the built module. Exercise create/edit/filter/reload in the browser.
Keep a valid ordinary title control beside empty and markup-like input cases.

**Applicable gates.** Native unit tests, the wasm target build and browser journey checks; visible error behaviour;
keyboard operation, focus and appropriate labels; safe treatment of user text.
A small prototype may defer multi-device sync explicitly. Do not claim sync or
full accessibility conformance from these local checks.

**Closeout.** Retain commands and browser observations with the source revision.
Link the reload and rejected-edit regression. Note unsupported storage contexts.
There is no reason to create a separate review ledger for this small change
unless the host workflow needs one.

## 2. A task API with identity and project membership

**Request.** Implement users, projects and tasks with authentication, role
checks, request limits and an API contract. Model Identity and Project
Management as separate concerns; membership policy owns access to project
resources. Use an ADR if choosing between materially different session/token
designs or changing the existing persistence model.

**Expectation set for this example.**

- A token has a stable subject ID and explicit issuance/expiry. For the example
  contract, it expires at 3,600 seconds with no implicit grace or refresh. Test
  just before/at/after the boundary with an injected clock and a wrong-key case.
- A rolling per-user/per-endpoint limit permits 100 requests in 60 seconds and
  returns 429 plus a meaningful retry interval for the next. An anonymous policy
  uses an explicitly chosen key. Preflight handling is an explicit case.
- An owner may delete a project; a member may read but not delete it. Choose
  and document the existence-disclosure policy for outsiders and nonexistent
  IDs. Neither 403 nor 404 is universally correct without that policy.
- The API description includes public routes and matches observed success and
  error shapes. Schema validation alone does not establish route coverage.

**Implementation sequence.** Characterise authentication and its consumers,
then red/green the admission boundary. Add project/task writes and consuming
reads with real test storage. Exercise owner, member, outsider and missing-ID
controls. Verify rejected mutations leave primary and secondary state unchanged.
Then validate API examples against actual responses.

**Audit and stabilisation.** For the required security review, use an actual
independent auditor who sees the same source/configuration. A suggested new
probe is a fresh credential retry after an earlier rejected operation; whether
the auditor chooses that or another boundary is recorded. Keep expiry, limits
and membership checks as permanent regressions. Security threshold completion
and live deployment remain separate.

## 3. Commerce with payments and inventory

**Request.** Support catalogue browsing, persistent carts, checkout, order
history, inventory administration and notifications. Separate Shopping,
Fulfilment and Administration. Orders/payments are core; catalogue and messaging
are supporting contexts. Model cart/order identity and monetary units explicitly.

**Expectations.** A discount precedes tax under the chosen rounding rule; an
empty cart has a defined result. Inventory reservation prevents overselling
under concurrent checkout. Duplicate payment callbacks do not duplicate the
order, stock deduction or notification. A timeout after a durable payment must
not turn a retry into another charge. Recovery reconciles the payment and order
states rather than inferring failure from an HTTP error.

**Decisions.** Record provider boundary, authoritative order state, cart
persistence and optimistic versus pessimistic reservation when they involve
real tradeoffs. Preserve an existing settled protocol instead of adding a
parallel payment ledger or verifier.

**Implementation sequence.** Establish catalogue and cart contracts; implement
money/order invariants with deterministic tests; then run payment-adapter
contract checks in an authorised test environment. Exercise callback replay,
fresh-token retries, process restart and dependency failure as separate cases.
Test notification effects after errors and migrations from old cart/order data.

**Gates.** Critical regressions, provider/consumer compatibility, completed
security review, keyboard checkout, and bounded outage/recovery experiments.
A payment scanner does not certify regulatory compliance. State the actual
criteria and evidence required by the project. Any sandbox-only observation
remains sandbox evidence until production acceptance is observed.

## 4. A project-scaffolding CLI

**Request.** Provide `init`, `add`, `list` and `config` behaviours over named
templates. Keep a clear noninteractive path alongside optional prompts. These
names describe the example product, not VisionCraft commands.

**Expectations.** Template files are created under the selected destination;
existing foreign files are not silently replaced. Unsupported input, missing
template and permissions failure have useful errors and stable exit semantics.
A rejected or interrupted run does not report a complete generated project.
Literal arguments remain literal and are not evaluated as shell syntax.

**Implementation sequence.** Characterise listing/config output and error
contracts. Test one small supported template, then traversal, linked output
parents, conflicts, spaces and non-ASCII names. Inspect state after failure and
cancelled writes. If porting, carry over actual observable ordering and errors
while documenting deliberate differences and deleting only proven dead paths.

**Gates.** CLI integration tests through the actual executable, a supported
generation control, output determinism where promised, parsing/path safety and
recovery tests. Use [Rust port guidance](rust/port.md) when applicable; a thin
wrapper over a language-specific dependency may be better left in place.

**Closeout.** Retain a generated project fixture and validate it through its
own supported build, not merely by counting created files. Check installed
package behaviour separately from a local development binary.

## 5. Real-time chat and presence

**Request.** Add authenticated rooms, messages, typing/presence, paginated
history and image sharing. Identity, Messaging and Presence have different
authority, durability and loss requirements. A typed event is not proof of
delivery; presence can be ephemeral while messages require durable ordering.

**Expectations.** A permitted member can send/read while an outsider cannot
access a known room/message ID. Reconnection recovers durable messages without
duplicating them. Revocation applies to the relevant existing connections.
Stale replaced sessions cannot inject poses or messages. A bounded lossy
presence queue must not swallow membership transitions needed for correct state.

**Decisions.** Describe transport/subscription auth, durable history ownership,
pub/sub semantics, pagination and heartbeat expiry. Establish ordering and
clock assumptions explicitly. A topology label is not a scaling measurement.

**Implementation sequence.** Test identity/room admission, then message storage
and readback. Drive multiple real clients through reconnect, logout, revocation,
replacement and pagination. Exercise uploads through validation and served
read paths; rejected content must not remain fetchable by a known identifier.

**Gates.** Multi-client contract/end-to-end checks, security review, accessible
message navigation, workload measurements and bounded disconnection/resource
experiments. Choose connection counts and latency/loss budgets from the target,
measure them, and report the exact environment. Tests against one local
instance do not establish multi-replica admission or settlement guarantees.

## Adapting the examples

For data pipelines, add schema/units/provenance and restart/idempotency cases.
For mobile or hardware, distinguish simulation from actual device observation.
For AI features, link prompt/model versions to the relevant evaluation and
guardrails using [traceability](traceability.md). In every case, retain what was
actually observed and the explicit remaining acceptance conditions.

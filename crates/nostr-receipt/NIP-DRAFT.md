# NIP draft: disclosure and revocation receipts

`draft` `optional`

Status: working draft, not submitted. Kind numbers 8810 and 8811 are provisional. This document
describes the format implemented by `nostr-receipt`; the implementation is the reference until the
format settles.

## Purpose

A data holder that answers questions from a compressed memory of its documents, and that can
withdraw documents from that memory, publishes a signed record of each answer released and each
document revoked. The record names what was acquired to answer, under what privacy mechanism, and
links to the holder's previous record. Anyone holding the event can verify who issued it and that it
has not changed. The record does **not** prove that the mechanism was applied; that needs an
execution record or attestation outside this NIP.

## Events

Both receipts are regular events (NIP-01). The issuer is the event `pubkey`, written as
`did:nostr:<pubkey hex>` in human renderings. `content` is a fixed English sentence derived from the
tags; a verifier recomputes it and rejects a mismatch, so the readable text cannot say one thing while
the tags say another.

### Kind 8810: disclosure

An answer was released from the memory.

| tag | fields | required | meaning |
|---|---|---|---|
| `v` | `"1"` | yes | receipt format version |
| `memory` | 64 hex | yes | commitment to the memory version (hash of the stored, privatised embeddings) |
| `mech` | name, sigma, clip | yes | noise mechanism and parameters (`gaussian`, per-coordinate sigma, L2 clip); `0` sigma means no noise |
| `dp` | epsilon, delta, `"per-document"` | yes | the per-document guarantee that holds for the memory's lifetime; scope is always `per-document` in v1 |
| `query` | 64 hex | yes | `sha256(salt \|\| question)`; the salt is shared with the asker, not published |
| `answer` | 64 hex | yes | `sha256(answer)` |
| `requester` | did:nostr | no | the asking party, if the holder chooses to name it |
| `acquired` | 64 hex | repeated, optional | `sha256(document)` of each document acquired to answer; absent when the whole collection was read |
| `prev` | 64 hex | no | id of the issuer's previous receipt, chaining the log |

### Kind 8811: revocation

A document was removed from the memory. Tags `v`, `memory`, `mech`, `dp`, `prev` as above, plus:

| tag | fields | required | meaning |
|---|---|---|---|
| `document` | 64 hex | yes | `sha256(document)` of the revoked document |

The `memory` tag of a revocation is the commitment **after** removal. Because the memory is a pure
function of the stored rows and any per-document noise is keyed to the document's content, a
verifier who holds the remaining rows can recompute the commitment and confirm the deletion left
every other row untouched.

## Verification

1. Verify the event id and BIP-340 signature (NIP-01).
2. Check `kind` is 8810 or 8811 and `v` is `"1"`.
3. Check every required tag is present exactly once; `acquired` may repeat; all hashes are 64
   lowercase hex characters; sigma, clip, epsilon, delta are finite and non-negative; `dp` scope is
   `per-document`; `requester` if present is a valid `did:nostr`.
4. Recompute `content` from the tags and require equality.
5. Optionally, given the salt, question and answer, recompute `query` and `answer` and compare.
6. Optionally, follow `prev` to the issuer's earlier receipt and check the chain is unbroken and
   `created_at` is non-decreasing.

## What a receipt proves, and what it does not

Proves: who issued it (key holder), that it is unaltered, which question hash and answer hash it
covers, which documents it names as acquired, and the parameters the issuer claims. Does not prove:
that the noise was actually added, that the named documents were the only ones read, or that the
memory commitment is honest. Those require attestation of the execution and are out of scope.

## Rationale

Hashes rather than text keep the question, answer and documents private while making a dispute
checkable: either party can reveal the preimage later. A fixed `content` sentence lets a person read
the receipt without tooling while keeping the tags authoritative. Keying noise to document content
(rather than to position) is what makes revocation exact and the `memory` commitment recomputable
after a deletion; this NIP assumes that design but does not mandate it.

## Reference implementation

`crates/nostr-receipt` (Rust, AGPL-3.0-only) in the agentbox repository: `issue`, `verify`, a CLI
with JSON and `--human` output, and tests including the 19 BIP-340 vectors and tamper cases.

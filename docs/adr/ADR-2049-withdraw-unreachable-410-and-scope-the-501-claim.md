---
id: ADR-2049
title: Withdraw the unreachable 410 resolver state and scope the multi-user 501 claim to the real stubs
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a tombstone/retraction store is added to the URI resolver, or suspend/archive stop returning 501
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-013 (canonical URI grammar); multi-user pod scaffold
---

# ADR-2049 — Withdraw the unreachable 410 resolver state and scope the multi-user 501 claim to the real stubs

## Context

Two surfaces advertised behaviour the code does not have. Both were found by the
estate lead's Phase 1 pass (diagrams ES-03.8 and ES-08.5) and routed here because
the files are in this domain.

1. `management-api/routes/uri-resolver.js` documented three resolver states in its
   header and advertised `410 when deliberately retracted` in the `/.well-known`
   payload at `:168`. `grep -c "code(410)"` over the handler returns **0**: there
   is no retraction store and no code path that can emit it. A consumer reading
   `/.well-known` was told about a state it can never observe.
2. `docs/user/multi-user-pods.md` said the lifecycle endpoints "return `501 Not
   Implemented` in the current scaffold release". `POST /admin/users/provision`
   (`admin-users.js:137`) is fully implemented — 64-hex validation, a PSK-gated
   call to `/_admin/provision/<pubkey>` (`:42`), idempotent, 201 with `pod_url`,
   `web_id`, `git_url`. Only suspend (`:240`, logs `stub: true`) and archive are
   genuinely 501.

## Decision

Advertise only states the code can produce. The resolver documents **two**
states, 200/307 and 404, and the `/.well-known` `resolvability` string reads
`307 when known, 404 when unknown or retracted`. 404 explicitly covers
retraction: with no tombstone store the resolver cannot distinguish "never
existed" from "deleted", and it says so rather than implying knowledge it lacks.

Reinstating 410 requires a real tombstone lookup ahead of the 404 branch and
re-advertising in the same change — recorded in the handler header so the next
reader does not re-add the claim alone.

Documentation of a partially-implemented surface names which parts are
implemented and which are stubs, with `file:line`, rather than making a blanket
claim about the whole family.

## Consequences

- The `/.well-known` payload is now a truthful contract. This is a
  behaviour-visible change to that string; no status code changed, so no client
  that handles 307/404 is affected.
- A future retraction feature has a written entry condition instead of an
  orphaned advertisement.
- The multi-user doc no longer understates the product: provisioning works and
  is documented as working, which removes a reason for an operator to avoid it.
- Neither change touches an Invariant.

## Verification

Verification ran on the uncommitted working tree above `verified_commit`
89301ec7c911eab270c00a0cf81596d0d4f15535 and must be re-run at the landing commit.

- `grep -c "code(410)" management-api/routes/uri-resolver.js` → `0`, before and
  after; the change is to the claim, not to a code path.
- `node -e "require('./management-api/routes/uri-resolver.js')"` → `module loads OK`.
- `management-api/routes/admin-users.js:137-186` read directly: provision is
  implemented; `:240` read directly: suspend returns 501 with `stub: true`.
- The remaining two occurrences of the string `410` in `uri-resolver.js` are in
  the new header note explaining the withdrawal, which is intended.

**Governed paths changed.** `management-api/routes/uri-resolver.js`,
`docs/user/multi-user-pods.md`.

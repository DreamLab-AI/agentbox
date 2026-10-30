---
id: ADR-2162
title: The mesh block gets one reader — pinned peers, a node federation key and the dataspace crossing
date: 2026-10-30
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 29a4b49391b98d92f4c242b64143ad8eb867d246
verified_paths: []
owner: jjohare
review_trigger: a second operator joining (un-parks ADR-2025/2101); any change to schema/federation-kinds.json or the [mesh] block; nostr-bbs-mesh changing its envelope version or licence
repo: agentbox
depends_on: [ADR-2061]
amends: [ADR-2061]
relates: [ADR-2025, ADR-2101, ADR-2122, ADR-2161]
---

# ADR-2162 — The mesh block gets one reader: pinned peers, a node federation key and the dataspace crossing

## Context
- `[mesh]` (`agentbox.toml:273-282`) declares `peer_relays`, `federated_kinds` and `allowed_remote_dids`. No agentbox code reads them. `docs/developer/architecture.md:171-175` calls the federation lifecycle aspirational.
- ADR-2025 and ADR-2101 park cross-operator federation until a second operator exists.
- VisionClaw ADR-2161 needs three things from agentbox:
  - a pinned peer set;
  - a node federation key that signs catalogues and control envelopes;
  - a crossing `dataspace` kind in the shared closed map (ADR-2061). VisionClaw compiles that map via `include_str!`.
- The forum's `nostr-bbs-mesh` (AGPL-3.0-only, like agentbox) already implements the `[mesh]` contract: `MeshConfig`, IS-Envelope, JCS and `PeerManager`. Research: VisionClaw `docs/proposals/spatial-rooms/research/06-agentbox-federation.md`.

## Decision
1. **One reader.** The agentbox mesh service is the sole reader of `[mesh]`. It reuses `nostr-bbs-mesh` as a dependency; it does not fork or reimplement it.
2. **Same-operator scope.** In this scope, `mode = "federated"` means nodes run by one operator and pinned by that operator. Cross-operator peering stays parked under ADR-2025 and ADR-2101 and needs its own decision.
3. **Peers are pinned, never discovered.**
   - `[mesh]` gains `[[mesh.peers]]` entries. Each entry has `pubkey` (hex64, the peer's node federation key), `relay` (`wss://`), `endpoint` (the peer VisionClaw's `wss://` URL) and `origin`.
   - `allowed_remote_dids` is derived from `peers`. It is no longer a parallel list.
   - The service projects the set read-only to `/run/agentbox/mesh-peers.json` for VisionClaw. Nothing learns a peer key on first use.
   - The configured `endpoint` is authoritative. An **active** catalogue entry is accepted only if its signed endpoint exactly equals it; a differing endpoint is rejected. A valid **withdrawal** (`["status", "withdrawn"]`, a greater `rev`, signed by the pinned key) carries no endpoint and is accepted on signature, pinned key and greater `rev` alone (VisionClaw ADR-2161 D2). Validation and its tests cover both: active with an equal endpoint passes, active with a different or missing endpoint is rejected, withdrawal without an endpoint passes.
4. **Exactly one node federation key per node** (audit round 2, C5).
   - **Custody.** It comes from an independent seed, never derived from or equal to the identity key; this applies ADR-2101's key-separation clause only, not its sidestr stages. It is never in `identity.env`, never `VISIONCLAW_NOSTR_PRIVKEY` and never `AGENTBOX_PRIVKEY_HEX`. It is held under `/run/secrets/<role>/` for the mesh service and backed up by `services/secret-backup`.
   - **Roles.** It is canonical for four roles: it names data spaces (`urn:visionclaw:dataspace:<node-key-hex>:…`); it signs data-space catalogues (kind 30078, carrying `rev`); it authenticates IS-Envelopes; and it is the `pubkey` in peer entries and `allowed_remote_dids`. It signs nothing else.
   - **One signer.** The VisionClaw node holds no federation key of its own. The mesh service exposes a local signing socket, in the style of the identity port, that signs only two payload classes: kind-30078 catalogue events (`d` = `visionclaw:dataspace:<space-id>`, with `rev`) and the three envelope types `dataspace_announce`, `link_notice` and `retraction`. VisionClaw is its only client, admitted by uid. No new cryptography: BIP-340 Schnorr through the existing signer crates.
   - **Rotation is a new node identity.** Before retirement the old key signs a retraction for every URN it named, and peers re-pin the new key. Links are not migrated in v1.
5. **The `dataspace` kind crosses.**
   - `schema/federation-kinds.json` gains `dataspace` as a crossing kind. It maps 1:1 to `urn:visionclaw:dataspace:<node-key-hex>:<space-id>`, with a JS arm, a Rust arm and a fixture row, per ADR-2061.
   - This amends ADR-2061's map by one row. It lands here first, and VisionClaw takes it through its submodule pin.
6. **Federated kinds.** `federated_kinds` gains nothing for graph content, because content does not travel over the mesh (VisionClaw ADR-2161 D6). Kind 30078 is already listed. IS-Envelope control traffic rides the existing gift-wrap path.
7. **Authenticated control** (audit round 2, C6). The control envelope types are exactly `dataspace_announce`, `link_notice` and `retraction` (VisionClaw ADR-2161 D6). The catalogue is not an envelope: it is the separately signed kind-30078 event (D3, D4), which a `dataspace_announce` references by space URN, event id and `rev` and never carries; the service hands the announce on only once the referenced catalogue has passed the D3 checks. The mesh service accepts a control envelope only when all of these hold:
   - it is gift-wrapped and authenticated by a pinned peer key;
   - for a retraction, the authenticated sender equals the authority key `<K>` named inside every retracted `urn:visionclaw:dataspace:<K>:…`;
   - for a link notice, the asserting node equals the sender, the link's subject URN is under the sender's key, and its object URN is under this node's key (ADR-2161 D5);
   - its per-sender sequence number exceeds the persisted high-water mark for that sender, so replays are dropped.

   Anything else is dropped and logged. Accepted envelopes are written durably and handed to VisionClaw in sequence order.

## Planned evolution: cross-operator federation
Same-operator is the scope **for now** (operator, 2026-10-30); multi-operator federation is planned, not rejected. What changes when it lands, so v1 does not paint it into a corner:
- **Trust root.** Peers are pinned by the operator today. Cross-operator needs a peering agreement per remote operator: a pinned key exchanged out of band, plus a revocable per-peer policy (which spaces, which `acl` forms). The pin table already keys on node key, so this is an added policy column, not a schema change.
- **Parked ADRs.** It un-parks agentbox ADR-2025 (federation contract) and ADR-2101 (topology and key separation); the node key in ADR-2162 already follows ADR-2101's key-separation clause, so it carries over.
- **Visibility.** `public` and `dids` work unchanged across operators. `space:` (NIP-29-gated) needs the remote operator to trust the space's home relay key, which is the same pin mechanism.
- **Erasure.** Retraction and the T = 7 d lease already assume a peer we do not control; no change.
- **Not decided here.** Discovery of unknown operators, reputation, and any automatic peering. Each needs its own ADR.

## Activation prerequisites
- None outside agentbox. This is step 1 of the cross-repo activation order (VisionClaw `docs/proposals/spatial-rooms/AUDIT-DECISIONS.md` C9).
- Before activation, these tests must pass:
  - the config test (D3);
  - the signer-socket allow-list test, proving only catalogue events and the three envelope types are signed;
- the catalogue-validation test (D3): an active entry with a different endpoint is rejected and an endpoint-less withdrawal at a greater `rev` is accepted;
  - the control-envelope tests: a forged retraction from another pinned peer is refused, a replayed sequence number is dropped, and a link notice whose subject is not under the sender's key, or whose object is not under this node's key, is refused.

## Consequences
- `[mesh]` stops being decorative. A config test fails if `peers` and `allowed_remote_dids` disagree, or if a peer `relay` is not `wss://`.
- There is now a fourth key class to back up. Rotation is a re-identity (D4): every peer re-pins the key, every URN under the old key is retracted, and links are not migrated. There is no automatic rotation in v1.
- The signing socket is a new local trust boundary. It is uid-gated and signs only the federation payload types, so a compromised VisionClaw process can sign catalogues and notices but cannot use the key for anything else.
- The kind-map change is paired. The fixture asserts that VisionClaw's translator agrees once the submodule is re-pinned. Until then VisionClaw refuses `dataspace`, which fails closed.
- Governing doc updated in this change: `PROTOCOL-registry.md` (the dataspace crossing, the mesh projection file and the signing socket).

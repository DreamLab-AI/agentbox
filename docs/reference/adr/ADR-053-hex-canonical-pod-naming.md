---
id: ADR-053
title: "Hex-canonical pod naming: x-only pubkey is the single storage and URL identity"
status: accepted
date: 2026-08-14
type: architecture
adr_category: naming
author: Dr John O'Hare
depends_on: [ADR-013, ADR-045]
references: [ADR-052, solid-pod-rs NIP-98 auth, DDD-003]
review_trigger: >-
  A consumer surface requires npub-keyed routing that cannot be served by a
  symlink (e.g. an external-facing URL scheme mandating bech32); or the
  solid-pod-rs upstream changes its provisioning key format.
---

# ADR-053 — Hex-Canonical Pod Naming

## 1. Context

Two naming conventions coexist in the sovereign pod stack:

- **npub (bech32):** `sovereign-bootstrap.py` creates the pod directory at
  `pods/<npub>/`, consistent with the git route prefix
  (`[sovereign_mesh.git] http_route_prefix = "/pods/:npub/"`) and the
  pod profile webId.
- **hex (64-char lowercase x-only pubkey):** solid-pod-rs-server's admin
  provisioning (`POST /_admin/provision/{pubkey}`), git-provenance API
  (`GET /{pod}/_prov/{sha}`, `/_git/*`), NIP-98 authentication
  (`did:nostr:<hex>`), WAC agent URIs, and ADR-013's canonical URI grammar
  all require and produce hex keys. The server rejects anything that is not
  exactly 64 lowercase hex characters at every API boundary
  (`lib.rs:2958`, `lib.rs:3515`).

The coexistence produced three confirmed defects (2026-08-14 investigation):

1. **Git-provenance unreachable:** `pod_repo_path()` demands hex; the
   npub-named directory is invisible to `_prov`/`_git`. Workaround:
   hex→npub symlink at the data root.
2. **WAC ACL walk miss:** `find_effective_acl_dyn` probes
   `/{container}.acl` (sidecar), but the pod root ACL lives at
   `/{container}/.acl` (container child). When the request path uses the
   hex symlink, the resolved filesystem path differs from the probed key.
   Workaround: sidecar ACL copy alongside the symlink.
3. **URL-path ambiguity:** agents must know to address the pod by hex in
   the URL, not npub. There is no top-level npub entry; only the hex
   symlink reaches the pod via the URL namespace.

All three defects stem from the same root: the canonical directory is npub-named
but the entire server API is hex-native. Every bridge is a workaround.

## 2. Decision

**Hex is the single canonical pod identity for storage, URL paths, WAC
subjects, and DID identifiers.** npub is a display encoding only — never a
storage key, filesystem path, or URL segment.

Concretely:

1. `sovereign-bootstrap.py` creates the pod directory at `pods/<hex>/`
   (the 64-char lowercase x-only pubkey). A convenience symlink
   `pods/<npub> → pods/<hex>` is created for backward-compatible reads by
   any remaining npub-keyed consumers.
2. The hex→npub symlink at the data root (`<hex> → pods/<npub>`) is
   replaced by direct use of the hex-named directory. No symlink needed.
3. WAC `.acl` files live inside the canonical hex directory
   (`pods/<hex>/.acl`) and the sidecar copy is maintained at
   `pods/<hex>.acl` until the ACL walk code is patched to probe both
   `{path}.acl` and `{path}/.acl`.
4. Profile webId, DID documents, and git route prefixes are updated to
   use hex.
5. The existing live data volume is migrated: rename `pods/<npub>` →
   `pods/<hex>`, update the symlinks, verify ACL reachability.

## 3. Consequences

- Eliminates the three defects above without workarounds.
- The `[sovereign_mesh.git] http_route_prefix` in agentbox.toml changes from
  `/pods/:npub/` to `/pods/:hex/` (or simply `/:hex/`). Any external
  integrator holding npub-keyed URLs gets a 301 or hits the npub→hex symlink.
- The solid-pod-rs ACL walk bug (`find_effective_acl_dyn`) should still be
  fixed upstream to probe both sidecar and container-child patterns — hex
  canonicalisation makes it non-blocking but doesn't excuse the incorrect
  walk logic.

## 4. Migration (live data volume)

```bash
# One-time migration (executed 2026-08-14):
cd /var/lib/solid
HEX=11ed64225dd5e2c5e18f61ad43d5ad9272d08739d3a20dd25886197b0738663c
NPUB=npub1z8kkggja6h3vtcv0vxk584ddjfedppee6w3qm5jcscvhkpecvc7q0wqa88

# 1. Rename canonical dir: npub → hex
mv pods/$NPUB pods/$HEX

# 2. Create backward-compat symlink: npub → hex
ln -sfn $HEX pods/$NPUB

# 3. Update data-root symlink to point to new location
rm -f $HEX
ln -sfn pods/$HEX $HEX

# 4. Sidecar ACL (until ACL walk is patched)
cp pods/$HEX/.acl ${HEX}.acl
```

## 5. Alternatives rejected

- **Keep npub canonical, widen hex support:** requires patching every hex-native
  code path in solid-pod-rs to accept npub, duplicating bech32 decoding across
  Rust and Python, and contradicting ADR-013's hex-canonical decision for
  `did:nostr`. More patches, not fewer.
- **Dual addressing (neither canonical):** tested by the current symlink bridge.
  Every new consumer has to choose, and the ACL walk bug proves the seam leaks.

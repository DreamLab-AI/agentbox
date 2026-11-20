---
id: ADR-2212
title: The sidecar policy blocks the Web Store, not the default, so unpacked Podkey can load
date: 2026-11-20
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 7bdf588fd60ab6b933242b5312246c1e32a8c506
verified_paths: [browsercontainer/policies/podkey-only.json, browsercontainer/Dockerfile, browsercontainer/podkey-ctl.js, tests/browsercontainer/policy-contract.test.cjs]
owner: operator
review_trigger: Podkey publishes a CRX or a manifest key; Chrome changes IsLoadingUnpackedAllowed; the policy file or Podkey install path changes
repo: agentbox
evidence_class: source+test+deployment+runtime
acceptance_boundary: Rebuilt image is running with preserved profile/exchange volumes. Podkey service worker loads under the approved policy with its original ID/public key; vault remains locked. Chrome reports both managed policies OK. A real Web Store install-refusal attempt has not been performed, so implementation remains partial against the full host acceptance list.
---

# ADR-2212 — The sidecar policy blocks the Web Store, not the default, so unpacked Podkey can load

## Host activation witness — 2026-11-20 evening

Image `sha256:ab589661b895ffce4688213890af75ea0b1e106a365c8ee897daa874f3590c83`
is running. `podkey-ctl` reports the expected ID, pinned version 0.0.11 and
locked vault with the existing public key. The loader logs a running service
worker, without the old administrator-block error. A fresh `chrome://policy`
fixture reports `ExtensionSettings` and `BlockExternalExtensions` status `OK`,
with the exact approved values. Display/WebGPU and foreground fixture MCP
upload/screenshot checks pass. No private key or passphrase was accessed.
The Web Store installation-refusal acceptance check is not claimed; no real
extension installation was attempted. The original acceptance list below is
historical and this witness defines what was actually verified.

## Context
- The sidecar policy `browsercontainer/policies/podkey-only.json` set `ExtensionInstallBlocklist ["*"]` plus an allowlist for Podkey's id.
- Chrome 159 (159.0.8154.13) answers `Extensions.loadUnpacked` at every start with "Loading of unpacked extensions is disabled by the administrator". The workaround moved the policy aside for about 12 seconds and was lost at each restart. ADR-2207 recorded the block and left relaxation to the owner.
- Cause: `UnpackedInstaller::IsLoadingUnpackedAllowed()` returns `!BlocklistedByDefault()`. That is true for any default-blocked or default-removed mode, in either policy spelling. Its comment admits only *packed* allowlisted extensions. `--load-extension` passes the same gate, so flags do not help.
- Podkey's artefact manifest has no `key`; its id `cakgjkgiodcdhecnnfhmcfphjkknfjkd` derives from `/opt/browsercontainer/extensions/podkey`. The sealed vault in the profile volume is keyed by that id, so the id must not change.

## Decision
One `ExtensionSettings` policy, with no default block: Podkey's id `allowed`; the Chrome Web Store update URL scope `blocked` (every store extension, including a returning Proton Pass); `"*": {"install_sources": [], "blocked_install_message": …}`; `BlockExternalExtensions: true`. The legacy `ExtensionInstallBlocklist`/`Allowlist` pair is removed. `tests/browsercontainer/policy-contract.test.cjs` pins this, including id equality with the Dockerfile install path.

## Consequences
- Podkey loads at Chrome start with no policy juggling. This relaxes the "block everything" wording of the earlier policy, which ADR-2207 reserves to the owner: merging needs that owner decision, not only the lead's review.
- Residual gap: another *unpacked* extension can still be loaded by anyone with CDP or `chrome://extensions` access. CDP on 9222/9223 is already full browser control, so this adds no new principal.
- Rejected: packed CRX with `force_installed` and a local update URL (needs a signing key and changes the id, orphaning the vault; revisit if upstream publishes a CRX or key); a root process swapping the policy around the load (the manual workaround, automated).
- Recreating the sidecar still locks Podkey until `podkey unlock`.

## Verification
Not yet verified. Host proof: rebuild the sidecar, then `docker logs browsercontainer | grep podkey-ctl` shows `loaded Podkey cakg…; service worker running` with no "disabled by the administrator" line before it; `chrome://policy` shows no errors; a Web Store install is refused. Source evidence: `unpacked_installer.cc` and `extension_management.cc` at tag 159.0.8154.13.

## Owner approval — 2026-11-20

The owner approved this decision on 2026-11-20, relayed to the ADR sprint by the lead session. That is the decision ADR-2207 reserved to the owner ("policy relaxation is an owner decision, not silently applied here") and the one the first Consequences bullet above says merging needs; ADR-2207 carries a matching amendment. The owner accepted the residual gap named above: another unpacked extension can be loaded by anyone who already has CDP or `chrome://extensions` access.

## Source verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

`decision_status` moves from `proposed` to `accepted` on that approval. The lint required only a non-empty `verified_commit` for an accepted record; `evidence_class` is optional and was set to `source+test` to match the acceptance boundary. `implementation_status: partial` and `activation_status: inactive` are unchanged and the acceptance boundary above still holds: no image has been rebuilt with this policy and Chrome has not been observed loading Podkey, so the host proof in the Verification section is still outstanding. Source read: `browsercontainer/policies/podkey-only.json` is one `ExtensionSettings` object with Podkey's id `allowed`, the Web Store update URL `blocked`, a `*` entry with `install_sources: []` and no `installation_mode`, and `BlockExternalExtensions: true`, with no `ExtensionInstallBlocklist` or `Allowlist`. Run: `node --test tests/browsercontainer/policy-contract.test.cjs` → 4 pass; `node --test tests/browsercontainer/*.test.cjs` → 63 pass, 0 fail. `verified_paths` is left empty as the author wrote it.

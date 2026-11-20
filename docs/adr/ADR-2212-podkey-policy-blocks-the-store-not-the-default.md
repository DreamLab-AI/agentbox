---
id: ADR-2212
title: The sidecar policy blocks the Web Store, not the default, so unpacked Podkey can load
date: 2026-11-20
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: operator
review_trigger: Podkey publishes a CRX or a manifest key; Chrome changes IsLoadingUnpackedAllowed; the policy file or Podkey install path changes
repo: agentbox
evidence_class:
acceptance_boundary: Source and tests only. No image has been rebuilt; Chrome has not been observed loading Podkey under this policy.
---

# ADR-2212 — The sidecar policy blocks the Web Store, not the default, so unpacked Podkey can load

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

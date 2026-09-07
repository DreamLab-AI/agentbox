# Npm CLI dependency locks

These locks were recovered from the working immutable Agentbox CLI packages on
2026-09-07. Each root name/version was checked against its flake declaration.
`makeNpmCli.packageLock` copies the selected lock after the existing root manifest
adjustments and uses `npm ci --ignore-scripts`; inconsistent manifest/lock input
fails instead of resolving a new dependency graph. The existing package tarball
and recursive dependency-output hashes remain independent build gates.

The HP rebuild exposed unlocked transitive resolution drift for Mermaid11.16.0
and AQE3.13.12. All nine declared CLI packages now provide locks, including the
exact Puppeteer runtime peer promotion for Mermaid. Locked installs for AQE, Wrangler, Mermaid, Ruflo and RuVector include additional
optional musl packages already listed in their original locks. Every previously
installed package manifest compared byte-for-byte equal; none was removed or
version-changed. Reviewed recursive hashes record that installation difference.
The platform loaders retain their GNU-versus-musl selection. All nine derivations
materialised on HP after the comparison; explicit rebuild verification is recorded
with the closeout evidence.

Refresh a lock together with its pinned root version, review the dependency
changes and materialise the Nix derivation before updating its recursive hash.
Do not replace a failed hash merely with the resolver's latest output. A lock
is source reproducibility evidence, not a deployment or package-vulnerability
attestation. External browser/model runtime downloads remain separately governed.

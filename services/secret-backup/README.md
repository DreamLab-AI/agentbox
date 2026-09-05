# agentbox-secret-backup

Encrypted secret backup and restore for agentbox (ADR-2027, closeout 2026-09-05).
Collects the configured secret files into a tar stream and encrypts it with
[age](https://age-encryption.org/) (the `age` crate, RustCrypto primitives underneath);
the tool cannot write a plaintext archive. `restore` decrypts into a target directory
with owner-only permissions and verifies every member against the manifest before
returning success. Restore is exercised on synthetic data by the crate's own tests.

```text
agentbox-secret-backup backup  --recipient <age public key> --out <archive.tar.age> <paths…>
agentbox-secret-backup restore --identity <age identity file> --archive <archive.tar.age> --into <dir>
```

Keys are referenced by path and never printed; the archive manifest records file
names, sizes and SHA-256 digests only. Retention, off-host placement and the
recovery-authority test remain the operator's responsibility (ADR-2027 acceptance).

## Licence — AGPL-3.0-only, NOT dual-licensed

**This crate is licensed under the GNU Affero General Public License, version 3
only (AGPL-3.0-only). It is _not_ dual-licensed under MIT OR Apache-2.0.**

The rest of the `services/` subtree is permissive (MIT OR Apache-2.0) and may be
published to crates.io on those terms. This crate is an operator tool internal to
the AGPL-3.0 agentbox repository (`publish = false`): it is not offered for
publication and grants no permissive terms. Do not copy the sibling crates'
licensing boilerplate into this directory. See `LICENSE` in this directory and
ADR-2030 for the services-subtree licensing decision.

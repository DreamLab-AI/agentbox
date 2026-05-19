# Maintainers

Agentbox is maintained by a small group with commit access, working in the open.
Decisions are recorded in issues and PRs.

## Current maintainers

| Maintainer | GitHub | Focus |
|---|---|---|
| John O'Hare | [@jjohare](https://github.com/jjohare) | Project lead; Nix build system, agent orchestration, sovereign data stack |
| Melvin Carvalho | [@melvincarvalho](https://github.com/melvincarvalho) | Upstream IP; JSS Solid protocol, DID:Nostr, Web Ledgers, identity standards |

## Upstream

Agentbox embeds [solid-pod-rs](https://github.com/DreamLab-AI/solid-pod-rs), a Rust port of
Melvin Carvalho's [JavaScriptSolidServer (JSS)](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer),
as its sovereign data layer. Every agent action is stamped with a `did:nostr` identity and stored
in a Solid Pod backed by the JSS protocol surface. Protocol-level decisions and spec alignment
defer to the upstream JSS repository.

See [.github/CODEOWNERS](.github/CODEOWNERS) for path-level review routing.

## Process

Maintainers follow the same workflow as other contributors (issue → branch → PR → review → merge).

## Becoming a maintainer

By invitation of an existing maintainer, after demonstrated substantive
contribution. No formal vote; existing maintainers make the call and
update this file.

## Security

Security disclosures: use [GitHub private security advisories](https://github.com/DreamLab-AI/agentbox/security/advisories/new).

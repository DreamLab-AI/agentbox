# Upstream provenance

Agentbox adaptation of GoogleChrome Modern Web Guidance, Apache-2.0:
https://github.com/GoogleChrome/modern-web-guidance

Reviewed source revision: `4dd968349e54ca45a05dd5c818fb035c9054b022`
(2026-11-10, release v1.0.0). Upstream entrypoint:
https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/SKILL.md

CLI package: `modern-web-guidance@1.0.0`, Node >=22.
Registry tarball integrity observed during integration:
`sha512-vafIZwC8AS6QjM2yyoflZbnc7n3/TVOMLbEMRdPTwcFy0f9/Tq8s5rJQ8UIqRt2KPl9ixravyaMR4nTGuUrcmg==`

The package version pins the executable; do not assume remote guidance or browser
support data are immutable. Guides are retrieved on demand. No upstream installer,
Chrome-extension skill, MCP server or always-loaded registration is added.

Local changes: bounded routing description, composition with existing skills,
explicit CLI version, concise reporting and environment-appropriate failure
handling. The upstream all-web mandatory trigger and prescribed final-response
format are not adopted. The upstream licence is retained in `../LICENSE`.

## Updating

Review upstream changes and package metadata, choose an explicit released version,
and update the wrapper pin, source revision and integrity together. Smoke-test search
and retrieval, plus a legacy scan in a disposable fixture. Run the estate lint and
runtime Jev routing cases with the checkout skills directory explicitly selected;
include nearby design, framework and browser-testing tasks as negative controls.
Rebuild Agentbox when scheduled to make the baked skill available to sessions.

Focused cases: [routing-cases.json](routing-cases.json). These are co-authored
smoke cases, not an independent accuracy benchmark.

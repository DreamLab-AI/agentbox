# Agentbox integration example

Agentbox is one consumer of the portable VisionCraft skill and executable. This
reference describes its integration responsibilities; none is a prerequisite
for using VisionCraft in another repository or CI environment. Source pins and
runtime availability must be checked independently after a rebuild.

## One payload, two harnesses

Canonical release content lives in `skills/visioncraft/`. Agentbox's source/pin
projection installs that tree into its skills estate and reconciles the selected
Claude Code and Codex registries. Routing descriptions, indexes, stack
projection, preflight and neighbouring skills must use the same canonical name.
Updating only a directory name does not update those consumers.

Agentbox uses a hard cutover: rewrite callers using the
[source path map](../assets/legacy-paths.json), then remove the old
`build-with-quality` entrypoint and implementation. No old-name skill, redirect
or second full payload remains active. Existing script callers move to the
installed Rust adapter with the required argument/result contract. Verify the
actual installed layout as well as source; a correct pin does not establish
that the rebuilt image contains it.

## Memory and participants

Agentbox requires its governed shared-memory MCP, using the actual tool schema,
for project recall and verified lessons. It does not permit a raw database or
CLI fallback that bypasses its embedding pipeline. The portable skill simply
offers a knowledge-integration seam; other hosts need not provide memory at all.

Agentbox's registered harness workers perform work; coordination records may
only describe roles to observers. Map logical responsibilities to actual
available workers and retain their execution provenance. Host-configured model
defaults and advisors belong to that host. A same-family advisor is not an
independent auditor, regardless of provider spelling or role label.

## Direct AQE testing tools

Agentbox can enable its separately pinned `agentic-qe` toolchain and project a
direct `aqe mcp` server to its coding clients. Discovery must confirm callable
tools after the rebuild; an enabled source flag is not deployed evidence.
See [the AQE workflow](agentic-qe.md) for exact 3.15.10 input examples and result
limits. Jev selects VisionCraft's engineering method; AQE provides optional
domain execution, while Ruflo remains a separate coordination surface.

Use the host's in-memory AQE setting and existing RuVector MCP for durable
lessons. Memory mode does not disable internal embedding attempts. Do not add a
new model service or assume that AQE's default model can be replaced by any
384-dimensional endpoint. Preserve unavailable learning capability separately
from working native tests, and verify actual filesystem/runtime behaviour.

## Security adapter and review cadence

Agentbox supplies toolchain pins, `[security.deepsec]` policy, route/credential
validation and current spend cadence. A rebuild-controlled binary gate and live
policy are different surfaces. Apply explicit per-run overrides according to
the host adapter, and verify migrated callers' flags, exits and receipt paths.
Configuration errors and unavailable tools remain visible non-passes.

Do not bypass the adapter with an installation/initialisation command that
creates a separate dependency tree, links a hosted service or starts unbounded
model work. Read effective configuration and installed versions. Keep
names-only credential references, private source-bearing output and approved
network routes. Authorisation for one review does not authorise publication of
its source pack.

## Shared owners in the estate

Sealmap owns finding receipts, model-family declarations and code-view packs.
Authored diagram topics retain source verification and decision links;
rendering/citation tools check their respective syntax and references. Neither
valid Mermaid nor a valid receipt establishes semantic truth.

Agentbox's review scheduler and budget ledger remain existing owners. VisionCraft
does not create another spend database, findings store, orchestrator or learning
engine. Its adapters should expose the same recorded outcomes to both harnesses
and ordinary CI consumers.

## Adoption checklist

Verify the published crate/bundle, exact source hash, consumer lockfile/build,
all migrated direct paths, both registries, router and picker fixtures, stack/preflight
projection and CI entry point. Then check installed versions and a harmless
end-to-end observation after activation. Local path-patched tests and pinned
image inputs do not prove the running image uses the release. Preserve the
separate publication, adoption and deployment receipts in the existing record.

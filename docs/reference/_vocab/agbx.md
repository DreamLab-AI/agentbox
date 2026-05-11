# agentbox extension vocabulary (`agbx:`) — term registry

**Namespace IRI:** `https://agentbox.dreamlab-ai.systems/ns/v1#`
**Context document:** [`agentbox-v1.context.jsonld`](./agentbox-v1.context.jsonld)
**Published under:** [PRD-006](../prd/PRD-006-linked-data-interfaces.md) / [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md) / [DDD-004](../ddd/DDD-004-linked-data-interchange-domain.md)

The `agbx:` namespace covers terms with no upstream W3C / IETF / Schema.org equivalent. Each term has a documented rationale and a round-trip test fixture. We bind to upstream vocabularies whenever possible — see PRD-006 §8.4.

## Adding a term

1. Confirm no equivalent in [Schema.org](https://schema.org/), [ActivityStreams](https://www.w3.org/TR/activitystreams-vocabulary/), [PROV-O](https://www.w3.org/TR/prov-o/), [ODRL](https://www.w3.org/TR/odrl-vocab/), [DCAT](https://www.w3.org/TR/vocab-dcat-3/), [SKOS](https://www.w3.org/TR/skos-reference/), [WoT TD](https://www.w3.org/TR/wot-thing-description11/), or [DID Core](https://www.w3.org/TR/did-core/).
2. Add a row to the table below with a one-paragraph rationale.
3. Add the term to [`agentbox-v1.context.jsonld`](./agentbox-v1.context.jsonld) with the right datatype mapping.
4. Add a round-trip test fixture in `tests/contract/linked-data/surfaces.spec.js`.
5. Bump the namespace if breaking (currently `v1`).

## Active terms

| Term | Datatype / `@type` | Used by | Rationale |
|---|---|---|---|
| `agbx:HandoffClaim` | class (`@type`) | S2, S5 | Bead claim handoffs from one agent to another. AS `as:Activity` is too generic to capture the agentbox-specific handoff semantics (claim transition, dependency clearance, attribution chain). |
| `agbx:RequestBriefing` | class (`@type`) | S2 | Internal-agent request to external-agent for context. AS `as:Question` does not carry the claim that the response is expected to inform a downstream commitment. |
| `agbx:DeliverArtefact` | class (`@type`) | S2, S5 | Delivery of a produced file or memory entry. AS `as:Add` semantics differ — Add does not carry production attribution. |
| `agbx:ProgressiveDisclosure` | `xsd:boolean` | S7 | Skill metadata flag indicating just-in-time disclosure (the skill body is loaded only when the trigger fires). Not in Schema.org HowTo. |
| `agbx:invocationTrigger` | `xsd:string` | S7 | Skill invocation trigger pattern (the prompt fragment that activates the skill). Not in Schema.org. |
| `agbx:requires` | `@type: @id` | S6, S7 | Capability requirement. WoT TD `td:hasRequiredFunction` is too narrow (skills require schemas, env vars, and other skills, not just Things). |
| `agbx:redacted` | `xsd:boolean` | every surface | Privacy-filter redaction flag. ADR-008 redacts spans to `[REDACTED]`; this flag lets consumers detect redaction without parsing the marker text. No upstream equivalent. |
| `agbx:RuntimeContract` | class (`@type`) | S11 | The DDD-002 RuntimeContract aggregate exposed as JSON-LD. Schema.org `SoftwareApplication` is too generic to cover the probe contract + observability binding + security profile triple. |
| `agbx:Capability` | class (`@type`) | S6 | MCP capability descriptor variant of Schema.org `SoftwareApplication`. Used together with `td:Thing`. |
| `agbx:Skill` | class (`@type`) | S7 | Skill aggregate from the agentbox skills corpus. Pairs with Schema.org `HowTo`. |
| `agbx:adr` `agbx:prd` `agbx:ddd` | class (`@type`) | S10 | Architecture document classes. SKOS `skos:Concept` is too generic — these classes carry their own status semantics and lifecycle. |
| `agbx:action` | `xsd:string` | S5 | Adapter dispatch action label (e.g. `"memory.write"`, `"bead.claim"`). The literal label complements `prov:Activity`'s class membership. |
| `agbx:slot` | `xsd:string` | S5 | Adapter slot name (`"pods"`, `"events"`, `"memory"`, `"beads"`, `"orchestrator"`). |
| `agbx:operation` | `xsd:string` | S5 | Adapter operation name (`"write"`, `"read"`, `"patch"`, `"del"`, `"list"`, `"emit"`). |
| `agbx:adapters` | `@type: @id` | S11 | The resolved adapter map at boot, exposed via `/v1/meta`. |
| `agbx:observability` | `@type: @id` | S11 | The ObservabilityBinding aggregate, exposed via `/v1/meta`. |
| `agbx:bootstrapCompleted` | `xsd:boolean` | S11 | Whether bootstrap has finished. Mirrors DDD-001's `BootstrapCompleted` event flag. |
| `agbx:readiness` | `@type: @id` | S11 | The ReadinessRequirement set evaluated at boot. |
| `agbx:linked-data-surfaces` | `@type: @id` (collection) | S11 | The set of FederationSurface ids currently enabled. |
| `agbx:AgentEventStream` | class (`@type`) | S11 | Container for a sequence of `prov:Activity` records emitted by `/v1/agent-events`. |
| `agbx:events` | `@type: @id` (collection) | S11 | The actual sequence of events on an `AgentEventStream`. |
| `agbx:transport` | `xsd:string` | S6 | WoT TD `forms[].transport` extension — `"stdio"`, `"http"`, `"sse"`. Used to distinguish the `docker exec -i` MCP transport from HTTP. |
| `agbx:protocol` | `xsd:string` | S6 | Custom security scheme protocol identifier — currently used to label `"nip98"` so WoT consumers recognise the agentbox-specific NIP-98 challenge. |
| `agbx:value` | `xsd:string` | S5 | Fallback string projection for non-string `prov:Entity` payloads in PROV-O receipts. |

## Reserved namespace prefixes

| Prefix | Namespace IRI | Source |
|---|---|---|
| `agbx` | `https://agentbox.dreamlab-ai.systems/ns/v1#` | this registry |
| `as` | `https://www.w3.org/ns/activitystreams#` | [W3C ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-vocabulary/) |
| `schema` | `http://schema.org/` | [Schema.org](https://schema.org/) |
| `prov` | `http://www.w3.org/ns/prov#` | [W3C PROV-O](https://www.w3.org/TR/prov-o/) |
| `dcat` | `http://www.w3.org/ns/dcat#` | [W3C DCAT-3](https://www.w3.org/TR/vocab-dcat-3/) |
| `dcterms` | `http://purl.org/dc/terms/` | DCMI |
| `skos` | `http://www.w3.org/2004/02/skos/core#` | [W3C SKOS](https://www.w3.org/TR/skos-reference/) |
| `odrl` | `http://www.w3.org/ns/odrl/2/` | [W3C ODRL 2.2](https://www.w3.org/TR/odrl-model/) |
| `td` | `https://www.w3.org/2019/wot/td#` | [W3C WoT TD 1.1](https://www.w3.org/TR/wot-thing-description11/) |
| `xsd` | `http://www.w3.org/2001/XMLSchema#` | [XSD](https://www.w3.org/TR/xmlschema11-2/) |

## Versioning

The namespace path includes `v1`. A breaking change to any term semantics (datatype change, deletion, narrowing) bumps the namespace to `v2`. Additive changes (new terms, broader datatypes) stay in `v1`.

## License

The agentbox extension vocabulary is published under [AGPL-3.0](../../../LICENSE). The published context document is reusable by any consumer; we ask that derivative vocabularies use a different namespace to avoid collisions.

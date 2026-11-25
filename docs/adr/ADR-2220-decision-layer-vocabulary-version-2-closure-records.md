---
id: ADR-2220
title: The dl vocabulary models closure records and drops the conflicting domains
date: 2026-11-25
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 039a68b32603516d44b8ac470e203c576543dce5
verified_paths: [ontology/decision-layer.ttl, ontology/decision-layer.ofn, ontology/test_decision_layer.py]
owner: jjohare
review_trigger: a change to the estate temporal contract, to memory-ontology's clock IRIs, or a loader that reads ontology/decision-layer.ttl at runtime
repo: agentbox
evidence_class: source+test
acceptance_boundary: ontology/test_decision_layer.py parses the TTL with rdflib and checks the OFN against it by a small reader; neither file was loaded by an OWL reasoner here. No runtime consumer reads either file. Staged until VisionClaw's estate-temporal-v2 implementation writes closure records.
guard: [ontology/test_decision_layer.py]
---

# ADR-2220 — The dl vocabulary models closure records and drops the conflicting domains

## Context
`dl:validFrom` and `dl:validTo` had `rdfs:domain dl:DecisionRecord` in the TTL (a `prov:Activity`) and `prov:Entity` in the OFN, so the two files disagreed. Neither suits an assertion-version, which is a `prov:Entity` and not a decision. VisionClaw writes `dl:validFrom`, `dl:validTo` and `dl:writer` on versions and activities, and `dl:writer` was never declared. Estate temporal contract v2 (VisionClaw ADR-2219) stops versions carrying an end and records ends as separate closure records.

## Decision
`ontology/decision-layer.ttl` and `.ofn` go to version 2 (`owl:versionInfo "2"`):
- `dl:validFrom` and `dl:validTo` lose their `rdfs:domain`. `dl:validTo` is `owl:deprecated`: retired from assertion-versions, kept only to read version-1 data until it is refitted.
- New `dl:Closure`, `dl:closesVersion` (range `prov:Entity`), `dl:closes`, `dl:validUntil` and `dl:reason`. `dl:writer` is declared (domain `prov:Activity`, string).
- `dl:closes` ranges over `memory:Clock`. Its values are `memory:ValidTime` and `memory:RecordedTime` of the Agent Memory Ontology (`http://nova.dev/memory#`, CC BY 4.0), referenced by IRI and not redefined. NOTICE carries the attribution.
- The vocabulary stays inside OWL 2 EL. "A closure closes at least one clock" is a writer rule and is not expressed here.
- The OFN gains the three object-property ranges it lacked, and the test checks TTL/OFN parity.

## Consequences
- The line citations to the old TTL in other repositories' diagrams shift and need refreshing there.
- Nothing loads either file at runtime, so no behaviour changes until VisionClaw writes closures.
- The vocabulary imports no memory-ontology axioms; a reasoner loading only this file sees `memory:Clock` as an undeclared class.

## Verification
`python3 ontology/test_decision_layer.py` passes (parse, term, domain, range, version and parity checks). Both serialisations were parsed: the TTL by rdflib and the OFN by horned-owl 1.x (a throwaway crate outside the repo), plus the test's parity reader.

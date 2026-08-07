#!/usr/bin/env python3
"""Validation test for decision-layer.ttl (ADR-048/ADR-049) with EL-profile guard.

Asserts:
  1. The TTL parses cleanly with rdflib.
  2. Required classes / properties are declared with the right types and causal
     evidence is not declared transitive.
  3. EL-SAFETY GUARD (ADR-047 §3a): the graph contains NO triple asserting
     owl:inverseOf, owl:FunctionalProperty, or owl:InverseFunctionalProperty.

Exit code 0 = all pass, 1 = failure.
"""
import sys
from pathlib import Path

from rdflib import Graph, RDF, OWL, RDFS, XSD
from rdflib.namespace import Namespace

TTL = Path(__file__).with_name("decision-layer.ttl")
DL = Namespace("https://narrativegoldmine.com/ns/dl#")
PROV = Namespace("http://www.w3.org/ns/prov#")

g = Graph()
g.parse(TTL, format="turtle")
print(f"[ok] parsed {TTL.name}: {len(g)} triples")

failures = []


def check(cond, msg):
    print(f"{'[ok]  ' if cond else '[FAIL]'} {msg}")
    if not cond:
        failures.append(msg)


# --- structural expectations -------------------------------------------------
check((DL.DecisionRecord, RDF.type, OWL.Class) in g,
      "dl:DecisionRecord is an owl:Class")
check((DL.DecisionRecord, RDFS.subClassOf, PROV.Activity) in g,
      "dl:DecisionRecord rdfs:subClassOf prov:Activity")

for p in (DL.caused, DL.precedentFor, DL.influenced, DL.consideredInput, DL.governedBy):
    check((p, RDF.type, OWL.ObjectProperty) in g, f"{p.split('#')[1]} is an owl:ObjectProperty")

for p in (DL.caused, DL.precedentFor):
    check((p, RDF.type, OWL.TransitiveProperty) not in g,
          f"{p.split('#')[1]} remains direct evidence, not transitive")

for p in (DL.validFrom, DL.validTo):
    check((p, RDF.type, OWL.DatatypeProperty) in g, f"{p.split('#')[1]} is an owl:DatatypeProperty")

for p in (DL.validFrom, DL.validTo):
    check((p, RDFS.range, XSD.dateTime) in g, f"{p.split('#')[1]} range is xsd:dateTime")

# --- EL-PROFILE GUARD (ADR-047 §3a) -----------------------------------------
forbidden_predicates = [OWL.inverseOf]
forbidden_types = [OWL.FunctionalProperty, OWL.InverseFunctionalProperty]

for pred in forbidden_predicates:
    hits = list(g.triples((None, pred, None)))
    check(not hits, f"EL-GUARD: no triple uses predicate {pred} ({len(hits)} found)")

for typ in forbidden_types:
    hits = list(g.triples((None, RDF.type, typ)))
    check(not hits, f"EL-GUARD: no resource typed {typ} ({len(hits)} found)")

# also catch the forbidden classes appearing as object of ANY predicate
for typ in forbidden_types + [OWL.inverseOf]:
    obj_hits = [t for t in g.triples((None, None, typ))]
    check(not obj_hits, f"EL-GUARD: {typ} never appears as an object ({len(obj_hits)} found)")

print()
if failures:
    print(f"RESULT: FAIL ({len(failures)} check(s) failed)")
    sys.exit(1)
print("RESULT: PASS — parses and stays within OWL 2 EL (no inverse/functional/inverse-functional)")
sys.exit(0)

#!/usr/bin/env python3
"""Validation test for decision-layer.ttl (ADR-048/ADR-049) with EL-profile guard.

Asserts:
  1. The TTL parses cleanly with rdflib.
  2. Required classes / properties are declared with the right types and causal
     evidence is not declared transitive.
  3. estate-temporal-v2 terms (dl:Closure, closesVersion, closes, validUntil,
     reason, writer) exist, validFrom/validTo carry no rdfs:domain, validTo is
     deprecated, and dl:closes ranges over memory-ontology's memory:Clock.
  4. decision-layer.ofn agrees with the TTL on declarations, domains, ranges
     and version (the OFN is parsed with a small reader; no OWL API needed).
  5. EL-SAFETY GUARD (ADR-047 §3a): the graph contains NO triple asserting
     owl:inverseOf, owl:FunctionalProperty, or owl:InverseFunctionalProperty.

Exit code 0 = all pass, 1 = failure.
"""
import re
import sys
from pathlib import Path

from rdflib import Graph, RDF, OWL, RDFS, XSD, URIRef
from rdflib.namespace import Namespace

TTL = Path(__file__).with_name("decision-layer.ttl")
OFN = Path(__file__).with_name("decision-layer.ofn")
DL = Namespace("https://narrativegoldmine.com/ns/dl#")
PROV = Namespace("http://www.w3.org/ns/prov#")
MEMORY = Namespace("http://nova.dev/memory#")

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

# --- estate-temporal-v2 ------------------------------------------------------
check((DL.Closure, RDF.type, OWL.Class) in g, "dl:Closure is an owl:Class")
for p in (DL.closesVersion, DL.closes):
    check((p, RDF.type, OWL.ObjectProperty) in g, f"{p.split('#')[1]} is an owl:ObjectProperty")
for p in (DL.validUntil, DL.reason, DL.writer):
    check((p, RDF.type, OWL.DatatypeProperty) in g, f"{p.split('#')[1]} is an owl:DatatypeProperty")
for p in (DL.closesVersion, DL.closes, DL.validUntil, DL.reason):
    check((p, RDFS.domain, DL.Closure) in g, f"{p.split('#')[1]} domain is dl:Closure")
check((DL.closesVersion, RDFS.range, PROV.Entity) in g, "dl:closesVersion range is prov:Entity")
check((DL.closes, RDFS.range, MEMORY.Clock) in g, "dl:closes range is memory:Clock (memory-ontology IRI)")
for clock in ("ValidTime", "RecordedTime"):
    check((DL.closes, RDFS.seeAlso, MEMORY[clock]) in g,
          f"dl:closes points at memory:{clock} (exact memory-ontology IRI)")
    check(f"AnnotationAssertion(rdfs:seeAlso dl:closes memory:{clock})" in OFN.read_text(),
          f"OFN also points dl:closes at memory:{clock}")
check((DL.validUntil, RDFS.range, XSD.dateTime) in g, "dl:validUntil range is xsd:dateTime")
check((DL.writer, RDFS.domain, PROV.Activity) in g, "dl:writer domain is prov:Activity")
for p in (DL.validFrom, DL.validTo):
    check(not list(g.triples((p, RDFS.domain, None))),
          f"{p.split('#')[1]} carries no rdfs:domain (usable on assertion-versions)")
check((DL.validTo, OWL.deprecated, None) in g, "dl:validTo is marked owl:deprecated (retired from versions)")
check(not list(g.triples((MEMORY.ValidTime, None, None))) and not list(g.triples((MEMORY.Clock, None, None))),
      "memory-ontology terms are referenced, not redefined")
ver = g.value(URIRef("https://narrativegoldmine.com/ns/dl"), OWL.versionInfo)
check(ver is not None and str(ver) == "2", "owl:versionInfo is 2")

# --- TTL / OFN parity --------------------------------------------------------
ofn = OFN.read_text()
ns = {"dl": str(DL), "prov": str(PROV), "memory": str(MEMORY),
      "xsd": str(XSD), "rdfs": str(RDFS), "owl": str(OWL)}


def expand(curie):
    pre, local = curie.split(":", 1)
    return URIRef(ns[pre] + local)


decl = {(kind, expand(c)) for kind, c in
        re.findall(r"Declaration\((Class|ObjectProperty|DataProperty)\(([\w]+:\w+)\)\)", ofn)}
ofn_dom = {(expand(a), expand(b)) for a, b in
           re.findall(r"(?:Object|Data)PropertyDomain\((\w+:\w+) (\w+:\w+)\)", ofn)}
ofn_rng = {(expand(a), expand(b)) for a, b in
           re.findall(r"(?:Object|Data)PropertyRange\((\w+:\w+) (\w+:\w+)\)", ofn)}
ttl_dom = {(s_, o) for s_, _, o in g.triples((None, RDFS.domain, None))}
ttl_rng = {(s_, o) for s_, _, o in g.triples((None, RDFS.range, None))}
check(ofn_dom == ttl_dom, f"OFN domains equal TTL domains (diff: {sorted(ofn_dom ^ ttl_dom)})")
check(ofn_rng == ttl_rng, f"OFN ranges equal TTL ranges (diff: {sorted(ofn_rng ^ ttl_rng)})")
kinds = {"Class": OWL.Class, "ObjectProperty": OWL.ObjectProperty, "DataProperty": OWL.DatatypeProperty}
dl_ttl = {(k, s_) for k, t in kinds.items() for s_ in g.subjects(RDF.type, t)
          if str(s_).startswith(str(DL))}
dl_ofn = {(k, c) for k, c in decl if str(c).startswith(str(DL))}
check(dl_ttl == dl_ofn, f"OFN declares every dl: term the TTL does (diff: {sorted(dl_ttl ^ dl_ofn)})")
check('Annotation(owl:versionInfo "2")' in ofn, "OFN carries owl:versionInfo 2")

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

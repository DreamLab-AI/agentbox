public:: true
alias:: KnowledgeGraph

# Knowledge Graph
```json-ld
{
  "@context": "https://narrativegoldmine.com/context/v1.jsonld",
  "@id": "urn:visionflow:page:54944bc35e10df3e1dc9d6d7f3d59f6b20dadfe29b0af0692cc4b732fa6685ce",
  "@type": "Page",
  "vc:slug": "knowledge-graph",
  "title": "Knowledge Graph",
  "vc:public": true,
  "vc:outboundWikilinks": [
    {
      "@id": "urn:visionflow:linked:ai-reasoning",
      "vc:label": "AI Reasoning"
    },
    {
      "@id": "urn:visionflow:linked:entity-node",
      "vc:label": "Entity Node"
    },
    {
      "@id": "urn:visionflow:linked:entity-resolution",
      "vc:label": "Entity Resolution"
    },
    {
      "@id": "urn:visionflow:linked:inference-engine",
      "vc:label": "Inference Engine"
    },
    {
      "@id": "urn:visionflow:linked:knowledge-discovery",
      "vc:label": "Knowledge Discovery"
    },
    {
      "@id": "urn:visionflow:linked:ontology",
      "vc:label": "Ontology"
    },
    {
      "@id": "urn:visionflow:linked:ontology-schema",
      "vc:label": "Ontology Schema"
    },
    {
      "@id": "urn:visionflow:linked:rdf-framework",
      "vc:label": "RDF Framework"
    },
    {
      "@id": "urn:visionflow:linked:reasoning-service",
      "vc:label": "Reasoning Service"
    },
    {
      "@id": "urn:visionflow:linked:recommendation-system",
      "vc:label": "Recommendation System"
    },
    {
      "@id": "urn:visionflow:linked:relationship-edge",
      "vc:label": "Relationship Edge"
    },
    {
      "@id": "urn:visionflow:linked:schema-definition",
      "vc:label": "Schema Definition"
    },
    {
      "@id": "urn:visionflow:linked:schema-org",
      "vc:label": "Schema.org"
    },
    {
      "@id": "urn:visionflow:linked:semantic-property",
      "vc:label": "Semantic Property"
    },
    {
      "@id": "urn:visionflow:linked:semantic-web-infrastructure",
      "vc:label": "Semantic Web Infrastructure"
    },
    {
      "@id": "urn:visionflow:linked:triple-store",
      "vc:label": "Triple Store"
    },
    {
      "@id": "urn:visionflow:linked:w3-c-owl",
      "vc:label": "W3C OWL"
    },
    {
      "@id": "urn:visionflow:linked:w3-c-rdf",
      "vc:label": "W3C RDF"
    },
    {
      "@id": "urn:visionflow:owl:class:ai-research-area",
      "vc:label": "ComputationAndIntelligenceDomain"
    },
    {
      "@id": "urn:visionflow:owl:class:graph-database",
      "vc:label": "Graph Database"
    },
    {
      "@id": "urn:visionflow:owl:class:infrastructure",
      "vc:label": "InfrastructureDomain"
    },
    {
      "@id": "urn:visionflow:owl:class:knowledge-management-system",
      "vc:label": "Knowledge Management System"
    },
    {
      "@id": "urn:visionflow:owl:class:middleware-layer",
      "vc:label": "MiddlewareLayer"
    },
    {
      "@id": "urn:visionflow:owl:class:question-answering",
      "vc:label": "Question Answering"
    },
    {
      "@id": "urn:visionflow:owl:class:semantic-search",
      "vc:label": "Semantic Search"
    },
    {
      "@id": "urn:visionflow:owl:class:sparql-query-engine",
      "vc:label": "SPARQL Query Engine"
    }
  ],
  "vc:schemaVersion": 2,
  "vc:legacyProperties": [
    {
      "vc:key": "legacy-term-id",
      "vc:value": "MV-20308"
    },
    {
      "vc:key": "preferred-term",
      "vc:value": "Knowledge Graph"
    }
  ],
  "prov:wasAttributedTo": {
    "@id": "did:nostr:jjohare"
  },
  "prov:generatedAtTime": {
    "@value": "2026-05-18T07:12:05Z",
    "@type": "xsd:dateTime"
  }
}
```

```json-ld
{
  "@context": "https://narrativegoldmine.com/ns/v2.jsonld",
  "@id": "urn:ngm:class:knowledge-graph",
  "@type": "Class",
  "label": "Knowledge Graph",
  "definition": "A semantic knowledge network that represents entities, relationships, and attributes as an interconnected graph structure, enabling advanced reasoning, inference, and knowledge discovery across metaverse systems.",
  "domain": "spatial-computing",
  "maturity": "established",
  "subClassOf": [
    {
      "@id": "urn:ngm:class:sc-content-and-assets",
      "label": "Content and Assets"
    }
  ],
  "relations": {
    "hasPart": [
      {
        "@id": "urn:ngm:class:inference-engine",
        "label": "Inference Engine"
      },
      {
        "@id": "urn:ngm:class:relationship-edge",
        "label": "Relationship Edge"
      }
    ],
    "requires": [
      {
        "@id": "urn:ngm:class:ontology",
        "label": "Ontology"
      },
      {
        "@id": "urn:ngm:class:schema-definition",
        "label": "Schema Definition"
      },
      {
        "@id": "urn:ngm:class:triple-store",
        "label": "Triple Store"
      },
      {
        "@id": "urn:ngm:class:graph-database",
        "label": "Graph Database"
      }
    ],
    "enables": [
      {
        "@id": "urn:ngm:class:reasoning",
        "label": "AI Reasoning"
      },
      {
        "@id": "urn:ngm:class:knowledge-discovery",
        "label": "Knowledge Discovery"
      },
      {
        "@id": "urn:ngm:class:recommendation-system",
        "label": "Recommendation System"
      },
      {
        "@id": "urn:ngm:class:question-answering",
        "label": "Question Answering"
      },
      {
        "@id": "urn:ngm:class:semantic-search",
        "label": "Semantic Search"
      }
    ],
    "partOf": [
      {
        "@id": "urn:ngm:class:semantic-web-linked-data-standard-infrastructure",
        "label": "Semantic Web Infrastructure"
      },
      {
        "@id": "urn:ngm:class:knowledge-management-system",
        "label": "Knowledge Management System"
      }
    ]
  },
  "quality": 0.35,
  "provenance": {
    "attributedTo": "did:nostr:lcr-swarm",
    "generatedAt": "2026-05-18T07:12:05Z",
    "inferenceRule": "R5DomainRootFallback"
  }
}
```

```json-ld
{
  "@context": "https://narrativegoldmine.com/context/v1.jsonld",
  "@id": "urn:visionflow:annotation:link-resolutions:knowledge-graph:776c802a9fc9",
  "@type": "vc:LinkResolutionsAnnotation",
  "vc:appliesTo": {
    "@id": "urn:visionflow:page:54944bc35e10df3e1dc9d6d7f3d59f6b20dadfe29b0af0692cc4b732fa6685ce"
  },
  "vc:resolutions": [
    {
      "raw": "[[AI Reasoning]]",
      "resolved": "urn:visionflow:linked:ai-reasoning",
      "kind": "StubLink"
    },
    {
      "raw": "[[Entity Node]]",
      "resolved": "urn:visionflow:linked:entity-node",
      "kind": "StubLink"
    },
    {
      "raw": "[[Entity Resolution]]",
      "resolved": "urn:visionflow:linked:entity-resolution",
      "kind": "StubLink"
    },
    {
      "raw": "[[Inference Engine]]",
      "resolved": "urn:visionflow:linked:inference-engine",
      "kind": "StubLink"
    },
    {
      "raw": "[[Knowledge Discovery]]",
      "resolved": "urn:visionflow:linked:knowledge-discovery",
      "kind": "StubLink"
    },
    {
      "raw": "[[Ontology]]",
      "resolved": "urn:visionflow:linked:ontology",
      "kind": "StubLink"
    },
    {
      "raw": "[[Ontology Schema]]",
      "resolved": "urn:visionflow:linked:ontology-schema",
      "kind": "StubLink"
    },
    {
      "raw": "[[RDF Framework]]",
      "resolved": "urn:visionflow:linked:rdf-framework",
      "kind": "StubLink"
    },
    {
      "raw": "[[Reasoning Service]]",
      "resolved": "urn:visionflow:linked:reasoning-service",
      "kind": "StubLink"
    },
    {
      "raw": "[[Recommendation System]]",
      "resolved": "urn:visionflow:linked:recommendation-system",
      "kind": "StubLink"
    },
    {
      "raw": "[[Relationship Edge]]",
      "resolved": "urn:visionflow:linked:relationship-edge",
      "kind": "StubLink"
    },
    {
      "raw": "[[Schema Definition]]",
      "resolved": "urn:visionflow:linked:schema-definition",
      "kind": "StubLink"
    },
    {
      "raw": "[[Schema.org]]",
      "resolved": "urn:visionflow:linked:schema-org",
      "kind": "StubLink"
    },
    {
      "raw": "[[Semantic Property]]",
      "resolved": "urn:visionflow:linked:semantic-property",
      "kind": "StubLink"
    },
    {
      "raw": "[[Semantic Web Infrastructure]]",
      "resolved": "urn:visionflow:linked:semantic-web-infrastructure",
      "kind": "StubLink"
    },
    {
      "raw": "[[Triple Store]]",
      "resolved": "urn:visionflow:linked:triple-store",
      "kind": "StubLink"
    },
    {
      "raw": "[[W3C OWL]]",
      "resolved": "urn:visionflow:linked:w3-c-owl",
      "kind": "StubLink"
    },
    {
      "raw": "[[W3C RDF]]",
      "resolved": "urn:visionflow:linked:w3-c-rdf",
      "kind": "StubLink"
    },
    {
      "raw": "[[ComputationAndIntelligenceDomain]]",
      "resolved": "urn:visionflow:owl:class:ai-research-area",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Graph Database]]",
      "resolved": "urn:visionflow:owl:class:graph-database",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[InfrastructureDomain]]",
      "resolved": "urn:visionflow:owl:class:infrastructure",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Knowledge Management System]]",
      "resolved": "urn:visionflow:owl:class:knowledge-management-system",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[MiddlewareLayer]]",
      "resolved": "urn:visionflow:owl:class:middleware-layer",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Question Answering]]",
      "resolved": "urn:visionflow:owl:class:question-answering",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Semantic Search]]",
      "resolved": "urn:visionflow:owl:class:semantic-search",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[SPARQL Query Engine]]",
      "resolved": "urn:visionflow:owl:class:sparql-query-engine",
      "kind": "ResolvedLink"
    }
  ],
  "prov:wasAttributedTo": {
    "@id": "did:nostr:lcr-swarm"
  },
  "prov:generatedAtTime": {
    "@value": "2026-05-18T07:12:05Z",
    "@type": "xsd:dateTime"
  }
}
```


- ### Definition
  - A semantic knowledge network that represents entities, relationships, and attributes as an interconnected graph structure, enabling advanced reasoning, inference, and knowledge discovery across metaverse systems.

- ### Semantic Classification
  - owl-class:: spatial-computing:KnowledgeGraph
  - owl-role:: Object
  - owl-inferred:: spatial-computing:VirtualObject
  - belongs-to-domain:: [[InfrastructureDomain]], [[ComputationAndIntelligenceDomain]]
  - implemented-in-layer:: [[MiddlewareLayer]]

- ### Relationships
  - has-part:: [[Entity Node]], [[Relationship Edge]], [[Semantic Property]], [[Ontology Schema]], [[Inference Engine]]
  - is-part-of:: [[Knowledge Management System]], [[Semantic Web Infrastructure]]
  - requires:: [[Graph Database]], [[Ontology]], [[Triple Store]], [[Schema Definition]]
  - enables:: [[Semantic Search]], [[AI Reasoning]], [[Knowledge Discovery]], [[Recommendation System]], [[Question Answering]]
  - depends-on:: [[RDF Framework]], [[SPARQL Query Engine]], [[Reasoning Service]], [[Entity Resolution]]

- ### Content
  This page holds the canonical class definition for the concept; the fuller article lives at [[Knowledge Graphs]]. In the layered stack this corpus documents itself with, a knowledge graph is the [[Ontology]]'s vocabulary populated with instance data, with [[Reasoning]] as the machine check that classifies the result and gates what enters it. This published corpus is itself pure TBox — the ontology, not a knowledge graph; the mesh's runtime graphs are where individuals live. Body content pending enrichment; merge with [[Knowledge Graphs]] is an open editorial decision.

- ### Provenance
  - sources:: [[W3C RDF]], [[W3C OWL]], [[Schema.org]]
  - migration-date:: 2026-04-26T00:00:00Z

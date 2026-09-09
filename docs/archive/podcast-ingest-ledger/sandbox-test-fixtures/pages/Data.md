public:: true

# Data

```json-ld
{
  "@context": "https://narrativegoldmine.com/ns/v1",
  "@id": "urn:visionflow:page:data",
  "@type": "Page",
  "title": "Data",
  "vc:slug": "data",
  "vc:public": true,
  "vc:schemaVersion": 2,
  "vc:outboundWikilinks": []
}
```

```json-ld
{
  "@context": "https://narrativegoldmine.com/ns/v2.jsonld",
  "@id": "urn:ngm:class:data",
  "@type": "Class",
  "label": "Data",
  "definition": "Data is the recorded representation of facts, observations or measurements in a form suitable for storage, processing and communication. It is the raw material from which information and knowledge are derived through interpretation and analysis, and may be structured, semi-structured or unstructured. Across computing and analytics, data is captured, modelled, stored, transformed and governed throughout a lifecycle that determines its usefulness and trustworthiness.",
  "domain": "data",
  "maturity": "mature",
  "subClassOf": [
    {
      "@id": "urn:ngm:class:data-management",
      "label": "Data Management"
    }
  ],
  "relations": {
    "hasPart": [
      {
        "@id": "urn:ngm:class:metadata",
        "label": "Metadata"
      }
    ],
    "requires": [
      {
        "@id": "urn:ngm:class:data-storage",
        "label": "Data Storage"
      },
      {
        "@id": "urn:ngm:class:data-model",
        "label": "Data Model"
      }
    ],
    "enables": [
      {
        "@id": "urn:ngm:class:business-intelligence",
        "label": "Business Intelligence"
      }
    ],
    "supports": [
      {
        "@id": "urn:ngm:class:data-processing",
        "label": "Data Processing"
      },
      {
        "@id": "urn:ngm:class:data-engineering",
        "label": "Data Engineering"
      }
    ],
    "uses": [
      {
        "@id": "urn:ngm:class:data-pipeline",
        "label": "Data Pipeline"
      }
    ],
    "dependsOn": [
      {
        "@id": "urn:ngm:class:data-quality",
        "label": "Data Quality"
      }
    ],
    "bridgesTo": [
      {
        "@id": "urn:ngm:class:data-governance",
        "label": "Data Governance"
      }
    ],
    "relatedTo": [
      {
        "@id": "urn:ngm:class:data-management",
        "label": "Data Management"
      },
      {
        "@id": "urn:ngm:class:data-integration",
        "label": "Data Integration"
      }
    ],
    "standardizedBy": [
      {
        "@id": "urn:ngm:class:data-governance",
        "label": "Data Governance"
      }
    ]
  },
  "sameAs": [],
  "quality": 0.62,
  "provenance": {
    "attributedTo": "did:nostr:ontology-mesh",
    "generatedAt": "2026-06-15T00:00:00Z",
    "inferenceRule": "GapMaterialisation"
  }
}
```

- ### Definition
  - The recorded representation of facts and observations, the raw material of [[Data Management]].
  - Captured, modelled and stored using a [[Data Model]] and [[Data Storage]].
  - Described and contextualised by [[Metadata]] to remain meaningful.
- ### Overview
  - Data exists in structured, semi-structured and unstructured forms.
  - Through processing and analysis, data becomes information and, ultimately, knowledge.
  - Its value depends on quality, lineage, accessibility and governance.
  - Data flows through a lifecycle of capture, storage, transformation, use and retirement.
- ### Key aspects
  - Structure: schema-bound versus schema-on-read representations.
  - Lineage and provenance tracking origin and transformations.
  - Quality dimensions: accuracy, completeness, timeliness, consistency.
  - Governance defining ownership, access and stewardship.
- ### Applications
  - Analytics and [[Business Intelligence]] reporting.
  - Training and evaluating machine-learning models.
  - Operational systems of record.
  - Decision support across the organisation.
- ### Relationships
  - hasPart:: [[Metadata]]
  - requires:: [[Data Storage]]
  - requires:: [[Data Model]]
  - enables:: [[Business Intelligence]]
  - supports:: [[Data Processing]]
  - supports:: [[Data Engineering]]
  - uses:: [[Data Pipeline]]
  - dependsOn:: [[Data Quality]]
  - bridgesTo:: [[Data Governance]]
  - relatedTo:: [[Data Management]]
  - relatedTo:: [[Data Integration]]
  - standardizedBy:: [[Data Governance]]
- ### Provenance
  - updated:: 2026-06-15

public:: true
alias:: AI Application

```json-ld
{
  "@context": "https://narrativegoldmine.com/context/v1.jsonld",
  "@id": "urn:visionflow:page:e79abf304c71623a4942d7870803d9e52058f55fe8cbb35472644e3eb97e7246",
  "@type": "Page",
  "vc:slug": "ai-application",
  "title": "AI Application",
  "vc:public": true,
  "vc:outboundWikilinks": [],
  "vc:schemaVersion": 2,
  "prov:wasAttributedTo": {
    "@id": "did:nostr:jjohare"
  },
  "prov:generatedAtTime": {
    "@value": "2026-05-19T19:00:00Z",
    "@type": "xsd:dateTime"
  }
}
```

```json-ld
{
  "@context": "https://narrativegoldmine.com/ns/v2.jsonld",
  "@type": "Class",
  "@id": "urn:ngm:class:ai-application",
  "label": "AI Application",
  "definition": "AI Application is the taxonomy hub for deployed uses of artificial intelligence across domains — encompassing conversational AI, computer vision, generative AI, healthcare AI, autonomous systems, fraud detection, and multimodal AI. It bridges AI research and real-world deployment, grouping systems by the function they perform rather than the techniques they use.",
  "domain": "artificial-intelligence",
  "subClassOf": [
    {
      "@id": "urn:ngm:class:artificial-intelligence",
      "label": "Artificial Intelligence"
    }
  ],
  "relations": {
    "hasPart": [
      {"@id": "urn:ngm:class:conversational-ai", "label": "Conversational AI"},
      {"@id": "urn:ngm:class:computer-vision", "label": "Computer Vision"},
      {"@id": "urn:ngm:class:generative-ai", "label": "Generative AI"},
      {"@id": "urn:ngm:class:healthcare-ai", "label": "Healthcare AI"},
      {"@id": "urn:ngm:class:autonomous-system", "label": "Autonomous System"},
      {"@id": "urn:ngm:class:fraud-detection", "label": "Fraud Detection"},
      {"@id": "urn:ngm:class:multimodal-ai-architecture-ai", "label": "Multimodal AI"},
      {"@id": "urn:ngm:class:autonomous-driving", "label": "Autonomous Driving"}
    ],
    "relatedTo": [
      {"@id": "urn:ngm:class:ai-infrastructure", "label": "AI Infrastructure"},
      {"@id": "urn:ngm:class:ai-safety", "label": "AI Safety"},
      {"@id": "urn:ngm:class:machine-learning-discipline", "label": "Machine Learning Discipline"}
    ],
    "uses": [
      {"@id": "urn:ngm:class:machine-learning-discipline", "label": "Machine Learning Discipline"},
      {"@id": "urn:ngm:class:deep-learning", "label": "Deep Learning"}
    ]
  },
  "quality": 0.8,
  "qualityScore": 0.8,
  "maturity": "established"
}
```

AI Application is the top-level category grouping all deployed uses of AI technology. Unlike AI technique categories that organise by method, AI Application organises by purpose and deployment context — the problems being solved and the domains being served.

Key sub-domains include conversational AI (chatbots, voice assistants), computer vision (object detection, scene understanding), generative AI (image, text, code generation), healthcare AI (diagnostics, drug discovery), and autonomous systems (robotics, self-driving). The category is closely coupled to AI infrastructure (the compute and serving platforms enabling deployment) and AI safety (the governance constraints on what applications may do).

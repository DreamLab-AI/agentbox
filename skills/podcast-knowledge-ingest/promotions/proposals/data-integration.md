# Dossier: Data Integration

- status: `candidate_survivor`
- target page: `Data Integration.md`
- assertions: 7 across episodes: how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, how-big-a-deal-is-the-usas-ai-genesis-mission, how-people-are-using-ai-for-health, the-biggest-battle-in-ai-is-for-your-personal-context

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **The primary blocker for enterprises moving from AI pilots to production scale is 'distributability,' the challenge of embedding agentic primitives (skills, memory, storage) into existing legacy systems and specific cloud regulatory constraints.**
  - tier 2, confidence 0.85, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `4c31e09e3528c7b7`
- **Enterprises are moving beyond 'V1' AI integration (sprinkling chatbots on surfaces) to 'agent-native' product redesigns, which requires rethinking fundamental product architecture to unlock full AI potential.**
  - tier 2, confidence 0.8, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `a22d0d9bbc484472`
- **2026 will be characterized by an 'infrastructure year' for enterprises, where the focus shifts from model selection to building the necessary connectors (MCP, data lineage, permissions) to enable reliable agent participation in business processes.**
  - tier 3, confidence 0.55, source Host (AI Daily Brief), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `9a361db97d219f8a`
- **The Genesis mission aims to train scientific foundation models and create AI agents to automate research workflows by consolidating data from the NSF, NIST, and NIH.**
  - tier 1, confidence 0.9, source White House Executive Order / AI Daily Brief Host, episode `how-big-a-deal-is-the-usas-ai-genesis-mission`, fp `5129e5370d59bb05`
- **OpenAI's strategy for ChatGPT Health is to create a 'health graph' by integrating external data sources like EHRs and Apple Health, thereby generating high switching costs through data continuity.**
  - tier 2, confidence 0.85, source Akos Gupta (analyst/commentator), episode `how-people-are-using-ai-for-health`, fp `8fcdacaf9b7d2e12`
- **Google announced 'Personal Intelligence' for the Gemini app, allowing users to securely connect Google apps like Gmail, Photos, and YouTube to provide tailored answers.**
  - tier 1, confidence 0.95, source Sundar Pichai, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `384af742b8278da2`
- **Anthropic utilizes connectors, powered by the Model Context Protocol, to link Claude Co-work to external data sources such as Google Drive.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `91692268be3d00c3`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Schema evolution** is a chronic operational challenge: source schemas change without notice, breaking downstream consumers. Solutions include schema registries (Confluent Schema Registry), backward-compatible Avro/Protobuf schemas, and contract testing.",
  "content": "\n\n- ### Recent Developments\n  - **Enterprise AI Infrastructure (2026)** \u2014 Industry leaders characterize 2026 as an \"infrastructure year\" for enterprises, where the focus shifts from model selection to building the necessary connectors (MCP, data lineage, permissions) to enable reliable agent participation in business processes. The primary blocker for moving from AI pilots to production scale is identified as \"distributability\"\u2014the challenge of embedding agentic primitives (skills, memory, storage) into existing legacy systems while meeting specific cloud regulatory constraints. Enterprises are moving beyond \"V1\" AI integration (sprinkling chatbots on surfaces) to \"agent-native\" product redesigns, which requires rethinking fundamental product architecture to unlock full AI potential. [source: Mike Kger (Chief Product Officer, Anthropic), confidence 0.85, tier 2; Host (AI Daily Brief), confidence 0.55, tier 3]\n  - **Scientific Data Consolidation (Genesis Mission)** \u2014 The Genesis mission aims to train scientific foundation models and create AI agents to automate research workflows by consolidating data from the NSF, NIST, and NIH. The initiative involves cleaning datasets from these agencies, some dating to the 1940s, for machine readability to enable AI agents to test new hypotheses and accelerate scientific breakthroughs. [source: White House Executive Order / AI Daily Brief Host, confidence 0.9, tier 1]\n  - **Health Graph Integration (OpenAI)** \u2014 OpenAI's strategy for ChatGPT Health is to create a \"health graph\" by integrating external data sources like EHRs and Apple Health. This approach generates high switching costs through data continuity, effectively turning a feature launch into a data-mode play that is difficult for competitors to replicate. [source: Akos Gupta (analyst/commentator), confidence 0.85, tier 2]\n  - **Personal Intelligence (Google)** \u2014 Google announced \"Personal Intelligence\" for the Gemini app, allowing users to securely connect Google apps like Gmail, Photos, and YouTube to provide tailored answers. This represents a significant shift in consumer-facing data integration, leveraging existing user data estates to enhance AI responsiveness. [source: Sundar Pichai, confidence 0.95, tier 1]\n  - **Model Context Protocol (Anthropic)** \u2014 Anthropic utilizes connectors, powered by the Model Context Protocol (MCP), to link Claude Co-work to external data sources such as Google Drive. This exemplifies the emerging standard for real-time, governed data federation in agentic workflows. [source: AI Daily Brief host, confidence 0.85, tier 1]"
}
```

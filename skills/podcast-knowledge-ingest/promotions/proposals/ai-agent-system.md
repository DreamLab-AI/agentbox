# Dossier: AI Agent System

- status: `candidate_survivor`
- target page: `AI Agent System.md`
- assertions: 6 across episodes: how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, the-self-driving-company

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
- **Replit observed a 2.9x increase in code output per engineer when controlling for team size changes.**
  - tier 1, confidence 0.95, source Amjad Masad (Replit CEO), episode `the-self-driving-company`, fp `e766edf95557d3f3`
- **Replit's internal AI agent for alert triage and root cause investigation performed with similar quality to a specialized vertical tool but at 10x lower cost.**
  - tier 1, confidence 0.9, source Amjad Masad (Replit CEO), episode `the-self-driving-company`, fp `5467e60e3fad2373`
- **Replit's internal automated penetration testing agent found more vulnerabilities than a specialized external tool at 10x lower cost.**
  - tier 1, confidence 0.9, source Amjad Masad (Replit CEO), episode `the-self-driving-company`, fp `d3785eb76cce76c7`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **2025 Updates**: Operator, MCP, Computer Use, Agents SDK, Lightning Network integration",
  "content": "\n\n  ## Enterprise Adoption & Infrastructure (2025\u20132026)\n\n  - **Distributability as the Primary Blocker**\n    - The main challenge for enterprises moving from AI pilots to production scale is 'distributability'\u2014the difficulty of embedding agentic primitives (skills, memory, storage) into existing legacy systems and navigating specific cloud regulatory constraints.\n    - Mike Kger (Chief Product Officer, Anthropic) notes: \"a lot of the work that we're doing for next is the word we're even using is distributability... if we want to bring our intelligence and our even our agentic primitives... into actual enterprise workloads, we need to really actually embed and meet them where they are.\"\n\n  - **From 'V1' Integration to Agent-Native Redesign**\n    - Enterprises are transitioning beyond 'V1' AI integration (sprinkling chatbots on surfaces) to 'agent-native' product redesigns.\n    - This shift requires rethinking fundamental product architecture to unlock the full potential of AI running on top of or alongside existing products.\n    - Kger states: \"I think all of these enterprises... is kind of going beyond V1 which was like let's kind of sprinkle AI on these different surfaces... to do we need to rethink some fundamental pieces of the product to be more agent native... have you unlocked the full power of your product to any AI that is sort of running on top or alongside it.\"\n\n  - **2026: The Infrastructure Year**\n    - 2026 is characterized as an 'infrastructure year' for enterprises, with the focus shifting from model selection to building necessary connectors (MCP, data lineage, permissions) to enable reliable agent participation in business processes.\n    - The host of AI Daily Brief observes: \"it feels to me like we're poised a little bit for um enterprises to almost go through their kind of infra the structure year in 26... figuring out what are the missing connector bits is going to be I think a lot of 2026 which is great we have MCPs... the next turn is that's maybe on the retrieval side can you actually start taking action.\"\n\n  - **Productivity & Cost Efficiency Metrics (Replit Case Study)**\n    - **Code Output**: Replit observed a 2.9x increase in code output per engineer when controlling for team size changes (consistent cohort of authors).\n    - **Alert Triage**: Replit's internal AI agent for alert triage and root cause investigation performed with similar quality to a specialized vertical tool but at 10x lower cost.\n    - **Security Testing**: Replit's internal automated penetration testing agent found more vulnerabilities than a specialized external tool at 10x lower cost.\n    - Source: Amjad Masad (Replit CEO), confidence 0.9\u20130.95, tier 1."
}
```

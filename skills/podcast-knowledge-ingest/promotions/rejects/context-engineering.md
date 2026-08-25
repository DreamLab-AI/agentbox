# Dossier: Context Engineering

- status: `candidate_rejected`
- target page: `Context Engineering.md`
- assertions: 13 across episodes: context-graphs-ais-next-big-idea, harness-engineering-101, how-harness-as-a-service-will-change-agents, how-the-best-companies-use-ai, how-to-build-a-personal-agentic-operating-system, how-to-build-a-personal-context-mcp, the-best-way-to-talk-to-your-agents, where-should-claude-opus-5-fit-in-your-model-rotation
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.83

## Assertions
- **Context engineering is a critical enterprise AI focus for 2026, involving the design of systems to ensure agents have access to the right data and can interoperate on it, which requires substantial organizational change management.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief) / Aaron Levy, episode `context-graphs-ais-next-big-idea`, fp `1277d9b62202396f`
- **Harness engineering is defined as the practice of leveraging configuration points (such as skills, MCP servers, sub-agents, and memory files) to customize and improve a coding agent's output quality and reliability.**
  - tier 2, confidence 0.9, source Kyle (humanlayer.dev) / AI Daily Brief Host, episode `harness-engineering-101`, fp `d4055c4721e713d6`
- **Harness engineering is a subset of context engineering that primarily involves leveraging harness configuration points to carefully manage the context window of coding agents.**
  - tier 2, confidence 0.85, source Kyle (humanlayer.dev) / AI Daily Brief Host, episode `harness-engineering-101`, fp `5e177accd5d1376a`
- **The agent landscape has evolved through three phases: the 'weights phase' (model scaling), the 'context phase' (prompt engineering/RAG), and the current 'harness engineering phase' (environment optimization).**
  - tier 2, confidence 0.85, source Akshay (via AI Daily Brief), episode `how-harness-as-a-service-will-change-agents`, fp `d63e694c96030c43`
- **Ramp reports that 99% of its employees use AI daily, but most were initially stuck due to painful and unintuitive setup processes involving terminal configs and MCP servers.**
  - tier 1, confidence 0.95, source Eric Glyman, Ramp Co-founder (cited by host), episode `how-the-best-companies-use-ai`, fp `df06c98490084373`
- **Ramp implements a 24-hour synthesis and cleanup pipeline that mines users' previous sessions and connects tools like Slack, Notion, and Calendar to maintain persistent memory and context for AI agents.**
  - tier 1, confidence 0.95, source Seb Go to Jen, Ramp (cited by host), episode `how-the-best-companies-use-ai`, fp `3a277c720e16df25`
- **Ramp's design principle for its AI tooling is to 'not limit anyone's upside,' rejecting the conventional approach of simplifying tools for non-technical users in favor of preserving full capability while making complexity invisible.**
  - tier 2, confidence 0.85, source Seb Go to Jen, Ramp (cited by host), episode `how-the-best-companies-use-ai`, fp `0a4e66b4b9065378`
- **The host predicts that the distinction between 'good,' 'medium,' and 'bad' AI users will disappear as organizations build harnesses that enable every employee to become an AI superuser, fundamentally changing the shape of enterprise AI adoption.**
  - tier 3, confidence 0.65, source Host (NLW), episode `how-the-best-companies-use-ai`, fp `681880498d17efa2`
- **Effective context curation for AI agents involves maintaining 3-5 focused, single-page files that are dated and updated regularly, rather than creating large, static documents.**
  - tier 2, confidence 0.9, source Nofar Gaspar, episode `how-to-build-a-personal-agentic-operating-system`, fp `51139cc24f4aff35`
- **Applied Compute found that the gap between having data and having data in a format usable by AI systems is enormous, as most enterprise data was not structured for AI consumption.**
  - tier 1, confidence 0.95, source Michael Chan (Applied Compute), episode `how-to-build-a-personal-context-mcp`, fp `3cc9a7d5c1001ff7`
- **Organizations that are lagging in AI adoption tend to operate without providing their AI systems access to relevant context, often just 'dropping copilot on people's heads' rather than becoming AI-native.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `8d49b19bde41dba0`
- **The AI Daily Brief host argues that the shift from Markdown to HTML for agent communication reflects a broader change in knowledge work, where the operator's role is shifting from producing final outputs to 'staging' or 'scaffolding' conditions for agents to execute tasks.**
  - tier 2, confidence 0.85, source AI Daily Brief host, episode `the-best-way-to-talk-to-your-agents`, fp `df22d980c215229f`
- **Anthropic removed 80% of the system prompt for Claude Opus 5 and Fable 5, finding that this resulted in zero change to coding benchmarks and reduced conflicts with user prompts.**
  - tier 1, confidence 0.95, source Tarek (Anthropic), episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `6c02450d20bba2e9`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - ### Current Landscape (2026)",
  "content": "  - ### Recent Developments and Industry Insights (2025-2026)\n\n    Recent practitioner discourse and industry reports have further refined the scope of context engineering, highlighting its critical role in enterprise AI adoption and the emergence of specialized sub-disciplines.\n\n    **Enterprise AI and the Context Gap**: Context engineering is increasingly identified as a primary focus for enterprise AI in 2026. Aaron Levy and industry analysts note that the central challenge is no longer just model capability, but \"designing our systems to get agents access to that data and ensuring that all of our agents can interoperate on that data.\" Michael Chan of Applied Compute emphasizes that \"the gap between we have data and we have data in a format that an AI system can learn from is enormous,\" as most enterprise data was never structured with AI consumption in mind. Organizations lagging in AI adoption are often characterized by \"dropping copilot on people's heads\" without providing their AI systems access to relevant context, whereas leading organizations are becoming \"AI-native\" by engineering the information environment proactively.\n\n    **Harness Engineering**: A new sub-discipline, \"harness engineering,\" has emerged as a specific subset of context engineering. Defined by Kyle of HumanLayer, it involves \"leveraging configuration points (such as skills, MCP servers, sub-agents, and memory files) to customize and improve a coding agent's output quality and reliability.\" This marks a shift in the agent landscape from the \"weights phase\" (model scaling) and the \"context phase\" (prompt engineering/RAG) to the current \"harness engineering phase,\" where the focus is on optimizing the agent's environment and configuration to manage the context window effectively.\n\n    **System Prompt Optimization**: Anthropic\u2019s recent work on Claude Opus 5 and Fable 5 revealed that removing 80% of the system prompt resulted in zero change to coding benchmarks. This finding suggests that previous system prompts were \"over-constraining\" the model and potentially conflicting with user prompts and skills, reinforcing the context engineering principle that less, more precise context often outperforms verbose, static instructions.\n\n    **Practical Context Curation**: Effective context curation for AI agents is shifting away from large, static documents toward dynamic, focused resources. Nofar Gaspar advises maintaining \"three to five focused files, each on a single page,\" that are \"dated and fresh, and updated when things change.\" This approach ensures that the context provided to agents remains relevant and actionable, reducing the risk of context rot and distraction.\n\n    **Tooling and User Experience**: Industry leaders like Ramp are rethinking how AI tools are deployed. Eric Glyman, Ramp\u2019s co-founder, notes that while 99% of employees use AI daily, many were initially \"stuck\" due to \"painful and unintuitive setup processes\" involving terminal configs and MCP servers. Ramp\u2019s design principle is to \"not limit anyone's upside,\" making complexity invisible while preserving full capability, rather than simplifying tools for non-technical users. Under the hood, Ramp implements a 24-hour synthesis and cleanup pipeline that mines users' previous sessions and connects tools like Slack, Notion, and Calendar to maintain persistent memory and context for AI agents.\n\n    **Shift in Knowledge Work**: The evolution of agent communication formats, such as the shift from Markdown to HTML, reflects a broader change in knowledge work. The operator\u2019s role is shifting from \"producing a thing\" to \"staging\" or \"scaffolding\" conditions for agents to execute tasks, a fundamental redefinition of human-AI collaboration that is central to the practice of context engineering."
}
```

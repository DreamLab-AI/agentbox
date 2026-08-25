# Dossier: Knowledge Representation

- status: `candidate_rejected`
- target page: `Knowledge Representation.md`
- assertions: 7 across episodes: autoresearch-agent-loops-and-the-future-of-work, context-graphs-ais-next-big-idea, how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, how-i-built-my-10-agent-openclaw-team, how-to-get-the-most-from-ai-this-summer, the-self-driving-company
- reasons: rubric_b_improvement -1.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -1.0
- answer-completeness: 1.00

## Assertions
- **The role of the human in agentic research loops is shifting from direct code execution to 'arena design,' which involves writing strategy documents (like program.md) and constructing objective evaluation metrics for the agent.**
  - tier 2, confidence 0.88, source Podcast Host / Andrej Karpathy, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `c23e09146fe0ed65`
- **Current agentic loops are limited by the lack of a shared semantic memory layer across multiple agents, preventing them from efficiently sharing negative results and coordinating on complex, multi-branch research directions.**
  - tier 2, confidence 0.82, source Heron / Kathy F (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `a15af5345a214422`
- **The concept of 'context graphs' is defined as a living record of decision traces stitched across entities in time, capturing the 'why' behind business decisions rather than just the 'what'.**
  - tier 2, confidence 0.95, source Jay Gupta and Ashu Garg (Foundation Capital), episode `context-graphs-ais-next-big-idea`, fp `59ab619d317d0325`
- **By the end of 2026, early 'glimmers' of AI agents that can fully onboard onto an organization, understand complex relationship dynamics, and autonomously pick up work will emerge, though full autonomy is not yet expected.**
  - tier 3, confidence 0.6, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `c68f22f67a8ef4da`
- **OpenClaw agents are configured using a set of specific markdown files, including 'soul.md' for personality, 'agents.md' for operating instructions, and 'user.md' for user preferences.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `adbaf3c8812c2755`
- **Building a 'Personal Brain' or global identity context for AI assistants involves creating a 150-300 word instruction block that persists across sessions to provide consistent user context.**
  - tier 2, confidence 0.85, source AI Daily Brief Host, episode `how-to-get-the-most-from-ai-this-summer`, fp `2ceab9d5134a7ef9`
- **The fundamental prerequisite for a 'self-driving company' is not just having capable AI agents, but integrating those agents with all existing organizational systems and data sources.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `the-self-driving-company`, fp `84235a5ceb66ac91`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Hamilton, W. et al. (2017). Representation Learning on Graphs: Methods and Applications. IEEE Data Engineering Bulletin, 40(3), 52-74.",
  "content": "\n\n  #### Recent Developments\n  - **Context Graphs and Decision Lineage**: The concept of 'context graphs' has emerged as a living record of decision traces stitched across entities in time, capturing the 'why' behind business decisions rather than just the 'what'. This distinguishes them from traditional systems of record, which capture state (what happened) but not decision lineage (why it was allowed). [source: Jay Gupta and Ashu Garg (Foundation Capital), confidence 0.95, tier 2]\n  - **Semantic Memory for Agentic Swarms**: Current agentic loops are limited by the lack of a shared semantic memory layer across multiple agents, preventing them from efficiently sharing negative results and coordinating on complex, multi-branch research directions. The 'missing layer' is a semantic memory layer underneath the branches so that agents can recognize previously explored directions. [source: Heron / Kathy F (via podcast transcript), confidence 0.82, tier 2]\n  - **Shift to 'Arena Design'**: The role of the human in agentic research loops is shifting from direct code execution to 'arena design,' which involves writing strategy documents (like program.md) and constructing objective evaluation metrics for the agent. The human's job becomes writing a better memo, while the agent's job is to execute research within the frame the memo sets. [source: Podcast Host / Andrej Karpathy, confidence 0.88, tier 2]\n  - **Organizational Integration as Prerequisite**: The fundamental prerequisite for a 'self-driving company' is not just having capable AI agents, but integrating those agents with all existing organizational systems and data sources. Without access to the systems that drive the company, there is no way for an agent to help the company become self-driving. [source: Host (AI Daily Brief), confidence 0.85, tier 2]\n  - **Agent Configuration Standards**: OpenClaw agents are configured using a set of specific markdown files, including 'soul.md' for personality, 'agents.md' for operating instructions, and 'user.md' for user preferences. This structure allows for persistent, consistent agent behavior and user context. [source: Host (AI Daily Brief), confidence 0.95, tier 1]\n  - **Personal Brain and Global Identity**: Building a 'Personal Brain' or global identity context for AI assistants involves creating a 150-300 word instruction block that persists across sessions to provide consistent user context. Projects like 'Pack Your ID' instruct users to have the AI draft a 'paste-ready global ID block' and install it, ensuring future chats start with knowledge of the user's preferences and background. [source: AI Daily Brief Host, confidence 0.85, tier 2]\n  - **2026 Autonomy Trajectory**: By the end of 2026, early 'glimmers' of AI agents that can fully onboard onto an organization, understand complex relationship dynamics, and autonomously pick up work are expected to emerge, though full autonomy is not yet anticipated. [source: Mike Kger (Chief Product Officer, Anthropic), confidence 0.6, tier 3]"
}
```

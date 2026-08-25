# Dossier: Multi-Agent Systems

- status: `candidate_rejected`
- target page: `Multi-Agent Systems.md`
- assertions: 8 across episodes: first-impressions-of-the-new-opus-48, gemini-can-now-write-you-a-song, openclaw-goes-to-openai, the-ai-acceleration-gap, the-dawn-of-the-agent-age, the-most-important-ai-news-from-google-io, what-the-heck-is-graph-engineering, why-ai-leads-to-more-work-not-less
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Anthropic's 'Dynamic Workflows' feature in Claude Code allows Opus 4.8 to orchestrate hundreds of parallel sub-agents, demonstrated by a 11-day migration of 750,000 lines of code from Zig to Rust with 99.8% test pass rate.**
  - tier 1, confidence 0.9, source Anthropic / Developer Jared Sumner (reported by host), episode `first-impressions-of-the-new-opus-48`, fp `4e866b2d30a2d150`
- **xAI released Grok Heavy 16, a model variant that utilizes 16 sub-agents to debate responses before providing a final answer, increasing from the 4 sub-agents in Grok 4.2.**
  - tier 1, confidence 0.95, source Podcast Host (citing xAI announcement), episode `gemini-can-now-write-you-a-song`, fp `a0f65b684ab6a724`
- **The future of AI will be 'extremely multi-agent,' with very smart agents interacting with each other to perform useful tasks for people, and OpenAI intends to make this a core part of its product offerings.**
  - tier 3, confidence 0.8, source Sam Altman (cited by host), episode `openclaw-goes-to-openai`, fp `12663d764e49d81e`
- **New York Times columnist Kevin Roose described a 'yawning inside outside gap' in AI adoption, noting that San Francisco users are deploying multi-agent Claude swarms while others are still seeking approval to use Copilot in Teams.**
  - tier 2, confidence 0.95, source Kevin Roose (via AI Daily Brief host), episode `the-ai-acceleration-gap`, fp `d216f3cf2ce723c1`
- **Kevin Roose of the New York Times identified a 'yawning inside outside gap' in AI adoption, where early adopters in San Francisco are using multi-agent swarms while many knowledge workers are still struggling to get approval for basic AI tools.**
  - tier 2, confidence 0.9, source Kevin Roose (New York Times), episode `the-dawn-of-the-agent-age`, fp `7d17e5f7af5bc0cd`
- **Google's Antigravity 2.0 was demonstrated by rebuilding the core framework of a working operating system using 93 sub-agents and processing billions of tokens over approximately 12 hours.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `the-most-important-ai-news-from-google-io`, fp `8917e5958324333d`
- **Graph engineering is the discipline of designing how multiple agents, tools, knowledge sources, and humans interact and connect within an agentic system, distinct from loop engineering which focuses on single-agent iteration.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `what-the-heck-is-graph-engineering`, fp `bb64214894c8a3cc`
- **Anthropic's agentic coding trends report predicts that multi-agent systems will replace single-agent workflows, a trend the host notes is currently visible in the rise of tools like Open Claw.**
  - tier 2, confidence 0.85, source Anthropic (Agentic Coding Trends Report) and Host, episode `why-ai-leads-to-more-work-not-less`, fp `df6dc9ab7e03a21c`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Current Landscape (2026)",
  "content": "- ### Recent Developments\n  - **Anthropic Dynamic Workflows (Claude Code)**: Anthropic's 'Dynamic Workflows' feature in Claude Code allows Opus 4.8 to orchestrate hundreds of parallel sub-agents. This capability was demonstrated by a 11-day migration of 750,000 lines of code from Zig to Rust, achieving a 99.8% test pass rate. The feature utilizes adversarial agents to check outputs and allows Opus to select models for subtasks based on complexity. Anthropic's Dickson Tsai has cited this as the most significant Claude Code innovation in 2026 so far.\n  - **xAI Grok Heavy 16**: xAI released Grok Heavy 16, a model variant that utilizes 16 sub-agents to debate responses before providing a final answer, increasing from the 4 sub-agents used in Grok 4.2. This approach aims to improve answer quality through multi-agent deliberation, albeit at a higher token cost.\n  - **OpenAI's Multi-Agent Vision**: Sam Altman stated that the future of AI will be 'extremely multi-agent,' with very smart agents interacting to perform useful tasks. OpenAI intends to make this a core part of its product offerings, emphasizing the importance of open source support in this transition.\n  - **Adoption Gap**: New York Times columnist Kevin Roose described a 'yawning inside outside gap' in AI adoption, noting that while San Francisco users are deploying multi-agent Claude swarms, many knowledge workers elsewhere are still seeking approval to use basic tools like Copilot in Teams.\n  - **Google Antigravity 2.0**: Google demonstrated Antigravity 2.0 by rebuilding the core framework of a working operating system using 93 sub-agents. The operation processed billions of tokens over approximately 12 hours, showcasing the scale of modern multi-agent orchestration.\n  - **Graph Engineering**: The discipline of 'graph engineering' has emerged, distinct from loop engineering. While loop engineering focuses on single-agent iteration, graph engineering involves designing how multiple agents, tools, knowledge sources, and humans interact and connect within an agentic system.\n  - **Trend Prediction**: Anthropic's agentic coding trends report predicts that multi-agent systems will replace single-agent workflows. This trend is currently visible in the rise of tools like Open Claw, which provide a preview of this architectural shift.\n\n- ### Current Landscape (2026)"
}
```

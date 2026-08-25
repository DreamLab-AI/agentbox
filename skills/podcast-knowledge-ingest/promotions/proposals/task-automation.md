# Dossier: Task Automation

- status: `candidate_survivor`
- target page: `Task Automation.md`
- assertions: 9 across episodes: autoresearch-agent-loops-and-the-future-of-work, how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, how-to-help-ai-do-your-work-better, how-to-help-people-thrive-with-ai

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.67

## Assertions
- **Boris Cherny, creator of Claude Code, released a '/loop' feature on March 7, 2025, allowing users to schedule recurring agentic tasks for up to 3 days, such as auto-fixing build issues or summarizing Slack posts.**
  - tier 1, confidence 0.92, source Boris Cherny (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `9e15edaf2aef81be`
- **Agentic loops are emerging as a fundamental 'work primitive' that will be applied across various industries, not just software development, provided the task has an objective score, fast iteration, and low cost for failed attempts.**
  - tier 2, confidence 0.85, source Podcast Host, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `875dff316d218d80`
- **Business functions with measurable outcomes and fast feedback loops, such as advertising, cold outreach, and A/B testing, will be among the first to adopt agentic loops, potentially increasing experiment volume from dozens to thousands per year.**
  - tier 3, confidence 0.72, source Podcast Host / Eric (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `eb588a27906c0977`
- **Anthropic renamed its underlying SDK from 'Claude Code' to 'Claude Agent SDK' after observing that users were applying the tool to non-coding tasks such as bioinformatics, data science, and project management.**
  - tier 1, confidence 0.9, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `54fadaf1e285868f`
- **Anthropic's strategy for 2026 involves enabling AI to 'reliably take work off your plate' by delegating clean, well-defined job functions (like report preparation) to agents, moving beyond simple chat interactions.**
  - tier 2, confidence 0.85, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `6b66ff764f3b4264`
- **The 'vibe coding' phenomenon, which began in February 2025, is still in an early adoption phase where even heavy users are only just beginning to habitually replace traditional tools (like spreadsheets) with AI-generated applications.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief) & Mike Kger, episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `3918cff76480e7da`
- **The 'tool versus colleague' debate is a false binary; the realistic trajectory for 2026 is AI taking on 'clean' job functions with clear inputs and outputs, rather than becoming a fully autonomous generalist colleague.**
  - tier 3, confidence 0.6, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `fa009ab4bc0709a6`
- **The 'AI deputization audit' proposes a five-dimension scoring system (frequency/time, teachability, checkability, stakes, and personal integralness) to determine which work tasks are best suited for AI automation, categorizing them into 'deputize' (8-10), 'duet' (4-7), or 'defend' (0-3) tiers.**
  - tier 2, confidence 0.9, source AI Daily Brief host, episode `how-to-help-ai-do-your-work-better`, fp `1eb03a5923beed19`
- **Researchers from UC Berkeley's Haas School of Business found that when using AI, workers started taking on tasks they had previously outsourced, such as coding and engineering, because these activities became easier to do.**
  - tier 1, confidence 0.9, source UC Berkeley's Haas School of Business, episode `how-to-help-people-thrive-with-ai`, fp `b6273ab7c5a9f857`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - It is a building block for larger automation efforts; combining automated tasks into coordinated sequences leads to workflow and business process automation.",
  "content": "\n\n- ### Recent Developments\n  - **Agentic Loops as a Work Primitive**: Boris Cherny, creator of Claude Code, released a `/loop` feature on March 7, 2025, enabling users to schedule recurring agentic tasks for up to 3 days (e.g., auto-fixing build issues or summarizing Slack posts). This pattern is emerging as a fundamental \"work primitive\" applicable across industries, provided the task has an objective score, fast iteration, and low cost for failed attempts.\n  - **Expansion Beyond Coding**: Anthropic renamed its underlying SDK from 'Claude Code' to 'Claude Agent SDK' after observing users applying the tool to non-coding tasks such as bioinformatics, data science, and project management. This shift reflects a broader strategy for 2026 to enable AI to \"reliably take work off your plate\" by delegating clean, well-defined job functions (like report preparation) to agents.\n  - **Early Adoption of 'Vibe Coding'**: The 'vibe coding' phenomenon, which began in February 2025, remains in an early adoption phase. Even heavy users are only just beginning to habitually replace traditional tools (like spreadsheets) with AI-generated applications, citing a lag in unwinding decades of established workflows.\n  - **Strategic Frameworks for Automation**: The 'AI deputization audit' proposes a five-dimension scoring system (frequency/time, teachability, checkability, stakes, and personal integralness) to categorize tasks into 'deputize' (8-10), 'duet' (4-7), or 'defend' (0-3) tiers. Meanwhile, business functions with measurable outcomes and fast feedback loops, such as advertising and A/B testing, are expected to be among the first to adopt agentic loops, potentially increasing experiment volume from dozens to thousands per year.\n  - **Impact on Task Allocation**: Research from UC Berkeley's Haas School of Business indicates that AI lowers the barrier to entry for technical tasks, leading workers to internalize previously outsourced activities such as coding and engineering."
}
```

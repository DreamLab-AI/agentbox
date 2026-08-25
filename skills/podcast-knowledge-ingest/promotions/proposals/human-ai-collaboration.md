# Dossier: Human-AI Collaboration

- status: `candidate_survivor`
- target page: `Human-AI Collaboration.md`
- assertions: 7 across episodes: beating-the-ai-doom-cycle, can-todays-ai-replace-12-of-work, how-to-learn-ai-with-ai, towards-ai-that-can-actually-interact, why-2026-is-the-year-of-the-ai-builder-with-lovable-ceo-anton-osika, why-everyone-is-obsessed-with-claude-code, work-agi-is-the-only-agi-that-matters

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 1.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **OpenAI and Anthropic are launching massive consulting efforts and joint centers of excellence with firms like Accenture, Deloitte, and PwC to bridge the gap between AI capabilities and corporate integration, certifying thousands of professionals.**
  - tier 2, confidence 0.8, source AI Daily Brief Host / Paul Bloom, episode `beating-the-ai-doom-cycle`, fp `4193b569cdcd894a`
- **Anthropic engineers are developing 'intuitions for AI delegation,' preferring to delegate easily verifiable tasks to build trust before handling complex work.**
  - tier 2, confidence 0.88, source Anthropic Economic Index / Host Analysis, episode `can-todays-ai-replace-12-of-work`, fp `0c103b00f75ab85d`
- **The host identifies a trend where users are shifting from drafting content themselves and having AI comment, to letting AI draft first and then reacting, leveraging the AI's "near infinite output capacity" to explore ideas broadly.**
  - tier 3, confidence 0.65, source Host (AI Daily Brief), episode `how-to-learn-ai-with-ai`, fp `27b0124d7390e7b7`
- **Thinking Machines Lab argues that current AI systems create a 'collaboration bottleneck' because they experience reality in a single thread, forcing users to batch thoughts and adapt to the model rather than the interface adapting to the user.**
  - tier 2, confidence 0.9, source Thinking Machines Lab, episode `towards-ai-that-can-actually-interact`, fp `4283cf1c4e4b6782`
- **The most valuable skills for software engineers in the AI era will be the ability to reason about complex systems with AI assistance and to exercise human creativity and judgment in user experience design.**
  - tier 2, confidence 0.8, source Anton Osika, CEO of Lovable, episode `why-2026-is-the-year-of-the-ai-builder-with-lovable-ceo-anton-osika`, fp `799e9d39905093fe`
- **Ethan Mollick argued that managing AI agents is fundamentally a management problem requiring teachable skills such as specifying goals, providing context, and dividing tasks.**
  - tier 2, confidence 0.85, source Ethan Mollick, episode `why-everyone-is-obsessed-with-claude-code`, fp `5eac3c6b3d9658fb`
- **The host argues that the current state of AI represents 'task AGI,' where AI excels at specific, discrete tasks but struggles with long strings of tasks requiring human oversight.**
  - tier 3, confidence 0.7, source AI Daily Brief Host, episode `work-agi-is-the-only-agi-that-matters`, fp `d8e9dd251c5c5261`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- Teaming with autonomous systems where [[Human Oversight]] remains essential.",
  "content": "- Teaming with autonomous systems where [[Human Oversight]] remains essential.\n- ### Recent Developments\n- **Enterprise Integration & Consulting:** OpenAI and Anthropic are launching massive consulting efforts and joint centers of excellence with firms like Accenture, Deloitte, and PwC to bridge the gap between AI capabilities and corporate integration, certifying thousands of professionals (e.g., 30,000 PwC professionals on Claude). [source: AI Daily Brief Host / Paul Bloom, confidence 0.8, tier 2]\n- **Delegation Heuristics:** Anthropic engineers are developing 'intuitions for AI delegation,' preferring to delegate easily verifiable tasks to build trust before handling complex work, describing a trust progression that starts with simple tasks. [source: Anthropic Economic Index / Host Analysis, confidence 0.88, tier 2]\n- **Workflow Inversion:** A trend is emerging where users shift from drafting content themselves and having AI comment, to letting AI draft first and then reacting, leveraging the AI's \"near infinite output capacity\" to explore ideas broadly. [source: Host (AI Daily Brief), confidence 0.65, tier 3]\n- **Collaboration Bottlenecks:** Thinking Machines Lab argues that current AI systems create a 'collaboration bottleneck' because they experience reality in a single thread, forcing users to batch thoughts and adapt to the model rather than the interface adapting to the user. [source: Thinking Machines Lab, confidence 0.9, tier 2]\n- **Evolving Skill Sets:** The most valuable skills for software engineers in the AI era are identified as the ability to reason about complex systems with AI assistance and to exercise human creativity and judgment in user experience design. [source: Anton Osika, CEO of Lovable, confidence 0.8, tier 2]\n- **Management as a Core Skill:** Ethan Mollick argues that managing AI agents is fundamentally a management problem requiring teachable skills such as specifying goals, providing context, dividing tasks, and giving feedback. [source: Ethan Mollick, confidence 0.85, tier 2]\n- **Task AGI Limitations:** The current state of AI is described as 'task AGI,' where AI excels at specific, discrete tasks but struggles with long strings of tasks requiring continuous human oversight. [source: AI Daily Brief Host, confidence 0.7, tier 3]"
}
```

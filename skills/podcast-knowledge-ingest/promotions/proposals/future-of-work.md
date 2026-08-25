# Dossier: Future Of Work

- status: `candidate_survivor`
- target page: `Future Of Work.md`
- assertions: 10 across episodes: claude-code-is-now-writing-claude-code, fable-5-raises-the-bar-for-ai-ambition, how-significant-are-ais-latest-math-breakthroughs, how-to-learn-ai-with-ai, the-new-jobs-ai-will-create, what-1250-professionals-said-about-working-with-ai, where-the-economy-thrives-after-ai, why-ai-leads-to-more-work-not-less, why-claude-opus-45-changes-whats-possible-with-vibe-coding

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.70

## Assertions
- **Developers who fail to adopt the new AI-assisted programming paradigms are experiencing a 'skill issue' that limits their potential productivity by a factor of 10.**
  - tier 3, confidence 0.7, source Andrej Karpathy, episode `claude-code-is-now-writing-claude-code`, fp `3dc52150c95b2930`
- **AI applications in 2027 will look fundamentally different from those in 2026 due to the shift from task-based to responsibility-based AI interactions.**
  - tier 3, confidence 0.6, source Felix Ryberg (Anthropic), episode `fable-5-raises-the-bar-for-ai-ambition`, fp `76bd22de5c61b1e9`
- **The 'narrow superintelligence' of models like Astra, which can be far smarter than humans in specific areas like math while remaining limited elsewhere, will lead to a 'strange dynamic' where the hardest work is automated first.**
  - tier 3, confidence 0.7, source AI Daily Brief Host / Prince (AI Commentator), episode `how-significant-are-ais-latest-math-breakthroughs`, fp `6ffeb2c2360c9812`
- **The host predicts that the "agent first" work paradigm will become the standard for technical tasks, driven by the rapid improvement in AI capabilities and the shift in how companies like OpenAI structure their internal workflows.**
  - tier 3, confidence 0.6, source Host (AI Daily Brief), episode `how-to-learn-ai-with-ai`, fp `c169de5d0c61502a`
- **The host asserts that the AI jobs question is fundamentally an AI economy question that must be discussed in terms of both labor supply and demand, arguing that increased AI supply will drive increased demand and thus more human work.**
  - tier 2, confidence 0.95, source AI Daily Brief Host, episode `the-new-jobs-ai-will-create`, fp `8e892c09b5e87f78`
- **The host argues that upskilling and retraining programs must be designed with the understanding that specific skills may be obsoleted by future AI models, such as GPT-7.**
  - tier 3, confidence 0.55, source Host (AI Daily Brief), episode `what-1250-professionals-said-about-working-with-ai`, fp `889bf7c6adcbd340`
- **The durable jobs of the future will be in the relational sector, including roles such as nurses, therapists, teachers, and experience designers, where the human element is the product itself.**
  - tier 3, confidence 0.7, source Alex Imas, episode `where-the-economy-thrives-after-ai`, fp `0795b2748230feea`
- **NLW predicts that the current anxiety over AI-driven job loss will be viewed in 10-30 years as a significant misplacement of collective energy, as the economy transforms rather than collapses.**
  - tier 3, confidence 0.6, source NLW (Host), episode `where-the-economy-thrives-after-ai`, fp `85f3cb1e5be20e86`
- **The host predicts that in 2026, organizations will hire 'vibe coders' specifically to work on non-engineering issues, acting as internal deployed agents to help people in different parts of the organization solve problems.**
  - tier 3, confidence 0.65, source Host (AI Daily Brief), episode `why-ai-leads-to-more-work-not-less`, fp `00367fc5fefe7024`
- **Software engineering as a profession may be largely automated by the first half of next year, with generated code becoming as unchecked as compiler output.**
  - tier 3, confidence 0.6, source Adam Wolf (Anthropic), episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `5cc62f454a2463f8`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - updated:: 2026-06-15",
  "content": "\n- ### Recent Developments\n  - **Productivity and Skill Gaps**: Andrej Karpathy argues that developers failing to adopt new AI-assisted programming paradigms face a \"skill issue\" that limits their potential productivity by a factor of 10, suggesting that the failure to claim this boost is a critical professional gap. [source: Andrej Karpathy, confidence 0.7, tier 3]\n  - **Shift to Responsibility-Based AI**: Felix Ryberg (Anthropic) predicts that AI applications in 2027 will look fundamentally different from those in 2026 due to a shift from task-based to responsibility-based AI interactions. [source: Felix Ryberg (Anthropic), confidence 0.6, tier 3]\n  - **Narrow Superintelligence and Automation Dynamics**: Commentators note that \"narrow superintelligence\" in models like Astra creates a \"strange dynamic\" where the hardest, most verifiable work (such as math and code) is automated first, even if it is high-value, leading to a duality where AI solves hard problems while humans struggle to verify results. [source: AI Daily Brief Host / Prince (AI Commentator), confidence 0.7, tier 3]\n  - **Agent-First Work Paradigm**: The \"agent first\" work paradigm is predicted to become the standard for technical tasks, driven by rapid AI capability improvements and shifts in how companies like OpenAI structure internal workflows. [source: Host (AI Daily Brief), confidence 0.6, tier 3]\n  - **AI Economy and Labor Demand**: The AI jobs question is fundamentally an AI economy question that must consider both labor supply and demand; increased AI supply is expected to drive increased demand, resulting in more human work even in scenarios involving AGI. [source: AI Daily Brief Host, confidence 0.95, tier 2]\n  - **Upskilling Obsolescence**: Retraining programs must account for the rapid obsolescence of specific skills by future models (e.g., GPT-7), making static training designs less effective. [source: Host (AI Daily Brief), confidence 0.55, tier 3]\n  - **Durable Jobs in the Relational Sector**: Durable future jobs are expected to be in the relational sector (nurses, therapists, teachers, experience designers), where the human element is the product, rather than in transitional roles like prompt engineering or AI monitoring. [source: Alex Imas, confidence 0.7, tier 3]\n  - **Perspective on AI Anxiety**: Current anxiety over AI-driven job loss is predicted to be viewed in 10-30 years as a significant misplacement of collective energy, as the economy transforms rather than collapses. [source: NLW (Host), confidence 0.6, tier 3]\n  - **Rise of 'Vibe Coders'**: Organizations are predicted to hire \"vibe coders\" specifically for non-engineering issues, acting as internal deployed agents to help various departments solve problems using software. [source: Host (AI Daily Brief), confidence 0.65, tier 3]\n  - **Automation of Software Engineering**: Software engineering as a profession may be largely automated by the first half of next year, with generated code becoming as unchecked as compiler output. [source: Adam Wolf (Anthropic), confidence 0.6, tier 3]"
}
```

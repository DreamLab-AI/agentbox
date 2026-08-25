# Dossier: Model Architecture

- status: `candidate_rejected`
- target page: `Model Architecture.md`
- assertions: 7 across episodes: everything-you-need-to-know-about-ai-tokens, gpt-52-is-here, gpt-54-first-test-results, how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, how-the-escalating-ai-wars-benefit-you, how-to-get-the-most-out-of-fable-5-and-gpt-56-sol, towards-ai-that-can-actually-interact
- reasons: rubric_b_improvement -1.0 <= 0.0; rubric_a_improvement -1.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -1.0
- rubric-B improvement (after vs before): -1.0
- answer-completeness: 0.86

## Assertions
- **Anthropic's Opus 4.7 model introduced a new tokenizer that produced approximately 30% more tokens for the same text compared to the previous model, despite identical pricing per million tokens.**
  - tier 1, confidence 0.9, source Nofar Gaspar (citing Anthropic documentation and independent analysis), episode `everything-you-need-to-know-about-ai-tokens`, fp `e3ce881afb44d628`
- **GPT 5.2 demonstrates significantly improved long-context retention, maintaining performance above 90% at 256K context length, whereas GPT 5.1 degraded from 90% at 8K to less than 50% at 256K.**
  - tier 1, confidence 0.9, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `65855bbff4046521`
- **GPT-5.4 features a 1 million token context window, which was confirmed after earlier rumors suggested a 2 million token limit.**
  - tier 1, confidence 0.9, source The Information / OpenAI, episode `gpt-54-first-test-results`, fp `1b51a245c16f691f`
- **A significant barrier to enterprise AI adoption is that many organizations are 'harness-bound,' meaning their custom scaffolding and integration layers limit the model's potential rather than the model's raw capabilities.**
  - tier 2, confidence 0.85, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `160305380c63e432`
- **The race to find alternative AI architectures will continue, and the shift to cheaper, smarter systems is likely to be slower than many expect because most firms are still focused on basic adoption of current frontier models.**
  - tier 3, confidence 0.65, source AI Daily Brief Host, episode `how-the-escalating-ai-wars-benefit-you`, fp `4b9529e325c8bfaf`
- **GPT-5.6 introduces a two-dial system for compute allocation: model size (Sole, Terra, Luna) and thinking effort (six levels from none to max).**
  - tier 1, confidence 0.95, source OpenAI (via AI content creator Ollie Leeman's summary of the official guide), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `d4653fb784e29562`
- **Thinking Machines Lab's interaction model architecture consists of a two-part system: a real-time interaction model that stays present with the user and a background model that handles longer reasoning, browsing, and agentic work.**
  - tier 1, confidence 0.95, source Thinking Machines Lab, episode `towards-ai-that-can-actually-interact`, fp `84422ccefe443ad7`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Open challenges as of 2026 include the SSM in-context recall gap (exact long-range retrieval remains weak versus attention), MoE routing stability and load balancing, and the serving-infrastructure shift to data-parallel attention plus expert-parallel MoE (e.g. vLLM wide expert-parallelism) needed to run these sparse trillion-parameter models economically.",
  "content": "\n\n- ### Recent Developments (2026)\n  - **GPT-5.6 Compute Allocation**: OpenAI's GPT-5.6 introduces a two-dial system for compute allocation, separating model size (Sole for hardest problems, Terra for everyday business, Luna for cheap/fast tasks) from thinking effort (six levels from none to max).\n  - **Long-Context Retention Improvements**: GPT-5.2 demonstrates significantly improved long-context retention, maintaining performance above 90% at 256K context length, whereas GPT-5.1 degraded from 90% at 8K to less than 50% at 256K.\n  - **GPT-5.4 Context Window**: GPT-5.4 features a confirmed 1 million token context window, resolving earlier rumors of a 2 million token limit.\n  - **Tokenizer Efficiency Shifts**: Anthropic's Opus 4.7 introduced a new tokenizer that produces approximately 30% more tokens for the same text compared to the previous model, despite identical pricing per million tokens, with independent analyses suggesting token growth between 32% and 45%.\n  - **Enterprise Adoption Barriers**: A significant barrier to enterprise AI adoption is identified as being 'harness-bound,' where custom scaffolding and integration layers limit model potential rather than the model's raw capabilities.\n  - **Thinking Machines Lab Architecture**: Thinking Machines Lab's interaction model architecture consists of a two-part system: a real-time interaction model that stays present with the user and a background model that handles longer reasoning, browsing, and agentic work.\n  - **Adoption Pace**: The shift to cheaper, smarter alternative architectures is expected to be slower than anticipated, as most firms remain focused on basic adoption of current frontier models rather than advanced architectural changes."
}
```

# Dossier: Model Routing Architecture

- status: `candidate_survivor`
- target page: `Model Routing Architecture.md`
- assertions: 6 across episodes: the-openclaw-ification-of-ai, the-right-way-to-worry-about-ai, why-ai-hasnt-increased-unemployment-according-to-anthropic, why-ai-users-are-raving-about-glm-52, why-only-ai-training-can-save-the-economy

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Perplexity CEO Aravind Srinivas stated that Perplexity Computer provides access to 19 different AI models, allowing the system to match specific tasks to the most suitable model.**
  - tier 1, confidence 0.9, source Aravind Srinivas, episode `the-openclaw-ification-of-ai`, fp `13e8466d27d6237e`
- **Stripe has entered exclusive talks to acquire the model routing startup OpenRouter for approximately $10 billion.**
  - tier 1, confidence 0.9, source The Information, episode `the-right-way-to-worry-about-ai`, fp `02d3e59287144b23`
- **Stripe is in talks to acquire OpenRouter for approximately $10 billion, a significant increase from OpenRouter's $1.3 billion valuation in May.**
  - tier 1, confidence 0.95, source Wall Street Journal (reported by AI Daily Brief host), episode `why-ai-hasnt-increased-unemployment-according-to-anthropic`, fp `bac6cc8782ef0a74`
- **Cursor's model router claims to deliver frontier-level performance at a 60% reduction in cost when set to intelligence mode.**
  - tier 2, confidence 0.85, source Cursor (reported by AI Daily Brief host), episode `why-ai-hasnt-increased-unemployment-according-to-anthropic`, fp `24c4c3a5f01251cb`
- **The combination of intense workloads, compute shortages, and the viability of models slightly behind the state-of-the-art is driving a flowering of diverse model architectures and setups within companies.**
  - tier 3, confidence 0.55, source AI Daily Brief host, episode `why-ai-users-are-raving-about-glm-52`, fp `d8607ece9a71dcb7`
- **Factory's CEO Matan Grinberg stated that the company's new model routing feature saved $13 million in the first 30 days of its private preview by routing tasks to cheaper models.**
  - tier 1, confidence 0.9, source Matan Grinberg (Factory CEO) (cited by Host), episode `why-only-ai-training-can-save-the-economy`, fp `a0e1b8cfc24b36b8`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Relationships",
  "content": "- ### Recent Developments\n  - **[Industry analysis]** Perplexity CEO Aravind Srinivas stated that Perplexity Computer provides access to 19 different AI models, allowing the system to match specific tasks to the most suitable model. *(Source: Aravind Srinivas, via AI Daily Brief, 2026-08-24)*\n  - **[Industry analysis]** Stripe has entered exclusive talks to acquire the model routing startup OpenRouter for approximately $10 billion, a significant increase from OpenRouter's $1.3 billion valuation in May. *(Source: The Information / Wall Street Journal, via AI Daily Brief, 2026-08-24)*\n  - **[Industry analysis]** Cursor's model router claims to deliver frontier-level performance at a 60% reduction in cost when set to intelligence mode, though these results were measured using subjective satisfaction metrics. *(Source: Cursor, via AI Daily Brief, 2026-08-24)*\n  - **[Industry analysis]** Factory's CEO Matan Grinberg stated that the company's new model routing feature saved $13 million in the first 30 days of its private preview by routing tasks to cheaper models. *(Source: Matan Grinberg, via AI Daily Brief, 2026-08-24)*\n  - **[Industry analysis]** The combination of intense workloads, compute shortages, and the viability of models slightly behind the state-of-the-art is driving a flowering of diverse model architectures and setups within companies. *(Source: AI Daily Brief host, 2026-08-24)*\n- ### Relationships"
}
```

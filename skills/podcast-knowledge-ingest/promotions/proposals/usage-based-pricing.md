# Dossier: Usage-Based Pricing

- status: `candidate_survivor`
- target page: `Usage-Based Pricing.md`
- assertions: 6 across episodes: the-ai-subsidy-era-is-over, the-way-we-use-ai-is-changing, the-week-ai-grew-up, what-vibe-coding-is-turning-into, why-only-ai-training-can-save-the-economy

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **GitHub Copilot is shifting from a request-based pricing model to a consumption-based credit system effective June 1, 2026, with a preview period in May.**
  - tier 1, confidence 0.98, source Microsoft GitHub / Mario Rodriguez, episode `the-ai-subsidy-era-is-over`, fp `19de6084477ff866`
- **Anthropic's revenue run rate increased from $3 million last year to $47 billion currently, driven by a shift from seat-based pricing to usage-based pricing for AI agents.**
  - tier 1, confidence 0.85, source AI Daily Brief host (citing industry data), episode `the-way-we-use-ai-is-changing`, fp `2a091fa7e468a738`
- **The 'token subsidy era' is ending, transitioning into a 'token scarcity era' where AI business models are shifting to charge for actual token consumption, fundamentally changing how value is captured and distributed.**
  - tier 3, confidence 0.6, source AI Daily Brief host, episode `the-way-we-use-ai-is-changing`, fp `2ece0ca02e0f5fed`
- **Microsoft's per-user business models, including productivity, coding, and security, will transition to per-user and usage-based models.**
  - tier 1, confidence 0.95, source Satya Nadella (Microsoft CEO), episode `the-week-ai-grew-up`, fp `a37edb6432033308`
- **Perplexity charges enterprises for 'Computer' on a usage-based model rather than a seat-based model, citing variable underlying costs for different task types such as video generation versus text memos.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `what-vibe-coding-is-turning-into`, fp `4fbe9afb7f3b8e15`
- **Anthropic's annual revenue run rate surged from $30 billion to $47 billion by late May, driven primarily by high usage of Claude Code rather than new seat-based subscriptions.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief), episode `why-only-ai-training-can-save-the-economy`, fp `f843922d6104bdfb`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - **[Industry analysis]** Stripe's token billing feature will make usage-based pricing a viable and sustainable business model for AI apps by allowing tokens to be priced as a commodity to the end user. *(Source: Host, via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - **[Industry analysis]** GitHub Copilot is transitioning from a request-based pricing model to a consumption-based credit system effective June 1, 2026, following a preview period in May. Chief Product Officer Mario Rodriguez stated, \"Usage-based billing fixes that. It better aligns pricing with actual usage.\" *(Source: Microsoft GitHub / Mario Rodriguez, confidence 0.98, tier 1)*\n  - **[Industry analysis]** Anthropic's revenue run rate has surged from $3 million last year to $47 billion currently, driven by a strategic shift from seat-based pricing to usage-based pricing for AI agents. This growth was primarily fueled by high usage of Claude Code rather than new seat-based subscriptions. *(Source: AI Daily Brief host (citing industry data), confidence 0.85, tier 1)*\n  - **[Industry analysis]** The industry is transitioning from a 'token subsidy era' to a 'token scarcity era,' where AI business models are shifting to charge for actual token consumption, fundamentally changing how value is captured and distributed. *(Source: AI Daily Brief host, confidence 0.6, tier 3)*\n  - **[Industry analysis]** Microsoft's per-user business models, including productivity, coding, and security, are transitioning to hybrid per-user and usage-based models. CEO Satya Nadella noted, \"Any per user business of ours, whether it's productivity or coding or security, will become a per user and usage business.\" *(Source: Satya Nadella (Microsoft CEO), confidence 0.95, tier 1)*\n  - **[Industry analysis]** Perplexity charges enterprises for its 'Computer' product on a usage-based model rather than a seat-based model, citing variable underlying costs for different task types, such as video generation versus text memos. *(Source: AI Daily Brief host, confidence 0.9, tier 1)*"
}
```

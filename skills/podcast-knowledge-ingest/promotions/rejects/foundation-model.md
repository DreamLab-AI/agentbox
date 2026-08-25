# Dossier: Foundation Model

- status: `candidate_rejected`
- target page: `Foundation Model.md`
- assertions: 7 across episodes: can-open-models-solve-corporate-ai-washing, harness-engineering-101, openai-preps-new-garlic-model, the-5-biggest-ai-stories-to-watch-in-december, val-kilmers-ai-resurrection, will-this-update-from-openai-make-ai-agents-work-better
- reasons: rubric_b_improvement -1.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 1.0
- rubric-B improvement (after vs before): -1.0
- answer-completeness: 0.86

## Assertions
- **Alibaba's Qwen 3.8 Max model has 2.4 trillion parameters and is priced at $2 per million input tokens and $6 per million output tokens.**
  - tier 1, confidence 0.95, source Alibaba Qwen Release (cited by AI Daily Brief host), episode `can-open-models-solve-corporate-ai-washing`, fp `04c02b2497d96f2d`
- **Alibaba's return to open-weights models with Qwen 3.8 Max is a strategic move to dominate the global open-model space, leveraging the recent PR issues of competitors like Anthropic.**
  - tier 2, confidence 0.75, source AI Daily Brief Host / Industry Analysts, episode `can-open-models-solve-corporate-ai-washing`, fp `22b24b2e2fcf20ff`
- **There is a strategic tension between 'big model' proponents who argue the model contains all the necessary intelligence and 'big harness' proponents who argue the surrounding system is the primary driver of value.**
  - tier 2, confidence 0.85, source Latent Space / AI Daily Brief Host, episode `harness-engineering-101`, fp `6b8da46a4e39f1ae`
- **OpenAI has not completed a successful full-scale training run on a new foundation model since GPT-4.0 in May of the previous year, according to SemiAnalysis.**
  - tier 2, confidence 0.75, source SemiAnalysis, episode `openai-preps-new-garlic-model`, fp `993b6f450cbfd821`
- **The host predicts that Apple will not compete meaningfully in AI through its own models but will instead use its balance sheet to buy AI capabilities to ensure its devices do not suffer from a lack of AI features.**
  - tier 3, confidence 0.5, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `37a9767778d21d1d`
- **Mustafa Suleyman stated that the model layer will accrue most of the future value and that his objective is to create highly optimized, enterprise-specific model lineages for Microsoft over the next 3 to 5 years.**
  - tier 2, confidence 0.9, source Mustafa Suleyman (via CNBC interview cited in transcript), episode `val-kilmers-ai-resurrection`, fp `49875419fe877119`
- **The adoption of Anthropic's skills standard by OpenAI demonstrates a trend where foundation model companies prioritize the speed of development and interoperability over owning proprietary standards.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `will-this-update-from-openai-make-ai-agents-work-better`, fp `3306843007b8ed3b`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Open challenges as of 2026 centre on the looming data wall (Epoch AI projects the usable stock of public training text could be exhausted between 2026 and 2032, pushing synthetic data), the rising energy and carbon footprint of training (Llama 3.1 405B at roughly 8,930 tons CO2), and durable gaps in reliability on long-running autonomous tasks, provenance and copyright compliance, and systemic-risk evaluation.",
  "content": "\n\n- ### Recent Developments (2026)\n  - **Alibaba Qwen 3.8 Max**: Alibaba released Qwen 3.8 Max, a foundation model with 2.4 trillion parameters, priced at $2 per million input tokens and $6 per million output tokens. This release marks a strategic return to open-weights models, aimed at dominating the global open-model space and leveraging recent public relations challenges faced by competitors such as Anthropic.\n  - **OpenAI Training Status**: According to a research note by SemiAnalysis, OpenAI has not completed a successful full-scale training run on a new foundation model since GPT-4.0 in May of the previous year, raising questions about the cadence of frontier model releases from the lab.\n  - **Model vs. Harness Debate**: A strategic tension has emerged between proponents of \"big model\" architectures, who argue the model contains all necessary intelligence, and \"big harness\" advocates, who contend the surrounding system is the primary driver of value. This debate is highlighted by industry figures such as Boris Cherny (Claude Code), who describes the harness as \"the thinnest possible wrapper,\" and Jerry Liu (LlamaIndex), who asserts \"The Model Harness Is Everything.\"\n  - **Microsoft's Model Strategy**: Mustafa Suleyman stated that the model layer will accrue most of the future value, with Microsoft's objective being to create highly optimized, enterprise-specific model lineages over the next 3 to 5 years.\n  - **Standardization and Interoperability**: The adoption of Anthropic's skills standard by OpenAI demonstrates a trend where foundation model companies prioritize the speed of development and interoperability over owning proprietary standards, with OpenAI appearing comfortable adopting standards like MCP and skills created by competitors.\n  - **Apple's AI Approach**: Industry analysis suggests Apple is unlikely to compete meaningfully in AI through its own models, instead expected to use its balance sheet to acquire AI capabilities to ensure its devices maintain competitive AI features."
}
```

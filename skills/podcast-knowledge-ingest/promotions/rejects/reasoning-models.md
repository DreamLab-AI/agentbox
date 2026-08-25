# Dossier: Reasoning Models

- status: `candidate_rejected`
- target page: `Reasoning Models.md`
- assertions: 5 across episodes: openai-declares-code-red, the-10-biggest-ai-stories-of-2025, the-5-most-impactful-ai-model-releases-of-2025, what-people-are-actually-using-ai-for-right-now, why-ai-users-are-raving-about-glm-52
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.80

## Assertions
- **OpenAI is planning to ship a new reasoning model next week that the company claims is ahead of Google's Gemini 3 in internal evaluations.**
  - tier 1, confidence 0.9, source The Information (citing Sam Altman), episode `openai-declares-code-red`, fp `1c4cd147da5526be`
- **According to OpenRouter data, reasoning tokens grew from zero at the start of 2025 to over 50% of the 100 trillion total tokens consumed by the end of the year.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief) citing OpenRouter, episode `the-10-biggest-ai-stories-of-2025`, fp `89bd2e6f12083fd6`
- **According to OpenRouter data, reasoning models represented over half of all model usage by November 2025, up from effectively zero on January 1st.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief) citing OpenRouter, episode `the-5-most-impactful-ai-model-releases-of-2025`, fp `8cd9465140c72771`
- **Reasoning model token usage increased from negligible levels to over 50% of tokens consumed during 2025.**
  - tier 1, confidence 0.95, source OpenRouter and a16z, episode `what-people-are-actually-using-ai-for-right-now`, fp `944fdf63a52d38bd`
- **DeepSeek's R1 release in January 2025 caused Nvidia to lose $589 billion in market cap in a single day.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `why-ai-users-are-raving-about-glm-52`, fp `7ffa774970ab1b69`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - These models are usually trained with reinforcement learning against checkable rewards, learning to plan, self-check, and backtrack within a long chain of thought. The approach excels on mathematics, competitive coding, and scientific reasoning, at the cost of higher latency and token consumption per query.",
  "content": "\n- ### Recent Developments\n  - **Adoption Surge (2025):** According to OpenRouter data, reasoning model usage has seen explosive growth. Reasoning tokens grew from effectively zero at the start of 2025 to over 50% of the 100 trillion total tokens consumed by the end of the year. By November 2025, reasoning models represented over half of all model usage, up from a negligible baseline on January 1st.\n  - **Market Impact:** The release of DeepSeek's R1 in January 2025 had significant market implications, causing Nvidia to lose $589 billion in market cap in a single day, marking the single biggest daily loss in terms of pure numbers for the company.\n  - **Competitive Landscape:** OpenAI is planning to ship a new reasoning model that the company claims is ahead of Google's Gemini 3 in internal evaluations, according to statements by Sam Altman."
}
```

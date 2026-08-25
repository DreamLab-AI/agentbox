# Dossier: AI Capital Expenditure

- status: `candidate_survivor`
- target page: `AI Capital Expenditure.md`
- assertions: 6 across episodes: the-state-of-ai-q2-2026, why-fable-5-is-the-most-controversial-ai-release-ever, why-only-ai-training-can-save-the-economy, why-the-ai-bubble-conversation-is-useless, why-the-data-center-debate-has-little-to-do-with-ai

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Hyperscalers are expected to spend $650 billion on capital expenditure in 2026, which is three times their spending from a couple of years ago.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `the-state-of-ai-q2-2026`, fp `8d3596640ef2ec7a`
- **Oracle reported $16.5 billion in capital expenditure for the previous quarter, bringing its annual total to $55.7 billion, and plans to raise spending to $70 billion for the coming fiscal year.**
  - tier 1, confidence 0.95, source Oracle Earnings Call (via AI Daily Brief host), episode `why-fable-5-is-the-most-controversial-ai-release-ever`, fp `013415b50a7ca3d7`
- **Data from the St. Louis Fed indicates that AI investment accounted for 39% of marginal GDP growth over the trailing four quarters, exceeding the tech sector's 28% contribution at the peak of the dot-com boom.**
  - tier 1, confidence 0.95, source St. Louis Fed (cited by Host), episode `why-only-ai-training-can-save-the-economy`, fp `a2c8bcdf001eecf6`
- **OpenAI has 1.4 trillion in spending commitments stretching out for approximately 8 years.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `why-the-ai-bubble-conversation-is-useless`, fp `7acc1aaf7bbaa9f9`
- **Google's current run rate for capital expenditure is 95 billion for the year, which would amount to 750 billion over an 8-year period.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `why-the-ai-bubble-conversation-is-useless`, fp `0e92943983db11e2`
- **SpaceX reported quarterly revenue of $7.8 billion, a 92% year-over-year increase, with $2.6 billion generated from its AI division including Grok subscriptions and data center rentals.**
  - tier 1, confidence 0.95, source SpaceX Earnings Report, episode `why-the-data-center-debate-has-little-to-do-with-ai`, fp `d53e66dc673ddbde`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - **[Industry analysis]** The current AI debt market is showing signs of exhaustion, with over $385 billion in data center debt issued this year, leading to higher interest rates for subsequent issuances. *(Source: Goldman Sachs (John Greenwood) and Trepp Data (Steven Bushbom), via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - **[Hyperscaler Spending]** Hyperscalers are expected to spend $650 billion on capital expenditure in 2026, which is three times their spending from a couple of years ago and exceeds the inflation-adjusted amount spent on the US interstate highway buildout. *(Source: AI Daily Brief host, 2026-08-24)*\n  - **[Corporate Capex: Oracle]** Oracle reported $16.5 billion in capital expenditure for the previous quarter, bringing its annual total to $55.7 billion (above its $50 billion forecast), and plans to raise spending to $70 billion for the coming fiscal year. *(Source: Oracle Earnings Call, via AI Daily Brief host, 2026-08-24)*\n  - **[Macroeconomic Impact]** Data from the St. Louis Fed indicates that AI investment accounted for 39% of marginal GDP growth over the trailing four quarters, exceeding the tech sector's 28% contribution at the peak of the dot-com boom. *(Source: St. Louis Fed, cited by AI Daily Brief host, 2026-08-24)*\n  - **[Long-term Commitments: OpenAI]** OpenAI has $1.4 trillion in spending commitments stretching out for approximately 8 years. *(Source: AI Daily Brief host, 2026-08-24)*\n  - **[Long-term Commitments: Google]** Google's current run rate for capital expenditure is $95 billion for the year, which would amount to $750 billion over an 8-year period. *(Source: AI Daily Brief host, 2026-08-24)*\n  - **[Revenue Context: SpaceX]** SpaceX reported quarterly revenue of $7.8 billion, a 92% year-over-year increase, with $2.6 billion generated from its AI division (including Grok subscriptions and data center rentals), which is triple the revenue from a year ago. *(Source: SpaceX Earnings Report, 2026-08-24)*"
}
```

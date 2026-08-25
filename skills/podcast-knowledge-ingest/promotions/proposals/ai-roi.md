# Dossier: AI ROI

- status: `candidate_survivor`
- target page: `AI ROI.md`
- assertions: 7 across episodes: the-ai-subsidy-era-is-over, the-time-savings-era-of-ai-is-over, why-ai-advantage-compounds, why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **In AI usage surveys conducted between January and March 2026, 'cost savings' was not listed as a primary benefit, while 'new capabilities' rose from 21.9% to 29.3% as the primary benefit.**
  - tier 1, confidence 0.8, source AI Daily Brief Host (citing monthly pulse results), episode `the-ai-subsidy-era-is-over`, fp `24b9fc26752b5194`
- **71% of respondents in the January 2026 survey increased their AI usage month-over-month, while 83% reported an increase in the value they derived from AI, creating a 12-point 'value premium' that suggests users are getting better at leveraging AI.**
  - tier 1, confidence 0.95, source AI DB Intel January AI usage pulse survey, episode `the-time-savings-era-of-ai-is-over`, fp `03065cd06b568e6b`
- **96% of leaders in the EY survey reported significant measurable improvements in overall financial performance, with only 4% reporting no measurable improvements.**
  - tier 1, confidence 0.95, source EY Pulse Survey, episode `why-ai-advantage-compounds`, fp `a38abd222cb9aa16`
- **In the AI ROI benchmarking survey, use cases reporting eight different benefit types had a mean ROI of 3.65, compared to 3.13 for use cases with only one benefit type.**
  - tier 1, confidence 0.95, source AI ROI Benchmarking Survey, episode `why-ai-advantage-compounds`, fp `05de74da34cfdb21`
- **Time savings is the universal entry point to AI value, but it has a weaker correlation with high ROI than improved decision-making, new capabilities, or increased revenue.**
  - tier 2, confidence 0.85, source AI ROI Benchmarking Survey / Host Analysis, episode `why-ai-advantage-compounds`, fp `4ebaaa00471cd487`
- **A PwC survey of nearly 4,500 CEOs found that only 12% reported AI had delivered both cost and revenue benefits, while 56% reported no significant financial benefit.**
  - tier 1, confidence 0.95, source PwC survey (reported by AI Daily Brief host), episode `why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai`, fp `6c10855e946c1bf5`
- **Companies in the top 12% of AI adopters, which report both revenue increases and cost reductions, are 2.6 times more likely to have embedded AI into their core processes compared to other companies.**
  - tier 1, confidence 0.9, source PwC survey (reported by AI Daily Brief host), episode `why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai`, fp `271ee7066307276d`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - KPMG's Global AI Pulse Survey for Q2 found that CEO-led AI efforts were 3x more likely to produce ROI than efforts where the CEO was less involved. *(Source: KPMG Global AI Pulse Survey (Q2), via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - **Value Premium & Usage Trends**: In the January 2026 AI usage pulse survey, 71% of respondents increased their AI usage month-over-month, while 83% reported an increase in the value derived from AI. This 12-point gap, termed a \"value premium,\" suggests users are becoming more proficient at leveraging AI. *(Source: AI DB Intel January AI usage pulse survey, confidence 0.95, tier 1)*\n  - **Financial Performance**: 96% of leaders in the EY survey reported significant measurable improvements in overall financial performance, with only 4% reporting no measurable improvements. *(Source: EY Pulse Survey, confidence 0.95, tier 1)*\n  - **Benefit Diversity & ROI**: In the AI ROI benchmarking survey, use cases reporting eight different benefit types had a mean ROI of 3.65, compared to 3.13 for use cases with only one benefit type. *(Source: AI ROI Benchmarking Survey, confidence 0.95, tier 1)*\n  - **Drivers of High ROI**: Time savings is the universal entry point to AI value but has a weaker correlation with high ROI than improved decision-making, new capabilities, or increased revenue. *(Source: AI ROI Benchmarking Survey / Host Analysis, confidence 0.85, tier 2)*\n  - **CEO Perception Gap**: A PwC survey of nearly 4,500 CEOs found that only 12% reported AI had delivered both cost and revenue benefits, while 56% reported no significant financial benefit. *(Source: PwC survey (reported by AI Daily Brief host), confidence 0.95, tier 1)*\n  - **Vanguard Adopters**: Companies in the top 12% of AI adopters, which report both revenue increases and cost reductions, are 2.6 times more likely to have embedded AI into their core processes compared to other companies. *(Source: PwC survey (reported by AI Daily Brief host), confidence 0.9, tier 1)*\n  - **Shifting Primary Benefits**: In AI usage surveys conducted between January and March 2026, 'cost savings' was not listed as a primary benefit, while 'new capabilities' rose from 21.9% to 29.3% as the primary benefit. Time savings dropped from 19.7% to 12.7%. *(Source: AI Daily Brief Host (citing monthly pulse results), confidence 0.8, tier 1)*"
}
```

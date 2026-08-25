# Dossier: BEIR Benchmark

- status: `candidate_rejected`
- target page: `BEIR Benchmark.md`
- assertions: 7 across episodes: fable-5-raises-the-bar-for-ai-ambition, gpt-54-first-test-results, harness-engineering-101, where-should-claude-opus-5-fit-in-your-model-rotation
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Claude Fable 5 achieved a score of 80.3% on SWE-bench Pro, significantly outperforming GPT-5.5 (58.6%) and Opus 4.8 (69.2%).**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Benchmark Data, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `9ab7f0e9eadaf86b`
- **On the Frontier Code benchmark, Claude Fable 5 scored 29.3%, more than double the previous best of 13.4% achieved by Opus 4.8.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Cognition, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `c4f6bbbd4d5cd3a8`
- **GPT-5.4 achieved a 75% score on the OSWorld verified benchmark, surpassing the human-level performance baseline of 72.4% and significantly exceeding GPT-5.2's 47.3%.**
  - tier 1, confidence 0.95, source Rahul Agrawal (citing OpenAI data), episode `gpt-54-first-test-results`, fp `23976822c3eb2c8b`
- **GPT-5.4 achieved a win rate of 69.2% to 70.8% against industry professionals on the GDP eval benchmark, rising to 82-83% when ties are included.**
  - tier 1, confidence 0.95, source Ethan Mollick / OpenAI Data, episode `gpt-54-first-test-results`, fp `d0c7e243aaf9a226`
- **Blitzcy achieved a 66.5% performance score on SWE-bench Pro, significantly outperforming GPT-5.4's 57.7% score.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Blitzcy, episode `harness-engineering-101`, fp `66c6a644e25c8ac6`
- **Claude Opus 5 scored 70.6% on the OSWorld 2.0 computer use benchmark, significantly outperforming Fable 5 (55.7%) and GPT-5.6-Soul (62.6%).**
  - tier 1, confidence 0.95, source Host / Benchmark Data, episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `681dfde1e1f9370a`
- **Claude Opus 5 achieved a state-of-the-art score of 30.2% on ARC-AGI 3, significantly surpassing the previous high score of 7.8% by GPT-5.6 Soul.**
  - tier 1, confidence 0.9, source ARC Prize / Host, episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `89cdf42983f1c5f8`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - ## Current Landscape (2026)",
  "content": "  - ## Recent Developments\n    - **Claude Fable 5** has emerged as a dominant performer in recent coding and reasoning benchmarks. On SWE-bench Pro, it achieved a score of 80.3%, significantly outperforming GPT-5.5 (58.6%) and Opus 4.8 (69.2%). Furthermore, on the Frontier Code benchmark, Claude Fable 5 scored 29.3%, more than double the previous best of 13.4% achieved by Opus 4.8, while GPT-5.5 managed only 5.7%.\n    - **GPT-5.4** demonstrated substantial progress in computer use and professional task evaluation. It achieved a 75% score on the OSWorld verified benchmark, surpassing the human-level performance baseline of 72.4% and significantly exceeding GPT-5.2's 47.3%. On the GDP eval benchmark, GPT-5.4 achieved a win rate of 69.2% to 70.8% against industry professionals, rising to 82-83% when ties are included, a marked improvement over GPT-5.2's 49.8%.\n    - **Blitzcy** recently released a model achieving a 66.5% performance score on SWE-bench Pro, significantly outperforming GPT-5.4's 57.7% score on the same benchmark.\n    - **Claude Opus 5** has set new state-of-the-art records in both computer use and abstract reasoning. It scored 70.6% on the OSWorld 2.0 computer use benchmark, significantly outperforming Fable 5 (55.7%) and GPT-5.6-Soul (62.6%). Additionally, Claude Opus 5 achieved a state-of-the-art score of 30.2% on ARC-AGI 3, significantly surpassing the previous high score of 7.8% by GPT-5.6 Soul (with Opus 4.8 at 1.5% and GPT-5.5 at 1.1%)."
}
```

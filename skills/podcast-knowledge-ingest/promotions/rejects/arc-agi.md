# Dossier: ARC-AGI

- status: `candidate_rejected`
- target page: `ARC-AGI.md`
- assertions: 8 across episodes: does-gemini-31-pro-matter, why-ai-needs-better-benchmarks
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Gemini 3.1 Pro achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens.**
  - tier 1, confidence 0.95, source Host (citing benchmark data and Akash Gupta's analysis), episode `does-gemini-31-pro-matter`, fp `82c4ca951ff14274`
- **OpenAI's O3 model achieved a 76% score on the low inference settings of ARC-AGI 1 in December 2024, exceeding the human performance baseline for the first time.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `why-ai-needs-better-benchmarks`, fp `16d7fa5b3bbac813`
- **ARC-AGI 3 consists of 135 simple graphical games that require AI agents to manipulate grids in real time without explicit instructions.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `why-ai-needs-better-benchmarks`, fp `999394a05b278fd8`
- **No frontier AI model currently scores above 1% on the ARC-AGI 3 benchmark, while humans score 100%.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `why-ai-needs-better-benchmarks`, fp `09d3b8143a516b53`
- **François Chollet stated that ARC-AGI is not a final exam for claiming AGI, but rather a moving target designed to track the frontier and spotlight unsolved problems as AI evolves.**
  - tier 2, confidence 0.95, source François Chollet, episode `why-ai-needs-better-benchmarks`, fp `ecfcf4c05c5c540a`
- **Gemini 3 DeepThink is the current leader on ARC-AGI 2 with a score of 84.6%, costing $13.62 per task.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `why-ai-needs-better-benchmarks`, fp `182bc9c172cf7fa9`
- **ARC-AGI 3 scores are calculated using squared efficiency relative to human performance, meaning a model taking 100 steps to solve a task that takes a human 10 steps receives a score of 1%.**
  - tier 2, confidence 0.85, source Lassana (Scaling AI 1), episode `why-ai-needs-better-benchmarks`, fp `0ff2d40c1539986a`
- **ARC-AGI 3 is designed to require zero language ability or cultural knowledge to solve, making it a frontier benchmark that tests universal reasoning concepts rather than next-token prediction.**
  - tier 2, confidence 0.85, source Brandon Hancock, episode `why-ai-needs-better-benchmarks`, fp `97ecbec71073d76e`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  ## Current Landscape (2026)",
  "content": "  ## Current Landscape (2026)\n\n    Recent benchmark data and expert commentary from 2026 highlight the rapid evolution of performance on the ARC-AGI series and clarify the benchmark's intended role in the AGI research landscape. On ARC-AGI-2, Gemini 3.1 Pro achieved a score of 77.1%, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens. This jump was noted by analyst Akash Gupta, who observed that Google \"doubled the intelligence and charged zero incremental cost\" in three months. As of the latest reporting, Gemini 3 DeepThink is the current leader on ARC-AGI-2 with a score of 84.6%, at a cost of $13.62 per task, slightly ahead of GPT-5.4 Pro's 83.3%.\n\n    Regarding ARC-AGI-1, OpenAI's O3 model achieved a 76% score on low inference settings in December 2024, a milestone that exceeded the human performance baseline for the first time. This result underscored the benchmark's sensitivity to inference-time compute strategies and reinforced the debate over whether such gains represent genuine fluid intelligence or sophisticated search.\n\n    The introduction of ARC-AGI-3 has further shifted the focus toward agentic capabilities. The benchmark consists of 135 simple graphical games that require AI agents to manipulate grids in real time without explicit instructions. Because the environments lack stated goals, models must explore, infer reward structures, and adapt on the fly. Currently, no frontier AI model scores above 1% on ARC-AGI-3, while human participants consistently achieve 100%. The scoring mechanism for ARC-AGI-3 uses squared efficiency relative to human performance; for instance, a model taking 100 steps to solve a task that takes a human 10 steps receives a score of 1%. This design ensures that the benchmark tests universal reasoning concepts rather than next-token prediction, as it requires zero language ability or cultural knowledge to solve. As Brandon Hancock noted, \"An alien species with zero knowledge of human language could ace Arc AGI 3 on day one,\" highlighting its value as a frontier benchmark in a field dominated by language models.\n\n    Fran\u00e7ois Chollet has clarified that ARC-AGI is not a \"final exam\" for claiming AGI, but rather a moving target designed to track the frontier and spotlight unsolved problems. He emphasized that the benchmark targets the residual gap between what is hard for AI and what is easy for humans, serving as a tool to measure AGI progress and drive researchers toward the most important open problems."
}
```

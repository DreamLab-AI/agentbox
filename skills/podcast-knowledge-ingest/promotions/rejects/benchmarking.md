# Dossier: Benchmarking

- status: `candidate_rejected`
- target page: `Benchmarking.md`
- assertions: 14 across episodes: bezos-is-back-to-build-ai, can-open-models-solve-corporate-ai-washing, dario-amodei-breaks-his-social-media-silence, does-gemini-31-pro-matter, gemini-can-now-write-you-a-song, grok-46-shows-how-fast-your-ai-options-are-expanding, how-deepseek-v4-connects-to-the-us-grid, how-harness-as-a-service-will-change-agents, how-significant-are-ais-latest-math-breakthroughs, how-the-4-new-models-released-this-week-will-change-how-you-work, what-i-learned-testing-gpt-5-5, why-ai-advantage-compounds, why-claude-opus-45-changes-whats-possible-with-vibe-coding
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.83

## Assertions
- **Grok 4.1 and 4.1 Thinking surpassed frontier models like Gemini 2.5 Pro, Claude Sonnet 4.5, and GPT-5 on LMArena leaderboards, reversing Grok 4's previous lower ranking.**
  - tier 1, confidence 0.85, source LMArena, episode `bezos-is-back-to-build-ai`, fp `456303a3a71cbce4`
- **Independent testing of Qwen 3.8 Max has yielded mixed results, with some users reporting it as 'unusable' or significantly slower and less stable than competitors like Kimmy K3 and GPT 5.6, despite strong self-reported benchmarks.**
  - tier 2, confidence 0.7, source Independent Developers (Datum, Pavel Huryn) / AI Daily Brief Host, episode `can-open-models-solve-corporate-ai-washing`, fp `1aeb1152a243aa6b`
- **Z AI's GLM 5.3 model scores 28.3% on Terminal Bench 3.0, placing it approximately five points behind frontier models like Fable 5 and GPT 5.6 Soul, but 11 points ahead of Kimik 3.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Z AI Benchmark Data, episode `dario-amodei-breaks-his-social-media-silence`, fp `38b03c36bcc1d038`
- **According to Artificial Analysis, Gemini 3.1 Pro leads their overall intelligence index by four points ahead of Claude Opus 4.6 while costing less than half as much to run.**
  - tier 1, confidence 0.9, source Artificial Analysis (cited by Host), episode `does-gemini-31-pro-matter`, fp `a5bbc3603fea9b57`
- **A test query on Grok Heavy 16 resulted in a 700-word report with nearly 900 references after the 16 sub-agents debated for over a minute.**
  - tier 1, confidence 0.9, source Ted Suo (xAI Community Promoter) via Podcast Host, episode `gemini-can-now-write-you-a-song`, fp `8436cef0f9f237c8`
- **Chinese AI models often show a significant gap between their benchmark performance and real-world agentic behavior, falling short of frontier models like Sonnet and Opus in practical applications.**
  - tier 2, confidence 0.85, source Flo Crell (Lindy Founder) via Podcast Host, episode `gemini-can-now-write-you-a-song`, fp `ebbb30efb0952ec0`
- **Leaked benchmarks for DeepSeek V4 Pro show it scoring 87.9% on Terminal Bench 2.1, but independent testing by Artificial Analysis found it scored only 53, trailing behind Kimmy K3 and Muark 1.2.**
  - tier 2, confidence 0.75, source Leaked Benchmarks / Artificial Analysis / AI Daily Brief Host, episode `grok-46-shows-how-fast-your-ai-options-are-expanding`, fp `c1b91c222c638c2d`
- **DeepSeek V4 is not state-of-the-art compared to US frontier models but offers a new Pareto frontier by providing near-frontier performance at a fraction of the cost.**
  - tier 2, confidence 0.85, source Leo Synth Wave / Simon Willison / AI Daily Brief Host, episode `how-deepseek-v4-connects-to-the-us-grid`, fp `eed0debac32af677`
- **A new report from Endor Labs found that GPT-5.5 operating within Cursor's harness achieved a 23.5% score on a security correctness benchmark, narrowly beating Cursor with Opus 4.7 (22.9%).**
  - tier 1, confidence 0.92, source Endor Labs / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `3e463fe7775ed389`
- **The 'capability overhang' of existing models is increasing, as weaker models can often reproduce frontier model discoveries if given the right conceptual hints, suggesting the gap between model generations is narrowing in specific tasks.**
  - tier 2, confidence 0.8, source Dan Shipper / Kevin Madura, episode `how-significant-are-ais-latest-math-breakthroughs`, fp `5676e52575dff934`
- **Grock 4.5 achieves near-frontier performance at significantly lower costs, costing 31 cents per task on the Artificial Analysis index compared to $1.80 for Opus 4.8 and $2.75 for Fable 5.**
  - tier 1, confidence 0.9, source Artificial Analysis / AI Daily Brief Host, episode `how-the-4-new-models-released-this-week-will-change-how-you-work`, fp `7f30a31a9d955a9e`
- **GPT-5.5 underperformed Anthropic's Opus 4.7 on the SWE-bench Pro benchmark, leading to debate about the benchmark's validity, with OpenAI's Tibo arguing that 'SWE-bench is not representative of anything real.'**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `what-i-learned-testing-gpt-5-5`, fp `fcf45c19535f6256`
- **In the AI ROI benchmarking survey, use cases reporting eight different benefit types had a mean ROI of 3.65, compared to 3.13 for use cases with only one benefit type.**
  - tier 1, confidence 0.95, source AI ROI Benchmarking Survey, episode `why-ai-advantage-compounds`, fp `05de74da34cfdb21`
- **Claude Opus 4.5 achieved a score of 52 on SWE-bench Pro, compared to 43.6 for Sonnet 4.5 and 36% for GPT-5.**
  - tier 1, confidence 0.85, source Igor Cotenkov / Host, episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `78ea42ed20f4c442`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Capacity planning** \u2014 Benchmarks inform how a system scales with load, supporting infrastructure sizing and cost modelling.",
  "content": "\n\n- ### Recent Developments\n  - **AI Model Benchmarking** \u2014 Recent industry reports and podcast discussions highlight the rapid evolution of AI model benchmarks, particularly in coding, agentic behavior, and cost-efficiency.\n    - **Coding & Agentic Performance**: Z AI's GLM 5.3 scores 28.3% on Terminal Bench 3.0, placing it approximately five points behind frontier models like Fable 5 and GPT 5.6 Soul, but 11 points ahead of Kimik 3. In a separate evaluation, Claude Opus 4.5 achieved a score of 52 on SWE-bench Pro, compared to 43.6 for Sonnet 4.5 and 36% for GPT-5. However, GPT-5.5 underperformed Anthropic's Opus 4.7 on SWE-bench Pro, sparking debate about the benchmark's validity, with OpenAI's Tibo arguing that \"SWE-bench is not representative of anything real.\"\n    - **Security & Intelligence Indices**: A report from Endor Labs found that GPT-5.5 operating within Cursor's harness achieved a 23.5% score on a security correctness benchmark, narrowly beating Cursor with Opus 4.7 (22.9%). According to Artificial Analysis, Gemini 3.1 Pro leads their overall intelligence index by four points ahead of Claude Opus 4.6 while costing less than half as much to run.\n    - **Cost-Efficiency & Pareto Frontiers**: Grok 4.5 achieves near-frontier performance at significantly lower costs, costing 31 cents per task on the Artificial Analysis index compared to $1.80 for Opus 4.8 and $2.75 for Fable 5. Similarly, DeepSeek V4 is not state-of-the-art compared to US frontier models but offers a new Pareto frontier by providing near-frontier performance at a fraction of the cost.\n    - **Benchmark Validity & Real-World Gaps**: Chinese AI models often show a significant gap between their benchmark performance and real-world agentic behavior, falling short of frontier models like Sonnet and Opus in practical applications. Additionally, the \"capability overhang\" of existing models is increasing, as weaker models can often reproduce frontier model discoveries if given the right conceptual hints, suggesting the gap between model generations is narrowing in specific tasks.\n    - **ROI & Multi-Benefit Use Cases**: In the AI ROI benchmarking survey, use cases reporting eight different benefit types had a mean ROI of 3.65, compared to 3.13 for use cases with only one benefit type, indicating that broader benefit realization correlates with higher return on investment."
}
```

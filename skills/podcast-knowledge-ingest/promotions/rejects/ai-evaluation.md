# Dossier: AI Evaluation

- status: `candidate_rejected`
- target page: `AI Evaluation.md`
- assertions: 11 across episodes: dario-amodei-breaks-his-social-media-silence, fable-5-raises-the-bar-for-ai-ambition, how-significant-are-ais-latest-math-breakthroughs, introducing-maturity-maps-a-new-way-to-measure-ai-adoption, real-world-ai-evaluations, why-ai-needs-better-benchmarks, why-claude-opus-45-changes-whats-possible-with-vibe-coding
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.82

## Assertions
- **Anthropic reported Q2 revenue of $11.5 billion, representing a 14x increase year-over-year, with investors expecting a $2 trillion valuation for its upcoming IPO.**
  - tier 1, confidence 0.95, source Financial Times / Anthropic Investor Meetings, episode `dario-amodei-breaks-his-social-media-silence`, fp `29f961ae02f7d83b`
- **The 'Frontier Code' benchmark was designed to address the issue of 'unmergeable slop' in AI-generated code by evaluating scope, discipline, style, and adherence to standards.**
  - tier 2, confidence 0.85, source Cognition / Shaun Wang / AI Daily Brief Host, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `c76f5e02f2d78252`
- **The performance gap between state-of-the-art models is becoming less visible in standard benchmarks and more apparent in the ability to handle previously impossible or extremely complex tasks.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `4beba9f035d0afd1`
- **Amazon has completed its full $50 billion investment in OpenAI, paying $13.7 billion in Q2 and the remainder in the following month, securing a roughly 5% stake at an $852 billion valuation.**
  - tier 1, confidence 0.95, source Amazon SEC Filings / Markets Researcher Nicholas Muggalli, episode `how-significant-are-ais-latest-math-breakthroughs`, fp `fe5b9b2ec07590c9`
- **The combined survey respondent base for the Q2 maturity maps exceeds 150,000 professionals across more than 50 countries.**
  - tier 1, confidence 0.98, source Host (AI DB / Super Intelligent), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `3b2b9c760568acf6`
- **The host identifies an 'adoption embedding gap' where high claimed adoption coexists with low depth and utilization across all function-specific surveys.**
  - tier 2, confidence 0.85, source Host, episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `ac83b84cdae2b1d6`
- **OpenAI's GDPval benchmark measures capabilities to complete knowledge work tasks end-to-end across over 44 occupations, using expert graders paired with an automated grader.**
  - tier 1, confidence 0.95, source OpenAI, episode `real-world-ai-evaluations`, fp `67fad014782e7787`
- **Artificial Analysis developed an AI-based grading pipeline for the GDPval tasks to allow the benchmark to be run autonomously and at scale on any LLM.**
  - tier 2, confidence 0.9, source Artificial Analysis, episode `real-world-ai-evaluations`, fp `a10ca98cedeac4e7`
- **The host argues that traditional AI benchmarks are often saturated, gameable, and disconnected from the real world, making them poor indicators of actual model utility.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `real-world-ai-evaluations`, fp `636512f4e04a21b8`
- **The rapid saturation of benchmarks like ARC-AGI 2 and SWE-Bench indicates that AI models are progressing faster than the evaluation infrastructure can adapt, necessitating continuous innovation in measurement methodologies.**
  - tier 3, confidence 0.75, source AI Daily Brief host, episode `why-ai-needs-better-benchmarks`, fp `8eab191a2ad012d3`
- **Claude Opus 4.5 scored higher than any human candidate on Anthropic's internal performance engineering take-home exam within a 2-hour time limit.**
  - tier 1, confidence 0.9, source Anthropic announcement post, episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `d4662990e1c33611`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  ## Research & Literature",
  "content": "  ## Recent Developments (2026)\n    Recent industry and evaluation developments highlight the accelerating divergence between model capabilities and traditional benchmarking infrastructure, as well as the growing economic scale of the AI sector.\n\n    - **Economic Scale and Investment**: The commercial footprint of frontier AI has expanded significantly. Anthropic reported Q2 revenue of $11.5 billion, a 14x year-over-year increase, with investors anticipating a $2 trillion valuation for its upcoming IPO. Concurrently, Amazon completed its full $50 billion investment in OpenAI, securing a roughly 5% stake at an $852 billion valuation, with SEC filings confirming the final payment of $13.7 billion in Q2.\n    - **New Evaluation Paradigms**: To address the limitations of saturated and gameable static benchmarks, new evaluation methodologies are emerging. OpenAI\u2019s **GDPval** benchmark measures the ability to complete knowledge work tasks end-to-end across over 44 occupations, utilizing a hybrid of expert human graders and automated scoring. To facilitate autonomous and scalable testing, Artificial Analysis has developed an AI-based grading pipeline for GDPval tasks. Additionally, Cognition\u2019s **Frontier Code** benchmark has been introduced to evaluate AI-generated code for \"scope, discipline, style, and adherence to standards,\" specifically targeting the issue of \"unmergeable slop\" where a majority of generated code fails to integrate cleanly into existing codebases.\n    - **Benchmark Saturation and Capability Shifts**: Industry observers note that the performance gap between state-of-the-art models is becoming less visible in standard benchmarks and more apparent in the ability to handle previously impossible or extremely complex tasks. The rapid saturation of benchmarks like ARC-AGI 2 and SWE-Bench indicates that AI models are progressing faster than the evaluation infrastructure can adapt, necessitating continuous innovation in measurement methodologies. This shift is exemplified by Anthropic\u2019s internal performance engineering take-home exam, where Claude Opus 4.5 scored higher than any human candidate within a 2-hour time limit, suggesting that traditional human-expert baselines are being surpassed in specialized technical domains.\n    - **Adoption and Utilization Gaps**: Despite high claimed adoption rates, a significant \"adoption embedding gap\" persists, where high visibility coexists with low depth and utilization across function-specific surveys. This \"applied capability overhang\" is identified as the most dominant finding in recent maturity maps, which now draw from a combined respondent base exceeding 150,000 professionals across more than 50 countries.\n\n  ## Research & Literature"
}
```

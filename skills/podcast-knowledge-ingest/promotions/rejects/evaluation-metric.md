# Dossier: Evaluation Metric

- status: `candidate_rejected`
- target page: `Evaluation Metric.md`
- assertions: 9 across episodes: autoresearch-agent-loops-and-the-future-of-work, gemini-3-launches-heres-everything-you-need-to-know, gpt-52-is-here, how-people-actually-use-ai-agents, introducing-maturity-maps-a-new-way-to-measure-ai-adoption, why-ai-needs-better-benchmarks
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.67

## Assertions
- **In the 'auto research' system, the AI agent operates in a fixed 5-minute training run cycle, evaluating performance via validation bits per byte (val BPB), and only commits changes to the Git feature branch if the val BPB improves.**
  - tier 1, confidence 0.95, source Podcast Host / Andrej Karpathy, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `686e0a36d0c39efa`
- **Gemini 3 Pro achieved a score of 37.5% on the Humanity's Last Exam benchmark, surpassing GPT-5.1's score of 26.5%.**
  - tier 1, confidence 0.95, source Google / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `4dc57b54becc36f2`
- **While Gemini 3 Pro excels in coding and reasoning, early feedback suggests it may still lag behind Anthropic's models (Sonnet/Haiku) in nuanced creative writing and editorial judgment.**
  - tier 2, confidence 0.8, source Dan Shipper / Murdan Kland / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `c51e0328069113bb`
- **GPT 5.2 Thinking scored 70.9% on GDP Val, an internal OpenAI benchmark for economically valuable knowledge work, compared to 38.8% for GPT 5.**
  - tier 1, confidence 0.95, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `bea2098b782bd985`
- **Critics such as Dan Shipper from Every characterize GPT 5.2 as an 'incremental upgrade' that is less creative and 'surprising' than GPT 5.1, despite its improvements in structured business outputs.**
  - tier 2, confidence 0.8, source Dan Shipper (Every) / AI Daily Brief Host, episode `gpt-52-is-here`, fp `20df046458ff12a2`
- **The METER study metric measures the duration of a task as it would take a human to complete it, not the actual time an AI agent takes to complete the task.**
  - tier 1, confidence 0.95, source AI Daily Brief Host, episode `how-people-actually-use-ai-agents`, fp `8064429c6b5a8cdb`
- **Jellyfish's AI coding benchmark used behavioral data for more than 200,000 engineers across 700 companies with 20 million PRs.**
  - tier 1, confidence 0.95, source Jellyfish (cited by host), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `4056b2bb4b195b4b`
- **The host predicts that ROI measurement efforts will see the biggest 'glow-up' in the coming quarters.**
  - tier 3, confidence 0.7, source Host, episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `15cbd203ead5d564`
- **ARC-AGI 3 scores are calculated using squared efficiency relative to human performance, meaning a model taking 100 steps to solve a task that takes a human 10 steps receives a score of 1%.**
  - tier 2, confidence 0.85, source Lassana (Scaling AI 1), episode `why-ai-needs-better-benchmarks`, fp `0ff2d40c1539986a`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  4. **Standardisation initiatives**: The EU AI Act's implementation via ISO/IEC standardisation (ISO/IEC 42001 AI Management Systems; ISO/IEC 22989 AI Concepts and Terminology) is creating harmonised evaluation requirements across EU member states. MLCommons' MLPerf inference benchmarks define reproducible performance metrics for inference hardware and model efficiency across vision, language, and recommender tasks.",
  "content": "\n\n  ### Recent Developments (2026)\n\n  Recent podcast evidence and industry reports highlight several specific advancements and shifts in evaluation metric practice and benchmarking:\n\n  - **Automated Research Cycles**: In 'auto research' systems, AI agents operate in fixed 5-minute training run cycles, evaluating performance via validation bits per byte (val BPB). Changes are committed to Git feature branches only if the val BPB improves, otherwise they are discarded (Karpathy, 2026).\n  - **Benchmark Performance Updates**: \n    - **Humanity's Last Exam**: Gemini 3 Pro achieved a score of 37.5%, surpassing GPT-5.1's score of 26.5% on this academic reasoning-focused benchmark.\n    - **GDP Val**: GPT 5.2 Thinking scored 70.9% on OpenAI's internal GDP Val benchmark for economically valuable knowledge work, a significant increase from GPT 5's 38.8%.\n    - **ARC-AGI 3**: Scores are calculated using squared efficiency relative to human performance. For example, a model taking 100 steps to solve a task that takes a human 10 steps receives a score of 1%.\n  - **Qualitative Model Comparisons**: While Gemini 3 Pro excels in coding and reasoning, early feedback suggests it may lag behind Anthropic's models (Sonnet/Haiku) in nuanced creative writing and editorial judgment. Similarly, GPT 5.2 is characterized by some critics as an 'incremental upgrade' that is less creative than GPT 5.1, despite improvements in structured business outputs.\n  - **New Metric Definitions**: The METER study metric measures the duration of a task as it would take a human to complete it, rather than the actual time an AI agent takes. This distinction is crucial for evaluating efficiency relative to human baselines.\n  - **Behavioral Data in Evaluation**: Jellyfish's AI coding benchmark utilized behavioral data from over 200,000 engineers across 700 companies with 20 million pull requests to inform maturity maps, highlighting the growing role of large-scale behavioral data in evaluation.\n  - **ROI Measurement**: Industry predictions indicate that ROI measurement efforts will see significant improvements ('glow-up') in the coming quarters, reflecting a maturing focus on the economic value of AI deployments."
}
```

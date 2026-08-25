# Dossier: Model Training

- status: `candidate_rejected`
- target page: `Model Training.md`
- assertions: 10 across episodes: autoresearch-agent-loops-and-the-future-of-work, bezos-is-back-to-build-ai, gpt-52-is-here, grok-46-shows-how-fast-your-ai-options-are-expanding, how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, is-kimi-k3-really-fable-class, the-5-biggest-ai-stories-to-watch-in-december, the-calm-before-the-agi-storm, why-ai-users-are-raving-about-glm-52, work-agi-is-the-only-agi-that-matters
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **In the 'auto research' system, the AI agent operates in a fixed 5-minute training run cycle, evaluating performance via validation bits per byte (val BPB), and only commits changes to the Git feature branch if the val BPB improves.**
  - tier 1, confidence 0.95, source Podcast Host / Andrej Karpathy, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `686e0a36d0c39efa`
- **xAI developed new reinforcement learning processes that enabled the creation of an autonomous training environment using agents to train Grok 4.1.**
  - tier 1, confidence 0.8, source xAI, episode `bezos-is-back-to-build-ai`, fp `feb68e8dd136d442`
- **The release of GPT 5.2 signals that pre-training scaling is not slowing down, suggesting that the compute supercycle and demand for hardware like Nvidia GPUs are still in an early phase of growth.**
  - tier 3, confidence 0.65, source Ben Paludan / AI Daily Brief Host, episode `gpt-52-is-here`, fp `57aeeee2a8180ad1`
- **Elon Musk announced that Grock 4.7 is 'significantly better' than 4.6 and will be ready in 3 to 4 weeks, claiming it will 'exceed all current models' due to the unique nature of SpaceX's training corpus.**
  - tier 2, confidence 0.75, source Elon Musk / AI Daily Brief Host, episode `grok-46-shows-how-fast-your-ai-options-are-expanding`, fp `6db8fe1cb55e6016`
- **Anthropic's internal 'Claude CLI' tool, later released as Claude Code, overtook all other internal coding tools between September and December of the previous year due to its design for longer model horizons.**
  - tier 1, confidence 0.95, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `91ecb5baf4d45c3f`
- **The narrative that Chinese AI progress is primarily driven by distillation of US models is overexaggerated, and Chinese labs are demonstrating genuine independent innovation capabilities.**
  - tier 2, confidence 0.8, source Sue Hail (Mixpanel founder) and Nathan Lambert (via AI Daily Brief host), episode `is-kimi-k3-really-fable-class`, fp `23d7e28575d334f3`
- **A SemiAnalysis report claimed that OpenAI's leading researchers have not completed a successful full-scale pre-training run for a new frontier model since GPT-4.0 in May 2024.**
  - tier 1, confidence 0.85, source SemiAnalysis (cited by Host), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `2ea610c1563696cb`
- **Microsoft released three new models for transcription, voice, and image generation, marking its return to the model training game after the unreleased MAI-1 preview, with plans to deploy them internally for cost-cutting in products like Microsoft Teams.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief), episode `the-calm-before-the-agi-storm`, fp `be0d00b26170ae1d`
- **A new, more capable version of Anthropic's Mythos model has emerged from training, potentially to be named Mythos 5.1 or Mythos 6.**
  - tier 2, confidence 0.65, source Andrew Curran, episode `why-ai-users-are-raving-about-glm-52`, fp `15a17795bd461629`
- **Sam Altman announced that OpenAI has finished pre-training its next model, which is code-named Spud.**
  - tier 1, confidence 0.95, source Sam Altman (via internal memo reported by AI Daily Brief), episode `work-agi-is-the-only-agi-that-matters`, fp `b9e62cf8be633377`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - ### Current Landscape (2026)",
  "content": "  - ### Recent Developments (2026)\n\n    Recent industry disclosures and podcast evidence highlight accelerating training cycles, autonomous training environments, and continued compute expansion.\n\n    **Autonomous and Agentic Training Loops**: xAI has developed new reinforcement learning processes enabling an autonomous training environment using agents to train Grok 4.1. In parallel, Andrej Karpathy\u2019s 'auto research' system demonstrates a fixed 5-minute training run cycle where AI agents evaluate performance via validation bits per byte (val BPB), committing changes to Git feature branches only if val BPB improves. This suggests a shift toward closed-loop, agent-driven optimisation of training hyperparameters and architectures.\n\n    **Frontier Model Pre-Training Status**: Sam Altman announced that OpenAI has finished pre-training its next model, code-named \"Spud,\" noting that \"Things are moving faster than many of us expected.\" Conversely, a SemiAnalysis report claims that OpenAI\u2019s leading researchers have not completed a successful full-scale pre-training run for a new frontier model since GPT-4.0 in May 2024, indicating potential internal bottlenecks or strategic pauses despite public announcements. Meanwhile, Elon Musk announced that Grok 4.7 is \"significantly better\" than 4.6 and will be ready in 3\u20134 weeks, claiming it will \"exceed all current models\" due to the unique nature of SpaceX\u2019s training corpus, with supplemental training on \"a massive amount of SpaceX company data.\"\n\n    **Compute Supercycle and Scaling Continuity**: The release of GPT-5.2 signals that pre-training scaling is not slowing down, suggesting that the compute supercycle and demand for hardware like Nvidia GPUs are still in an early phase of growth. Ben Paludan noted, \"GPT-5.2 is the clearest signal yet that pre-training scaling isn't slowing down... Nvidia's curve is nowhere near flattening. We're still early in the compute supercycle.\"\n\n    **Corporate Model Training Returns**: Microsoft released three new models for transcription, voice, and image generation, marking its return to the model training game after the unreleased MAI-1 preview. Microsoft plans to deploy these models internally for cost-cutting in products like Microsoft Teams. Additionally, a new, more capable version of Anthropic's Mythos model has emerged from training, potentially to be named Mythos 5.1 or Mythos 6, with the possibility of it remaining internal to accelerate further development.\n\n    **Geopolitical and Research Context**: The narrative that Chinese AI progress is primarily driven by distillation of US models is considered overexaggerated, with Chinese labs demonstrating genuine independent innovation capabilities. Sue Hail and Nathan Lambert noted that \"distillation from Chinese labs is way overexaggerated\" and that \"China is also very good at building models.\" Internally at Anthropic, the 'Claude CLI' tool (later released as Claude Code) overtook all other internal coding tools between September and December of the previous year due to its design for longer model horizons, reflecting a broader industry bet on extended context and reasoning capabilities."
}
```

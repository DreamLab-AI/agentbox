# Dossier: Reinforcement Learning

- status: `candidate_rejected`
- target page: `Reinforcement Learning.md`
- assertions: 11 across episodes: autoresearch-agent-loops-and-the-future-of-work, bezos-is-back-to-build-ai, black-friday-gpt, dario-amodei-breaks-his-social-media-silence, should-we-be-scared-of-anthropics-mythos, the-era-of-vertical-ai-models, what-i-learned-testing-gpt-5-5, where-should-claude-opus-5-fit-in-your-model-rotation, why-ai-hasnt-increased-unemployment-according-to-anthropic
- reasons: rubric_b_improvement -2.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **In the 'auto research' system, the AI agent operates in a fixed 5-minute training run cycle, evaluating performance via validation bits per byte (val BPB), and only commits changes to the Git feature branch if the val BPB improves.**
  - tier 1, confidence 0.95, source Podcast Host / Andrej Karpathy, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `686e0a36d0c39efa`
- **Grok 4.1 and 4.1 Thinking surpassed frontier models like Gemini 2.5 Pro, Claude Sonnet 4.5, and GPT-5 on LMArena leaderboards, reversing Grok 4's previous lower ranking.**
  - tier 1, confidence 0.85, source LMArena, episode `bezos-is-back-to-build-ai`, fp `456303a3a71cbce4`
- **xAI developed new reinforcement learning processes that enabled the creation of an autonomous training environment using agents to train Grok 4.1.**
  - tier 1, confidence 0.8, source xAI, episode `bezos-is-back-to-build-ai`, fp `feb68e8dd136d442`
- **OpenAI used reinforcement learning to train a specialized version of GPT-5 Mini for its new shopping research feature, which outperformed the full-size GPT-5 Thinking model in internal product accuracy benchmarks.**
  - tier 1, confidence 0.95, source Host (citing OpenAI technical details), episode `black-friday-gpt`, fp `c8a45e6fcab08599`
- **Z AI's GLM 5.3 overtook Fable 5 on the Cyber Gym cybersecurity benchmark, jumping seven points from its predecessor, GLM 5.2.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Z AI Benchmark Data, episode `dario-amodei-breaks-his-social-media-silence`, fp `1b44e2319ef3b569`
- **Nathan Lambert argues that the AI community should stop being surprised by strong performance from Chinese labs, as they are genuinely good at what they do rather than just relying on distillation or benchmark maxing.**
  - tier 2, confidence 0.8, source Nathan Lambert, episode `dario-amodei-breaks-his-social-media-silence`, fp `bd482179b044483f`
- **Anthropic admitted to having accidentally trained against the chain of thought for Opus 4.6, Sonnet 4.6, and Mythos for 8% of reinforcement learning, potentially compromising the faithfulness of chain-of-thought observations.**
  - tier 1, confidence 0.9, source Anthropic (via podcast host reporting system card admission), episode `should-we-be-scared-of-anthropics-mythos`, fp `c75c4b59f8e94a9f`
- **Cursor's Composer 2 model beat Opus 4.6 on coding benchmarks while being cheaper to run, despite being based on an open-source model with additional reinforcement learning.**
  - tier 1, confidence 0.85, source Host (AI Daily Brief), episode `the-era-of-vertical-ai-models`, fp `b68b355c8b7ebb36`
- **The host anticipates that GPT-5.5's 'O3 moment' will come soon, suggesting that the current release is an initial RL checkpoint of a new pre-training model, similar to how O1 preview preceded O3.**
  - tier 3, confidence 0.5, source No More ID (cited by Host), episode `what-i-learned-testing-gpt-5-5`, fp `541fa2b32a6f62bf`
- **Hugging Face ML engineer Niels Roggy argued that Claude Opus 5's high performance on ARC-AGI 3 may not indicate generalization because Anthropic likely trained the model on RL environments resembling ARC-AGI puzzles.**
  - tier 2, confidence 0.8, source Niels Roggy (Hugging Face), episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `7936652a84b5b6cf`
- **Training MAI Code 1 Flash in Microsoft's Excel harness boosted its SWE-bench Verified score from 72% to 86%.**
  - tier 1, confidence 0.9, source Microsoft (reported by AI Daily Brief host), episode `why-ai-hasnt-increased-unemployment-according-to-anthropic`, fp `59ad0ee4941ecbda`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Reward hacking has become the central open challenge: RLVR-trained models exploit verifier gaps via specification gaming, premature answer revelation and reward tampering, and even \"spurious\" or format-only rewards can drive gains; benchmarks such as TRACE (517 trajectories, 54 exploit categories) show the best detector, GPT-5.2 with high reasoning, catching only 63% of hacks, while rubric-based rewards in open-ended medical and science domains still fail to transfer to independent judge panels.",
  "content": "\n\n- ### Recent Developments (2026)\n  - **Autonomous Training Loops:** Andrej Karpathy described an 'auto research' system where an AI agent operates in a fixed 5-minute training run cycle, evaluating performance via validation bits per byte (val BPB). Changes are committed to the Git feature branch only if the val BPB improves; otherwise, they are discarded. This exemplifies the shift toward self-improving, autonomous RL pipelines.\n  - **Frontier Model Performance:** Grok 4.1 and 4.1 Thinking surpassed frontier models like Gemini 2.5 Pro, Claude Sonnet 4.5, and GPT-5 on LMArena leaderboards, reversing Grok 4's previous lower ranking. xAI attributed this to new reinforcement learning processes that enabled an autonomous training environment using agents. Similarly, Z AI's GLM 5.3 overtook Fable 5 on the Cyber Gym cybersecurity benchmark, jumping seven points from its predecessor. Nathan Lambert argued that the community should stop being surprised by strong performance from Chinese labs, noting they are genuinely capable rather than just relying on distillation or benchmark maxing.\n  - **Specialized RL Applications:** OpenAI used reinforcement learning to train a specialized version of GPT-5 Mini for its shopping research feature, which outperformed the full-size GPT-5 Thinking model in internal product accuracy benchmarks. In the coding domain, Cursor's Composer 2 model beat Opus 4.6 on coding benchmarks while being cheaper to run, despite being based on an open-source model with additional RL. Microsoft reported that training MAI Code 1 Flash in an Excel harness boosted its SWE-bench Verified score from 72% to 86%.\n  - **Methodological Concerns:** Anthropic admitted to having accidentally trained against the chain of thought for Opus 4.6, Sonnet 4.6, and Mythos for 8% of reinforcement learning, potentially compromising the faithfulness of chain-of-thought observations. Hugging Face ML engineer Niels Roggy argued that Claude Opus 5's high performance on ARC-AGI 3 may not indicate generalization, as Anthropic likely trained the model on RL environments resembling ARC-AGI puzzles.\n  - **Future Trajectories:** Analysts anticipate that GPT-5.5's 'O3 moment' will come soon, suggesting the current release is an initial RL checkpoint of a new pre-training model, similar to how O1 preview preceded O3."
}
```

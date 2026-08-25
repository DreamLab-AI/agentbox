# Dossier: Model Capacity

- status: `candidate_rejected`
- target page: `Model Capacity.md`
- assertions: 6 across episodes: can-open-models-solve-corporate-ai-washing, gemini-3-anticipation-reaches-fever-pitch, is-kimi-k3-really-fable-class, what-i-learned-testing-gpt-5-5
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.83

## Assertions
- **Alibaba's Qwen 3.8 Max model has 2.4 trillion parameters and is priced at $2 per million input tokens and $6 per million output tokens.**
  - tier 1, confidence 0.95, source Alibaba Qwen Release (cited by AI Daily Brief host), episode `can-open-models-solve-corporate-ai-washing`, fp `04c02b2497d96f2d`
- **Sam Altman's announcement of a $1.4 trillion, 30-gigawatt infrastructure deal is argued to have 'popped the nonbubble' by shifting the AI narrative from a straight-line giddy phase to a more scrutinized, fundamentals-driven phase.**
  - tier 2, confidence 0.75, source TMT Breakout (X account) / Host, episode `gemini-3-anticipation-reaches-fever-pitch`, fp `2e35e47246fbc334`
- **The AI capital expenditure boom is predicted to roll over next year, potentially causing the NASDAQ to plummet.**
  - tier 3, confidence 0.5, source Michael Bur / Host, episode `gemini-3-anticipation-reaches-fever-pitch`, fp `d3e213ad0ab93bd0`
- **Moonshot AI's Kimmy K3 is a 2.8 trillion parameter model, making it the largest open model released to date.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `is-kimi-k3-really-fable-class`, fp `466bbafffa478cb5`
- **Running Kimmy K3 locally requires the rough equivalent of 44 Mac Studios or 15 Blackwell GPUs (a full NVL72 rack), representing a compute cost in the hundreds of thousands of dollars.**
  - tier 1, confidence 0.9, source Ryan Feduick (via AI Daily Brief host), episode `is-kimi-k3-really-fable-class`, fp `36a6b9d9610e5950`
- **Anthropic's unreleased 'Mythos' model is speculated to have approximately 10 trillion parameters, compared to GPT-5.5's estimated 2 to 5 trillion parameters.**
  - tier 3, confidence 0.55, source Scaling 01 (cited by Host), episode `what-i-learned-testing-gpt-5-5`, fp `2c84f6e3eff0e0e2`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Regional Context**: UK/North England where applicable",
  "content": "\n\n  ## Recent Developments (2026)\n\n  - **Alibaba Qwen 3.8 Max**: Released with 2.4 trillion parameters, priced at $2 per million input tokens and $6 per million output tokens, reflecting the scaling of frontier model capacity and associated inference costs.\n  - **Moonshot AI Kimmy K3**: A 2.8 trillion parameter model, currently the largest open model released to date. It is significantly larger than competitors such as Deepseek V4 Pro (1.6T) and GLM 5.2 (744B). Running Kimmy K3 locally requires the rough equivalent of 44 Mac Studios or 15 Blackwell GPUs (a full NVL72 rack), representing a compute cost in the hundreds of thousands of dollars.\n  - **Anthropic 'Mythos' (Unreleased)**: Speculated to have approximately 10 trillion parameters, compared to GPT-5.5's estimated 2 to 5 trillion parameters, indicating continued exponential growth in model capacity among leading labs.\n  - **Infrastructure & Market Impact**: Sam Altman's announcement of a $1.4 trillion, 30-gigawatt infrastructure deal has been argued to shift the AI narrative from a \"straight-line giddy phase\" to a more scrutinized, fundamentals-driven phase. Conversely, some analysts predict the AI capital expenditure boom may roll over, potentially impacting broader market indices like the NASDAQ."
}
```

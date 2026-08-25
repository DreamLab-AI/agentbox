# Dossier: Metrics

- status: `candidate_rejected`
- target page: `Metrics.md`
- assertions: 5 across episodes: black-friday-gpt, can-todays-ai-replace-12-of-work, claude-code-turns-one, everything-you-need-to-know-about-ai-tokens, grok-bot-finally-makes-ai-agents-easy
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Adobe Analytics reported that AI-based traffic to leading retail sites increased by 1,300% in the previous year, though this growth was from an extremely low base.**
  - tier 1, confidence 0.95, source Adobe Analytics (cited by Host), episode `black-friday-gpt`, fp `96a500d37e8438bd`
- **Anthropic's internal survey of 132 engineers found that employees self-report using Claude in 60% of their work and achieving a 50% productivity boost.**
  - tier 1, confidence 0.95, source Anthropic Economic Index / Internal Survey, episode `can-todays-ai-replace-12-of-work`, fp `8c1d6929108e1904`
- **OpenAI's weekly active ChatGPT users stand at 910 million, falling short of the company's target of one billion users for 2025.**
  - tier 1, confidence 0.9, source OpenAI Financial Presentation, episode `claude-code-turns-one`, fp `935a51a57c0e6a59`
- **Meta consumed between 60 and 74 trillion tokens in a single month, with its top individual user consuming 280 billion tokens.**
  - tier 1, confidence 0.95, source Nofar Gaspar (citing published data), episode `everything-you-need-to-know-about-ai-tokens`, fp `24351faad2758313`
- **Google's Gemini app has reached 1 billion monthly active users, with 63% of users utilizing the voice interface and 150 million images generated per day.**
  - tier 1, confidence 0.95, source Sundar Pichai / Google, episode `grok-bot-finally-makes-ai-agents-easy`, fp `50f81e32adb28cc8`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Quantifying the impact of deployments and incidents on system health.",
  "content": "\n- ### Recent Developments\n  - Adobe Analytics reported that AI-based traffic to leading retail sites increased by 1,300% in the previous year, though this growth was from an extremely low base.\n  - Anthropic's internal survey of 132 engineers found that employees self-report using Claude in 60% of their work and achieving a 50% productivity boost.\n  - OpenAI's weekly active ChatGPT users stand at 910 million, falling short of the company's target of one billion users for 2025.\n  - Meta consumed between 60 and 74 trillion tokens in a single month, with its top individual user consuming 280 billion tokens.\n  - Google's Gemini app has reached 1 billion monthly active users, with 63% of users utilizing the voice interface and 150 million images generated per day."
}
```

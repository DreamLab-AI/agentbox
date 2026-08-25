# Dossier: Initial Public Offering

- status: `candidate_rejected`
- target page: `Initial Public Offering.md`
- assertions: 5 across episodes: openai-declares-the-next-phase-of-ai, openai-preps-new-garlic-model, the-ai-chart-everyone-is-getting-wrong, what-google-needs-to-do-at-io-this-week, who-cares-about-consumer-ai
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **OpenAI filed its IPO paperwork confidentially on Monday.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `openai-declares-the-next-phase-of-ai`, fp `6efff18ecb40300e`
- **Anthropic is preparing for a 2026 IPO and is negotiating a private funding round at a valuation exceeding $300 billion.**
  - tier 1, confidence 0.9, source The Financial Times, episode `openai-preps-new-garlic-model`, fp `c60f2638dd413c1a`
- **SpaceX is conducting the largest IPO in history, priced at $135 per share, implying a valuation just shy of $1.8 trillion.**
  - tier 1, confidence 0.95, source AI Daily Brief host citing Bloomberg, episode `the-ai-chart-everyone-is-getting-wrong`, fp `b66a058ef6c719fb`
- **Cerebras stock opened at a $40 billion market capitalization, briefly touched $100 billion, and closed its first day of trading with a 68% gain at a $66 billion valuation.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `what-google-needs-to-do-at-io-this-week`, fp `64fe57dcb8df4b22`
- **The Cerebras IPO is experiencing demand that massively outstrips supply, with private investors seeking $10 billion in allocations against a planned sale of $3.5 billion at a high-end valuation of $26.6 billion.**
  - tier 1, confidence 0.85, source Bloomberg, episode `who-cares-about-consumer-ai`, fp `37b2766e2ad63f86`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- Serving as the conceptual baseline for token-based fundraising models.",
  "content": "- ### Recent Developments\n- OpenAI filed its IPO paperwork confidentially on Monday, officially initiating its process to go public.\n- Anthropic is preparing for a 2026 IPO and is currently negotiating a private funding round at a valuation exceeding $300 billion, with potential to reach $350 billion.\n- SpaceX is conducting the largest IPO in history, priced at $135 per share, implying a valuation just shy of $1.8 trillion and positioning it to debut as the seventh largest company in the world.\n- Cerebras stock opened at a $40 billion market capitalization, briefly touched $100 billion, and closed its first day of trading with a 68% gain at a $66 billion valuation.\n- The Cerebras IPO is experiencing demand that massively outstrips supply, with private investors seeking $10 billion in allocations against a planned sale of $3.5 billion at a high-end valuation of $26.6 billion."
}
```

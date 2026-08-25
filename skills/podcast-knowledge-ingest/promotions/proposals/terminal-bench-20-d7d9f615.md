# Dossier: Terminal Bench 2.0

- status: `candidate_survivor`
- target page: `Terminal Bench 2.0.md`
- assertions: 5 across episodes: opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, should-we-be-scared-of-anthropics-mythos, the-most-important-ai-news-from-google-io, what-i-learned-testing-gpt-5-5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Anthropic claims Claude Opus 4.6 achieved the leading score on the Terminal Bench 2.0 benchmark.**
  - tier 1, confidence 0.9, source Anthropic (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `39cc2ff69ddcdeb9`
- **OpenAI's GPT-5.3 Codex scored 77.3% on Terminal Bench 2.0, surpassing Codex 5.2's 64% and Claude Opus 4.6's 65.4%.**
  - tier 1, confidence 0.9, source OpenAI (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `92f516885a0f4e88`
- **Anthropic's Claude Mythos model scored 92.1% on Terminal Bench 2.0 when the timeout window was extended to 4 hours, compared to 82% under standard conditions.**
  - tier 1, confidence 0.95, source Anthropic (via podcast host reporting benchmark results), episode `should-we-be-scared-of-anthropics-mythos`, fp `bb674acd17d3c2b3`
- **Gemini 3.5 Flash scored 76.2% on the Terminal Bench 2.0 benchmark, compared to 70.3% for Gemini 3.1 Pro.**
  - tier 1, confidence 0.92, source AI Daily Brief host, episode `the-most-important-ai-news-from-google-io`, fp `ae318036831a3217`
- **GPT-5.5 scored 82.7% on the Terminal Bench 2.0 agentic coding benchmark, compared to 69.4% for Anthropic's Opus 4.7.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `what-i-learned-testing-gpt-5-5`, fp `06d5907e5bfab51f`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - OpenAI's GPT 5.6 Soul model scored 91.9% on Terminal Bench 2.0 in Ultra settings, beating Claude Mythos by almost four percentage points. *(Source: OpenAI (via AI Daily Brief host), via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - GPT-5.5 scored 82.7% on the Terminal Bench 2.0 agentic coding benchmark, compared to 69.4% for Anthropic's Opus 4.7. *(Source: Host (AI Daily Brief), 2026-08-24)*\n  - Gemini 3.5 Flash scored 76.2% on the Terminal Bench 2.0 benchmark, compared to 70.3% for Gemini 3.1 Pro. *(Source: AI Daily Brief host, 2026-08-24)*\n  - OpenAI's GPT-5.3 Codex scored 77.3% on Terminal Bench 2.0, surpassing Codex 5.2's 64% and Claude Opus 4.6's 65.4%. *(Source: OpenAI (via Host), 2026-08-24)*\n  - Anthropic's Claude Mythos model scored 92.1% on Terminal Bench 2.0 when the timeout window was extended to 4 hours, compared to 82% under standard conditions. *(Source: Anthropic (via podcast host reporting benchmark results), 2026-08-24)*\n  - Anthropic claims Claude Opus 4.6 achieved the leading score on the Terminal Bench 2.0 benchmark. *(Source: Anthropic (via Host), 2026-08-24)*"
}
```

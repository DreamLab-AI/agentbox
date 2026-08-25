# Dossier: Frontier Models

- status: `candidate_rejected`
- target page: `Frontier Models.md`
- assertions: 11 across episodes: bezos-is-back-to-build-ai, claude-code-turns-one, does-gemini-31-pro-matter, how-the-escalating-ai-wars-benefit-you, is-kimi-k3-really-fable-class, why-claude-opus-45-changes-whats-possible-with-vibe-coding
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.82

## Assertions
- **Grok 4.1 and 4.1 Thinking surpassed frontier models like Gemini 2.5 Pro, Claude Sonnet 4.5, and GPT-5 on LMArena leaderboards, reversing Grok 4's previous lower ranking.**
  - tier 1, confidence 0.85, source LMArena, episode `bezos-is-back-to-build-ai`, fp `456303a3a71cbce4`
- **OpenAI's upcoming model, internally known as 'Garlic' (GPT-5.3), is rumored to be a 'GPT-3 to GPT-4 moment' that surpasses human baselines on non-coding benchmarks and represents a huge leap in capability.**
  - tier 3, confidence 0.55, source AI Engineer Dan Mack / Rumor Accounts, episode `claude-code-turns-one`, fp `22842658fa862d53`
- **Gemini 3.1 Pro achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens.**
  - tier 1, confidence 0.95, source Host (citing benchmark data and Akash Gupta's analysis), episode `does-gemini-31-pro-matter`, fp `82c4ca951ff14274`
- **The competitive landscape of frontier AI models has shifted from infrequent major releases to frequent incremental updates, making 'state-of-the-art' benchmark leadership a less significant barometer of a model's overall importance.**
  - tier 2, confidence 0.85, source Host, episode `does-gemini-31-pro-matter`, fp `459c2862e9ae2cc0`
- **Google's primary competitive advantage ('moat') lies in its distribution channels, including 2 billion Chrome users, Android, Workspace, and Cloud, rather than solely in raw model intelligence.**
  - tier 2, confidence 0.8, source Akash Gupta (cited by Host), episode `does-gemini-31-pro-matter`, fp `9a471ef3bb5e403f`
- **The frontier of AI model capabilities is commoditizing rapidly, with benchmark leadership rotating on a weekly basis and major labs converging on comparable intelligence levels.**
  - tier 2, confidence 0.8, source Akash Gupta (cited by Host), episode `does-gemini-31-pro-matter`, fp `ce0346059edd71c5`
- **Google may be strategically accepting a lag in core coding use cases (like agentic coding) because it has a financial stake in Anthropic, allowing it to focus on other areas like multimodal and scientific reasoning.**
  - tier 3, confidence 0.5, source Simon Smith (cited by Host), episode `does-gemini-31-pro-matter`, fp `5873184d2f9fcf06`
- **Leading frontier labs like OpenAI and Anthropic are unlikely to roll over and let the market shift away from them, as evidenced by OpenAI releasing cheaper versions of GPT-5.6 (Terra and Luna) that outperform Chinese models at lower costs.**
  - tier 3, confidence 0.6, source AI Daily Brief Host, episode `how-the-escalating-ai-wars-benefit-you`, fp `719376eac3da15e0`
- **Artificial Analysis assigned Kimmy K3 an overall intelligence index score of 57, ranking it third overall, three points behind Fable 5 and two points behind GPT 5.6 Soul.**
  - tier 1, confidence 0.9, source Artificial Analysis (via AI Daily Brief host), episode `is-kimi-k3-really-fable-class`, fp `a3f73edc8514c1c4`
- **The release of Kimmy K3 represents a narrowing of the capability gap between Chinese open-weight models and US closed-source frontier models to less than three months.**
  - tier 2, confidence 0.85, source Jukan (Satrini analyst, via AI Daily Brief host), episode `is-kimi-k3-really-fable-class`, fp `3cdebe80c548de5e`
- **Anthropic may be holding back its most capable models to prevent an AI arms race, with internal scores potentially higher than public releases.**
  - tier 3, confidence 0.5, source Super Dario / Host, episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `06a98566fe4d9697`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "Safety evaluation infrastructure\u2014red-teaming, model cards, responsible scaling policies\u2014has matured but remains contested in methodology.",
  "content": "\n\n- ### Recent Developments\n  - The competitive landscape of frontier AI models has shifted from infrequent major releases to frequent incremental updates, making \"state-of-the-art\" benchmark leadership a less significant barometer of a model's overall importance. The frontier is commoditizing rapidly, with benchmark leadership rotating on a weekly basis and major labs converging on comparable intelligence levels.\n  - **Gemini 3.1 Pro** achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens. Analysts note that Google \"doubled the intelligence and charged zero incremental cost,\" though its primary competitive advantage remains its distribution channels (2 billion Chrome users, Android, Workspace, and Cloud) rather than solely raw model intelligence.\n  - **Grok 4.1 and 4.1 Thinking** surpassed frontier models like Gemini 2.5 Pro, Claude Sonnet 4.5, and GPT-5 on LMArena leaderboards, reversing Grok 4's previous lower ranking.\n  - **Artificial Analysis** assigned **Kimmy K3** an overall intelligence index score of 57, ranking it third overall. The release of Kimmy K3 represents a narrowing of the capability gap between Chinese open-weight models and US closed-source frontier models to less than three months.\n  - **OpenAI** released cheaper versions of GPT-5.6 (Terra and Luna) that outperform Chinese models at lower costs, signaling that leading labs are unlikely to cede market share. An upcoming model, internally known as 'Garlic' (GPT-5.3), is rumored to be a \"GPT-3 to GPT-4 moment\" that surpasses human baselines on non-coding benchmarks.\n  - **Anthropic** may be holding back its most capable models to prevent an AI arms race, with internal scores potentially higher than public releases. Google may be strategically accepting a lag in core coding use cases due to its financial stake in Anthropic, allowing it to focus on other areas like multimodal and scientific reasoning."
}
```

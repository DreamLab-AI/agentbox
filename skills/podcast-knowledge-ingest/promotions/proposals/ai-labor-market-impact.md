# Dossier: AI Labor Market Impact

- status: `candidate_survivor`
- target page: `AI Labor Market Impact.md`
- assertions: 6 across episodes: the-final-ai-word-from-davos, the-week-the-ai-story-shifted, weird-vibes-at-ai-india-summit, where-the-economy-thrives-after-ai, why-ai-hasnt-increased-unemployment-according-to-anthropic, why-the-ai-bubble-conversation-is-useless

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **IMF Managing Director Kristalina Georgieva stated that AI has the potential to transform or eliminate 60% of jobs in advanced economies and 40% globally.**
  - tier 1, confidence 0.95, source Kristalina Georgieva (IMF Managing Director), episode `the-final-ai-word-from-davos`, fp `4941c9f4186aa968`
- **The AI infrastructure buildout is likely a sustained, decades-long project rather than a temporary burst, which will drive long-term job creation in blue-collar and construction sectors.**
  - tier 3, confidence 0.6, source Host (AI Daily Brief), episode `the-week-the-ai-story-shifted`, fp `a5ac6a0a37ab5e25`
- **Sam Altman expressed skepticism about AI-driven job loss, suggesting that some layoffs are 'AI washing' where companies blame AI for cuts they would have made anyway.**
  - tier 2, confidence 0.9, source Sam Altman, episode `weird-vibes-at-ai-india-summit`, fp `6be27b91a035132f`
- **David Autor and Neil Thompson argue that AI will reshape the economic value of human expertise by distinguishing between expert and inexpert tasks, leading to opposite labor market outcomes depending on which part of the job is automated.**
  - tier 2, confidence 0.85, source Alex Imas (citing Autor and Thompson), episode `where-the-economy-thrives-after-ai`, fp `2c0d6cd0bf4022f3`
- **Anthropic's head of economics Peter McCrory argues that AI has caused no material increase in the US unemployment rate to date, as it functions as a skill-biased labor-augmenting technology.**
  - tier 2, confidence 0.9, source Peter McCrory (Anthropic), episode `why-ai-hasnt-increased-unemployment-according-to-anthropic`, fp `0fbb4414e80e4b03`
- **ADP private payrolls data reported a net loss of 29,000 jobs in September and an addition of only 42,000 jobs in October 2025.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `why-the-ai-bubble-conversation-is-useless`, fp `9d9956e21ab07d11`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - **[Industry analysis]** The host asserts that the shift in the labor market caused by AI will require a 'total new labor movement' rather than simple policy enactments, as the relationship between employees and management undergoes a wholesale shift. *(Source: Host (AI Daily Brief), via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - **[Macroeconomic Forecast]** IMF Managing Director Kristalina Georgieva stated that AI has the potential to transform or eliminate 60% of jobs in advanced economies and 40% globally, describing it as a \"tsunami hitting the labor market.\" *(Source: Kristalina Georgieva (IMF Managing Director), confidence 0.95, tier 1)*\n  - **[Labor Market Data]** ADP private payrolls data reported a net loss of 29,000 jobs in September 2025 and an addition of only 42,000 jobs in October 2025. *(Source: AI Daily Brief host, confidence 0.9, tier 1)*\n  - **[Expert Skepticism]** Sam Altman expressed skepticism about AI-driven job loss, suggesting that some layoffs are \"AI washing\" where companies blame AI for cuts they would have made anyway, while acknowledging some real displacement. *(Source: Sam Altman, confidence 0.9, tier 2)*\n  - **[Economic Analysis]** David Autor and Neil Thompson argue that AI will reshape the economic value of human expertise by distinguishing between expert and inexpert tasks, leading to opposite labor market outcomes depending on which part of the job is automated. *(Source: Alex Imas (citing Autor and Thompson), confidence 0.85, tier 2)*\n  - **[Current Unemployment Impact]** Anthropic's head of economics Peter McCrory argues that AI has caused no material increase in the US unemployment rate to date, characterizing it as a skill-biased labor-augmenting technology. *(Source: Peter McCrory (Anthropic), confidence 0.9, tier 2)*\n  - **[Infrastructure Employment]** The AI infrastructure buildout is likely a sustained, decades-long project rather than a temporary burst, which will drive long-term job creation in blue-collar and construction sectors. *(Source: Host (AI Daily Brief), confidence 0.6, tier 3)*"
}
```

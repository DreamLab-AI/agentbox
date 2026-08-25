# Dossier: AI Job Displacement

- status: `candidate_survivor`
- target page: `AI Job Displacement.md`
- assertions: 12 across episodes: openai-proposes-a-new-deal, the-ai-subsidy-era-is-over, the-anti-ai-movement, weird-vibes-at-ai-india-summit, what-1250-professionals-said-about-working-with-ai, what-people-really-want-from-ai, who-will-adapt-best-to-ai-disruption

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **According to the Quinnipiac poll, 70% of Americans believe AI will reduce job opportunities, while only 7% believe it will increase them, creating a 10-to-1 ratio.**
  - tier 1, confidence 0.95, source Quinnipiac University (cited by host), episode `openai-proposes-a-new-deal`, fp `861c58dfea99d1c8`
- **In AI usage surveys conducted between January and March 2026, 'cost savings' was not listed as a primary benefit, while 'new capabilities' rose from 21.9% to 29.3% as the primary benefit.**
  - tier 1, confidence 0.8, source AI Daily Brief Host (citing monthly pulse results), episode `the-ai-subsidy-era-is-over`, fp `24b9fc26752b5194`
- **A YouGov study found that 63% of Americans think AI will lead to a decrease in the number of jobs available in the US, compared to 7% who think it will increase jobs.**
  - tier 1, confidence 0.95, source YouGov, episode `the-anti-ai-movement`, fp `97a3dcd06eeb66e3`
- **The host identifies 'job displacement' as the biggest, most broad-based, and politically significant category of anti-AI sentiment, surpassing existential risk or technical skepticism.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `the-anti-ai-movement`, fp `295412ee6bfb4a45`
- **Sam Altman expressed skepticism about AI-driven job loss, suggesting that some layoffs are 'AI washing' where companies blame AI for cuts they would have made anyway.**
  - tier 2, confidence 0.9, source Sam Altman, episode `weird-vibes-at-ai-india-summit`, fp `6be27b91a035132f`
- **Professionals in the general workforce generally prefer to preserve tasks that define their professional identity while delegating routine work to AI, envisioning a future where they oversee AI systems.**
  - tier 2, confidence 0.85, source Anthropic (cited by host), episode `what-1250-professionals-said-about-working-with-ai`, fp `3a64e391a217ad39`
- **Jobs and economy concerns represented 22.3% of worries in the Anthropic study, ranking second after unreliability.**
  - tier 1, confidence 0.95, source Anthropic, episode `what-people-really-want-from-ai`, fp `23a0c0c58e42c440`
- **A National Bureau of Economic Research study found that 6.1 million US workers face both high exposure to AI disruption and low adaptive capacity for job transitions.**
  - tier 1, confidence 0.95, source National Bureau of Economic Research study, episode `who-will-adapt-best-to-ai-disruption`, fp `6770802587eaa3dd`
- **86% of the US workers identified as having high AI exposure and low adaptive capacity are women.**
  - tier 1, confidence 0.95, source National Bureau of Economic Research study, episode `who-will-adapt-best-to-ai-disruption`, fp `f4a08c68cd746a4f`
- **The NBER study identified that 26.5 million US workers have high AI exposure but also high adaptive capacity, including occupations like software developers, financial managers, and lawyers.**
  - tier 1, confidence 0.95, source National Bureau of Economic Research study, episode `who-will-adapt-best-to-ai-disruption`, fp `9d0ec91498278de5`
- **The NBER study analyzed approximately 350 jobs representing about 96% of American employment to create its composite measure of adaptive capacity.**
  - tier 1, confidence 0.92, source National Bureau of Economic Research study, episode `who-will-adapt-best-to-ai-disruption`, fp `449b86ebae489e3a`
- **Vulnerability to AI disruption with low adaptive capacity is geographically concentrated in college towns and state capitals, with places like Laramie, Wyoming, and Carson City, Nevada, having 5 to 7% of their local workforce in this high-vulnerability category.**
  - tier 1, confidence 0.9, source National Bureau of Economic Research study, episode `who-will-adapt-best-to-ai-disruption`, fp `75b445ca6243720e`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - **[Emerging signal]** A world where AI displaces 8 million workers may be harder to handle socially and economically than a world where it displaces 80 million, because limited displacement does not force a wholesale economic restructuring. *(Source: Ezra Klein, via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - **Public Perception & Sentiment**\n    - A Quinnipiac poll found that 70% of Americans believe AI will reduce job opportunities, while only 7% believe it will increase them, creating a 10-to-1 ratio. *(Source: Quinnipiac University, confidence 0.95)*\n    - A YouGov study similarly found that 63% of Americans think AI will lead to a decrease in the number of jobs available in the US, compared to 7% who think it will increase jobs. *(Source: YouGov, confidence 0.95)*\n    - The AI Daily Brief host identifies 'job displacement' as the biggest, most broad-based, and politically significant category of anti-AI sentiment, surpassing existential risk or technical skepticism. *(Source: AI Daily Brief Host, confidence 0.8)*\n  - **Workforce Vulnerability & Adaptive Capacity (NBER Study)**\n    - A National Bureau of Economic Research study analyzed approximately 350 jobs representing about 96% of American employment to create its composite measure of adaptive capacity. *(Source: NBER, confidence 0.92)*\n    - The study found that 6.1 million US workers face both high exposure to AI disruption and low adaptive capacity for job transitions. *(Source: NBER, confidence 0.95)*\n    - Among this high-vulnerability, low-adaptive-capacity group, 86% are women. *(Source: NBER, confidence 0.95)*\n    - Conversely, 26.5 million US workers have high AI exposure but also high adaptive capacity, including occupations like software developers, financial managers, and lawyers. *(Source: NBER, confidence 0.95)*\n    - Vulnerability to AI disruption with low adaptive capacity is geographically concentrated in college towns and state capitals, with places like Laramie, Wyoming, and Carson City, Nevada, having 5 to 7% of their local workforce in this high-vulnerability category. *(Source: NBER, confidence 0.9)*\n  - **Corporate & Professional Perspectives**\n    - Sam Altman expressed skepticism about AI-driven job loss, suggesting that some layoffs are 'AI washing' where companies blame AI for cuts they would have made anyway, while acknowledging some real displacement exists. *(Source: Sam Altman, confidence 0.9)*\n    - In AI usage surveys conducted between January and March 2026, 'cost savings' was not listed as a primary benefit, while 'new capabilities' rose from 21.9% to 29.3% as the primary benefit. *(Source: AI Daily Brief Host, confidence 0.8)*\n    - An Anthropic study found that jobs and economy concerns represented 22.3% of worries, ranking second after unreliability. *(Source: Anthropic, confidence 0.95)*\n    - Professionals in the general workforce generally prefer to preserve tasks that define their professional identity while delegating routine work to AI, envisioning a future where they oversee AI systems. *(Source: Anthropic, confidence 0.85)*"
}
```

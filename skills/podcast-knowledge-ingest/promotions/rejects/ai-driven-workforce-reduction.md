# Dossier: AI-Driven Workforce Reduction

- status: `candidate_rejected`
- target page: `AI-Driven Workforce Reduction.md`
- assertions: 6 across episodes: the-5-biggest-ai-stories-to-watch-in-december, the-new-ai-org-chart, what-happens-when-ai-obliterates-your-business-model, who-cares-about-consumer-ai, why-agents-still-need-humans
- reasons: rubric_b_improvement -2.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **HP announced 4,000 to 6,000 job cuts in November 2025, which were widely attributed to AI-related workforce reductions.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `1228e7b89df89aab`
- **Block is undergoing a 40% workforce reduction as part of its transition to an AI-driven organizational structure.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief), episode `the-new-ai-org-chart`, fp `df04eeaa78b5377a`
- **Tailwind CSS CEO Adam Wathan stated that 75% of the company's engineering team was laid off due to the impact of AI on their business.**
  - tier 1, confidence 0.95, source Adam Wathan (via GitHub comment cited in transcript), episode `what-happens-when-ai-obliterates-your-business-model`, fp `e33b34b6c5b4ca12`
- **Coinbase announced a 14% reduction in its workforce, resulting in approximately 700 of its 5,000 employees being laid off.**
  - tier 1, confidence 0.95, source Brian Armstrong (CEO of Coinbase), episode `who-cares-about-consumer-ai`, fp `e281fb9d36666570`
- **Meta laid off 8,000 people and is installing software on US employees' computers to capture mouse movements, clicks, and keystrokes for AI training data.**
  - tier 1, confidence 0.85, source Dan Shipper (citing company actions), episode `why-agents-still-need-humans`, fp `60cc772be582e32f`
- **Atlassian announced 10% layoffs in March, an event that marked the end of a mini-recovery and preceded the stock heading into a year-to-date low in mid-April.**
  - tier 1, confidence 0.85, source Host (AI Daily Brief), episode `why-agents-still-need-humans`, fp `e6a8e5cad87154fa`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - Enterprise software company Atlassian cut roughly 10% of its workforce, or 1,600 jobs, explicitly attributing the decision to AI. *(Source: Mike Cannon-Brookes (CEO of Atlassian) / AI Daily Brief host, via AI Daily Brief, 2026-08-24)*",
  "content": "\n- ### Recent Developments\n  - HP announced 4,000 to 6,000 job cuts in November 2025, which were widely attributed to AI-related workforce reductions. *(Source: Host (AI Daily Brief), confidence 0.95, tier 1)*\n  - Block is undergoing a 40% workforce reduction as part of its transition to an AI-driven organizational structure. *(Source: Host (AI Daily Brief), confidence 0.9, tier 1)*\n  - Tailwind CSS CEO Adam Wathan stated that 75% of the company's engineering team was laid off due to the impact of AI on their business. *(Source: Adam Wathan (via GitHub comment cited in transcript), confidence 0.95, tier 1)*\n  - Coinbase announced a 14% reduction in its workforce, resulting in approximately 700 of its 5,000 employees being laid off. *(Source: Brian Armstrong (CEO of Coinbase), confidence 0.95, tier 1)*\n  - Meta laid off 8,000 people and is installing software on US employees' computers to capture mouse movements, clicks, and keystrokes for AI training data. *(Source: Dan Shipper (citing company actions), confidence 0.85, tier 1)*\n  - Atlassian announced 10% layoffs in March, an event that marked the end of a mini-recovery and preceded the stock heading into a year-to-date low in mid-April. *(Source: Host (AI Daily Brief), confidence 0.85, tier 1)*"
}
```

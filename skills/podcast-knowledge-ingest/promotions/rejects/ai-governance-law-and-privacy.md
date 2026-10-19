# Dossier: AI Governance Law and Privacy

- status: `candidate_rejected`
- target page: `AI Governance Law and Privacy.md`
- assertions: 7 across episodes: can-open-models-solve-corporate-ai-washing, the-5-biggest-ai-stories-to-watch-in-december, the-next-wave-of-enterprise-ai
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.86

## Assertions
- **Apple's lawsuit against OpenAI was weakened after Apple admitted its outside lawyers emailed the wrong person at OpenAI, confusing two Asian last names, regarding a prior contact attempt.**
  - tier 1, confidence 0.85, source OpenAI Legal Response (cited by AI Daily Brief host), episode `can-open-models-solve-corporate-ai-washing`, fp `6ef5ab587c37add3`
- **HP announced 4,000 to 6,000 job cuts in November 2025, which were widely attributed to AI-related workforce reductions.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `1228e7b89df89aab`
- **The host argues that the enterprise AI story of 2025 is that AI and agents are extremely valuable but require serious reorganization, data readiness, and capacity building, creating a growing gap between leaders and laggards.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `94529d5c5249f12a`
- **The host predicts that a more full-throated and clearly articulated anti-AI political position will emerge from the right in the US during December 2025.**
  - tier 3, confidence 0.55, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `273b29d7e2434fae`
- **The Trump AI executive order signed in 2025 requires AI labs to make advanced models available to the government 30 days prior to public release, reduced from a 90-day period in the previous draft.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `the-next-wave-of-enterprise-ai`, fp `253994ea2ffcd5c0`
- **The Trump AI executive order explicitly disclaims the creation of a mandatory government licensing, pre-clearance, or permitting requirement for the development of new AI models.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `the-next-wave-of-enterprise-ai`, fp `9ec7401b736b2386`
- **The NSA has been assigned primary responsibility for testing advanced AI models under the new executive order, with support from various cyber technology and defense agencies.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `the-next-wave-of-enterprise-ai`, fp `5f89d8b5a2d2d110`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Key open challenges as of 2026 include overlapping jurisdiction between the EU AI Office, the EDPS, national data protection authorities and market surveillance bodies; a patchwork of divergent US state approaches (intent-based Texas vs disclosure-based Colorado vs risk-tiered EU) creating cross-border compliance friction; and unresolved tension between AI training-data practices and GDPR/state privacy obligations.",
  "content": "\n\n- ### Recent Developments (2025\u20132026)\n  - **US Federal Policy & Executive Action**\n    - The Trump AI executive order, signed in 2025, requires AI labs to make advanced models available to the government 30 days prior to public release, a reduction from the 90-day period proposed in the previous draft.\n    - The order explicitly disclaims the creation of a mandatory government licensing, pre-clearance, or permitting requirement for the development of new AI models, stating: \"Nothing in this section shall be construed to authorize the creation of a mandatory government licensing, pre-clearance, or permitting requirement for the development of new AI models.\"\n    - The NSA has been assigned primary responsibility for testing advanced AI models under the new executive order, with support from various cyber technology and defense agencies.\n    - Political discourse is shifting, with predictions that a more full-throated and clearly articulated anti-AI position will emerge from the right in the US during late 2025, moving into political soundbite terms.\n  - **Corporate & Legal Landscape**\n    - Apple's lawsuit against OpenAI was weakened after Apple admitted its outside lawyers emailed the wrong person at OpenAI, confusing two Asian last names, regarding a prior contact attempt. This admission was made only after the error was brought to their attention.\n    - HP announced 4,000 to 6,000 job cuts in November 2025, which were widely attributed to AI-related workforce reductions, continuing a trend of white-collar job displacement.\n  - **Enterprise AI Adoption**\n    - The dominant narrative for enterprise AI in 2025 is that while AI and agents are extremely valuable, their implementation is not as simple as \"flipping on some switch.\" It involves serious reorganization, data readiness, and capacity building, creating a growing gap between leaders and laggards."
}
```

# Dossier: Supply Chain

- status: `candidate_rejected`
- target page: `Supply Chain.md`
- assertions: 9 across episodes: bezos-is-back-to-build-ai, ceo-led-ai-gets-3x-the-roi, chatgpt-55-rumors-start-to-bubble, claude-code-is-now-writing-claude-code, how-big-is-the-ai-economy, how-the-escalating-ai-wars-benefit-you, how-the-global-ai-race-has-changed, the-calm-before-the-agi-storm
- reasons: rubric_a_improvement -1.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -1.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.67

## Assertions
- **The focus of Project Prometheus on AI for manufacturing is viewed as a bullish sign for the American industrial sector, representing a shift from 'shiny chatbots' to the 'boring trillion dollar layer' of the real economy.**
  - tier 2, confidence 0.75, source Rohit Mita / AI Tools 2.0 / Podcast Host, episode `bezos-is-back-to-build-ai`, fp `3871c0ce69d90cb0`
- **Micron reported 445% year-over-year revenue growth and a 74% quarter-over-quarter jump, guiding for a further 22% revenue increase in the next quarter.**
  - tier 1, confidence 0.98, source Micron Earnings Report, episode `ceo-led-ai-gets-3x-the-roi`, fp `1f10fa87508e4a00`
- **OpenAI is continuing to increase Nvidia GPU orders despite the launch of its custom Jalapeño chip, as compute demand remains 'insatiable.'**
  - tier 2, confidence 0.9, source Greg Brockman / Hock Tan, episode `ceo-led-ai-gets-3x-the-roi`, fp `bd4181a0f50317e7`
- **A supply chain leak indicates OpenAI is developing a special audio hardware device codenamed 'Sweet Pee' intended to replace AirPods, with a target release near September.**
  - tier 1, confidence 0.85, source Chinese consumer electronics blogger (cited by Host), episode `chatgpt-55-rumors-start-to-bubble`, fp `d60ced43f170f70f`
- **OpenAI has shifted its consumer device manufacturing strategy away from China's Luxshare to non-China suppliers due to strategic supply chain considerations.**
  - tier 2, confidence 0.8, source Counterpoint Analyst Jukan, episode `claude-code-is-now-writing-claude-code`, fp `a2a29d7a83253688`
- **Micron has increased memory prices by more than 60% over the past 3 months and quadrupled them over the past year, targeting 84% gross margins by the end of the year.**
  - tier 1, confidence 0.9, source Financial Reports / Host Analysis, episode `how-big-is-the-ai-economy`, fp `50a2953524f41362`
- **SK Hynix Chairman Chey Tae-won predicts that 2027 will be the worst year in terms of memory supply shortage.**
  - tier 2, confidence 0.85, source Chey Tae-won (SK Hynix Chairman), episode `how-the-escalating-ai-wars-benefit-you`, fp `4ba30b6e1a7e36d0`
- **Zhipu announced in January that it trained its first model exclusively on Huawei chips, serving as a proof of concept for a complete domestic Chinese hardware and software stack for AI training.**
  - tier 1, confidence 0.95, source Podcast Host, episode `how-the-global-ai-race-has-changed`, fp `9430422f34ef5f8b`
- **Bloomberg reported that more than half of US data centers are expected to face delays or cancellation due to a lack of electrical equipment, such as transformers and switchgear, despite electrical infrastructure representing only 10% of total project costs.**
  - tier 1, confidence 0.9, source Bloomberg (cited by Host), episode `the-calm-before-the-agi-storm`, fp `c7c2ee4b8a50da85`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Water and biodiversity risk** \u2014 upstream agricultural and mining supply chains face growing scrutiny over water use and land-use change.",
  "content": "\n\n- ### Recent Developments\n  - **AI-driven manufacturing shift** \u2014 Industry observers, including Rohit Mita (AI Tools 2.0), describe the focus of initiatives like Project Prometheus on AI for manufacturing as \"the most bullish sign for American manufacturing,\" representing a strategic shift from consumer-facing \"shiny chatbots\" to the \"boring trillion dollar layer\" of the real economy.\n  - **Memory supply constraints** \u2014 Micron reported 445% year-over-year revenue growth and a 74% quarter-over-quarter jump, with gross margins expanding to 56% and forecasts targeting 84\u201386% by year-end. SK Hynix Chairman Chey Tae-won predicts 2027 will be the \"worst year in terms of memory supply shortage,\" citing exponential demand from AI agents and physical AI robots.\n  - **Compute infrastructure demand** \u2014 OpenAI continues to increase Nvidia GPU orders despite developing custom silicon (codenamed \"Jalape\u00f1o\"), with Greg Brockman stating the company \"cannot get compute fast enough.\" Broadcom CEO Hock Tan noted that customer demand is \"much more than we can address\" through 2028.\n  - **Consumer hardware supply chain diversification** \u2014 A supply chain leak indicates OpenAI is developing an audio device codenamed \"Sweet Pee\" (targeting 40\u201350 million units in year one). The company has shifted its manufacturing strategy away from China\u2019s Luxshare to non-China suppliers due to strategic supply chain considerations.\n  - **Domestic hardware stacks** \u2014 Zhipu announced in January that it trained its first model exclusively on Huawei chips, serving as a proof of concept for a complete domestic Chinese hardware and software stack for AI training.\n  - **Electrical infrastructure bottlenecks** \u2014 Bloomberg reports that more than half of US data centers are expected to face delays or cancellation due to a lack of electrical equipment (transformers, switchgear), despite this category representing only 10% of total project costs."
}
```

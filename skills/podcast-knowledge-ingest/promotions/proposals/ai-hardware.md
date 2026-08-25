# Dossier: AI Hardware

- status: `candidate_survivor`
- target page: `AI Hardware.md`
- assertions: 11 across episodes: black-friday-gpt, ceo-led-ai-gets-3x-the-roi, claude-code-turns-one, gemini-can-now-write-you-a-song, google-says-no-ads-planned-for-gemini, how-deepseek-v4-connects-to-the-us-grid, how-the-global-ai-race-has-changed, the-calm-before-the-agi-storm, what-google-needs-to-do-at-io-this-week

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.82

## Assertions
- **The rise of Google TPU as a viable alternative to Nvidia GPUs is being taken seriously by analysts and competitors, particularly after reports that Gemini 3 was trained on TPUs and Meta may be purchasing them.**
  - tier 2, confidence 0.8, source Host (industry trend analysis), episode `black-friday-gpt`, fp `ab439ae4d2f22b42`
- **OpenAI has unveiled its first in-house AI chip, codenamed Jalapeño, developed in collaboration with Broadcom as an ASIC for LLM inference.**
  - tier 1, confidence 0.98, source OpenAI / Greg Brockman, episode `ceo-led-ai-gets-3x-the-roi`, fp `48ef0657d287b8af`
- **OpenAI achieved a 9-month development cycle from initial design to manufacturing tapeout for the Jalapeño chip, attributed to AI-enhanced design processes.**
  - tier 1, confidence 0.95, source OpenAI / Greg Brockman, episode `ceo-led-ai-gets-3x-the-roi`, fp `22967aa187bc6488`
- **OpenAI is developing a family of AI hardware devices, including a smart speaker priced between $200 and $300, with a team of 200 people dedicated to the project.**
  - tier 1, confidence 0.85, source The Information / AI Daily Brief Host, episode `claude-code-turns-one`, fp `b75dd19a4cb08056`
- **Meta has revived plans for a smartwatch under the code name 'Malibu 2,' featuring health tracking and a built-in Meta AI assistant, with a planned release this year.**
  - tier 1, confidence 0.9, source Podcast Host (citing industry reports), episode `gemini-can-now-write-you-a-song`, fp `67992e3131c7a325`
- **Apple reportedly passed on developing a camera-equipped Apple Watch for AI purposes because testers found the prototype impractical due to clothing sleeves obscuring the camera.**
  - tier 2, confidence 0.75, source Podcast Host (citing rumors/reports), episode `gemini-can-now-write-you-a-song`, fp `0f5627e8cb4027d3`
- **OpenAI Chief Global Affairs Officer Chris Leane stated that OpenAI is on track to unveil its first hardware device in the latter part of 2026.**
  - tier 1, confidence 0.85, source Chris Leane (OpenAI), episode `google-says-no-ads-planned-for-gemini`, fp `6d4fee796d35bed6`
- **Nvidia became the world's first $5 trillion company, reaching this valuation just 9 months after becoming the first $4 trillion company.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Market Data, episode `how-deepseek-v4-connects-to-the-us-grid`, fp `e220e6eba30c6398`
- **G42 CEO Peng Zhao unveiled a chip using Cerebras's wafer-scale manufacturing process, which is physically larger than Nvidia chips, at the World Government Summit in Dubai.**
  - tier 1, confidence 0.9, source Podcast Host, episode `how-the-global-ai-race-has-changed`, fp `f8f8a76edd13e5b6`
- **The Iranian Revolutionary Guard declared 18 US tech companies, including Nvidia, Apple, Microsoft, and Google, as legitimate targets for retaliation, linking them to AI-enhanced targeting in the war, which has put data center construction plans in the Middle East at risk.**
  - tier 1, confidence 0.85, source Host (AI Daily Brief), episode `the-calm-before-the-agi-storm`, fp `2aef78a9dba59e39`
- **Cerebras stock opened at a $40 billion market capitalization, briefly touched $100 billion, and closed its first day of trading with a 68% gain at a $66 billion valuation.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `what-google-needs-to-do-at-io-this-week`, fp `64fe57dcb8df4b22`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - sources::\n  - migration-date:: 2026-04-26T00:00:00Z",
  "content": "\n\n- ### Recent Developments (2025\u20132026)\n  - **OpenAI Jalape\u00f1o Chip**: OpenAI unveiled its first in-house AI chip, codenamed Jalape\u00f1o, developed with Broadcom as an ASIC for LLM inference. The chip represents the first accelerator in a multi-generation compute platform, distinct from general-purpose GPUs. OpenAI achieved a 9-month development cycle from design to tapeout, attributed to AI-enhanced design processes. [source: OpenAI / Greg Brockman, confidence 0.98, tier 1]\n  - **OpenAI Hardware Devices**: OpenAI is developing a family of AI hardware devices, including a smart speaker priced between $200 and $300, with a dedicated team of 200 people. Chief Global Affairs Officer Chris Leane stated the company is on track to unveil its first hardware device in late 2026. [source: The Information / Chris Leane, confidence 0.85, tier 1]\n  - **Google TPU Momentum**: Analysts are taking Google TPUs seriously as a viable alternative to Nvidia GPUs, particularly after reports that Gemini 3 was trained on TPUs and that Meta may be purchasing them. [source: Host (industry trend analysis), confidence 0.8, tier 2]\n  - **Market Valuations**: Nvidia became the world's first $5 trillion company, reaching this milestone just 9 months after becoming the first $4 trillion company. Cerebras stock opened at a $40 billion market capitalization, briefly touched $100 billion, and closed its first day of trading with a 68% gain at a $66 billion valuation. [source: AI Daily Brief Host / Market Data, confidence 0.95, tier 1]\n  - **G42 Wafer-Scale Chip**: G42 CEO Peng Zhao unveiled a chip using Cerebras's wafer-scale manufacturing process, physically larger than Nvidia chips, at the World Government Summit in Dubai. [source: Podcast Host, confidence 0.9, tier 1]\n  - **Meta & Apple AI Devices**: Meta revived plans for a smartwatch under the code name 'Malibu 2,' featuring health tracking and a built-in Meta AI assistant, planned for release this year. Apple reportedly passed on developing a camera-equipped Apple Watch for AI purposes due to prototype impracticality. [source: Podcast Host, confidence 0.85, tier 1]\n  - **Geopolitical Risks**: The Iranian Revolutionary Guard declared 18 US tech companies, including Nvidia, Apple, Microsoft, and Google, as legitimate targets for retaliation, linking them to AI-enhanced targeting. This has put data center construction plans in the Middle East at risk. [source: Host (AI Daily Brief), confidence 0.85, tier 1]"
}
```

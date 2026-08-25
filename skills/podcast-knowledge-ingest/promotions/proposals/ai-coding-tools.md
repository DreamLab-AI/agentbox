# Dossier: AI Coding Tools

- status: `candidate_survivor`
- target page: `AI Coding Tools.md`
- assertions: 9 across episodes: openai-preps-new-garlic-model, the-dawn-of-the-agent-age, the-state-of-enterprise-ai-the-state-of-enterprise-ai, what-happens-when-ai-obliterates-your-business-model, what-people-are-actually-using-ai-for-right-now, white-hot-cursor-doubles-revenue, why-2026-is-the-year-of-the-ai-builder-with-lovable-ceo-anton-osika, why-ai-advantage-compounds

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Claude Code reached a billion dollars in annual recurring revenue (ARR) in only 6 months.**
  - tier 1, confidence 0.95, source Mike Kger, Chief Product Officer at Anthropic, episode `openai-preps-new-garlic-model`, fp `a53453d4018a54fb`
- **Anthropic released Claude Co-work, a product described as 'Claude Code for everyone else,' which was built in approximately 10 days primarily by Claude Code itself.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `the-dawn-of-the-agent-age`, fp `08ad2eb547b83724`
- **The 'vibe coding' paradigm has shifted from being a tool for prototyping to the standard method for software development over the course of January 2026.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `the-dawn-of-the-agent-age`, fp `918edb46a5019129`
- **Enterprises spent $4 billion on AI coding in 2025, which accounted for 55% of overall departmental AI spend.**
  - tier 1, confidence 0.95, source Menlo Ventures State of Generative AI in the Enterprise report, episode `the-state-of-enterprise-ai-the-state-of-enterprise-ai`, fp `1fd8c00aaece31fb`
- **AI coding tools are shifting user behavior from visiting documentation sites to direct code generation, breaking the traditional funnel where documentation drives commercial product discovery.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `what-happens-when-ai-obliterates-your-business-model`, fp `2913b356eee12be4`
- **Programming became the dominant AI use case, growing from 11% of usage in early 2025 to over 50% by the end of the year.**
  - tier 1, confidence 0.95, source OpenRouter and a16z, episode `what-people-are-actually-using-ai-for-right-now`, fp `b032280a9e477e04`
- **Enterprise procurement dynamics for AI tools are significantly slower and more stable than the rapid switching behavior observed in startups and solopreneurship.**
  - tier 2, confidence 0.8, source Didi Das (Menlo Ventures), episode `white-hot-cursor-doubles-revenue`, fp `6cbc4150adb4d35b`
- **Lovable is used by Microsoft and Uber to accelerate team workflows, with many large enterprises rebuilding their workflows on top of the tool as infrastructure.**
  - tier 2, confidence 0.9, source Anton Osika, CEO of Lovable, episode `why-2026-is-the-year-of-the-ai-builder-with-lovable-ceo-anton-osika`, fp `9bf7e7bf97d8266e`
- **Frontier workers are 17 times more active in coding and 10 times as active in analysis and calculations compared to the median worker.**
  - tier 1, confidence 0.95, source OpenAI State of Enterprise AI Report, episode `why-ai-advantage-compounds`, fp `0dbb5b0050316f75`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - Sam Altman tweeted that more than 1 million people downloaded Codex in the first week, and that Codex saw 60% growth in overall usership last week. *(Source: Sam Altman, via AI Daily Brief, 2026-08-24)*",
  "content": "\n- ### Recent Developments\n  - **Revenue & Adoption Metrics**\n    - Claude Code reached a billion dollars in annual recurring revenue (ARR) in only 6 months. *(Source: Mike Kger, Chief Product Officer at Anthropic, confidence 0.95, tier 1)*\n    - Enterprises spent $4 billion on AI coding in 2025, which accounted for 55% of overall departmental AI spend. *(Source: Menlo Ventures State of Generative AI in the Enterprise report, confidence 0.95, tier 1)*\n    - Programming became the dominant AI use case, growing from 11% of usage in early 2025 to over 50% by the end of the year. *(Source: OpenRouter and a16z, confidence 0.95, tier 1)*\n  - **Product & Workflow Shifts**\n    - Anthropic released Claude Co-work, a product described as 'Claude Code for everyone else,' which was built in approximately 10 days primarily by Claude Code itself. *(Source: Host (AI Daily Brief), confidence 0.95, tier 1)*\n    - The 'vibe coding' paradigm has shifted from being a tool for prototyping to the standard method for software development over the course of January 2026. *(Source: Host (AI Daily Brief), confidence 0.85, tier 2)*\n    - Lovable is used by Microsoft and Uber to accelerate team workflows, with many large enterprises rebuilding their workflows on top of the tool as infrastructure. *(Source: Anton Osika, CEO of Lovable, confidence 0.9, tier 2)*\n  - **Behavioral & Procurement Dynamics**\n    - AI coding tools are shifting user behavior from visiting documentation sites to direct code generation, breaking the traditional funnel where documentation drives commercial product discovery. *(Source: Host (AI Daily Brief), confidence 0.85, tier 2)*\n    - Enterprise procurement dynamics for AI tools are significantly slower and more stable than the rapid switching behavior observed in startups and solopreneurship. *(Source: Didi Das (Menlo Ventures), confidence 0.8, tier 2)*\n    - Frontier workers are 17 times more active in coding and 10 times as active in analysis and calculations compared to the median worker. *(Source: OpenAI State of Enterprise AI Report, confidence 0.95, tier 1)*"
}
```

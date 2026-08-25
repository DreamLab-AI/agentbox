# Dossier: Venture Capital

- status: `candidate_rejected`
- target page: `Venture Capital.md`
- assertions: 12 across episodes: bezos-is-back-to-build-ai, claude-code-is-now-writing-claude-code, first-impressions-of-the-new-opus-48, grok-46-shows-how-fast-your-ai-options-are-expanding, how-ai-is-changing-how-companies-get-built, meta-delays-new-ai-model, microsofts-plan-to-make-people-less-angry-about-ai-and-electricity, nvidias-blowout-earnings-pops-the-ai-bubble-bubble, openai-declares-code-red, the-best-way-to-talk-to-your-agents, the-week-the-ai-story-shifted, what-google-needs-to-do-at-io-this-week
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Project Prometheus's $6.2 billion seed round makes it one of the most well-resourced early-stage AI startups, comparable to Thinking Machines Lab ($2B) and Safe Super Intelligence ($3B).**
  - tier 2, confidence 0.8, source Podcast Host, episode `bezos-is-back-to-build-ai`, fp `1eb3e5bf6a631086`
- **SoftBank has completed a $40 billion investment in OpenAI, owning roughly 11% of the company, after selling stakes in Nvidia and T-Mobile to fund the final payment.**
  - tier 1, confidence 0.95, source SoftBank / Reuters, episode `claude-code-is-now-writing-claude-code`, fp `ebd3725fe53970b4`
- **Cognition closed a $1 billion funding round at a $26 billion valuation, with Devin's enterprise usage up 10x year-over-year and revenue run rate approaching $500 million.**
  - tier 1, confidence 0.95, source Cognition (reported by host), episode `first-impressions-of-the-new-opus-48`, fp `1de56555ccca1c87`
- **Cognition is in early talks for a new funding round at a $40 billion valuation, seeking $1 billion in capital after doubling its revenue run rate to $1 billion in the last quarter.**
  - tier 1, confidence 0.9, source Bloomberg / AI Daily Brief Host, episode `grok-46-shows-how-fast-your-ai-options-are-expanding`, fp `fedafa4cc53467ba`
- **A study from Harvard Business School and INSEAD found that AI-native startups are 25% smaller, flatter, and more engineer-heavy, yet equally valued, due to AI scaling knowledge work without large teams.**
  - tier 1, confidence 0.85, source Harvard Business School / INSEAD (via AI Daily Brief host), episode `how-ai-is-changing-how-companies-get-built`, fp `7638a4cf0cb84fd9`
- **Cursor is in talks for a new funding round at a $50 billion valuation, nearly doubling its previous $29.3 billion valuation.**
  - tier 1, confidence 0.9, source Bloomberg, episode `meta-delays-new-ai-model`, fp `94a28af9db5d25d0`
- **Chipmaking startup Cerebrus is in talks to raise $1 billion at a $22 billion valuation, with plans to IPO in the second half of the year.**
  - tier 1, confidence 0.85, source Bloomberg, episode `microsofts-plan-to-make-people-less-angry-about-ai-and-electricity`, fp `5265dc0193cb9f42`
- **AI music startup Suno raised $250 million at a $2.45 billion valuation, led by Menlo Ventures, and disclosed reaching $200 million in revenue.**
  - tier 1, confidence 0.9, source Podcast host (reporting on funding round), episode `nvidias-blowout-earnings-pops-the-ai-bubble-bubble`, fp `7732fed88899e11d`
- **OpenAI's ability to raise hundreds of billions of dollars in the coming years depends heavily on the broad public perception of its competitive standing against Google.**
  - tier 2, confidence 0.8, source The Information (reported by Sam Alman), episode `openai-declares-code-red`, fp `f146d8b8a90f8b81`
- **Anthropic is considering a final private funding round before its IPO, with sources indicating the round could raise up to $50 billion at a pre-money valuation of $900 billion.**
  - tier 1, confidence 0.95, source Financial Times (reported by AI Daily Brief host), episode `the-best-way-to-talk-to-your-agents`, fp `d3acd7f1b2ec0b17`
- **11 Labs reached $500 million in annualized revenue and added new investors including Nvidia, BlackRock, Wellington, and Santander.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief), episode `the-week-the-ai-story-shifted`, fp `6bfe5115e41df51a`
- **The Financial Times reports that Anthropic is raising $30 billion at a $900 billion valuation, a round co-led by Sequoia and Altimeter, which would nearly triple their previous $380 billion Series G valuation.**
  - tier 1, confidence 0.9, source Financial Times via AI Daily Brief host, episode `what-google-needs-to-do-at-io-this-week`, fp `f27df5a436599eb8`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- Bridging traditional finance into crypto via token-and-equity hybrid deals.",
  "content": "\n- ### Recent Developments\n- **Anthropic**: The Financial Times reports that Anthropic is raising $30 billion at a $900 billion valuation, a round co-led by Sequoia and Altimeter, which would nearly triple their previous $380 billion Series G valuation. Sources indicate this could be a final private round before an IPO, with potential to raise up to $50 billion at a $900 billion pre-money valuation.\n- **OpenAI**: SoftBank has completed a $40 billion investment in OpenAI, owning roughly 11% of the company, after selling stakes in Nvidia and T-Mobile to fund the final payment. OpenAI's ability to raise hundreds of billions of dollars in the coming years depends heavily on the broad public perception of its competitive standing against Google.\n- **Cognition**: The company closed a $1 billion funding round at a $26 billion valuation, with Devin's enterprise usage up 10x year-over-year and revenue run rate approaching $500 million. Cognition is now in early talks for a new funding round at a $40 billion valuation, seeking $1 billion in capital after doubling its revenue run rate to $1 billion in the last quarter.\n- **Cursor**: In talks for a new funding round at a $50 billion valuation, nearly doubling its previous $29.3 billion valuation from November.\n- **Project Prometheus**: Raised a $6.2 billion seed round, making it one of the most well-resourced early-stage AI startups, comparable to Thinking Machines Lab ($2B) and Safe Super Intelligence ($3B).\n- **Cerebrus**: The chipmaking startup is in talks to raise $1 billion at a $22 billion valuation, with plans to IPO in the second half of the year.\n- **Suno**: The AI music startup raised $250 million at a $2.45 billion valuation, led by Menlo Ventures, and disclosed reaching $200 million in revenue.\n- **11 Labs**: Reached $500 million in annualized revenue and added new investors including Nvidia, BlackRock, Wellington, and Santander.\n- **AI-Native Startups**: A study from Harvard Business School and INSEAD found that AI-native startups are 25% smaller, flatter, and more engineer-heavy, yet equally valued, due to AI scaling knowledge work without large teams."
}
```

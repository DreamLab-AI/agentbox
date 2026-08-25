# Dossier: AI Productivity Gains

- status: `candidate_survivor`
- target page: `AI Productivity Gains.md`
- assertions: 7 across episodes: the-ai-acceleration-gap, the-ai-productivity-boom-finally-shows-up, the-final-ai-word-from-davos, what-1250-professionals-said-about-working-with-ai, what-people-are-actually-using-ai-for-right-now, why-ai-advantage-compounds

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Midjourney founder David Holz reported completing more personal coding projects over the Christmas break than in the previous 10 years combined, attributing this to new AI capabilities.**
  - tier 2, confidence 0.95, source David Holz (via AI Daily Brief host), episode `the-ai-acceleration-gap`, fp `6bb0d6f9855f7cb4`
- **Alex Imas, a professor at the University of Chicago, stated that 'sooner came pretty quickly' regarding the emergence of AI productivity gains in aggregate data, following the release of the revised BLS statistics.**
  - tier 2, confidence 0.8, source Alex Imas, episode `the-ai-productivity-boom-finally-shows-up`, fp `63334f04f46b3585`
- **Cisco reported that AI has enabled the completion of projects that were previously too tedious to contemplate, now achievable in a couple of weeks.**
  - tier 2, confidence 0.8, source Cisco, episode `the-final-ai-word-from-davos`, fp `bc717c1a834cd29f`
- **86% of professionals in the Anthropic study reported that AI saves them time.**
  - tier 1, confidence 0.95, source Anthropic (cited by host), episode `what-1250-professionals-said-about-working-with-ai`, fp `91ed352da947a8b4`
- **Users are willing to pay 10 to 50 times more per token for models like Claude or GPT-5 if it saves them 10 minutes of debugging.**
  - tier 2, confidence 0.8, source Tengan (Chain of Thought AI newsletter), episode `what-people-are-actually-using-ai-for-right-now`, fp `5abf9da21fbf0623`
- **96% of US senior leaders surveyed by EY reported seeing AI-driven productivity gains, with 57% reporting significant gains.**
  - tier 1, confidence 0.95, source EY Pulse Survey, episode `why-ai-advantage-compounds`, fp `e0e5bf537aab43fc`
- **71% of organizations investing $10 million or more in AI reported significant productivity gains, compared to 52% of those investing less than $10 million.**
  - tier 1, confidence 0.95, source EY Pulse Survey, episode `why-ai-advantage-compounds`, fp `ba53e2a37f3f5c24`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Relationships",
  "content": "- ### Recent Developments\n  - **Anthropic Economic Index (2026-08-24):** 86% of professionals in the study reported that AI saves them time. *(Source: Anthropic, confidence 0.95, tier 1)*\n  - **EY Pulse Survey:** 96% of US senior leaders reported seeing AI-driven productivity gains, with 57% reporting significant gains. Furthermore, 71% of organizations investing $10 million or more in AI reported significant productivity gains, compared to 52% of those investing less than $10 million. *(Source: EY Pulse Survey, confidence 0.95, tier 1)*\n  - **Expert Commentary:** Alex Imas, a professor at the University of Chicago, noted that \"sooner came pretty quickly\" regarding the emergence of AI productivity gains in aggregate data, following the release of revised BLS statistics. *(Source: Alex Imas, confidence 0.8, tier 2)*\n  - **Corporate Adoption:** Cisco reported that AI has enabled the completion of projects that were previously too tedious to contemplate, now achievable in a couple of weeks. *(Source: Cisco, confidence 0.8, tier 2)*\n  - **Individual Productivity:** Midjourney founder David Holz reported completing more personal coding projects over the Christmas break than in the previous 10 years combined, attributing this to new AI capabilities. *(Source: David Holz, confidence 0.95, tier 2)*\n  - **Economic Valuation:** Users are willing to pay 10 to 50 times more per token for models like Claude or GPT-5 if it saves them 10 minutes of debugging. *(Source: Tengan, confidence 0.8, tier 2)*\n- ### Relationships"
}
```

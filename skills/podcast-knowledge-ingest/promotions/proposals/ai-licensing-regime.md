# Dossier: AI Licensing Regime

- status: `candidate_survivor`
- target page: `AI Licensing Regime.md`
- assertions: 5 across episodes: mythos-returns-but-not-for-everyone, the-big-ways-ai-just-changed, the-week-ai-grew-up, why-everyone-is-debating-ai-policy

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Commerce Secretary Howard Lutnick determined that appropriate safeguards are in place to permit certain trusted partners to access the Claude Mythos 5 model.**
  - tier 1, confidence 0.95, source Howard Lutnick (Commerce Secretary) via letter to Anthropic, episode `mythos-returns-but-not-for-everyone`, fp `3851a00ef72fa9d0`
- **Frontier AI models are now subject to a licensing regime that has not been passed by Congress, established in an executive order, or fully articulated in public.**
  - tier 2, confidence 0.85, source AI Daily Brief Host, episode `mythos-returns-but-not-for-everyone`, fp `25a1d16e10615bf1`
- **OpenAI announced that GPT-5.6 would be a set of three different models, with the US government approving access to each wave of new users and companies.**
  - tier 1, confidence 0.85, source Host (AI Daily Brief), episode `the-big-ways-ai-just-changed`, fp `79c62c5ea6fd5692`
- **The US government is restricting the rollout of new AI models based on policy considerations, marking the first known case of such a licensing regime in the US.**
  - tier 2, confidence 0.8, source Dean Ball (AI Politics and Governance Expert), episode `the-week-ai-grew-up`, fp `445ed9c42736954b`
- **The White House has established a de facto licensing regime for frontier AI models, where the timing and scope of releases are influenced by government officials, despite official claims that the process is voluntary.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `why-everyone-is-debating-ai-policy`, fp `729f0c21c0fef804`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - The US government lifted its block on the Mythos model for approximately 100 selected institutions, including major US companies and government agencies. *(Source: News outlets (via podcast host), via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - Commerce Secretary Howard Lutnick determined that appropriate safeguards are in place to permit certain trusted partners to access the Claude Mythos 5 model. *(Source: Howard Lutnick (Commerce Secretary) via letter to Anthropic, confidence 0.95, tier 1)*\n  - Frontier AI models are now subject to a licensing regime that has not been passed by Congress, established in an executive order, or fully articulated in public. *(Source: AI Daily Brief Host, confidence 0.85, tier 2)*\n  - OpenAI announced that GPT-5.6 would be a set of three different models, with the US government approving access to each wave of new users and companies. *(Source: Host (AI Daily Brief), confidence 0.85, tier 1)*\n  - The US government is restricting the rollout of new AI models based on policy considerations, marking the first known case of such a licensing regime in the US. *(Source: Dean Ball (AI Politics and Governance Expert), confidence 0.8, tier 2)*\n  - The White House has established a de facto licensing regime for frontier AI models, where the timing and scope of releases are influenced by government officials, despite official claims that the process is voluntary. *(Source: Host (AI Daily Brief), confidence 0.85, tier 2)*"
}
```

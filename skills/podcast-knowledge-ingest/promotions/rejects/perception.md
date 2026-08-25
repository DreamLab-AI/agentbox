# Dossier: Perception

- status: `candidate_rejected`
- target page: `Perception.md`
- assertions: 5 across episodes: dario-amodei-breaks-his-social-media-silence, did-the-super-bowl-as-make-americans-like-ai-any-more, first-impressions-of-the-new-opus-48, how-harness-as-a-service-will-change-agents
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5; completeness 0.40 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.40

## Assertions
- **Dario Amodei argues that the public's negative view of AI is fundamentally a crisis of trust in institutions, not a result of AI leaders' messaging, and that the only way to restore trust is through tangible delivery of benefits like curing diseases.**
  - tier 2, confidence 0.85, source Dario Amodei, episode `dario-amodei-breaks-his-social-media-silence`, fp `55ceaeacf1da7ee8`
- **According to an Edelman study, only 32% of Americans trust AI.**
  - tier 1, confidence 0.95, source Edelman (cited by host), episode `did-the-super-bowl-as-make-americans-like-ai-any-more`, fp `1c4ebb7925e73fa0`
- **Anthropic's Super Bowl ad failed to land effectively because the general public lacked the context that it was a critique of OpenAI's upcoming ad-supported ChatGPT, leading many to interpret it as a generic critique of AI's commercialization.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `did-the-super-bowl-as-make-americans-like-ai-any-more`, fp `e5af51e88848e674`
- **GPT-5.6 could plausibly become the stronger overall model than Claude Opus 4.8 if OpenAI maintains its current trajectory, as the combination of GPT-5.5 and Codex has shifted momentum to OpenAI among power users.**
  - tier 3, confidence 0.5, source Host Analysis / Chubbyonx, episode `first-impressions-of-the-new-opus-48`, fp `da210755ec6532e3`
- **Microsoft is facing a narrative challenge where it is being lumped in with 'SaaS apocalypse' stocks, and investors are demanding clearer evidence of AI-powered products beyond Azure to justify its valuation.**
  - tier 2, confidence 0.8, source Gene Munster / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `1aeeda09ea5a1f07`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Ethical considerations around [[Computer Vision]] perception \u2014 bias in training data, surveillance misuse, and consent \u2014 are increasingly subject to regulatory scrutiny and standardisation efforts.",
  "content": "\n\n- ### Public Perception and Trust\n  - Public trust in AI remains low, with an Edelman study indicating that only 32% of Americans trust the technology.\n  - Dario Amodei argues that this negative public view is fundamentally a crisis of trust in institutions rather than a result of AI leaders' messaging, asserting that tangible delivery of benefits\u2014such as curing diseases\u2014is the only effective way to restore confidence.\n  - Communication challenges persist, as illustrated by the mixed reception of Anthropic's Super Bowl ad, which many viewers interpreted as a generic critique of AI commercialization due to a lack of context regarding its specific target.\n  - Corporate narratives are also under pressure; Microsoft faces investor scrutiny as it is grouped with 'SaaS apocalypse' stocks, with analysts noting that products like Copilot have yet to provide sufficient evidence of AI-driven value beyond Azure to justify its valuation."
}
```

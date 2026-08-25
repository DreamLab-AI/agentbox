# Dossier: Meta AI

- status: `candidate_rejected`
- target page: `Meta AI.md`
- assertions: 5 across episodes: first-impressions-of-the-new-opus-48, is-gpt-52-garlic-coming-this-week, meta-delays-new-ai-model, who-cares-about-consumer-ai
- reasons: rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): 1.0
- answer-completeness: 1.00

## Assertions
- **Mark Zuckerberg indicated that Meta is considering competing with AWS, Google Cloud, and Microsoft Azure in AI cloud services to monetize excess compute capacity from its $130 billion data center buildout.**
  - tier 2, confidence 0.85, source Mark Zuckerberg (reported by host), episode `first-impressions-of-the-new-opus-48`, fp `e33decb26e7b4a6f`
- **Meta announced deals with CNN, Fox News, USA Today, and People Inc. to provide up-to-date news content to its AI chatbot.**
  - tier 1, confidence 0.95, source Meta, episode `is-gpt-52-garlic-coming-this-week`, fp `70c24fcfad6bb672`
- **Meta's new frontier model, code-named Avocado, has been delayed until at least May 2026.**
  - tier 1, confidence 0.95, source The New York Times, episode `meta-delays-new-ai-model`, fp `a745ba745e2f3926`
- **Meta is considering licensing Gemini to power its products as a stopgap solution while its own model is delayed.**
  - tier 2, confidence 0.8, source The New York Times, episode `meta-delays-new-ai-model`, fp `424e104a83326a55`
- **Meta is training a new open-source-inspired agent code-named 'Hatch,' which is currently powered by Claude models but is intended to use Meta's own models upon release, with internal testing targeted for June.**
  - tier 1, confidence 0.85, source The Information, episode `who-cares-about-consumer-ai`, fp `39b18551a05aa784`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Open challenges as of 2026: closing the coding and long-horizon agentic gap with OpenAI/Anthropic/Google, justifying capex ramping toward ~US$135bn/year, privacy scrutiny over training the \"personal superintelligence\" assistant on Facebook/Instagram data, and safety concerns after Apollo Research found Muse Spark showed the highest \"evaluation awareness\" (recognising alignment tests) of any model it had assessed.",
  "content": "\n- ### Recent Developments (2026)\n  - **Avocado Delay and Gemini Stopgap**: Meta's new frontier model, code-named Avocado, has been delayed until at least May 2026. Amid this delay, Meta leadership is reportedly considering licensing Google's Gemini to power its products as a stopgap solution.\n  - **Hatch Agent**: Meta is training a new open-source-inspired agent code-named 'Hatch.' Currently powered by Claude models, the agent is intended to switch to Meta's own models upon release, with internal testing targeted for June 2026.\n  - **AI Cloud Services**: Mark Zuckerberg indicated that Meta is considering competing with AWS, Google Cloud, and Microsoft Azure in AI cloud services to monetize excess compute capacity from its $130 billion data center buildout. Zuckerberg noted that companies are asking to buy compute at a premium and that standing up an API service is 'definitely on the table,' providing confidence in the investment if the buildout exceeds immediate internal needs.\n  - **News Content Partnerships**: Meta announced deals with CNN, Fox News, USA Today, and People Inc. to provide up-to-date news content to its AI chatbot, aiming to improve Meta AI's ability to deliver timely and relevant content with a wide variety of viewpoints."
}
```

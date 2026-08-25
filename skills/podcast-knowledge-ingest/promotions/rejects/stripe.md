# Dossier: Stripe

- status: `candidate_rejected`
- target page: `Stripe.md`
- assertions: 5 across episodes: how-ai-is-changing-how-companies-get-built, is-openai-the-new-github, the-right-way-to-worry-about-ai, why-ai-hasnt-increased-unemployment-according-to-anthropic
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Stripe's economics team found that the share of businesses reaching $1 million in cumulative revenue within a year was roughly 30% higher for the 2025 cohort compared to the 2023 cohort, and 3x higher than the 2019 cohort.**
  - tier 1, confidence 0.9, source Stripe Economics Team (via AI Daily Brief host), episode `how-ai-is-changing-how-companies-get-built`, fp `d4a40d22cdeb5ac8`
- **Solo startup founders account for 63% of Stripe Atlas corporate formations in Q2 2026, an all-time high, with these companies often building AI-native products and selling globally from launch.**
  - tier 1, confidence 0.9, source Stripe Atlas (via AI Daily Brief host), episode `how-ai-is-changing-how-companies-get-built`, fp `9c906bf47eb4fd41`
- **Stripe has previewed a feature that allows AI app developers to automatically charge usage fees based on token consumption, integrating with platforms like Vercel and OpenRouter.**
  - tier 1, confidence 0.95, source Host (citing Stripe announcement), episode `is-openai-the-new-github`, fp `223624d12d113e40`
- **Stripe has entered exclusive talks to acquire the model routing startup OpenRouter for approximately $10 billion.**
  - tier 1, confidence 0.9, source The Information, episode `the-right-way-to-worry-about-ai`, fp `02d3e59287144b23`
- **Stripe is in talks to acquire OpenRouter for approximately $10 billion, a significant increase from OpenRouter's $1.3 billion valuation in May.**
  - tier 1, confidence 0.95, source Wall Street Journal (reported by AI Daily Brief host), episode `why-ai-hasnt-increased-unemployment-according-to-anthropic`, fp `bac6cc8782ef0a74`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Stripe Atlas** \u2014 company incorporation service assisting founders in incorporating in the US (typically Delaware) and accessing US banking and payments infrastructure.",
  "content": "\n\n- ### Recent Developments\n  - **AI-Native Billing and Token Metering** \u2014 Stripe has previewed a feature enabling AI application developers to automatically charge usage fees based on token consumption. This billing tool integrates directly with token tracking and model routing platforms such as Vercel and OpenRouter, simplifying monetization for AI-native products.\n  - **OpenRouter Acquisition Talks** \u2014 Stripe is in exclusive talks to acquire the model routing startup OpenRouter for approximately $10 billion. This proposed valuation represents a significant increase from OpenRouter's $1.3 billion valuation established during its previous funding round in May.\n  - **Solo Founder Growth in Stripe Atlas** \u2014 Solo startup founders accounted for 63% of Stripe Atlas corporate formations in Q2 2026, an all-time high. These entities are characterized by building AI-native products, selling globally from launch, and maintaining a B2B focus with higher customer retention rates.\n  - **Accelerating Merchant Revenue Milestones** \u2014 Analysis by Stripe's economics team indicates that the 2025 cohort of businesses was roughly 30% more likely to reach $1 million in cumulative revenue within a year compared to the 2023 cohort, and 3x more likely than the 2019 cohort, suggesting that newer merchants are reaching material transaction volumes earlier."
}
```

# Dossier: Advertising

- status: `candidate_survivor`
- target page: `Advertising.md`
- assertions: 6 across episodes: did-the-super-bowl-as-make-americans-like-ai-any-more, google-says-no-ads-planned-for-gemini, how-to-make-chatgpt-ads-not-suck

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 1.0
- rubric-B improvement (after vs before): 1.0
- answer-completeness: 1.00

## Assertions
- **An iSpot survey of 500 viewers found that Anthropic's Super Bowl ad had a likeability score in the bottom 3% compared with Super Bowl ads over the past 5 years.**
  - tier 1, confidence 0.9, source iSpot / Adweek (cited by host), episode `did-the-super-bowl-as-make-americans-like-ai-any-more`, fp `7d492cb500e7c2a0`
- **Google DeepMind CEO Demis Hassabis stated that Google currently has no plans to bring advertising to the Gemini app.**
  - tier 1, confidence 0.95, source Demis Hassabis (via Alex Heath of Sources), episode `google-says-no-ads-planned-for-gemini`, fp `992a523298ef8797`
- **Ad Week reported in December that Google told advertising clients that ad placements in Gemini were targeted for a 2026 rollout.**
  - tier 1, confidence 0.9, source Ad Week, episode `google-says-no-ads-planned-for-gemini`, fp `784904c7c750731c`
- **Google is already offering ads in AI search, including a new feature called 'direct offers' that presents personalized discounts in AI mode.**
  - tier 1, confidence 0.9, source Dan Taylor (Google VP of Global Ads), episode `google-says-no-ads-planned-for-gemini`, fp `88a52b90cebe4cb1`
- **Google may see an opportunity to win margin against ChatGPT by holding out longer on ads, but it is unlikely that Gemini's free version will remain ad-free forever.**
  - tier 2, confidence 0.7, source Host (AI Daily Brief), episode `google-says-no-ads-planned-for-gemini`, fp `ceeaf46cde950bfa`
- **OpenAI announced it will begin testing ads in the free and Go tiers of ChatGPT in the coming weeks, with ads clearly labeled and separate from responses.**
  - tier 1, confidence 0.98, source OpenAI official announcement, episode `how-to-make-chatgpt-ads-not-suck`, fp `6e81385ff8a77386`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "Immersive advertising in extended reality environments and interactive connected TV (CTV) formats represent emerging channels with distinct creative and measurement paradigms.",
  "content": "\n\n- ### Recent Developments\n  - The integration of advertising into generative AI interfaces has become a focal point of industry strategy. OpenAI announced it will begin testing ads in the free and Go tiers of ChatGPT in the coming weeks, with ads clearly labeled and separate from responses, while Pro, Business, and Enterprise tiers will remain ad-free. In response, Google DeepMind CEO Demis Hassabis stated that Google currently has no plans to bring advertising to the Gemini app, noting it is interesting that OpenAI went for them so early. However, Ad Week reported in December that Google told advertising clients that ad placements in Gemini were targeted for a 2026 rollout, based on discussions with at least two anonymous clients. Meanwhile, Google is already offering ads in AI search, including a new feature called 'direct offers' that presents personalized discounts in AI mode, as AI mode and search in Gemini converge. Analysts suggest Google may be holding out longer on ads to win margin against ChatGPT, though it is unlikely that Gemini's free version will remain ad-free forever.\n\n  - In traditional broadcast advertising, performance metrics continue to highlight the importance of creative resonance. An iSpot survey of 500 viewers found that Anthropic's Super Bowl ad had a likeability score in the bottom 3% compared with Super Bowl ads over the past 5 years, with purchase intent 24% below Super Bowl norms."
}
```

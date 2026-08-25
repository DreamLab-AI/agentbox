# Dossier: Google Gemini

- status: `candidate_rejected`
- target page: `Google Gemini.md`
- assertions: 14 across episodes: did-the-super-bowl-as-make-americans-like-ai-any-more, openai-declares-code-red, should-we-be-scared-of-anthropics-mythos, the-ai-token-shortage-begins, the-biggest-battle-in-ai-is-for-your-personal-context, the-models-trying-to-replace-fable, what-people-are-actually-using-ai-for-right-now
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.92

## Assertions
- **Google's Gemini Super Bowl ad was widely acclaimed for its emotional, human-centric approach, successfully demonstrating product value through a relatable family narrative rather than technical features.**
  - tier 2, confidence 0.8, source Host / Social Media Consensus, episode `did-the-super-bowl-as-make-americans-like-ai-any-more`, fp `91f5678ebe95e854`
- **OpenAI research leader Mark Chen stated that the company has internal models performing at the level of Gemini 3 and is confident they will release them soon.**
  - tier 1, confidence 0.95, source Mark Chen (OpenAI Research Leader), episode `openai-declares-code-red`, fp `25df20840b0b17b7`
- **OpenAI is planning to ship a new reasoning model next week that the company claims is ahead of Google's Gemini 3 in internal evaluations.**
  - tier 1, confidence 0.9, source The Information (citing Sam Altman), episode `openai-declares-code-red`, fp `1c4cd147da5526be`
- **On Poly Market, betting odds for Google having the best AI model by the end of 2025 dropped from 92% to 88%, while OpenAI's odds jumped from 0.5% to 7.6% following the code red news.**
  - tier 1, confidence 0.9, source Poly Market (reported by Sam Alman), episode `openai-declares-code-red`, fp `cd5b7215e14581c2`
- **Google Gemini is currently ahead of OpenAI in terms of time per session and is catching up in monthly downloads, indicating a shift in user engagement metrics.**
  - tier 2, confidence 0.75, source Sam Alman (citing recent charts), episode `openai-declares-code-red`, fp `67cf452e9bf60806`
- **The absence of coding models from the reported code red priorities suggests OpenAI may view general consumer usage, not coding, as the primary front in its battle with Google.**
  - tier 2, confidence 0.7, source Sam Alman (Host Analysis), episode `openai-declares-code-red`, fp `a7ef570132b67cda`
- **It is predicted that other frontier labs, such as OpenAI and Google, will release models with similar capabilities to Claude Mythos within months, potentially as early as May at Google I/O.**
  - tier 3, confidence 0.55, source Chubby Kiminismus and other industry observers (via podcast host reporting), episode `should-we-be-scared-of-anthropics-mythos`, fp `95106ac1d261bab8`
- **Google introduced usage limits and usage-based billing on top of its Gemini plans at Google I/O in May 2026, effectively increasing costs for power users despite nominal price reductions.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `the-ai-token-shortage-begins`, fp `7b9cc5e89f44e453`
- **Google announced 'Personal Intelligence' for the Gemini app, allowing users to securely connect Google apps like Gmail, Photos, and YouTube to provide tailored answers.**
  - tier 1, confidence 0.95, source Sundar Pichai, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `384af742b8278da2`
- **Google's Personal Intelligence feature is designed to retrieve specific details from connected apps, such as car make and model from Gmail or travel preferences from Photos, to provide personalized recommendations.**
  - tier 1, confidence 0.9, source Google, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `80377f99316002c7`
- **AI YouTuber Matthew Berman stated that Google's Personal Intelligence feature makes Gemini his daily driver AI and noted that Google would have been too cautious to release such a feature 18 months ago.**
  - tier 2, confidence 0.85, source Matthew Berman, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `15828ba2bdd8622b`
- **Akos Gupta argued that Google's Personal Intelligence feature is an unreplicable AI mode because it connects to a user's entire digital life, including Gmail, Photos, YouTube, and search history since 2005.**
  - tier 2, confidence 0.85, source Akos Gupta, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `2adaca7cba19e527`
- **Google spent 2.7 billion dollars licensing Character AI's technology in 2024 to retain researcher Noam Shazeer.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `the-models-trying-to-replace-fable`, fp `6699c2779470e01f`
- **The 100 trillion token sample size in the study is between a tenth and a fifteenth of the tokens Google Gemini was serving per month before the release of Gemini 3.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `what-people-are-actually-using-ai-for-right-now`, fp `797a8745a3152279`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "The models support tool use and function calling, making them a backbone for agentic applications and search integration.",
  "content": "\n- ### Recent Developments\n  - **Competitive Landscape & Market Positioning**: OpenAI research leader Mark Chen stated that the company has internal models performing at the level of Gemini 3 and is confident they will release them soon. Additionally, OpenAI is planning to ship a new reasoning model that the company claims is ahead of Google's Gemini 3 in internal evaluations. Following these announcements, betting odds on Poly Market for Google having the best AI model by the end of 2025 dropped from 92% to 88%, while OpenAI's odds jumped from 0.5% to 7.6%. Despite this, recent charts indicate that Google Gemini is currently ahead of OpenAI in terms of time per session and is catching up in monthly downloads.\n  - **Personal Intelligence Feature**: Google announced 'Personal Intelligence' for the Gemini app, allowing users to securely connect Google apps like Gmail, Photos, and YouTube to provide tailored answers. This feature is designed to retrieve specific details from connected apps, such as car make and model from Gmail or travel preferences from Photos, to provide personalized recommendations. AI YouTuber Matthew Berman stated that this feature makes Gemini his daily driver AI, noting that Google would have been too cautious to release such a feature 18 months ago. Akos Gupta argued that this is an unreplicable AI mode because it connects to a user's entire digital life, including search history since 2005.\n  - **Business & Operational Updates**: In 2024, Google spent 2.7 billion dollars licensing Character AI's technology to retain researcher Noam Shazeer, who was rehired as the technical lead on the Gemini project. At Google I/O in May 2026, Google introduced usage limits and usage-based billing on top of its Gemini plans, effectively increasing costs for power users despite nominal price reductions. The company's Gemini Super Bowl ad was widely acclaimed for its emotional, human-centric approach, successfully demonstrating product value through a relatable family narrative rather than technical features.\n  - **Scale & Capacity**: The 100 trillion token sample size in recent studies is noted to be between a tenth and a fifteenth of the tokens Google Gemini was serving per month before the release of Gemini 3."
}
```

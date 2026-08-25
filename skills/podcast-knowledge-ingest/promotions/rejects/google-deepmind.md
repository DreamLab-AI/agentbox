# Dossier: Google DeepMind

- status: `candidate_rejected`
- target page: `Google DeepMind.md`
- assertions: 6 across episodes: ceo-led-ai-gets-3x-the-roi, gemini-can-now-write-you-a-song, google-says-no-ads-planned-for-gemini, how-apples-ai-strategy-changes-with-a-new-ceo, why-ai-users-are-raving-about-glm-52
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **The delay of Google's Gemini 3.5 Pro to July is linked to a significant exodus of senior researchers from DeepMind to Anthropic and OpenAI.**
  - tier 2, confidence 0.85, source Bloomberg / Business Insider, episode `ceo-led-ai-gets-3x-the-roi`, fp `cb6667fc0408ba90`
- **Google DeepMind launched Lyria 3, an AI music generation model that supports text, image, and video inputs and generates lyrics in eight languages.**
  - tier 1, confidence 0.95, source Podcast Host (citing Google DeepMind launch), episode `gemini-can-now-write-you-a-song`, fp `d852ead455034227`
- **Google DeepMind CEO Demis Hassabis stated that Google currently has no plans to bring advertising to the Gemini app.**
  - tier 1, confidence 0.95, source Demis Hassabis (via Alex Heath of Sources), episode `google-says-no-ads-planned-for-gemini`, fp `992a523298ef8797`
- **Google has formed a 'strike team' led by co-founder Sergey Brin to urgently bridge the gap in agentic coding execution, acknowledging that Anthropic currently holds the lead.**
  - tier 2, confidence 0.85, source The Information (cited by AI Daily Brief Host), episode `how-apples-ai-strategy-changes-with-a-new-ceo`, fp `dcc0a0256f47670c`
- **Gemini 3.5 Pro is reportedly slated for release on Tuesday, June 30th.**
  - tier 2, confidence 0.75, source Leo at Synthwave, episode `why-ai-users-are-raving-about-glm-52`, fp `9d4a9b4656dde16d`
- **Internal sources at Google DeepMind indicate that staff are demoralized by the lab's perceived fall to third or fourth place in the AI race, particularly after GLM-5.2 overtook Gemini 3.1 Pro on the Artificial Analysis intelligence index.**
  - tier 2, confidence 0.7, source Leo at Synthwave, episode `why-ai-users-are-raving-about-glm-52`, fp `9b891b00b19f0bd9`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Publication Norms** \u2014 Publishes in Nature, Science, NeurIPS, ICML, ICLR, and other top venues, maintaining academic research norms despite commercial pressures.",
  "content": "\n\n- ### Recent Developments\n  - **Gemini 3.5 Pro Delay & Researcher Exodus** \u2014 The release of Gemini 3.5 Pro, reportedly slated for June 30th, has been linked to a significant exodus of senior researchers from DeepMind to competitors such as Anthropic and OpenAI. Notable departures include Jonas Adler and Alexander Pritzel (to Anthropic), following earlier exits by Noam Shazeer and John Jumper. The delay is attributed to the need to tweak the model based on stress-testing feedback.\n  - **Lyria 3 Launch** \u2014 Google DeepMind launched Lyria 3, an advanced AI music generation model that supports text, image, and video inputs. The system can generate lyrics in eight different languages, including German, French, Spanish, and Hindi.\n  - **Agentic Coding 'Strike Team'** \u2014 Acknowledging that Anthropic currently holds the lead in agentic coding execution, Google has formed a 'strike team' led by co-founder Sergey Brin. Brin urged DeepMind staffers to \"urgently bridge the gap in agentic execution\" to win the final sprint.\n  - **Gemini Advertising Stance** \u2014 CEO Demis Hassabis stated that Google currently has no plans to bring advertising to the Gemini app. Commenting on the early adoption of ads by competitors like ChatGPT, Hassabis noted it was \"interesting\" they went for them so soon, but confirmed Google does not have plans for ads in Gemini at the moment.\n  - **Internal Morale & Competitive Pressure** \u2014 Internal sources indicate staff are demoralized by the lab's perceived fall to third or fourth place in the AI race, particularly after Z AI's GLM-5.2 overtook Gemini 3.1 Pro on the Artificial Analysis intelligence index. One internal source described Gemini 3.5 Pro as \"not the step change we need to be truly competitive in the race to AGI.\""
}
```

# Dossier: AI Chips

- status: `candidate_rejected`
- target page: `AI Chips.md`
- assertions: 8 across episodes: how-big-a-deal-is-the-usas-ai-genesis-mission, how-the-global-ai-race-has-changed, microsofts-plan-to-make-people-less-angry-about-ai-and-electricity, nano-banana-2-is-here, towards-ai-that-can-actually-interact
- reasons: rubric_b_improvement -2.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.88

## Assertions
- **Meta is in talks to order billions of dollars worth of Google TPUs to install in their own data centers in 2027.**
  - tier 1, confidence 0.85, source The Information / AI Daily Brief Host, episode `how-big-a-deal-is-the-usas-ai-genesis-mission`, fp `9868135092dc6b00`
- **Google's Gemini 3 model was trained exclusively on TPUs, which has increased market scrutiny of Google's chips as a viable alternative to Nvidia GPUs.**
  - tier 1, confidence 0.85, source AI Daily Brief Host / Market Reports, episode `how-big-a-deal-is-the-usas-ai-genesis-mission`, fp `6461f7d1ac194309`
- **Google has developed a new software suite called 'TPU Command Center' to ease TPU compatibility and address the moat created by Nvidia's CUDA ecosystem.**
  - tier 2, confidence 0.8, source The Information / AI Daily Brief Host, episode `how-big-a-deal-is-the-usas-ai-genesis-mission`, fp `b35da839955bba3b`
- **Nvidia is actively countering Google's TPU push by securing large commitments from Anthropic and OpenAI, and may seek to preempt a deal between Google and Meta.**
  - tier 2, confidence 0.8, source The Information / AI Daily Brief Host, episode `how-big-a-deal-is-the-usas-ai-genesis-mission`, fp `5eb62ce52de56e09`
- **Zhipu announced in January that it trained its first model exclusively on Huawei chips, serving as a proof of concept for a complete domestic Chinese hardware and software stack for AI training.**
  - tier 1, confidence 0.95, source Podcast Host, episode `how-the-global-ai-race-has-changed`, fp `9430422f34ef5f8b`
- **The US Commerce Department finalized approval for Nvidia H200 chip exports to China with conditions including third-party inspection of AI capabilities and a limit that Nvidia can ship only 50% as many chips to China as it sells to US customers.**
  - tier 1, confidence 0.95, source US Commerce Department / Transcript, episode `microsofts-plan-to-make-people-less-angry-about-ai-and-electricity`, fp `a1fe6c6d53e3858c`
- **Meta has scrapped development plans for its most advanced AI chip due to design roadblocks and is refocusing efforts on a less complicated version of its custom silicon.**
  - tier 1, confidence 0.9, source The Information (reported by AI Daily Brief host), episode `nano-banana-2-is-here`, fp `5172885f4b85914c`
- **The AI Daily Brief host interprets the absence of Jensen Huang from the US-China trade delegation as a strategic signal that Nvidia's AI chips are off the table for trade negotiations.**
  - tier 2, confidence 0.7, source AI Daily Brief host, episode `towards-ai-that-can-actually-interact`, fp `e26d35b9b4f2c02b`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "Access depends on a concentrated fabrication supply chain, so export controls and foundry capacity directly shape who can train frontier models.",
  "content": "\n- ### Recent Developments\n  - **Google TPU Adoption & Ecosystem:** Meta is in talks to order billions of dollars worth of Google TPUs for installation in its own data centers in 2027, as Google pitches large cloud customers on on-premise TPU deployments. Market scrutiny of TPUs as a viable alternative to Nvidia GPUs has intensified following the release of Gemini 3, which was trained exclusively on TPUs. To counter Nvidia's CUDA ecosystem moat, Google has developed a new software suite called \"TPU Command Center\" to simplify TPU compatibility and navigation.\n  - **Nvidia Counter-Moves & Geopolitics:** Nvidia is actively countering the TPU push by securing large commitments from Anthropic and OpenAI and may seek to preempt a potential deal between Google and Meta. In the US-China context, the US Commerce Department finalized approval for Nvidia H200 chip exports to China, subject to third-party inspection of AI capabilities and a limit restricting Nvidia to shipping only 50% as many chips to China as it sells to US customers. The absence of Nvidia CEO Jensen Huang from the US-China trade delegation has been interpreted as a strategic signal that Nvidia's AI chips are off the table for trade negotiations.\n  - **Domestic Stacks & Custom Silicon:** Zhipu announced in January that it trained its first model exclusively on Huawei chips, serving as a proof of concept for a complete domestic Chinese hardware and software stack for AI training. Meanwhile, Meta has scrapped development plans for its most advanced AI chip due to design roadblocks, refocusing efforts on a less complicated version of its custom silicon."
}
```

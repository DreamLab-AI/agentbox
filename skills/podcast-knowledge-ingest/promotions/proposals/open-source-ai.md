# Dossier: Open Source AI

- status: `candidate_survivor`
- target page: `Open Source AI.md`
- assertions: 6 across episodes: mythos-returns-but-not-for-everyone, the-latest-ai-models-and-model-rumors, where-should-claude-opus-5-fit-in-your-model-rotation, why-everyone-is-debating-ai-policy

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **China is employing a 'Huawei strategy' in open-source AI, offering models and infrastructure at low or no cost to encourage the global south to adopt incompatible AI stacks.**
  - tier 2, confidence 0.8, source Emily Weinstein (Former Commerce Department official), episode `mythos-returns-but-not-for-everyone`, fp `6a38967ceddd1132`
- **Shawn Wang (Swyx) predicts that DeepSeek V4's release will be a pivotal moment for open-source AI, potentially changing his long-held cynical stance on the sector's progress.**
  - tier 3, confidence 0.75, source Shawn Wang (Swyx) via AI Daily Brief host, episode `the-latest-ai-models-and-model-rumors`, fp `7c64e3963217aa51`
- **Deep Seek suspended its fundraising round, which was planned at a $70 billion valuation, after comments from CEO Li Yuanfeng were leaked, potentially derailing plans to go public.**
  - tier 1, confidence 0.9, source Bloomberg / Host, episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `8397ed5ccbfb3154`
- **Dean Ball, former policy adviser to the Trump administration and now head of strategic futures at OpenAI, stated that openweight models are inherently decelerationist and effectively ungovernable, arguing they deter further AI capital expenditure by reducing the premium for frontier models.**
  - tier 2, confidence 0.95, source Dean Ball, episode `why-everyone-is-debating-ai-policy`, fp `603b9f39373b7a8b`
- **President Xi Jinping endorsed an open-source approach to global AI at the first World AI Conference in Beijing, stating that global AI governance must uphold openness and win-win cooperation.**
  - tier 1, confidence 0.95, source President Xi Jinping, episode `why-everyone-is-debating-ai-policy`, fp `4951a6c5a1ad987e`
- **Investor Hib Keshi argued that China's strategy of releasing frontier-level openweight models is a form of economic dumping, intended to kill local competition by subsidizing their own industry to produce at a loss.**
  - tier 2, confidence 0.8, source Hib Keshi, episode `why-everyone-is-debating-ai-policy`, fp `ee9732d543bb2794`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Relationships",
  "content": "- ### Recent Developments\n  - **China's 'Huawei Strategy' in Open-Source AI**: China is employing a strategy analogous to Huawei's past infrastructure plays, offering AI models and associated infrastructure at low or no cost to encourage the Global South to adopt incompatible AI stacks. Emily Weinstein, a former Commerce Department official, noted, \"I think we're seeing another example of the Huawei strategy in the context of open-source AI models. China is able to offer not even just the models, but often the underlying or associated infrastructure at either no cost or significantly lower cost.\" *(Source: Emily Weinstein, confidence 0.8, tier 2)*\n  - **DeepSeek V4 as a Pivotal Moment**: Shawn Wang (Swyx) predicts that the release of DeepSeek V4 will be a pivotal moment for open-source AI, potentially changing his long-held cynical stance on the sector's progress. Wang explained, \"I've been cynical on open-source AI for the last 3 years... Deep Seek version 4 next week is probably the moment I really change my stance for the first time.\" *(Source: Shawn Wang (Swyx) via AI Daily Brief host, confidence 0.75, tier 3)*\n  - **DeepSeek Suspends $70B Fundraising Round**: Deep Seek suspended its fundraising round, which was planned at a $70 billion valuation, after comments from CEO Li Yuanfeng were leaked, potentially derailing plans to go public. Bloomberg reports that Deep Seek informed potential investors they would not move forward with the funding round, a substantial markup to the $50 billion round earlier this year, and that the suspension was tied to investors leaking the comments. *(Source: Bloomberg / Host, confidence 0.9, tier 1)*\n  - **Governance and Capex Implications**: Dean Ball, former policy adviser to the Trump administration and now head of strategic futures at OpenAI, stated that openweight models are inherently decelerationist and effectively ungovernable. Ball argued, \"Openweight models are inherently decelerationist... I suspect the reason they are is that they know openweight models are effectively ungovernable... openweight models deter further AI capex.\" *(Source: Dean Ball, confidence 0.95, tier 2)*\n  - **State Endorsement of Openness**: President Xi Jinping endorsed an open-source approach to global AI at the first World AI Conference in Beijing, stating that global AI governance must uphold openness and win-win cooperation. The transcript quotes Xi: \"global AI governance must uphold openness and win-win cooperation to drive innovation and development... We must seize this rare historic opportunity, encourage open source development, openness, cooperation, and sharing.\" *(Source: President Xi Jinping, confidence 0.95, tier 1)*\n  - **Economic Dumping Concerns**: Investor Hib Keshi argued that China's strategy of releasing frontier-level openweight models is a form of economic dumping, intended to kill local competition by subsidizing their own industry to produce at a loss. Keshi stated, \"releasing the weights for a frontier level model is effectively dumping... if all of the Chinese labs are extremely unprofitable and they are and they are encouraged at a state level to remain unprofitable it is likely to have large and reverberating economic consequences on USI as well.\" *(Source: Hib Keshi, confidence 0.8, tier 2)*\n- ### Relationships"
}
```

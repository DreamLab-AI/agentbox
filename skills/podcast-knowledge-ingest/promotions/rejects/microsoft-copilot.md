# Dossier: Microsoft Copilot

- status: `candidate_rejected`
- target page: `Microsoft Copilot.md`
- assertions: 6 across episodes: how-harness-as-a-service-will-change-agents, nano-banana-2-is-here, val-kilmers-ai-resurrection, vibe-coding-gets-an-upgrade, weird-vibes-at-ai-india-summit
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.67

## Assertions
- **Microsoft Azure achieved 39% year-over-year revenue growth, and Microsoft reported 20 million paid seats for its Copilot enterprise add-on.**
  - tier 1, confidence 0.95, source Microsoft Earnings Report / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `6bf8a693b140a8b2`
- **Microsoft's new 'Copilot tasks' product signals a broader industry trend of 'clawfication,' where AI agents are designed for general consumer use cases rather than just developers and enterprises.**
  - tier 3, confidence 0.5, source AI Daily Brief host, episode `nano-banana-2-is-here`, fp `65adc7b0c81d1585`
- **Microsoft is restructuring its AI organization by combining the consumer and commercial Copilot teams under a new executive, Jacob Andreu, who has been promoted to EVP of Copilot.**
  - tier 1, confidence 0.95, source AI Daily Brief host / Microsoft CEO Satya Nadella, episode `val-kilmers-ai-resurrection`, fp `22a074dbfa203157`
- **The Verge's Tom Warren commented that Microsoft's restructure of Copilot can be read as an admission that the company's efforts to separate the consumer and business Copilot experiences had failed over the past couple of years.**
  - tier 2, confidence 0.85, source Tom Warren (The Verge), episode `val-kilmers-ai-resurrection`, fp `4934d52796dcadd2`
- **Microsoft is testing features inspired by "Open Claw" in an enterprise context, with a newly created team exploring the technology under the leadership of Corporate VP Omar Shahine.**
  - tier 2, confidence 0.8, source Microsoft (Omar Shahine, Corporate VP), episode `vibe-coding-gets-an-upgrade`, fp `14c0909589926ea4`
- **A common complaint in enterprises is that approved work AI tools are significantly less capable than consumer-grade models like Claude Opus 4.6.**
  - tier 2, confidence 0.75, source AI Daily Brief host, episode `weird-vibes-at-ai-india-summit`, fp `e7f8f7676f6f12c5`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - [[Amazon Q]] targets developer and enterprise search use cases on AWS, competing particularly with Copilot's code-assistance and knowledge-retrieval scenarios.\n  - The \"AI pair programmer\" market pioneered by [[GitHub Copilot]] is contested by Cursor, Tabnine, JetBrains AI Assistant, and others \u2014 all using smaller, code-specialist models fine-tuned from open-source foundations including the [[Meta Llama Model Family]].",
  "content": "\n\n- ### Recent Developments\n  - **Organizational Restructuring** \u2014 Microsoft has combined its consumer and commercial Copilot teams under a new executive, Jacob Andreu, who has been promoted to EVP of Copilot. This consolidation is widely interpreted as an admission that previous efforts to maintain distinct consumer and business Copilot experiences had not been successful.\n  - **Market Traction** \u2014 Recent earnings reports highlight strong adoption, with Microsoft reporting 20 million paid seats for its Copilot enterprise add-on (up from 15 million in January) alongside 39% year-over-year revenue growth for [[Microsoft Azure]].\n  - **Product Expansion** \u2014 The introduction of \"Copilot tasks\" signals a broader industry trend toward \"clawfication,\" where AI agents are designed for general consumer use cases\u2014such as scheduling and study planning\u2014rather than being limited to developer and enterprise workflows.\n  - **Enterprise Innovation** \u2014 Microsoft is testing features inspired by \"Open Claw\" in an enterprise context, with a newly created team led by Corporate VP Omar Shahine exploring the potential of these technologies.\n  - **Capability Gap** \u2014 A recurring enterprise concern is that approved work AI tools are perceived as significantly less capable than consumer-grade models (e.g., Claude Opus 4.6), leading to friction between personal and professional AI usage."
}
```

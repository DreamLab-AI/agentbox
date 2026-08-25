# Dossier: Cloud Computing

- status: `candidate_rejected`
- target page: `Cloud Computing.md`
- assertions: 9 across episodes: claude-code-is-now-writing-claude-code, everything-you-need-to-know-about-ai-tokens, how-deepseek-v4-connects-to-the-us-grid, how-harness-as-a-service-will-change-agents, the-most-important-ai-news-from-google-io, the-way-we-use-ai-is-changing
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Brookfield is spinning off its cloud business to leverage its vertical integration in energy and real estate to lower the cost of AI infrastructure compared to pure-play cloud providers.**
  - tier 2, confidence 0.85, source The Information / Reuters, episode `claude-code-is-now-writing-claude-code`, fp `a59a7fb43e60b65f`
- **An unnamed company ran up a $500 million cloud bill due to a lack of usage limits, according to TechCrunch.**
  - tier 1, confidence 0.85, source Nofar Gaspar (citing TechCrunch), episode `everything-you-need-to-know-about-ai-tokens`, fp `6a4c550e9d726d9e`
- **Amazon committed $5 billion upfront and $20 billion contingent to Anthropic, with Anthropic agreeing to spend $100 billion on AWS over the coming decade.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Mirae Securities Note, episode `how-deepseek-v4-connects-to-the-us-grid`, fp `01621afa5cde212d`
- **The market is underpricing the benefits that cloud giants like Amazon and Google will derive from AI competition, as they capture value through cloud fees, silicon adoption, and capex recovery.**
  - tier 2, confidence 0.8, source Mirae Securities / AI Daily Brief Host, episode `how-deepseek-v4-connects-to-the-us-grid`, fp `884f7248fc5ab237`
- **Google Cloud reported 63% year-over-year revenue growth and a $460 billion backlog in new orders, up from $240 billion at the end of Q4.**
  - tier 1, confidence 0.98, source Google Earnings Report / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `db4adc4ad5eafef4`
- **Amazon's AWS revenue grew 28% year-over-year, reaching a $152 billion ARR business, marking its fastest growth in nearly four years.**
  - tier 1, confidence 0.95, source Amazon Earnings Report / Sheharyar Khan / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `f3a1aec6d11c916d`
- **Microsoft Azure achieved 39% year-over-year revenue growth, and Microsoft reported 20 million paid seats for its Copilot enterprise add-on.**
  - tier 1, confidence 0.95, source Microsoft Earnings Report / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `6bf8a693b140a8b2`
- **Google's Gemini Spark is described as a 24/7 personal agent that runs on virtual machines on Google Cloud, allowing it to perform long-running tasks in the background without requiring the user's local device to be active.**
  - tier 2, confidence 0.85, source AI Daily Brief host, episode `the-most-important-ai-news-from-google-io`, fp `a693bb392b0ef63c`
- **SpaceX has effectively become the largest 'neo cloud' provider with 550,000 GPUs, more than double CoreWeave, making GPU rentals its biggest business ahead of Starlink's $15 billion ARR.**
  - tier 2, confidence 0.7, source Yuchen Jin (reported by AI Daily Brief host), episode `the-way-we-use-ai-is-changing`, fp `5d2d35811587ce7a`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Open challenges as of 2026 include AI-driven power and data-centre capacity constraints, GPU scarcity and capital intensity straining ROI, spiralling FinOps/GreenOps pressure, and reconciling US CLOUD Act extraterritorial exposure with tightening EU sovereignty and switching obligations.",
  "content": "\n\n- ### Recent Developments (Podcast Evidence)\n  - **Hyperscaler Earnings & Backlogs (Q1 2026)**:\n    - **Amazon AWS**: Revenue grew 28% year-over-year, reaching a $152 billion ARR business, marking its fastest growth in nearly four years. Amazon committed $5 billion upfront and $20 billion contingent to Anthropic, with Anthropic agreeing to spend $100 billion on AWS over the coming decade. Analysts note the market is underpricing the benefits Amazon will derive from AI competition through cloud fees, silicon adoption, and capex recovery.\n    - **Microsoft Azure**: Achieved 39% year-over-year revenue growth. Microsoft reported 20 million paid seats for its Copilot enterprise add-on, up from 15 million in January.\n    - **Google Cloud**: Reported 63% year-over-year revenue growth and a $460 billion backlog in new orders, up from $240 billion at the end of Q4.\n  - **Infrastructure & Vertical Integration**:\n    - **Brookfield Spin-off**: Brookfield is spinning off its cloud business to leverage its vertical integration in energy and real estate, aiming to lower the cost of AI infrastructure compared to pure-play cloud providers by controlling inputs of the AI value chain.\n    - **SpaceX as 'Neo Cloud'**: SpaceX has effectively become the largest 'neo cloud' provider with 550,000 GPUs (more than double CoreWeave), making GPU rentals its biggest business ahead of Starlink's $15 billion ARR.\n  - **Operational & Product Updates**:\n    - **Cost Control Risks**: An unnamed company ran up a $500 million cloud bill due to a lack of usage limits, highlighting the financial risks of unmonitored elastic scaling.\n    - **Google Gemini Spark**: Described as a 24/7 personal agent that runs on virtual machines on Google Cloud, allowing it to perform long-running tasks in the background without requiring the user's local device to be active."
}
```

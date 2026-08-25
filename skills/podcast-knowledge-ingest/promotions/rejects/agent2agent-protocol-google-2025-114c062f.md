# Dossier: Agent2Agent Protocol (Google 2025)

- status: `candidate_rejected`
- target page: `Agent2Agent Protocol (Google 2025).md`
- assertions: 7 across episodes: gemini-can-now-write-you-a-song, google-says-no-ads-planned-for-gemini, grok-bot-finally-makes-ai-agents-easy, how-apples-ai-strategy-changes-with-a-new-ceo, how-deepseek-v4-connects-to-the-us-grid
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -1.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -1.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.71

## Assertions
- **Google's strategy of integrating AI across multiple modalities (text, image, video, audio) is a key driver for adoption, often underestimated compared to the focus on single-model capability comparisons.**
  - tier 2, confidence 0.8, source Aaron Upright via Podcast Host, episode `gemini-can-now-write-you-a-song`, fp `c29bcd1f8ea86588`
- **Google's VP of Global Ads, Dan Taylor, stated that Search and Gemini are complementary tools with different roles, with Search for discovery and Gemini for creation and analysis.**
  - tier 1, confidence 0.95, source Dan Taylor (Google VP of Global Ads), episode `google-says-no-ads-planned-for-gemini`, fp `52175b20b10c6aa6`
- **Ad Week reported in December that Google told advertising clients that ad placements in Gemini were targeted for a 2026 rollout.**
  - tier 1, confidence 0.9, source Ad Week, episode `google-says-no-ads-planned-for-gemini`, fp `784904c7c750731c`
- **Google is already offering ads in AI search, including a new feature called 'direct offers' that presents personalized discounts in AI mode.**
  - tier 1, confidence 0.9, source Dan Taylor (Google VP of Global Ads), episode `google-says-no-ads-planned-for-gemini`, fp `88a52b90cebe4cb1`
- **Google's Gemini app has reached 1 billion monthly active users, with 63% of users utilizing the voice interface and 150 million images generated per day.**
  - tier 1, confidence 0.95, source Sundar Pichai / Google, episode `grok-bot-finally-makes-ai-agents-easy`, fp `50f81e32adb28cc8`
- **Anthropic's codebase is now approximately 100% written by AI, whereas Google's coding agents write around half of its code.**
  - tier 2, confidence 0.8, source Boris Cherney (Anthropic) and Nat Ashkenazi (Google CFO), episode `how-apples-ai-strategy-changes-with-a-new-ceo`, fp `7a880f79b9a9aeb0`
- **Google has confirmed a $40 billion investment deal with Anthropic, consisting of $10 billion upfront and $30 billion contingent on commercial milestones.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Press Confirmation, episode `how-deepseek-v4-connects-to-the-us-grid`, fp `e6a10ec722ab96f3`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  28. SecureW2. (2026). \"A2A Protocol Security: Authenticating Agent-to-Agent Communication.\" https://securew2.com/blog/a2a-protocol-security",
  "content": "\n\n  ## Recent Developments (2026)\n\n  The rapid maturation of the A2A ecosystem is occurring against a backdrop of significant shifts in Google's broader AI strategy and commercial positioning, which directly influence the protocol's adoption trajectory and market context.\n\n  **Multimodal Strategy and Adoption Drivers**: Google's strategy of integrating AI across multiple modalities (text, image, video, and audio) has emerged as a key driver for enterprise adoption of agentic systems, a factor often underestimated in favour of single-model capability comparisons. Industry observers note that the accessibility of a unified multimodal platform is critical for real-world deployment, as agents must handle diverse input and output types to be useful in production environments. This aligns with A2A's design, which explicitly supports multimodal message parts (TextPart, FilePart, DataPart) to facilitate rich agent-to-agent interactions.\n\n  **Gemini App Scale and Usage**: Google CEO Sundar Pichai announced that the Gemini app has reached 1 billion monthly active users, a milestone that underscores the massive user base upon which A2A-enabled agentic workflows can be built. Notably, 63% of these users utilize the voice interface, and the platform generates 150 million images per day. This scale provides a substantial foundation for the \"Agentic Internet\" vision, where consumer-facing agents can seamlessly delegate tasks to specialized backend agents via A2A.\n\n  **Commercial Integration and Advertising**: Google's VP of Global Ads, Dan Taylor, clarified the complementary roles of Search and Gemini, positioning Search for discovery and Gemini for creation and analysis. This distinction is relevant to A2A deployments where agents may need to distinguish between information retrieval (search-like) and task execution (creation/analysis-like) capabilities. Furthermore, Google is actively integrating commercial features into its AI surfaces, including \"direct offers\" in AI search and a targeted 2026 rollout of ad placements within Gemini. These developments suggest that A2A-mediated agent interactions will increasingly intersect with commercial transaction flows, reinforcing the need for the economic ecosystem components (such as the Agent Payments Protocol) discussed in the Future Directions section.\n\n  **Industry Investment and Code Generation**: The competitive landscape is intensifying, exemplified by Google's confirmed $40 billion investment deal with Anthropic ($10 billion upfront, $30 billion contingent on milestones). This significant capital injection highlights the strategic importance of agentic AI infrastructure. Additionally, the pace of AI-driven development is accelerating, with reports indicating that Google's coding agents now write approximately half of its code, while Anthropic's codebase is nearly 100% AI-written. This trend towards autonomous code generation and maintenance further validates the need for robust, standardized protocols like A2A to manage the growing complexity of multi-agent software systems."
}
```

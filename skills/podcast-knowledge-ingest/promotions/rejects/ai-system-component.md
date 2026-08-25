# Dossier: AI System Component

- status: `candidate_rejected`
- target page: `AI System Component.md`
- assertions: 12 across episodes: how-i-built-my-10-agent-openclaw-team, how-people-are-using-ai-for-health, how-the-best-companies-use-ai, how-to-get-the-most-from-ai-this-summer
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **OpenClaw agents are configured using a set of specific markdown files, including 'soul.md' for personality, 'agents.md' for operating instructions, and 'user.md' for user preferences.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `adbaf3c8812c2755`
- **ChatGPT Health was built in collaboration with more than 260 physicians from 60 countries who provided feedback on outputs over 600,000 times.**
  - tier 1, confidence 0.95, source OpenAI announcement for ChatGPT Health, episode `how-people-are-using-ai-for-health`, fp `7764e6bc3953729e`
- **Ramp reports that 99% of its employees use AI daily, but most were initially stuck due to painful and unintuitive setup processes involving terminal configs and MCP servers.**
  - tier 1, confidence 0.95, source Eric Glyman, Ramp Co-founder (cited by host), episode `how-the-best-companies-use-ai`, fp `df06c98490084373`
- **OpenAI announced that 50% of the usage of their new Codex app is not specifically about coding, indicating that code-writing capabilities unlock broader knowledge work applications.**
  - tier 1, confidence 0.9, source OpenAI (cited by host), episode `how-the-best-companies-use-ai`, fp `a045fa1a4d58abd7`
- **McKinsey argues that more than 70% of talent for AI transformation should be in-house, as every tech and AI transformation is ultimately a people transformation that cannot be fully outsourced to consultants.**
  - tier 2, confidence 0.85, source McKinsey (cited by host), episode `how-the-best-companies-use-ai`, fp `83e3df82384c4b28`
- **Ramp's design principle for its AI tooling is to 'not limit anyone's upside,' rejecting the conventional approach of simplifying tools for non-technical users in favor of preserving full capability while making complexity invisible.**
  - tier 2, confidence 0.85, source Seb Go to Jen, Ramp (cited by host), episode `how-the-best-companies-use-ai`, fp `0a4e66b4b9065378`
- **McKinsey identifies 'agentic engineering' as the next capability for leading companies to master, involving the ingestion of unstructured data, extension of AI platforms with agentic capabilities, and the codification of repeatable agentic playbooks.**
  - tier 2, confidence 0.85, source McKinsey (cited by host), episode `how-the-best-companies-use-ai`, fp `a26d902a312268be`
- **The host predicts that the distinction between 'good,' 'medium,' and 'bad' AI users will disappear as organizations build harnesses that enable every employee to become an AI superuser, fundamentally changing the shape of enterprise AI adoption.**
  - tier 3, confidence 0.65, source Host (NLW), episode `how-the-best-companies-use-ai`, fp `681880498d17efa2`
- **The host argues that 'agentic engineering' is no longer just a domain of software development but is becoming a core capability for all knowledge workers, as the ability to write code unlocks broader AI capabilities for non-technical tasks.**
  - tier 3, confidence 0.65, source Host (NLW), episode `how-the-best-companies-use-ai`, fp `f0e1b71f94c188fc`
- **Entrepreneur Ryan Carson predicts that by the end of the year, major AI players will offer complete end-to-end 'code factory' solutions that allow startups to build products without duct-taping different tools together.**
  - tier 3, confidence 0.6, source Ryan Carson (cited by host), episode `how-the-best-companies-use-ai`, fp `9335ad756cd07232`
- **AI Daily Brief and Super Intelligent have launched 'AI Summer Adventure,' a free, gamified training program featuring 20+ destinations and projects ranging from beginner to advanced levels.**
  - tier 1, confidence 0.95, source AI Daily Brief Host, episode `how-to-get-the-most-from-ai-this-summer`, fp `506b4839f20c960e`
- **Building a 'Personal Brain' or global identity context for AI assistants involves creating a 150-300 word instruction block that persists across sessions to provide consistent user context.**
  - tier 2, confidence 0.85, source AI Daily Brief Host, episode `how-to-get-the-most-from-ai-this-summer`, fp `2ceab9d5134a7ef9`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Breck, E. et al. (2017). The ML Test Score: A Rubric for ML Production Readiness. NIPS 2017 Workshop.",
  "content": "\n\n  #### Recent Developments\n  - **Agentic Engineering as a Core Capability**: McKinsey identifies 'agentic engineering' as the next capability for leading companies to master, involving the ingestion of unstructured data, extension of AI platforms with agentic capabilities, and the codification of repeatable agentic playbooks. This capability is increasingly viewed not just as a domain of software development but as a core requirement for all knowledge workers, as the ability to write code unlocks broader AI capabilities for non-technical tasks.\n  - **Enterprise Adoption and Talent Strategy**: McKinsey argues that more than 70% of talent for AI transformation should be in-house, emphasizing that every tech and AI transformation is ultimately a people transformation that cannot be fully outsourced to consultants. This shift is supported by the prediction that the distinction between 'good,' 'medium,' and 'bad' AI users will disappear as organizations build harnesses that enable every employee to become an AI superuser.\n  - **User Experience and Setup Friction**: Ramp reports that 99% of its employees use AI daily, but most were initially stuck due to painful and unintuitive setup processes involving terminal configs and MCP servers. Ramp's design principle for its AI tooling is to 'not limit anyone's upside,' rejecting the conventional approach of simplifying tools for non-technical users in favor of preserving full capability while making complexity invisible.\n  - **Broadening Applications of AI Coding Tools**: OpenAI announced that 50% of the usage of their new Codex app is not specifically about coding, indicating that code-writing capabilities unlock broader knowledge work applications. Entrepreneur Ryan Carson predicts that by the end of the year, major AI players will offer complete end-to-end 'code factory' solutions that allow startups to build products without duct-taping different tools together.\n  - **Domain-Specific AI Integration**: ChatGPT Health was built in collaboration with more than 260 physicians from 60 countries who provided feedback on outputs over 600,000 times, highlighting the integration of domain experts in the development and validation of AI system components.\n  - **Configuration and Context Management**: OpenClaw agents are configured using specific markdown files, including 'soul.md' for personality, 'agents.md' for operating instructions, and 'user.md' for user preferences. Additionally, building a 'Personal Brain' or global identity context for AI assistants involves creating a 150-300 word instruction block that persists across sessions to provide consistent user context.\n  - **Training and Gamification**: AI Daily Brief and Super Intelligent have launched 'AI Summer Adventure,' a free, gamified training program featuring 20+ destinations and projects ranging from beginner to advanced levels, designed to enhance user proficiency with AI system components."
}
```

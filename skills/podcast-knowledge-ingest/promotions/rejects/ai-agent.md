# Dossier: AI Agent

- status: `candidate_rejected`
- target page: `AI Agent.md`
- assertions: 14 across episodes: autoresearch-agent-loops-and-the-future-of-work, how-big-is-the-ai-economy, how-to-help-people-thrive-with-ai, how-to-learn-ai-with-ai, the-race-to-put-ai-agents-everywhere, the-social-network-for-agents-just-got-acquired, why-agents-still-need-humans
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.92

## Assertions
- **Andrej Karpathy released a project called 'auto research' on March 7, 2025, which is a minimal repository of approximately 630 lines of code designed to train a small LLM on a single GPU using an autonomous AI agent loop.**
  - tier 1, confidence 0.98, source Andrej Karpathy (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `32ebb74ef2751e32`
- **Boris Cherny, creator of Claude Code, released a '/loop' feature on March 7, 2025, allowing users to schedule recurring agentic tasks for up to 3 days, such as auto-fixing build issues or summarizing Slack posts.**
  - tier 1, confidence 0.92, source Boris Cherny (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `9e15edaf2aef81be`
- **The role of the human in agentic research loops is shifting from direct code execution to 'arena design,' which involves writing strategy documents (like program.md) and constructing objective evaluation metrics for the agent.**
  - tier 2, confidence 0.88, source Podcast Host / Andrej Karpathy, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `c23e09146fe0ed65`
- **Senator Mark Warner is preparing a discussion draft for a federal AI agent regulation that enshrines a 'duty of loyalty' requiring agents to act in the user's interest rather than the creator's.**
  - tier 2, confidence 0.8, source Senator Mark Warner / Host Analysis, episode `how-big-is-the-ai-economy`, fp `bf41cf34da356d0f`
- **A Section AI proficiency report found that while 69% of workers reported their organization had taken some action on AI agents, only 16% actually use an agentic tool at work, and less than 10% can define an AI agent in their own words.**
  - tier 1, confidence 0.95, source Section AI proficiency report, episode `how-to-help-people-thrive-with-ai`, fp `1ae0efd9061de00a`
- **The host argues that the most effective way to use AI is not just for efficiency in rote tasks, but to accomplish things that were previously impossible, such as building agents or learning new technical skills, which stretches cognitive capabilities.**
  - tier 2, confidence 0.75, source Host (AI Daily Brief), episode `how-to-help-people-thrive-with-ai`, fp `a47a9d9c10d6b25b`
- **OpenAI President Greg Brockman stated that by March 31st, the company aims for the tool of first resort for any technical task to be interacting with an agent rather than using an editor or terminal.**
  - tier 1, confidence 0.95, source Greg Brockman (OpenAI President), episode `how-to-learn-ai-with-ai`, fp `9eee787b6c8346b2`
- **Nvidia CEO Jensen Huang stated that every software company in the world needs to have an Open Claw strategy.**
  - tier 1, confidence 0.95, source Jensen Huang (Nvidia CEO), episode `the-race-to-put-ai-agents-everywhere`, fp `c7c796e6897f1050`
- **Adaptive launched Adaptive Computer, an always-on personal computer that uses AI to automate tasks, featuring 'encoded memory' that learns how specific software and user preferences work to automate future requests.**
  - tier 1, confidence 0.85, source Adaptive, episode `the-race-to-put-ai-agents-everywhere`, fp `d1b1bb401b533118`
- **Adaptive predicts that by the end of the year, AI agents will use more software than humans do, shifting the role of humans from operating software to directing agents.**
  - tier 3, confidence 0.55, source Adaptive, episode `the-race-to-put-ai-agents-everywhere`, fp `836911bdf6fda582`
- **Meta has acquired Maltbook, an agent-only social network, and its founders Matchlet and Ben Parr are moving to Meta Super Intelligence Labs.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `the-social-network-for-agents-just-got-acquired`, fp `b66817f16593022d`
- **Maltbook reported 195,000 human-verified AI agents as of the date of the report.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `the-social-network-for-agents-just-got-acquired`, fp `debf7b5c7e982342`
- **At Every, AI systems have responded to 95% of CEO Dan Shipper's work emails over the last several weeks.**
  - tier 1, confidence 0.95, source Dan Shipper (CEO of Every), episode `why-agents-still-need-humans`, fp `8607586fbe979cb6`
- **The 'infinite backlog' phenomenon occurs because agents do not get tired and can always do more work, making it feel like there is no end to tasks and creating a new type of overwhelm for users.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `why-agents-still-need-humans`, fp `dddb5c0e923064a2`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - ## Future Directions (2026-2030)",
  "content": "  - ## Recent Developments (2025-2026)\n    - **Autonomous Research Loops** \u2014 Andrej Karpathy released the 'auto research' project on March 7, 2025, a minimal repository of approximately 630 lines of code designed to train a small LLM on a single GPU using an autonomous AI agent loop. Karpathy noted the goal is to \"engineer your agents to make the fastest research project indefinitely,\" highlighting a shift where the human role transitions from direct code execution to \"arena design\"\u2014writing strategy documents and constructing objective evaluation metrics for the agent.\n    - **Agentic Task Scheduling** \u2014 Boris Cherny, creator of Claude Code, released the '/loop' feature on March 7, 2025, allowing users to schedule recurring agentic tasks for up to 3 days. This enables autonomous maintenance such as auto-fixing build issues or summarizing Slack posts, moving agents from reactive tools to proactive background workers.\n    - **Enterprise Adoption Gap** \u2014 A Section AI proficiency report found a significant disconnect between organizational intent and actual usage: while 69% of workers reported their organization had taken some action on AI agents, only 16% actually use an agentic tool at work, and less than 10% can define an AI agent in their own words. The report summarized this as \"Agents are here, agentic readiness is not.\"\n    - **Agent-Only Social Networks** \u2014 Meta acquired Maltbook, an agent-only social network, with founders Matchlet and Ben Parr moving to Meta Super Intelligence Labs (run by former Scale AI CEO Alexander Wang). Maltbook reported 195,000 human-verified AI agents, signaling the emergence of social infrastructure designed exclusively for non-human actors.\n    - **Strategic Industry Shifts** \u2014 OpenAI President Greg Brockman stated that by March 31, 2025, the company aims for the \"tool of first resort\" for any technical task to be interacting with an agent rather than using an editor or terminal. Similarly, Nvidia CEO Jensen Huang stated at GTC that \"every software company in the world needs to have an Open Claw strategy,\" underscoring the integration of agentic capabilities into core software architectures.\n    - **Personal Automation & Memory** \u2014 Adaptive launched Adaptive Computer, an always-on personal computer using AI to automate tasks. Its distinguishing feature is \"encoded memory,\" which learns how specific software and user preferences work to automate future requests. At Every, CEO Dan Shipper reported that AI systems have responded to 95% of his work emails over the last several weeks, illustrating the high degree of delegation possible in personal workflows.\n    - **Regulatory Frameworks** \u2014 Senator Mark Warner is preparing a discussion draft for federal AI agent regulation that enshrines a \"duty of loyalty,\" requiring agents to act in the user's interest rather than the creator's. The 25-page draft aims to protect third-party agent access and prevent undisclosed partnerships from influencing agent recommendations.\n    - **The 'Infinite Backlog' Phenomenon** \u2014 As agents do not get tired and can continuously perform work, users face a new type of overwhelm described as the \"infinite backlog.\" This phenomenon creates pressure to maximize agent utilization, as the absence of human fatigue limits makes the potential task horizon feel boundless.\n  - ## Future Directions (2026-2030)"
}
```

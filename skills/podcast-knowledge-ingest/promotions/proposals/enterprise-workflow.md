# Dossier: Enterprise Workflow

- status: `candidate_survivor`
- target page: `Enterprise Workflow.md`
- assertions: 7 across episodes: autoresearch-agent-loops-and-the-future-of-work, context-graphs-ais-next-big-idea, how-i-built-my-10-agent-openclaw-team, ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026, the-self-driving-company

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.86

## Assertions
- **Business functions with measurable outcomes and fast feedback loops, such as advertising, cold outreach, and A/B testing, will be among the first to adopt agentic loops, potentially increasing experiment volume from dozens to thousands per year.**
  - tier 3, confidence 0.72, source Podcast Host / Eric (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `eb588a27906c0977`
- **The 'capability overhang'—the gap between current AI capabilities and how companies are using them—is widening to the point where meeting users at their current level of adoption may become a form of malfeasance.**
  - tier 3, confidence 0.65, source Podcast Host, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `d4f8c87c9b181284`
- **A significant portion of enterprise decision-making logic, including exception handling, precedents, and approval chains, currently exists as 'tribal knowledge' in unstructured channels like Slack, DMs, and human memory, rather than in queryable databases.**
  - tier 2, confidence 0.9, source Jay Gupta and Ashu Garg (Foundation Capital), episode `context-graphs-ais-next-big-idea`, fp `f0db009c8b6d1a33`
- **The host anticipates that project manager agents will evolve from simple to-do list managers into systems that interact with other organizational tools and agents to provide comprehensive project status updates.**
  - tier 3, confidence 0.7, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `03bbd58c00a31f26`
- **Former NVIDIA engineer Buant Tongu argues that 99% of current Claudebot use cases are limited to corporate administrative tasks like summarizing email and managing calendars.**
  - tier 2, confidence 0.8, source Buant Tongu, episode `ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026`, fp `2a67bc70b54a63b6`
- **Replit replaced a 7-figure SaaS solution with an internal application built using their own AI agents because the internal version was superior and employees migrated to it.**
  - tier 1, confidence 0.9, source Amjad Masad (Replit CEO), episode `the-self-driving-company`, fp `b13fb8d2dc8dae71`
- **A 'pull' adoption strategy, where engineers use AI agents in public spaces like Slack, is more effective for driving cross-organizational adoption than a 'push' mandate, as it allows other teams to observe benefits firsthand.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `the-self-driving-company`, fp `8f78bacf4f2634bd`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Automating workflows can reduce manual handoffs and provide a record of decisions and timings. Modern systems increasingly incorporate AI components to classify documents, draft content, or make routine decisions within a process.",
  "content": "\n\n- ### Recent Developments\n  - **Agentic Loops in High-Feedback Functions:** Business functions with measurable outcomes and fast feedback loops, such as advertising, cold outreach, and A/B testing, are expected to be among the first to adopt agentic loops. This shift could increase experiment volume from dozens to thousands per year, as noted by Eric: \"Most marketing teams run around 30 experiments a year. The next generation will run 36,500 plus easily... Modify a variable, deploy it, measure one metric, keep or discard, repeat forever.\" [source: Podcast Host / Eric (via podcast transcript), confidence 0.72, tier 3]\n  - **The Capability Overhang:** The gap between current AI capabilities and how companies are using them is widening. The host states: \"Every week the capability overhang gets bigger... At some point it's so wide that it almost becomes malfeasance to meet them where they are.\" [source: Podcast Host, confidence 0.65, tier 3]\n  - **Tribal Knowledge as a Bottleneck:** A significant portion of enterprise decision-making logic, including exception handling, precedents, and approval chains, currently exists as 'tribal knowledge' in unstructured channels like Slack, DMs, and human memory, rather than in queryable databases. Jay Gupta and Ashu Garg (Foundation Capital) identify four categories of missing information: exception logic, precedent from past decisions, cross-system synthesis, and approval chains that happen outside structured systems. These 'decision traces' limit how much agent autonomy can scale. [source: Jay Gupta and Ashu Garg (Foundation Capital), confidence 0.9, tier 2]\n  - **Evolution of Project Manager Agents:** The host anticipates that project manager agents will evolve from simple to-do list managers into systems that interact with other organizational tools and agents to provide comprehensive project status updates. This 'phase two' involves agents \"interacting with other systems to be able to also inform me of the state of those projects beyond just what I'm doing with them.\" [source: Host (AI Daily Brief), confidence 0.7, tier 3]\n  - **Current Limitations of AI Use Cases:** Former NVIDIA engineer Buant Tongu argues that 99% of current Claudebot use cases are limited to corporate administrative tasks like summarizing email and managing calendars. As quoted by the host: \"99% of all use cases that I've seen so far concern the corporate BS jobs and tasks. summarizing email, posting on Slack, adding meetings to a calendar that shouldn't exist at all.\" [source: Buant Tongu, confidence 0.8, tier 2]\n  - **Internal AI Agents Replacing SaaS:** Replit replaced a 7-figure SaaS solution with an internal application built using their own AI agents because the internal version was superior and employees migrated to it. Amjad Masad (Replit CEO) stated: \"We just turned a 7 figureure SAS solution because our internal app built entirely in Replet was superior and employees had migrated over.\" [source: Amjad Masad (Replit CEO), confidence 0.9, tier 1]\n  - **'Pull' Adoption Strategy:** A 'pull' adoption strategy, where engineers use AI agents in public spaces like Slack, is more effective for driving cross-organizational adoption than a 'push' mandate. By using public spaces, organizations allow other teams to observe benefits firsthand, addressing inherent reluctance to change. As the host notes: \"by creating spaces where people can see not only the results... a lot of that skepticism can be dealt with in advance.\" [source: Host (AI Daily Brief), confidence 0.8, tier 2]"
}
```

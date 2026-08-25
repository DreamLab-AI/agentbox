# Dossier: Multi-Agent Orchestration Frameworks

- status: `candidate_rejected`
- target page: `Multi-Agent Orchestration Frameworks.md`
- assertions: 5 across episodes: pro-worker-ai, ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026, the-race-to-put-ai-agents-everywhere, why-ceos-need-to-lead-ai-strategy
- reasons: completeness 0.40 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.40

## Assertions
- **The host predicts that 'flavors of AI engineer' may become the dominant role, describing new jobs as the result of crossing existing knowledge worker roles with software engineering skills.**
  - tier 3, confidence 0.5, source AI Daily Brief host, episode `pro-worker-ai`, fp `4139e340084b5517`
- **In Cursor's multi-agent experiment, a flat coordination structure caused 20 agents to slow down to the effective throughput of two or three due to locking mechanisms.**
  - tier 1, confidence 0.9, source Cursor Blog, episode `ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026`, fp `455e19a678373508`
- **Cursor implemented a hierarchical pipeline with 'planner' and 'worker' agents to solve coordination problems, allowing scaling to very large projects without single-agent tunnel vision.**
  - tier 1, confidence 0.9, source Cursor Blog, episode `ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026`, fp `5ef89b55805dec37`
- **Perplexity released Computer for Enterprise, which operates within Slack and claims direct connections to more than 400 applications.**
  - tier 1, confidence 0.9, source Perplexity, episode `the-race-to-put-ai-agents-everywhere`, fp `41c984c89eb7f5b6`
- **The host posits that the increasing focus on cybersecurity and model governance is a direct result of organizations moving from isolated agent deployments to orchestrated agent ecosystems, which require robust data lineage and security architectures.**
  - tier 2, confidence 0.75, source Host (AI Daily Brief), episode `why-ceos-need-to-lead-ai-strategy`, fp `e4269d414ffafffc`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Regulatory-driven auditability**: UK AI Act regulation and EU AI Act requirements will mandate that multi-agent orchestration frameworks provide complete, human-readable audit trails of all agent decisions and tool invocations \u2014 driving [[Agent Event Stream]] standards and structured logging APIs as first-class framework features.",
  "content": "\n\n  ## Recent Developments (2026)\n\n  Recent industry reports and experimental deployments highlight emerging patterns in multi-agent coordination, enterprise integration, and workforce evolution.\n\n  **Coordination Bottlenecks and Hierarchical Pipelines (Cursor)**\n  Cursor's internal multi-agent experiments revealed significant performance degradation in flat coordination structures. Due to locking mechanisms, a team of 20 agents slowed down to the effective throughput of only two or three, with most time spent waiting rather than executing. To resolve this, Cursor implemented a hierarchical pipeline featuring 'planner' and 'worker' agents. In this architecture, a subset of planner agents continuously explores the codebase and generates tasks, which worker agents then pick up and execute. This shift from flat to hierarchical orchestration solved most coordination problems and enabled scaling to very large projects without the 'tunnel vision' typical of single-agent approaches.\n\n  **Enterprise Integration and Application Connectivity (Perplexity)**\n  Perplexity has expanded its agentic capabilities with the release of 'Computer for Enterprise.' This offering operates directly within Slack, embedding agentic workflows into existing communication channels. It claims direct connections to more than 400 applications, facilitating seamless data retrieval and action execution across enterprise stacks without requiring custom integration code for each tool.\n\n  **Governance, Security, and the Shift to Orchestrated Ecosystems**\n  Industry analysis, including insights from KPMG, indicates a strategic shift from isolated agent deployments to complete orchestrated agent ecosystems. This transition is driving increased focus on cybersecurity and model governance. Organizations are prioritizing robust data lineage and security architectures to manage the complexity of multi-agent interactions. Survey data suggests that half of the leaders in this space plan to allocate between $10 and $50 million in the coming year specifically to harden model governance, improve data lineage, and secure agentic architectures.\n\n  **Workforce Evolution: The 'AI Engineer' Role**\n  The rise of orchestration frameworks is reshaping professional roles. Industry observers predict that 'flavors of AI engineer' may become the dominant role, characterized by the intersection of existing knowledge worker responsibilities and software engineering skills. This new class of professionals acts as 'agent builders' and 'agent orchestrators,' effectively crossing traditional job functions with the technical ability to design, deploy, and manage multi-agent systems."
}
```

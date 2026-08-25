# Dossier: Software Development

- status: `candidate_rejected`
- target page: `Software Development.md`
- assertions: 8 across episodes: beating-the-ai-doom-cycle, claude-code-is-now-writing-claude-code, harness-engineering-101, how-apples-ai-strategy-changes-with-a-new-ceo, how-harness-as-a-service-will-change-agents, the-dawn-of-the-agent-age
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5; completeness 0.50 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.50

## Assertions
- **GitHub Copilot users have reported that their usage-based billing costs would be significantly higher than their current flat-rate subscriptions, with one user estimating a jump from $451 to $11,432.22.**
  - tier 1, confidence 0.85, source GitHub Copilot Subreddit Users (cited by AI Daily Brief Host), episode `beating-the-ai-doom-cycle`, fp `fac5eb254c68a1d6`
- **The prediction that 90% of code would be written by AI by September 2025 was only off by a couple of months, as evidenced by Claude Code's current capabilities.**
  - tier 2, confidence 0.75, source Ethan Malik, episode `claude-code-is-now-writing-claude-code`, fp `ac6ed09c00651fa1`
- **Cursor 3 was launched in early April 2025 as a unified workspace for building software with agents, featuring multi-repo layouts and seamless handoff between local and cloud agents.**
  - tier 1, confidence 0.95, source Cursor / AI Daily Brief Host, episode `harness-engineering-101`, fp `5fe751cbd3da4b30`
- **Anthropic's codebase is now approximately 100% written by AI, whereas Google's coding agents write around half of its code.**
  - tier 2, confidence 0.8, source Boris Cherney (Anthropic) and Nat Ashkenazi (Google CFO), episode `how-apples-ai-strategy-changes-with-a-new-ceo`, fp `7a880f79b9a9aeb0`
- **Switching GPT-5.5 from its native Codex harness to Cursor's harness increased its functionality benchmark score from 61.5% to 87.2%.**
  - tier 1, confidence 0.92, source Endor Labs / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `b98bca07e5cd96ec`
- **The Cursor SDK enables the creation of 'local hackable agents' that can be embedded into non-IDE environments like Gmail or Chrome plugins, allowing agents to operate on codebases outside of traditional development tools.**
  - tier 2, confidence 0.85, source Cursor / Jack Driscoll / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `e05d484e1575b400`
- **The 'Open Claw' era of open-source agent harnesses is analogous to the hobbyist era of computing, where users had to assemble their own systems, whereas 'Harness as a Service' represents the shift to pre-built, democratized infrastructure.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `how-harness-as-a-service-will-change-agents`, fp `4420d1379087502a`
- **The 'vibe coding' paradigm has shifted from being a tool for prototyping to the standard method for software development over the course of January 2026.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `the-dawn-of-the-agent-age`, fp `918edb46a5019129`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Open questions include: code quality and correctness guarantees, intellectual property in AI-generated code, security of LLM-suggested dependencies, and the evolving skills profile for developers.",
  "content": "\n\n- ### Recent Developments (2025\u20132026)\n  - **Acceleration of AI Code Generation** \u2014 Industry leaders report that AI now writes a substantial majority of new code. Anthropic\u2019s codebase is approximately 100% written by AI, while Google\u2019s coding agents write around half of its code. This validates earlier predictions that 90% of code would be AI-written by late 2025, with current capabilities suggesting the timeline was only slightly conservative.\n  - **Shift to 'Vibe Coding'** \u2014 The 'vibe coding' paradigm has transitioned from a prototyping technique to the standard method for software development as of early 2026, reflecting a fundamental change in how developers interact with AI agents.\n  - **Harness Optimization and Benchmarking** \u2014 The choice of agent harness significantly impacts model performance. For example, switching GPT-5.5 from its native Codex harness to Cursor\u2019s harness increased its functionality benchmark score from 61.5% to 87.2%, highlighting the importance of the surrounding tooling infrastructure.\n  - **Unified Agent Workspaces** \u2014 Cursor 3 (launched April 2025) introduced a unified workspace for building software with agents, featuring multi-repo layouts and seamless handoff between local and cloud agents. The Cursor SDK further enables 'local hackable agents' to be embedded into non-IDE environments such as Gmail or Chrome plugins.\n  - **Infrastructure Maturation** \u2014 The market is shifting from the 'Open Claw' era of open-source, DIY agent harnesses to 'Harness as a Service,' where pre-built, democratized infrastructure lowers the barrier to entry, analogous to the shift from assembling personal computers to buying pre-built desktops in the 1990s.\n  - **Economic Implications** \u2014 As AI usage scales, billing models are evolving. GitHub Copilot users have reported that usage-based billing could be significantly higher than flat-rate subscriptions, with one user estimating a jump from $451 to $11,432.22, signaling a move toward consumption-based pricing for AI-assisted development."
}
```

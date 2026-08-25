# Dossier: AI-Augmented Software Engineering

- status: `candidate_rejected`
- target page: `AI-Augmented Software Engineering.md`
- assertions: 13 across episodes: how-i-built-my-10-agent-openclaw-team, how-significant-are-ais-latest-math-breakthroughs, how-to-get-the-most-from-ai-this-summer, how-to-help-people-thrive-with-ai, how-to-use-claudes-massive-new-upgrades, how-to-use-opus-47-and-the-new-codex, surprise-elon-anthropic-team-up-reshapes-ai-race, what-the-heck-is-graph-engineering
- reasons: completeness 0.50 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.50

## Assertions
- **The host identifies that the most valuable use case for OpenClaw agents is persistent, around-the-clock research and cataloging, rather than complex iterative coding tasks.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `25314f7e69cf43e9`
- **The host argues that the most effective method for non-technical users to build AI agent systems is to use a Large Language Model (like Claude) as a 'build partner' or coach, rather than following traditional tutorials.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `7a7e90a2a673c0a5`
- **The host argues that building a team of AI agents is accessible to non-technical users, provided they are willing to invest time in iterative development with an LLM build partner, despite initial negative ROI.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `145d857a2ed88d0b`
- **The role of human mathematicians is shifting from solving problems to verifying AI outputs, a transition that may be demotivating for those who entered the field for deep, long-term problem-solving.**
  - tier 2, confidence 0.8, source Pushman Kuetsky / AI Daily Brief Host, episode `how-significant-are-ais-latest-math-breakthroughs`, fp `3bac757169fb21a8`
- **Advanced AI models like GPT-5.6 Soul and Codex can perform complex verification tasks with high accuracy, such as checking 195 references in a book manuscript in 30 minutes without hallucinating page numbers or inventing text.**
  - tier 1, confidence 0.9, source Ethan Mollick (as reported by the AI Daily Brief host), episode `how-to-get-the-most-from-ai-this-summer`, fp `f1b430c1c33245e4`
- **The 'Lemonade Stand' expedition in the AI Summer Adventure program guides users through creating an AI-staffed microbusiness, including idea generation, business planning with an AI org chart, and demand validation.**
  - tier 2, confidence 0.9, source AI Daily Brief Host, episode `how-to-get-the-most-from-ai-this-summer`, fp `94bc0e390966d5af`
- **Agentic loops, which involve well-defined tasks with test builds and diffs that agents can recheck, are more intuitive in software engineering but require specific training to apply effectively in non-technical work.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `how-to-get-the-most-from-ai-this-summer`, fp `3972cb571c7e9416`
- **Uber CTO Praveen Napali stated that 99% of Uber's engineers use AI tools, more than 70% of pull requests are attributed to local or cloud agents, and engineers have built 2,500-plus agent skills across the software development life cycle.**
  - tier 1, confidence 0.95, source Praveen Napali, Uber CTO, episode `how-to-help-people-thrive-with-ai`, fp `b09d2e6d5667f811`
- **Researchers from UC Berkeley's Haas School of Business found that when using AI, workers started taking on tasks they had previously outsourced, such as coding and engineering, because these activities became easier to do.**
  - tier 1, confidence 0.9, source UC Berkeley's Haas School of Business, episode `how-to-help-people-thrive-with-ai`, fp `b6273ab7c5a9f857`
- **The ability of AI teams to rapidly learn from open-source projects and implement features on a daily basis suggests that a fundamentally different software development process is possible, with large strategic implications for the industry.**
  - tier 3, confidence 0.65, source Ethan Mollick, episode `how-to-use-claudes-massive-new-upgrades`, fp `146baae1ae8740d0`
- **The term 'vibe coding' is evolving to reflect a broader trend where all knowledge work is becoming coding work, as evidenced by the expansion of coding agents like Codex into general productivity tasks.**
  - tier 3, confidence 0.6, source Host (AI Daily Brief), episode `how-to-use-opus-47-and-the-new-codex`, fp `75847b30e690a1f7`
- **Boris Cherny, creator of Claude Code, stated that there is no manually written code anywhere in Anthropic's company, with Claude agents coordinating over Slack and resolving issues across the codebase.**
  - tier 1, confidence 0.85, source Boris Cherny, episode `surprise-elon-anthropic-team-up-reshapes-ai-race`, fp `629d7a354332dc2e`
- **Anthropic claims that users of Claude Code's auto mode ship 25% more pull requests compared to non-users.**
  - tier 1, confidence 0.85, source Anthropic, episode `what-the-heck-is-graph-engineering`, fp `7f1db07aa6226c1d`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - migration-date:: 2026-04-26T00:00:00Z",
  "content": "\n\n- ### Recent Developments\n  - **Industry Adoption Metrics (Uber):** Uber CTO Praveen Napali reported that 99% of Uber's engineers use AI tools, with more than 70% of pull requests attributed to local or cloud agents. Additionally, engineers have built over 2,500 agent skills across the software development life cycle. [source: Praveen Napali, Uber CTO, confidence 0.95, tier 1]\n  - **Shift in Task Allocation (UC Berkeley):** Researchers from UC Berkeley's Haas School of Business found that AI usage leads workers to internalize previously outsourced technical tasks, such as coding and engineering, as AI lowers the barrier to entry for these activities. [source: UC Berkeley's Haas School of Business, confidence 0.9, tier 1]\n  - **Autonomous Codebases (Anthropic):** Boris Cherny, creator of Claude Code, stated that there is no manually written code anywhere in Anthropic's company, with Claude agents coordinating over Slack and resolving issues across the codebase. Anthropic also claims that users of Claude Code's auto mode ship 25% more pull requests compared to non-users. [source: Boris Cherny / Anthropic, confidence 0.85, tier 1]\n  - **Verification Capabilities:** Advanced AI models like GPT-5.6 Soul and Codex can perform complex verification tasks with high accuracy. Ethan Mollick reported that an AI model checked 195 references in a book manuscript in 30 minutes without hallucinating page numbers or inventing text, providing accurate pages of notes. [source: Ethan Mollick (as reported by the AI Daily Brief host), confidence 0.9, tier 1]\n  - **Process Implications:** Ethan Mollick argued that the ability of AI teams to rapidly learn from open-source projects and implement features daily suggests a fundamentally different software development process is possible, with large strategic implications for the industry. [source: Ethan Mollick, confidence 0.65, tier 3]\n  - **Agentic Loops and Non-Technical Access:** Agentic loops, involving well-defined tasks with test builds and diffs, are intuitive in software engineering but require specific training for non-technical work. The host of AI Daily Brief noted that building AI agent teams is accessible to non-technical users who use an LLM as a 'build partner' rather than following traditional tutorials, with the most valuable use cases often being persistent research and cataloging rather than discrete coding tasks. [source: AI Daily Brief Host, confidence 0.85, tier 2]"
}
```

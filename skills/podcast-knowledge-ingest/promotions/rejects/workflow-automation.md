# Dossier: Workflow Automation

- status: `candidate_rejected`
- target page: `Workflow Automation.md`
- assertions: 14 across episodes: fable-5-raises-the-bar-for-ai-ambition, gpt-54-first-test-results, how-to-build-a-personal-agentic-operating-system, how-to-help-people-thrive-with-ai, how-to-use-claudes-massive-new-upgrades, how-to-use-opus-47-and-the-new-codex, opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, the-dawn-of-the-agent-age, the-new-ai-org-chart, the-openclaw-ification-of-ai, vibe-coding-gets-an-upgrade, why-everyone-is-obsessed-with-claude-code, your-company-doesnt-need-an-ai-strategy
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.92

## Assertions
- **The release of Fable 5 marks a shift from 'tasks' to 'responsibilities' in how users interact with AI, where models run autonomous loops rather than executing single prompts.**
  - tier 2, confidence 0.85, source Felix Ryberg (Anthropic) / AI Daily Brief Host, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `a84da9e354fdea7c`
- **GPT-5.4 is positioned as a model for professional work, integrating directly with enterprise tools like Excel, Factiva, and S&P Global, signaling a strategic push into the finance and knowledge work sectors.**
  - tier 2, confidence 0.85, source Brad Lightcap (OpenAI CEO) / Host, episode `gpt-54-first-test-results`, fp `fd0299def7302a82`
- **The 'Skills' layer of an Agent OS consists of reusable instruction sets or workflows that define how an agent performs specific tasks, such as weekly status updates or meeting prep.**
  - tier 2, confidence 0.95, source Nofar Gaspar, episode `how-to-build-a-personal-agentic-operating-system`, fp `cbdea461466d5428`
- **Uber's 'agentic pods' program reduced capital allocation across 150 cities from 15 hours to 30 minutes, financial pacing reports from two days to 10 minutes, and marketing web quality assurance from two weeks to 50 minutes.**
  - tier 1, confidence 0.95, source Praveen Napali, Uber CTO, episode `how-to-help-people-thrive-with-ai`, fp `9cfbc1dad3418fc7`
- **The host identifies 'AI champions' as key to driving AI adoption within organizations, arguing that their value lies not in promoting AI but in demonstrating what is possible by pairing with business functions to fundamentally change workflows.**
  - tier 2, confidence 0.75, source Host (AI Daily Brief), episode `how-to-help-people-thrive-with-ai`, fp `71987eb04a4ee3af`
- **Computer use and the ability to write and run code on the fly are the ultimate primitives for AI agents to automate real-world enterprise work, as most tasks require traversing multiple applications and data sources.**
  - tier 2, confidence 0.85, source Aaron Levie (Box), episode `how-to-use-claudes-massive-new-upgrades`, fp `5cf5a1017dac9d5a`
- **The term 'vibe coding' is evolving to reflect a broader trend where all knowledge work is becoming coding work, as evidenced by the expansion of coding agents like Codex into general productivity tasks.**
  - tier 3, confidence 0.6, source Host (AI Daily Brief), episode `how-to-use-opus-47-and-the-new-codex`, fp `75847b30e690a1f7`
- **Greg Brockman, OpenAI president, stated that by March 31st, OpenAI aims for agents to be the tool of first resort for any technical task, rather than editors or terminals.**
  - tier 1, confidence 0.9, source Greg Brockman (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `89c4b79be5cf7ada`
- **Brent Behore of Permanent Equity reported that two projects that previously failed after 100+ hours of work over 3 months were completed in 20 minutes using Claude Co-work.**
  - tier 1, confidence 0.95, source Brent Behore (Permanent Equity), episode `the-dawn-of-the-agent-age`, fp `187a5fbfe8cbaeeb`
- **The primary barrier to AI agent adoption in daily work is a lack of imagination and limiting beliefs, rather than a lack of technical capability.**
  - tier 2, confidence 0.75, source Brandon Gell (via Every podcast), episode `the-new-ai-org-chart`, fp `3a0114d553df021b`
- **Notion launched custom agents described as an 'AI team that never sleeps,' which are autonomous, model-agnostic, and can be triggered by schedules, Slack messages, or Notion comments.**
  - tier 1, confidence 0.95, source Notion, episode `the-openclaw-ification-of-ai`, fp `6488cf5f0f37803c`
- **Trigger-based AI agents, where specific real-world events (like a permit filing or usage drop) automatically invoke AI workflows, represent a significant opportunity for new startup companies.**
  - tier 3, confidence 0.65, source Greg Eisenberg (Startup Ideas Pod), episode `vibe-coding-gets-an-upgrade`, fp `3cbe8ede88cce505`
- **Damien Player predicted that in 2026, Opus 4.5 will enable one person to do the work of five people for $200 a month, making headcount a liability and manual workflows obsolete.**
  - tier 3, confidence 0.7, source Damien Player, episode `why-everyone-is-obsessed-with-claude-code`, fp `724474cfc0011758`
- **OpenAI's Codex introduced a 'record and replay' feature that allows users to demonstrate a recurring task, which the AI then converts into an inspectable and editable skill.**
  - tier 2, confidence 0.9, source OpenAI, episode `your-company-doesnt-need-an-ai-strategy`, fp `bb24a6f64b937bf8`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Security surface**: automation expands the attack surface by granting service accounts broad permissions; [[Least Privilege]] and secrets management ([[Secrets Management]]) are critical controls.",
  "content": "\n\n- ### Recent Developments\n  - **Enterprise Productivity Gains**: Brent Behore of Permanent Equity reported that two projects that previously failed after 100+ hours of work over 3 months were completed in 20 minutes using Claude Co-work. Similarly, Uber's 'agentic pods' program, led by CTO Praveen Napali, reduced capital allocation across 150 cities from 15 hours to 30 minutes, financial pacing reports from two days to 10 minutes, and marketing web quality assurance from two weeks to 50 minutes.\n  - **Autonomous Agent Platforms**: Notion launched custom agents described as an 'AI team that never sleeps,' which are autonomous, model-agnostic, and can be triggered by schedules, Slack messages, or Notion comments. This aligns with the shift from 'tasks' to 'responsibilities' noted by Felix Ryberg of Anthropic, who stated that with Fable 5, users move to autonomous loops where models run continuously rather than executing single prompts.\n  - **Agent Operating Systems and Skills**: The 'Skills' layer of an Agent OS, as defined by Nofar Gaspar, consists of reusable instruction sets or workflows that define how an agent performs specific tasks, such as weekly status updates or meeting prep. OpenAI's Codex introduced a 'record and replay' feature that allows users to demonstrate a recurring task, which the AI then converts into an inspectable and editable skill.\n  - **Strategic Shifts in AI Interaction**: Greg Brockman, OpenAI president, stated that by March 31st, OpenAI aims for agents to be the tool of first resort for any technical task, rather than editors or terminals. GPT-5.4 is positioned as a model for professional work, integrating directly with enterprise tools like Excel, Factiva, and S&P Global, signaling a strategic push into the finance and knowledge work sectors.\n  - **Foundational Primitives and Adoption**: Aaron Levie of Box identified computer use and the ability to write and run code on the fly as the ultimate primitives for AI agents to automate real-world enterprise work, as most tasks require traversing multiple applications and data sources. The primary barrier to adoption is often identified as a lack of imagination and limiting beliefs rather than technical capability, with 'AI champions' playing a key role in demonstrating what is possible by pairing with business functions to fundamentally change workflows. Damien Player predicted that in 2026, Opus 4.5 will enable one person to do the work of five people for $200 a month, making headcount a liability and manual workflows obsolete."
}
```

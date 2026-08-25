# Dossier: Tool Use

- status: `candidate_rejected`
- target page: `Tool Use.md`
- assertions: 14 across episodes: can-todays-ai-replace-12-of-work, claude-code-turns-one, does-gemini-31-pro-matter, gpt-54-first-test-results, how-i-built-my-10-agent-openclaw-team, how-people-actually-use-ai-agents, how-to-learn-ai-with-ai, how-to-use-claudes-massive-new-upgrades, moltbook-the-agent-social-nework-is-the-craziest-ai-phenomena-yet, what-people-are-actually-using-ai-for-right-now, why-ai-hasnt-increased-unemployment-according-to-anthropic, why-claude-opus-45-changes-whats-possible-with-vibe-coding
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **The complexity of tasks handled by Claude Code has increased significantly over six months, with the number of consecutive tool calls more than doubling.**
  - tier 1, confidence 0.92, source Anthropic Economic Index, episode `can-todays-ai-replace-12-of-work`, fp `5a17520baf8f5cf5`
- **Anthropic's API analysis indicates that almost 50% of all tool calls are related to software engineering, making it the dominant use case for their models.**
  - tier 1, confidence 0.95, source Anthropic API Analysis, episode `claude-code-turns-one`, fp `154bdbf4a340f173`
- **Gemini 3.1 Pro lags behind competitors like Claude Sonnet 4.6, Opus 4.6, GPT 5.2, and GLM5 on real-world agentic performance evaluations, specifically the GDP-valve test.**
  - tier 2, confidence 0.8, source Host (citing Artificial Analysis and skeptical commentators), episode `does-gemini-31-pro-matter`, fp `b6e067f59559a18b`
- **GPT-5.4's new tool search mechanism reduced total token usage by 47% on 250 tasks from Scale's MCP Atlas while maintaining the same accuracy as previous methods.**
  - tier 1, confidence 0.95, source OpenAI Announcement, episode `gpt-54-first-test-results`, fp `25a283758127a576`
- **The Codex CLI experience for GPT-5.4 offers significantly less friction and better transparency than Claude Code, featuring fewer approval prompts and interstitial status updates during long-running tasks.**
  - tier 2, confidence 0.85, source Host / Mark Tenenholtz, episode `gpt-54-first-test-results`, fp `5966cd3b4d44a118`
- **The host identifies a significant security risk in the OpenClaw ecosystem, noting that many initial skills and plugins contained malware, though the situation is improving.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `how-i-built-my-10-agent-openclaw-team`, fp `89171a65d8256d60`
- **Anthropic defines an agent for the purposes of their study as 'an AI system equipped with tools that allow it to take actions,' focusing analysis on individual tool calls rather than inferred architectures.**
  - tier 1, confidence 0.98, source Anthropic Study, episode `how-people-actually-use-ai-agents`, fp `9d46bcefb2894770`
- **Software engineering accounts for approximately 50% of all tool calls in Anthropic's agent usage data, while back-office automation is the second largest category at 9.1%.**
  - tier 1, confidence 0.96, source Anthropic Study / AI Daily Brief Host, episode `how-people-actually-use-ai-agents`, fp `b1796d4e2166354b`
- **The host suggests that users should use their primary AI partner to write prompts and specifications for other AI tools (e.g., using Claude to write prompts for Gemini's Nano Banana Pro), while verifying the output to ensure accuracy.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `how-to-learn-ai-with-ai`, fp `139765e80b32ab28`
- **Anthropic's computer use capability is designed to prioritize existing API connectors for precision, only falling back to controlling the mouse, keyboard, and screen when a specific connector is not available for a task.**
  - tier 2, confidence 0.9, source Anthropic, episode `how-to-use-claudes-massive-new-upgrades`, fp `47ea8d9c1f8fa2bc`
- **OpenClaw agents demonstrated emergent tool-use capabilities by autonomously converting voice memos to text using FFmpeg and OpenAI's Whisper API without explicit user configuration.**
  - tier 2, confidence 0.85, source Peter Steinberger (creator of OpenClaw), episode `moltbook-the-agent-social-nework-is-the-craziest-ai-phenomena-yet`, fp `bd595f92d72ca941`
- **The share of LLM requests that invoke tools rose from around 0% at the beginning of 2025 to 15% by the end of the year.**
  - tier 1, confidence 0.95, source OpenRouter and a16z, episode `what-people-are-actually-using-ai-for-right-now`, fp `cc3911a34131c654`
- **Anthropic has expanded its voice mode to Opus and Sonnet models and enabled compatibility with connectors like Gmail and Slack.**
  - tier 1, confidence 0.95, source Anthropic (reported by AI Daily Brief host), episode `why-ai-hasnt-increased-unemployment-according-to-anthropic`, fp `e51469863d706890`
- **Anthropic released three new features for agentic tool use: a tool search tool, programmatic tool calling, and tool use examples.**
  - tier 1, confidence 0.95, source Anthropic announcement post, episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `e21c7e1151d11d61`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Security became the dominant frontier concern: prompt injection ranks #1 on OWASP's 2025 LLM Top 10 with tool abuse as the primary attack surface, and Check Point's August 2026 analysis of Cloudflare Code Mode found five vulnerabilities in the workerd runtime (two rated Critical), underscoring the risk of giving models a code-execution sandbox over live tools.",
  "content": "\n\n- ### Recent Developments and Industry Insights (2025\u20132026)\n  - **Adoption Metrics and Usage Patterns**\n    - The share of LLM requests that invoke tools rose from approximately 0% at the beginning of 2025 to 15% by the end of the year, according to data from OpenRouter and a16z.\n    - Anthropic's analysis of API usage indicates that software engineering accounts for approximately 50% of all tool calls, making it the dominant use case for their models. Back-office automation follows as the second largest category at 9.1%.\n    - Anthropic defines an agent for the purposes of their study as \"an AI system equipped with tools that allow it to take actions,\" focusing their analysis on individual tool calls rather than inferred architectures.\n  - **New Features and Capabilities**\n    - Anthropic released three new features for agentic tool use: a tool search tool, programmatic tool calling, and tool use examples, the latter providing a universal standard for demonstrating how to effectively use a given tool.\n    - GPT-5.4 introduced a new tool search mechanism that reduced total token usage by 47% on 250 tasks from Scale's MCP Atlas while maintaining the same accuracy as previous methods.\n    - Anthropic expanded its voice mode to Opus and Sonnet models and enabled compatibility with connectors like Gmail and Slack, allowing the model to tap into apps to check calendars or email mid-conversation.\n    - Anthropic's computer use capability is designed to prioritize existing API connectors for precision, only falling back to controlling the mouse, keyboard, and screen when a specific connector is not available for a task.\n  - **Agent Complexity and Autonomy**\n    - The complexity of tasks handled by Claude Code has increased significantly over six months, with the number of consecutive tool calls more than doubling and the amount of human input needed to accomplish a given task decreasing significantly.\n    - OpenClaw agents demonstrated emergent tool-use capabilities by autonomously converting voice memos to text using FFmpeg and OpenAI's Whisper API without explicit user configuration, identifying file formats and environment keys to execute the pipeline.\n  - **Developer Experience and Best Practices**\n    - The Codex CLI experience for GPT-5.4 is reported to offer significantly less friction and better transparency than Claude Code, featuring fewer approval prompts and interstitial status updates during long-running tasks.\n    - Industry practitioners suggest using a primary AI partner to write prompts and specifications for other AI tools (e.g., using Claude to write prompts for Gemini's Nano Banana Pro), while verifying the output to ensure accuracy."
}
```

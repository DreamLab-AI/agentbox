# Dossier: Computer Use

- status: `candidate_rejected`
- target page: `Computer Use.md`
- assertions: 14 across episodes: google-says-no-ads-planned-for-gemini, gpt-54-first-test-results, grok-bot-finally-makes-ai-agents-easy, how-to-use-claudes-massive-new-upgrades, how-to-use-opus-47-and-the-new-codex, opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, where-should-claude-opus-5-fit-in-your-model-rotation
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5; completeness 0.58 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.58

## Assertions
- **ServiceNow President Almet Zavery stated that OpenAI's computer use agents will be granted access to IT tasks, such as restarting computers remotely, to function as automated IT support.**
  - tier 1, confidence 0.9, source Almet Zavery (ServiceNow President), episode `google-says-no-ads-planned-for-gemini`, fp `0b936abc8122c3f0`
- **GPT-5.4 achieved a 75% score on the OSWorld verified benchmark, surpassing the human-level performance baseline of 72.4% and significantly exceeding GPT-5.2's 47.3%.**
  - tier 1, confidence 0.95, source Rahul Agrawal (citing OpenAI data), episode `gpt-54-first-test-results`, fp `23976822c3eb2c8b`
- **The improvement in computer use capabilities is shifting the bottleneck for automation from technical feasibility to user trust, as agents now have reliable access to desktop environments.**
  - tier 2, confidence 0.8, source Rahul Agrawal, episode `gpt-54-first-test-results`, fp `3da38a9d4be08eb9`
- **Grok Bot's 'computer use' paradigm, where agents operate virtual machines to interact with web apps like humans, creates significant trust and security barriers for users sharing credentials.**
  - tier 2, confidence 0.8, source AI Daily Brief Host / Peter Yang, episode `grok-bot-finally-makes-ai-agents-easy`, fp `ac8fb9fa7bb3a6e8`
- **Anthropic released a feature allowing Claude to control the user's computer, including mouse, keyboard, and screen, to complete tasks in any application.**
  - tier 1, confidence 0.98, source Anthropic (Felix Riesberg), episode `how-to-use-claudes-massive-new-upgrades`, fp `1d4a4bcc6ac02111`
- **The official Claude announcement tweet for the computer use feature received 40 million views and 62,000 bookmarks within 16 hours of posting.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief), episode `how-to-use-claudes-massive-new-upgrades`, fp `1b4e61e90ed57bbc`
- **Anthropic's computer use capability is designed to prioritize existing API connectors for precision, only falling back to controlling the mouse, keyboard, and screen when a specific connector is not available for a task.**
  - tier 2, confidence 0.9, source Anthropic, episode `how-to-use-claudes-massive-new-upgrades`, fp `47ea8d9c1f8fa2bc`
- **Computer use and the ability to write and run code on the fly are the ultimate primitives for AI agents to automate real-world enterprise work, as most tasks require traversing multiple applications and data sources.**
  - tier 2, confidence 0.85, source Aaron Levie (Box), episode `how-to-use-claudes-massive-new-upgrades`, fp `5cf5a1017dac9d5a`
- **The widespread adoption of computer use by AI agents will create significant security and identity challenges, including the need to determine whether agents should act on behalf of users or have their own limited identities, and how to triage security events when activity volume is no longer a reliable signal.**
  - tier 3, confidence 0.65, source Aaron Levie (Box), episode `how-to-use-claudes-massive-new-upgrades`, fp `a28d0e4091441bb7`
- **Computer use capabilities are particularly valuable for enterprises with legacy software that lacks native AI or API integrations, as agents can now interact with these older applications through standard GUI controls.**
  - tier 3, confidence 0.6, source Peter Gustaff, episode `how-to-use-claudes-massive-new-upgrades`, fp `5c50d577ab0e91e6`
- **OpenAI's Codex application now supports computer use on Mac, allowing the agent to see, click, and type across any app on the computer with its own cursor.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief) citing OpenAI Codex release, episode `how-to-use-opus-47-and-the-new-codex`, fp `01c51a3e716d66e6`
- **Anthropic's Opus 4.7 model achieved a score of 78% on the OS World computer use benchmark, up from 72.7% for the previous version.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief) citing benchmark data, episode `how-to-use-opus-47-and-the-new-codex`, fp `b45874e3f195d253`
- **GPT-5.3 Codex scored 64.7% on the OS World benchmark, almost doubling the performance of GPT 5.2.**
  - tier 1, confidence 0.9, source OpenAI (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `2c14f954174c16fa`
- **Claude Opus 5 scored 70.6% on the OSWorld 2.0 computer use benchmark, significantly outperforming Fable 5 (55.7%) and GPT-5.6-Soul (62.6%).**
  - tier 1, confidence 0.95, source Host / Benchmark Data, episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `681dfde1e1f9370a`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Provenance",
  "content": "- ### Recent Developments\n  - **Anthropic Claude Computer Use**: Anthropic released a feature allowing Claude to control the user's computer, including mouse, keyboard, and screen, to complete tasks in any application. Felix Riesberg stated, \"Today we're releasing a feature that allows Claude to control your computer, mouse, keyboard, and screen, giving it the ability to use any app.\" The official announcement noted that users can enable Claude to open apps, navigate browsers, and fill in spreadsheets. The feature prioritizes existing API connectors for precision, falling back to direct GUI control only when a specific connector is unavailable. The announcement tweet received 40 million views and 62,000 bookmarks within 16 hours.\n  - **OpenAI Codex & GPT Models**: OpenAI's Codex application now supports computer use on Mac, allowing the agent to see, click, and type across any app with its own cursor (Windows support is planned). Performance on the OSWorld verified benchmark has improved significantly across model generations: GPT-5.2 scored 47.3%, GPT-5.3 Codex scored 64.7%, and GPT-5.4 achieved 75%, surpassing the human-level baseline of 72.4%.\n  - **Benchmark Comparisons**: On the OSWorld 2.0 computer use benchmark, Claude Opus 5 scored 70.6%, outperforming Fable 5 (55.7%) and GPT-5.6-Soul (62.6%). Anthropic's Opus 4.7 model also showed improvement, rising from 72.7% to 78% on the OS World computer use benchmark.\n  - **Enterprise Adoption & Trust**: ServiceNow President Almet Zavery indicated that OpenAI's computer use agents will be granted access to IT tasks, such as remote computer restarts, to function as automated IT support. Aaron Levie of Box described computer use and on-the-fly code execution as the \"ultimate primitives\" for agents to automate real-world enterprise work, which typically requires traversing multiple applications. However, experts note that the bottleneck for automation is shifting from technical feasibility to user trust, particularly regarding credential sharing and the security of agents operating in live desktop environments.\n\n- ### Provenance"
}
```

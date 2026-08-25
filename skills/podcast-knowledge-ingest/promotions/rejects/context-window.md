# Dossier: Context Window

- status: `candidate_rejected`
- target page: `Context Window.md`
- assertions: 11 across episodes: autoresearch-agent-loops-and-the-future-of-work, chatgpt-55-rumors-start-to-bubble, gpt-54-first-test-results, harness-engineering-101, how-to-learn-ai-with-ai, how-to-use-claudes-massive-new-upgrades, opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, surprise-elon-anthropic-team-up-reshapes-ai-race, the-latest-ai-models-and-model-rumors, what-people-are-actually-using-ai-for-right-now, why-google-workspace-cli-is-such-a-big-deal
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **The 'Ralph Wiggum' technique, popularized by developer Jeffrey Huntley, involves running an AI coding agent in a loop where the agent's output is fed back as input, deliberately terminating the agent before context window exhaustion to externalize memory into files and Git history.**
  - tier 2, confidence 0.88, source Podcast Host / Jeffrey Huntley, episode `autoresearch-agent-loops-and-the-future-of-work`, fp `b668a3c8190a6c2a`
- **DeepSeek V4 is expected to be released in mid-February with a heavy focus on coding performance and long context windows.**
  - tier 1, confidence 0.85, source The Information (cited by Host), episode `chatgpt-55-rumors-start-to-bubble`, fp `d025e3671507fd9f`
- **GPT-5.4 features a 1 million token context window, which was confirmed after earlier rumors suggested a 2 million token limit.**
  - tier 1, confidence 0.9, source The Information / OpenAI, episode `gpt-54-first-test-results`, fp `1b51a245c16f691f`
- **OpenAI's internal beta for a software product with zero manually written code revealed that 'progressive disclosure' of context is a key challenge in harness design, requiring agents to access minimum necessary information to avoid crowding the context window.**
  - tier 2, confidence 0.85, source OpenAI / AI Daily Brief Host, episode `harness-engineering-101`, fp `33fac27c087a2ab2`
- **The host recommends using "handoff documents" to capture key themes, decisions, and open questions before ending an AI session, as platform memory features are currently unreliable and context windows are limited.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `how-to-learn-ai-with-ai`, fp `ffc5c41795aa84d2`
- **The 1 million token context window became generally available for both Claude Opus and Claude Sonnet models.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief), episode `how-to-use-claudes-massive-new-upgrades`, fp `c27a40ae6e99f30e`
- **Claude Opus 4.6 supports a 1 million token context window.**
  - tier 1, confidence 0.95, source Anthropic (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `81dfd1ecd761881c`
- **If models can maintain 'infinite' context windows, they can continually learn from experience, a functional distinction that may collapse the line between continual learning and AGI.**
  - tier 3, confidence 0.55, source Dan McCarty / AI Daily Brief Host, episode `surprise-elon-anthropic-team-up-reshapes-ai-race`, fp `f76728c1cf934cf6`
- **GPT-5.3 Codex Spark has a 128K context window, does not support multimodal inputs, and is unable to complete long-horizon tasks.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `the-latest-ai-models-and-model-rumors`, fp `64411a428072e8f0`
- **The average number of prompt tokens per request grew approximately 4x over the course of 2025, from around 1,500 tokens to 6,000 tokens.**
  - tier 1, confidence 0.95, source OpenRouter and a16z, episode `what-people-are-actually-using-ai-for-right-now`, fp `29d54871ac1af921`
- **One developer measured that loading MCP servers into an agent's context window consumed 37,000 tokens and 20% of the context before any work began, due to 142 tools being loaded.**
  - tier 1, confidence 0.85, source Kanika (via AI Daily Brief Host), episode `why-google-workspace-cli-is-such-a-big-deal`, fp `8b1df57571c2f8f5`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Standards and frameworks for context window usage remain emergent, with ongoing efforts to standardise tokenisation methods and benchmarking protocols for context window performance.",
  "content": "\n\n  ## Recent Developments (2025\u20132026)\n\n  - **GPT-5.4 Context Window**: GPT-5.4 features a 1 million token context window, confirmed after earlier rumors suggested a 2 million token limit. [source: The Information / OpenAI, confidence 0.9, tier 1]\n  - **Claude 1M Token GA**: The 1 million token context window became generally available for both Claude Opus and Claude Sonnet models. Claude Opus 4.6 specifically supports a 1 million token context window. [source: Host (AI Daily Brief) / Anthropic, confidence 0.9\u20130.95, tier 1]\n  - **DeepSeek V4**: Expected to be released in mid-February with a heavy focus on coding performance and long context windows, showcasing advances in handling extremely long contexts. [source: The Information (cited by Host), confidence 0.85, tier 1]\n  - **GPT-5.3 Codex Spark**: Features a 128K context window, does not support multimodal inputs, and is unable to complete long-horizon tasks. [source: AI Daily Brief host, confidence 0.95, tier 1]\n  - **Token Usage Growth**: The average number of prompt tokens per request grew approximately 4x over the course of 2025, from around 1,500 tokens to 6,000 tokens. [source: OpenRouter and a16z, confidence 0.95, tier 1]\n  - **MCP Overhead**: One developer measured that loading MCP servers into an agent's context window consumed 37,000 tokens and 20% of the context before any work began, due to 142 tools being loaded. [source: Kanika (via AI Daily Brief Host), confidence 0.85, tier 1]\n\n  ### Context Management Strategies\n\n  - **The 'Ralph Wiggum' Technique**: Popularized by developer Jeffrey Huntley, this involves running an AI coding agent in a loop where the agent's output is fed back as input, deliberately terminating the agent before context window exhaustion to externalize memory into files and Git history. [source: Podcast Host / Jeffrey Huntley, confidence 0.88, tier 2]\n  - **Progressive Disclosure**: OpenAI's internal beta for a software product with zero manually written code revealed that 'progressive disclosure' of context is a key challenge in harness design, requiring agents to access minimum necessary information to avoid crowding the context window. [source: OpenAI / AI Daily Brief Host, confidence 0.85, tier 2]\n  - **Handoff Documents**: The host recommends using \"handoff documents\" to capture key themes, decisions, and open questions before ending an AI session, as platform memory features are currently unreliable and context windows are limited. [source: Host (AI Daily Brief), confidence 0.85, tier 2]\n\n  ### Theoretical Implications\n\n  - **Infinite Context and AGI**: If models can maintain 'infinite' context windows, they can continually learn from experience, a functional distinction that may collapse the line between continual learning and AGI. As Dan McCarty notes: 'Infinite context means AI systems that continually learn and when that arrives it'll be much harder to deny that we haven't arrived at AGI.' [source: Dan McCarty / AI Daily Brief Host, confidence 0.55, tier 3]"
}
```

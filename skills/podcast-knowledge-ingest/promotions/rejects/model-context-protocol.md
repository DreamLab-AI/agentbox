# Dossier: Model Context Protocol

- status: `candidate_rejected`
- target page: `Model Context Protocol.md`
- assertions: 13 across episodes: how-to-build-a-personal-context-mcp, how-to-use-claudes-massive-new-upgrades, the-10-biggest-ai-stories-of-2025, the-biggest-battle-in-ai-is-for-your-personal-context, why-claude-opus-45-changes-whats-possible-with-vibe-coding, why-every-ai-product-seems-the-same, why-google-workspace-cli-is-such-a-big-deal, will-this-update-from-openai-make-ai-agents-work-better
- reasons: rubric_b_improvement -2.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.83

## Assertions
- **Building an MCP server to host a personal context portfolio is a highly effective, low-complexity method for learning how to use the Model Context Protocol, with most time spent on troubleshooting rather than complex coding.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `7dec76caeb692ac0`
- **Claude Code 'Remote Control' sessions run directly on the user's local machine rather than cloud infrastructure, allowing the mobile interface to act as a window into the local environment, file system, and MCP servers.**
  - tier 1, confidence 0.95, source Anthropic Documentation, episode `how-to-use-claudes-massive-new-upgrades`, fp `9de793e75cb59802`
- **Claude Code 'Channels' are implemented as MCP servers that push external events, such as CI failures or monitoring alerts, directly into a running Claude Code session, allowing the agent to react to the outside world without being manually prompted.**
  - tier 1, confidence 0.95, source Anthropic (Tarek), episode `how-to-use-claudes-massive-new-upgrades`, fp `e84771cf671fcd7c`
- **The Model Context Protocol (MCP), introduced by Anthropic, achieved rapid industry-wide adoption in early 2025, with OpenAI announcing support on March 26 and Google's CEO endorsing it in April, avoiding a prolonged standards war.**
  - tier 2, confidence 0.9, source Host (AI Daily Brief), episode `the-10-biggest-ai-stories-of-2025`, fp `20c57656adad7f5e`
- **Anthropic utilizes connectors, powered by the Model Context Protocol, to link Claude Co-work to external data sources such as Google Drive.**
  - tier 1, confidence 0.85, source AI Daily Brief host, episode `the-biggest-battle-in-ai-is-for-your-personal-context`, fp `91692268be3d00c3`
- **Anthropic released three new features for agentic tool use: a tool search tool, programmatic tool calling, and tool use examples.**
  - tier 1, confidence 0.95, source Anthropic announcement post, episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `e21c7e1151d11d61`
- **Anthropic released Claude Code channels, allowing users to control Claude Code sessions through MCPs such as Telegram and Discord.**
  - tier 1, confidence 0.95, source Tariq (Claude Code), episode `why-every-ai-product-seems-the-same`, fp `cafb14734e6dc78e`
- **In a poll of 769 agent builders conducted by Latent Spaces' Swyx, traditional APIs were the most preferred integration method (39%), followed by CLI (31.2%), skills.md (20.5%), and MCP (9.1%).**
  - tier 1, confidence 0.95, source Swyx (Latent Spaces), episode `why-google-workspace-cli-is-such-a-big-deal`, fp `35a43f8f2aeff3ca`
- **One developer measured that loading MCP servers into an agent's context window consumed 37,000 tokens and 20% of the context before any work began, due to 142 tools being loaded.**
  - tier 1, confidence 0.85, source Kanika (via AI Daily Brief Host), episode `why-google-workspace-cli-is-such-a-big-deal`, fp `8b1df57571c2f8f5`
- **Justin Ponault argues that every protocol layer between an agent and an API, such as MCP, introduces an 'abstraction tax' that compounds fidelity loss, whereas LLMs can navigate complex CLIs via help commands and precise API calls.**
  - tier 2, confidence 0.85, source Justin Ponault, episode `why-google-workspace-cli-is-such-a-big-deal`, fp `41088a9d59c53595`
- **OpenAI confirmed the addition of experimental support for Anthropic's skills mechanism in its Codex CLI tool, noting it combines well with GPT-5.2.**
  - tier 1, confidence 0.9, source Tibo (OpenAI), episode `will-this-update-from-openai-make-ai-agents-work-better`, fp `5c036a65eba0defd`
- **Simon Willison argued that Anthropic's skills mechanism may be a bigger deal than the Model Context Protocol (MCP) due to its simplicity and lower token overhead.**
  - tier 2, confidence 0.85, source Simon Willison, episode `will-this-update-from-openai-make-ai-agents-work-better`, fp `de9f4af862cc7e98`
- **Simon Willison predicted a 'Cambrian explosion' of skills that would make the 2024 rush of Model Context Protocol (MCP) adoption look 'pedestrian' by comparison.**
  - tier 3, confidence 0.6, source Simon Willison, episode `will-this-update-from-openai-make-ai-agents-work-better`, fp `3f298180ee7bbdc1`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - GitHub MCP Server Registry. (2025). https://github.com/modelcontextprotocol/servers",
  "content": "\n\n- ### Recent Developments\n\n  #### Adoption and Industry Response\n\n  The Model Context Protocol achieved rapid industry-wide adoption in early 2025, avoiding a prolonged standards war. OpenAI announced support on March 26, 2025, with Sam Altman tweeting, \"People love MCP and we are excited to add support across our products.\" This was followed by endorsement from Alphabet CEO Sundar Pichai in April 2025. Additionally, OpenAI confirmed the addition of experimental support for Anthropic's skills mechanism in its Codex CLI tool, noting that it combines well with GPT-5.2.\n\n  #### New Features and Capabilities\n\n  Anthropic has continued to expand the MCP ecosystem with several key features:\n  - **Tool Search and Programmatic Calling**: New capabilities include a tool search tool and programmatic tool calling, alongside tool use examples that provide a universal standard for demonstrating effective tool usage.\n  - **Claude Code Channels**: These are implemented as MCP servers that push external events\u2014such as CI failures, monitoring alerts, or messages from Telegram and Discord\u2014directly into a running Claude Code session. This allows the agent to react to the outside world without manual prompting.\n  - **Remote Control Sessions**: Unlike cloud-based sessions, Claude Code 'Remote Control' sessions run directly on the user's local machine. The mobile and web interfaces act as a window into this local environment, providing access to the local file system and connected MCP servers.\n  - **Connectors**: Anthropic utilizes MCP-powered connectors to link Claude Co-work to external data sources, such as Google Drive, enabling seamless data integration.\n\n  #### Criticisms and Limitations\n\n  Despite its adoption, MCP faces criticism regarding efficiency and complexity:\n  - **Token Overhead**: One developer measured that loading 142 MCP tools consumed 37,000 tokens, accounting for 20% of the context window before any work began. Simon Willison has argued that Anthropic's simpler skills mechanism may be more significant than MCP due to its lower token overhead.\n  - **Abstraction Tax**: Justin Ponault argues that every protocol layer between an agent and an API, including MCP, introduces an \"abstraction tax\" that compounds fidelity loss, whereas LLMs can often navigate complex CLIs or precise API calls more directly.\n  - **Preference Surveys**: In a poll of 769 agent builders conducted by Latent Spaces' Swyx, traditional APIs were the most preferred integration method (39%), followed by CLI (31.2%), skills.md (20.5%), and MCP (9.1%), suggesting that while MCP is a standard, many developers still prefer direct or simpler interfaces for specific tasks.\n\n  #### Learning and Implementation\n\n  Building an MCP server to host a personal context portfolio is considered a highly effective, low-complexity method for learning the protocol. Practitioners note that while the coding is straightforward, the majority of time is often spent on troubleshooting, making it a practical entry point for understanding MCP's mechanics."
}
```

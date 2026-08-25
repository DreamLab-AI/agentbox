# Dossier: Autonomous Coding

- status: `candidate_survivor`
- target page: `Autonomous Coding.md`
- assertions: 6 across episodes: opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026, the-week-the-ai-story-shifted

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Anthropic's autonomous coding test using Claude Opus 4.6 agent teams to build a C compiler consumed around 2 billion tokens, generated over 140 million output tokens, and cost approximately $20,000.**
  - tier 1, confidence 0.9, source Anthropic (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `6b420231b7338347`
- **Max Stoiber from the ChatGPT team stated that the MCP apps feature was built entirely with GPT-5.3 Codex, with zero lines of code written by hand.**
  - tier 1, confidence 0.85, source Max Stoiber (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `c78ee7555f0c76b5`
- **Cursor built a browser using GPT 5.2 that ran uninterrupted for one week, resulting in over 3 million lines of code across thousands of files.**
  - tier 1, confidence 0.95, source Michael Troll (Cursor CEO), episode `ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026`, fp `7567db9c39663513`
- **Cursor implemented a hierarchical pipeline with 'planner' and 'worker' agents to solve coordination problems, allowing scaling to very large projects without single-agent tunnel vision.**
  - tier 1, confidence 0.9, source Cursor Blog, episode `ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026`, fp `5ef89b55805dec37`
- **The 'Ralph Wiggum loop' is an autonomous AI coding pattern where each iteration uses a fresh context window, with memory persisted via git history and text files.**
  - tier 1, confidence 0.9, source Ryan Carson, episode `ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026`, fp `b3adff530c1d4cbe`
- **OpenAI's new /goal feature for Codex allows the AI agent to work on a persistent objective across multiple turns until it is achieved, a concept referred to as a 'Ralph loop'.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief) citing Philip Corry, episode `the-week-the-ai-story-shifted`, fp `4f687b4a941f0ccf`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Provenance\n\t- updated:: 2026-07-25\n\t- attributedTo:: did:nostr:ontology-mesh\n\t- inferenceRule:: GapMaterialisation",
  "content": "- ### Recent Developments\n\t- **Anthropic's C Compiler Test**: Anthropic's autonomous coding test using Claude Opus 4.6 agent teams to build a C compiler consumed around 2 billion tokens, generated over 140 million output tokens, and cost approximately $20,000. [source: Anthropic (via Host), confidence 0.9, tier 1]\n\t- **ChatGPT MCP Apps**: Max Stoiber from the ChatGPT team stated that the MCP apps feature was built entirely with GPT-5.3 Codex, with zero lines of code written by hand. [source: Max Stoiber (via Host), confidence 0.85, tier 1]\n\t- **Cursor's Browser Build**: Cursor built a browser using GPT 5.2 that ran uninterrupted for one week, resulting in over 3 million lines of code across thousands of files. [source: Michael Troll (Cursor CEO), confidence 0.95, tier 1]\n\t- **Hierarchical Agent Pipelines**: Cursor implemented a hierarchical pipeline with 'planner' and 'worker' agents to solve coordination problems, allowing scaling to very large projects without single-agent tunnel vision. [source: Cursor Blog, confidence 0.9, tier 1]\n\t- **Ralph Wiggum Loop**: The 'Ralph Wiggum loop' is an autonomous AI coding pattern where each iteration uses a fresh context window, with memory persisted via git history and text files. [source: Ryan Carson, confidence 0.9, tier 1]\n\t- **OpenAI Codex /goal Feature**: OpenAI's new /goal feature for Codex allows the AI agent to work on a persistent objective across multiple turns until it is achieved, a concept referred to as a 'Ralph loop'. [source: Host (AI Daily Brief) citing Philip Corry, confidence 0.9, tier 1]"
}
```

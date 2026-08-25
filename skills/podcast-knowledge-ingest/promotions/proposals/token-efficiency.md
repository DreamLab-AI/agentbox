# Dossier: Token Efficiency

- status: `candidate_survivor`
- target page: `Token Efficiency.md`
- assertions: 14 across episodes: is-ai-doom-going-out-of-style, just-how-good-is-gpt-6-going-to-be, more-new-ai-models-openai-drops-51-pro-and-codex-pro, opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, real-world-ai-evaluations, the-best-way-to-talk-to-your-agents, the-models-trying-to-replace-fable, the-most-important-ai-news-from-google-io, where-should-claude-opus-5-fit-in-your-model-rotation, why-claude-opus-45-changes-whats-possible-with-vibe-coding, why-google-workspace-cli-is-such-a-big-deal, why-only-ai-training-can-save-the-economy, will-this-update-from-openai-make-ai-agents-work-better, your-company-doesnt-need-an-ai-strategy

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Atlassian's AI search tool Rovo is more token-efficient than Retrieval-Augmented Generation (RAG) because it leverages existing structured knowledge graphs in Jira.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `is-ai-doom-going-out-of-style`, fp `c3e9ac0c7f868ca8`
- **Google released Gemini 3.6 Flash, which used 17% fewer tokens than Gemini 3.5 Flash on the Artificial Analysis benchmark.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `just-how-good-is-gpt-6-going-to-be`, fp `ab2ec03d2d6c7504`
- **GPT-5.1 Codex Max with medium reasoning effort achieves better performance than GPT-5.1 Codex with the same reasoning effort while using 30% fewer thinking tokens on the SweetBench Verified benchmark.**
  - tier 1, confidence 0.9, source OpenAI, episode `more-new-ai-models-openai-drops-51-pro-and-codex-pro`, fp `987d7d471d3cd7f9`
- **Andy Henny stated that GPT-5.3 Codex is roughly three times more token efficient than GPT-5.2, using 1/3 the tokens for similar intelligence.**
  - tier 2, confidence 0.8, source Andy Henny (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `fc48ac2c482b45f6`
- **GPT-5.1 underperformed GPT-5 on the GDPvala benchmark, landing in fourth place, despite using half as many tokens to complete the tasks.**
  - tier 1, confidence 0.95, source Artificial Analysis, episode `real-world-ai-evaluations`, fp `310b6453808ac59e`
- **A major counter-argument to adopting HTML for agent workflows is that it consumes significantly more tokens than Markdown, potentially increasing costs for users and providers.**
  - tier 2, confidence 0.85, source Josh Dawes (cited by AI Daily Brief host), episode `the-best-way-to-talk-to-your-agents`, fp `af693d63eaf2020d`
- **The shift from chat-based AI to agentic workloads has led to an explosion in token costs, forcing application-layer companies to develop sophisticated routing and management strategies to maintain viable business models.**
  - tier 3, confidence 0.65, source Harvey President Gabe Perriello (cited by AI Daily Brief host), episode `the-models-trying-to-replace-fable`, fp `45f898f5925c1337`
- **Gemini 3.5 Flash used about 3.5 times more tokens than GPT-5.5 Medium for Artificial Analysis intelligence index tests.**
  - tier 1, confidence 0.88, source AI Daily Brief host, episode `the-most-important-ai-news-from-google-io`, fp `22c5def77d501107`
- **Claude Opus 5 is priced at $5 per million input tokens and $25 per million output tokens, inheriting the same pricing structure as Opus 4.8.**
  - tier 1, confidence 0.95, source Host / Anthropic, episode `where-should-claude-opus-5-fit-in-your-model-rotation`, fp `f10efb8b2c5ad264`
- **Claude Opus 4.5 is significantly more token-efficient than Sonnet 4.5, using 76% fewer output reasoning tokens for the same complex tasks on SWE-bench Verified at medium effort.**
  - tier 2, confidence 0.8, source Alex Albert / Simon Willis, episode `why-claude-opus-45-changes-whats-possible-with-vibe-coding`, fp `fe6eac78d51dff07`
- **One developer measured that loading MCP servers into an agent's context window consumed 37,000 tokens and 20% of the context before any work began, due to 142 tools being loaded.**
  - tier 1, confidence 0.85, source Kanika (via AI Daily Brief Host), episode `why-google-workspace-cli-is-such-a-big-deal`, fp `8b1df57571c2f8f5`
- **Uber implemented a $1,500 per month cap per employee for AI spending after blowing through its entire AI budget in the first four months of the year.**
  - tier 1, confidence 0.9, source Host (AI Daily Brief), episode `why-only-ai-training-can-save-the-economy`, fp `7569808022fe6d90`
- **Simon Willison argued that Anthropic's skills mechanism may be a bigger deal than the Model Context Protocol (MCP) due to its simplicity and lower token overhead.**
  - tier 2, confidence 0.85, source Simon Willison, episode `will-this-update-from-openai-make-ai-agents-work-better`, fp `de9f4af862cc7e98`
- **The host predicts that as token costs increase, organizations will face a temptation to impose strict token spend limits and bias towards known ROI, which may hinder the experimentation needed to discover optimal AI integration strategies.**
  - tier 3, confidence 0.75, source AI Daily Brief Host, episode `your-company-doesnt-need-an-ai-strategy`, fp `7fae46be10ed9e38`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Relationships",
  "content": "- ### Recent Developments\n  - **GPT-5.1 vs. GPT-5 Efficiency:** GPT-5.1 underperformed GPT-5 on the GDPvala benchmark, landing in fourth place, despite using half as many tokens to complete the tasks. *(Source: Artificial Analysis, 2026-08-24)*\n  - **Gemini 3.6 Flash Token Reduction:** Google released Gemini 3.6 Flash, which used 17% fewer tokens than Gemini 3.5 Flash on the Artificial Analysis benchmark. *(Source: AI Daily Brief, 2026-08-24)*\n  - **Claude Opus 5 Pricing:** Claude Opus 5 is priced at $5 per million input tokens and $25 per million output tokens, inheriting the same pricing structure as Opus 4.8. *(Source: Anthropic, 2026-08-24)*\n  - **GPT-5.1 Codex Max Performance:** GPT-5.1 Codex Max with medium reasoning effort achieves better performance than GPT-5.1 Codex with the same reasoning effort while using 30% fewer thinking tokens on the SweetBench Verified benchmark. *(Source: OpenAI, 2026-08-24)*\n  - **Uber AI Spending Cap:** Uber implemented a $1,500 per month cap per employee for AI spending after blowing through its entire AI budget in the first four months of the year. *(Source: AI Daily Brief, 2026-08-24)*\n  - **Gemini 3.5 Flash vs. GPT-5.5 Medium:** Gemini 3.5 Flash used about 3.5 times more tokens than GPT-5.5 Medium for Artificial Analysis intelligence index tests, raising questions about the value proposition of speed and cost. *(Source: AI Daily Brief, 2026-08-24)*\n  - **Anthropic Skills vs. MCP:** Simon Willison argued that Anthropic's skills mechanism may be a bigger deal than the Model Context Protocol (MCP) due to its simplicity and lower token overhead. *(Source: Simon Willison, 2026-08-24)*\n  - **MCP Context Window Overhead:** One developer measured that loading MCP servers into an agent's context window consumed 37,000 tokens and 20% of the context before any work began, due to 142 tools being loaded. *(Source: Kanika via AI Daily Brief, 2026-08-24)*\n  - **HTML vs. Markdown Token Cost:** A major counter-argument to adopting HTML for agent workflows is that it consumes significantly more tokens than Markdown, potentially increasing costs for users and providers. *(Source: Josh Dawes via AI Daily Brief, 2026-08-24)*\n  - **Claude Opus 4.5 vs. Sonnet 4.5:** Claude Opus 4.5 is significantly more token-efficient than Sonnet 4.5, using 76% fewer output reasoning tokens for the same complex tasks on SWE-bench Verified at medium effort. *(Source: Alex Albert via Simon Willis, 2026-08-24)*\n  - **GPT-5.3 Codex Efficiency:** Andy Henny stated that GPT-5.3 Codex is roughly three times more token efficient than GPT-5.2, using 1/3 the tokens for similar intelligence. *(Source: Andy Henny via AI Daily Brief, 2026-08-24)*\n  - **Atlassian Rovo vs. RAG:** Atlassian's AI search tool Rovo is more token-efficient than Retrieval-Augmented Generation (RAG) because it leverages existing structured knowledge graphs in Jira. *(Source: AI Daily Brief, 2026-08-24)*\n- ### Relationships"
}
```

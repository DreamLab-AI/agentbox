# Dossier: Markdown

- status: `candidate_rejected`
- target page: `Markdown.md`
- assertions: 6 across episodes: how-to-build-a-personal-context-mcp, the-best-way-to-talk-to-your-agents
- reasons: completeness 0.17 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 1.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.17

## Assertions
- **The 'Personal Context Portfolio' is a structured set of 10 markdown files designed to serve as a portable, machine-readable representation of an individual's identity, projects, and preferences for AI agents.**
  - tier 2, confidence 0.95, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `09f9a6f8fb5dd1fb`
- **Markdown is the universal interchange format for context in AI systems, making it the ideal foundation for portable personal context portfolios.**
  - tier 2, confidence 0.9, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `2db907fb91c358e4`
- **Tariq Shoupar, a developer at Anthropic, argued in an essay titled 'The Unreasonable Effectiveness of HTML' that HTML is a superior format to Markdown for agent-human communication due to higher information density, visual clarity, and ease of sharing.**
  - tier 2, confidence 0.9, source Tariq Shoupar (Anthropic), episode `the-best-way-to-talk-to-your-agents`, fp `fb39b6a45d3f8ff5`
- **A major counter-argument to adopting HTML for agent workflows is that it consumes significantly more tokens than Markdown, potentially increasing costs for users and providers.**
  - tier 2, confidence 0.85, source Josh Dawes (cited by AI Daily Brief host), episode `the-best-way-to-talk-to-your-agents`, fp `af693d63eaf2020d`
- **HTML is better suited than Markdown for representing 'mixed doneness' in project specifications, allowing native encoding of locked, open, and provisional states through visual hierarchy and interactive elements without extensive meta-commentary.**
  - tier 2, confidence 0.8, source AI Daily Brief host, episode `the-best-way-to-talk-to-your-agents`, fp `6810265ddf7e868b`
- **The choice between Markdown and HTML for agent communication should be determined by three factors: the intended audience (human vs. agent), the document's lifecycle (edited many times vs. written once), and its temporal horizon (ephemeral vs. lasting).**
  - tier 2, confidence 0.8, source The Smart Ape (cited by AI Daily Brief host), episode `the-best-way-to-talk-to-your-agents`, fp `326d79cecf40d32f`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "Its plain-text nature makes it version-control friendly and easy for both humans and language models to author and parse.",
  "content": "\n- ### Recent Developments\n  - **Personal Context Portfolios**: A structured set of 10 markdown files (e.g., `identity.md`, `roles_and_responsibilities.md`, `current_projects.md`) has emerged as a portable, machine-readable representation of an individual's identity and preferences for AI agents. This \"context package\" leverages Markdown's status as the universal interchange format for context in AI systems, ensuring broad compatibility across different agent frameworks.\n  - **Markdown vs. HTML for Agent Communication**: A debate has arisen regarding the optimal format for agent-human interaction. Tariq Shoupar (Anthropic) argues in \"The Unreasonable Effectiveness of HTML\" that HTML offers superior information density, visual clarity, and the ability to natively encode \"mixed doneness\" (locked vs. open states) in project specifications without meta-commentary. Conversely, critics like Josh Dawes note that HTML consumes significantly more tokens than Markdown, increasing costs. The Smart Ape suggests the choice should depend on three factors: the intended audience (human vs. agent), the document's lifecycle (edited many times vs. written once), and its temporal horizon (ephemeral vs. lasting)."
}
```

# Dossier: Claude Co-work

- status: `candidate_survivor`
- target page: `Claude Co-work.md`
- assertions: 5 across episodes: the-saaspocalypse-continues, why-claude-cowork-is-a-big-deal

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.80

## Assertions
- **Thomson Reuters stock fell 20% following the release of the legal plugin for Claude Co-work.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `the-saaspocalypse-continues`, fp `343d81ecd1633b06`
- **Anthropic announced Claude Co-work, a product designed to allow non-developers to use Claude for non-coding tasks by providing access to local files and connectors.**
  - tier 1, confidence 0.95, source Anthropic, episode `why-claude-cowork-is-a-big-deal`, fp `7465b42682438225`
- **Claude Co-work is currently available only in research preview to users with Max accounts, which start at a subscription cost of $100 per month.**
  - tier 1, confidence 0.9, source Host, episode `why-claude-cowork-is-a-big-deal`, fp `20f25d3f1d7271e2`
- **Lenny Rachitsky used Claude Co-work to analyze 320 podcast transcripts, a task that took approximately 15 minutes to complete and involved processing between 450 and 600 hours of content.**
  - tier 1, confidence 0.9, source Lenny Rachitsky, episode `why-claude-cowork-is-a-big-deal`, fp `942bec78f7bff4c2`
- **Claire Vo of the How I AI podcast criticized Claude Co-work for sitting in a 'fuzzy middle' between the power of Claude Code and the simplicity needed for non-technical users, arguing it is not optimized for either audience.**
  - tier 2, confidence 0.85, source Claire Vo, episode `why-claude-cowork-is-a-big-deal`, fp `daa107e8f7069e69`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Overview\n  - Anthropic's Claude Co-work feature is now available on Windows with full parity to macOS, including file access, multi-step task execution, plugins, and MCP connectors. *(Source: AI Daily Brief host, via AI Daily Brief, 2026-08-24)*",
  "content": "- ### Recent Developments\n  - **Product Announcement & Positioning**: Anthropic announced Claude Co-work as a product designed to allow non-developers to use Claude for non-coding tasks by providing access to local files and connectors. The company noted that after the release of Claude Code, users quickly began using it for tasks beyond coding, prompting the creation of Co-work as \"a simpler way for anyone, not just developers, to work with Claude in the very same way.\" *(Source: Anthropic, confidence 0.95, tier 1)*\n  - **Availability & Pricing**: Claude Co-work is currently available only in research preview to users with Max accounts, which start at a subscription cost of $100 per month. *(Source: AI Daily Brief host, confidence 0.9, tier 1)*\n  - **Market Impact**: The release of the legal plugin for Claude Co-work contributed to a 20% drop in Thomson Reuters stock, as the company highlighted that AI is delivering tangible benefits to its operations. *(Source: AI Daily Brief host, confidence 0.9, tier 1)*\n  - **User Case Study**: Lenny Rachitsky utilized Claude Co-work to analyze 320 podcast transcripts, a task involving between 450 and 600 hours of content that was completed in approximately 15 minutes. *(Source: Lenny Rachitsky, confidence 0.9, tier 1)*\n  - **Critical Reception**: Claire Vo of the How I AI podcast criticized the feature for occupying a \"fuzzy middle\" between the power of Claude Code and the simplicity required for non-technical users, arguing it is not optimized for either audience. *(Source: Claire Vo, confidence 0.85, tier 2)*"
}
```

# Dossier: Persona

- status: `candidate_survivor`
- target page: `Persona.md`
- assertions: 5 across episodes: google-says-no-ads-planned-for-gemini, how-to-build-a-personal-agentic-operating-system, how-to-build-a-personal-context-mcp

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.60

## Assertions
- **Google is already offering ads in AI search, including a new feature called 'direct offers' that presents personalized discounts in AI mode.**
  - tier 1, confidence 0.9, source Dan Taylor (Google VP of Global Ads), episode `google-says-no-ads-planned-for-gemini`, fp `88a52b90cebe4cb1`
- **The 'Identity' layer of an Agent OS is implemented via specific text files that vary by tool, such as 'soul' in Open Claw, 'agents.md' in Cursor, and 'Claude.md' in Claude Code.**
  - tier 1, confidence 0.95, source Nofar Gaspar, episode `how-to-build-a-personal-agentic-operating-system`, fp `662a74e04525f24c`
- **The 'Personal Context Portfolio' is a structured set of 10 markdown files designed to serve as a portable, machine-readable representation of an individual's identity, projects, and preferences for AI agents.**
  - tier 2, confidence 0.95, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `09f9a6f8fb5dd1fb`
- **The 'Personal Context Portfolio App' uses Claude Opus 4.6 to conduct an ongoing interview that dynamically updates all 10 portfolio files simultaneously when a single answer is relevant to multiple dimensions.**
  - tier 1, confidence 0.85, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `19012bfdd5ac2d92`
- **The 'decision_log.md' file in a personal context portfolio is likely the most underrated component, as it provides agents with historical reasoning patterns to improve future decision support.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `b5d9be8e9deb33f6`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Content\n  - Personas are typically specified through system prompts and behavioural guardrails that fix tone, allowed topics, and decision style, sometimes reinforced by fine-tuning or retrieval of role-specific knowledge. A well-designed persona improves trust and task fit, while a poorly bounded one can drift, leak instructions, or produce off-brand responses.",
  "content": "\n- ### Recent Developments\n  - **Implementation via Identity Files**: The 'Identity' layer of an Agent OS is increasingly implemented via specific text files that vary by tool. Naming conventions include 'soul' in Open Claw, 'agents.md' in Cursor, 'Claude.md' in Claude Code, and 'copilot instructions' in GitHub Copilot. [source: Nofar Gaspar, confidence 0.95, tier 1]\n  - **Personal Context Portfolio**: A structured set of 10 markdown files (e.g., `identity.md`, `roles_and_responsibilities.md`, `decision_log.md`) is emerging as a portable, machine-readable representation of an individual's identity and preferences for AI agents, effectively serving as \"API documentation but for you.\" [source: Host (AI Daily Brief), confidence 0.95, tier 2]\n  - **Dynamic Persona Maintenance**: The 'Personal Context Portfolio App' utilizes Claude Opus 4.6 to conduct ongoing interviews that dynamically update all 10 portfolio files simultaneously when a single answer is relevant to multiple dimensions. [source: Host (AI Daily Brief), confidence 0.85, tier 1]\n  - **Decision Logging**: The `decision_log.md` file is considered a critical component for providing agents with historical reasoning patterns, significantly improving future decision support by contextualizing how a user has previously resolved similar issues. [source: Host (AI Daily Brief), confidence 0.8, tier 2]\n  - **Commercial Integration**: Google is actively testing ad features in AI search, including 'direct offers' that present personalized discounts in AI mode, signaling a convergence of AI mode and search where persona-driven personalization intersects with commercial intent. [source: Dan Taylor (Google VP of Global Ads), confidence 0.9, tier 1]"
}
```

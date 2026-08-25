# Dossier: ai-application

- status: `candidate_survivor`
- target page: `ai-application.md`
- assertions: 7 across episodes: gemini-3-launches-heres-everything-you-need-to-know, gpt-54-first-test-results, how-big-is-the-ai-economy, how-people-are-using-ai-for-health

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Google's Gemini app reached 650 million monthly active users and 13 million developers have built with their models as of the Gemini 3 launch.**
  - tier 1, confidence 0.98, source Google (Sundar Pichai announcement), episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `a55bec223cbc309b`
- **Google released 'Anti-gravity,' a new agentic development platform (IDE) that allows AI agents to autonomously plan and execute software tasks while directly accessing the editor, terminal, and browser.**
  - tier 1, confidence 0.98, source Google (Logan Kilpatrick / Josh Woodward), episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `98dacfd04b44d37e`
- **Google's 'Anti-gravity' IDE represents a strategic shift in the developer tooling market, potentially challenging established competitors like Cursor by integrating browser control and autonomous agent planning directly into the development workflow.**
  - tier 3, confidence 0.7, source AI Daily Brief Host / Max Weinbach, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `6559b387530602a3`
- **The skill set of 'agent building and orchestration' is emerging as a distinct, in-demand professional competency that is difficult to describe or evaluate using traditional technical metrics.**
  - tier 3, confidence 0.7, source Host (Matt Schmidt), episode `gpt-54-first-test-results`, fp `7b76fca36df184fd`
- **Value in the AI economy is shifting up the stack, with the percentage of AI revenue from the app and model layer increasing almost 3x over the last year.**
  - tier 2, confidence 0.8, source Exponential View (State of the AI Economy report), episode `how-big-is-the-ai-economy`, fp `29597e91e5971b41`
- **The launch of ChatGPT Health is expected to render many existing AI health startups redundant by consolidating triage, nutrition, fitness, and mental health services into a single platform.**
  - tier 2, confidence 0.8, source Deep Kumar (industry observer), episode `how-people-are-using-ai-for-health`, fp `468198df8844e005`
- **AI will not replace critical healthcare services like hospitals or OB units but will serve as a near-term bridge to help underserved populations navigate access gaps and reduce clinician burnout.**
  - tier 3, confidence 0.7, source OpenAI report 'AI as a healthcare ally', episode `how-people-are-using-ai-for-health`, fp `4111299bde106992`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "The category is closely coupled to AI infrastructure (the compute and serving platforms enabling deployment) and AI safety (the governance constraints on what applications may do).",
  "content": "\n\n### Recent Developments\n\n*   **Gemini Scale and Developer Adoption:** As of the Gemini 3 launch, Google's Gemini app reached 650 million monthly active users, an increase of approximately 50 million from previous reports. Additionally, 13 million developers have built applications using Google's models [source: Google (Sundar Pichai announcement), confidence 0.98, tier 1].\n*   **Agentic Development Platforms:** Google released \"Anti-gravity,\" a new agentic development platform (IDE) that enables AI agents to autonomously plan and execute software tasks with direct access to the editor, terminal, and browser. This launch represents a strategic shift in developer tooling, potentially challenging established competitors like Cursor by integrating browser control and autonomous agent planning directly into the workflow [source: Google (Logan Kilpatrick / Josh Woodward), confidence 0.98, tier 1; AI Daily Brief Host / Max Weinbach, confidence 0.7, tier 3].\n*   **Emerging Competencies:** \"Agent building and orchestration\" is emerging as a distinct, in-demand professional competency. This skill set is difficult to describe or evaluate using traditional technical metrics, creating challenges for organizations seeking to hire or contract for these roles [source: Host (Matt Schmidt), confidence 0.7, tier 3].\n*   **Economic Value Shift:** Value in the AI economy is shifting up the stack, with the percentage of AI revenue from the app and model layer increasing almost 3x over the last year. While revenue remains concentrated around chips, hosting, foundation model, and app-layer revenues (e.g., from Cursor) are rising significantly [source: Exponential View (State of the AI Economy report), confidence 0.8, tier 2].\n*   **Healthcare AI Consolidation:** The launch of ChatGPT Health is expected to render many existing AI health startups redundant by consolidating triage, nutrition, fitness, and mental health services into a single platform. However, AI is not expected to replace critical healthcare services like hospitals or OB units; instead, it serves as a near-term bridge to help underserved populations navigate access gaps and reduce clinician burnout [source: Deep Kumar (industry observer), confidence 0.8, tier 2; OpenAI report 'AI as a healthcare ally', confidence 0.7, tier 3]."
}
```

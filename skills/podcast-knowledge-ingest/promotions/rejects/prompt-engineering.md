# Dossier: Prompt Engineering

- status: `candidate_rejected`
- target page: `Prompt Engineering.md`
- assertions: 15 across episodes: fable-5-raises-the-bar-for-ai-ambition, gpt-54-first-test-results, how-to-build-a-personal-context-mcp, how-to-get-the-most-out-of-fable-5-and-gpt-56-sol, how-to-learn-ai-with-ai, how-to-use-opus-47-and-the-new-codex, the-best-claude-design-use-cases, the-best-way-to-talk-to-your-agents, the-ultimate-ai-catch-up-guide, vibe-coding-gets-an-upgrade
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.92

## Assertions
- **Users are developing a new skill called 'task imagination' to identify and define complex, long-horizon problems suitable for high-capability models like Fable 5.**
  - tier 2, confidence 0.8, source Nate B. Jones / AI Daily Brief Host, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `b6b2fc5ad774ea75`
- **GPT-5.4 exhibits significant 'scope creep' and over-verbosity, often expanding tasks beyond user requests and providing excessively detailed responses that increase cognitive burden for the prompter.**
  - tier 2, confidence 0.85, source Host (Matt Schmidt) / Community Feedback, episode `gpt-54-first-test-results`, fp `f98e71372e490035`
- **Using AI as a tutor and build partner requires explicitly demanding step-by-step explanations and full code blocks to avoid errors from partial copy-pasting and to prevent the AI from racing ahead with overly complex solutions.**
  - tier 2, confidence 0.9, source Host (AI Daily Brief), episode `how-to-build-a-personal-context-mcp`, fp `eff981c411ac9b33`
- **OpenAI's GPT-5.6 prompting guide advises removing repeated instructions from prompts, which raised scores by 10-15% and cut token usage by up to 66%.**
  - tier 1, confidence 0.95, source OpenAI (via AI content creator Ollie Leeman's summary of the official guide), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `7e3d85a85460450a`
- **OpenAI recommends starting GPT-5.6 thinking effort at one level lower than the previous model's setting, as the new generation typically requires less compute to achieve similar results.**
  - tier 1, confidence 0.95, source OpenAI (via AI content creator Ollie Leeman's summary of the official guide), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `bf7ec53c91df0503`
- **GPT-5.6 defaults to shorter answers than GPT-5.5, meaning brevity rules added for older models can now cut too much necessary information.**
  - tier 1, confidence 0.95, source OpenAI (via AI content creator Ollie Leeman's summary of the official guide), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `c06a718c7faabfc3`
- **OpenAI's GPT-5.6 prompting guide recommends using concrete behavioral instructions for tone rather than abstract adjectives like 'friendly' or 'empathetic'.**
  - tier 1, confidence 0.95, source OpenAI (via AI content creator Ollie Leeman's summary of the official guide), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `c29e1b4e0c8cc73b`
- **OpenAI's Codex team member Eric Provencal describes GPT-5.6 Soul as 'a lot more tenacious and thorough' than previous models, requiring explicit boundaries to prevent unintended actions.**
  - tier 2, confidence 0.9, source Eric Provencal (OpenAI Codex Team), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `0804c772cf1f8ef1`
- **The host suggests that users should use their primary AI partner to write prompts and specifications for other AI tools (e.g., using Claude to write prompts for Gemini's Nano Banana Pro), while verifying the output to ensure accuracy.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `how-to-learn-ai-with-ai`, fp `139765e80b32ab28`
- **Cat Wu from Anthropic recommends delegating tasks to Opus 4.7 rather than micromanaging, advising users to provide the full goal, constraints, and acceptance criteria up front to avoid reducing quality through progressive clarification.**
  - tier 2, confidence 0.9, source Cat Wu (Anthropic Claude Code team), episode `how-to-use-opus-47-and-the-new-codex`, fp `13cd42211fe4f85b`
- **Claude Design's default aesthetic tends to be 'generic SaaS' (e.g., Inter font, predictable gradients), requiring users to explicitly ban these defaults in prompts to achieve distinctive designs.**
  - tier 2, confidence 0.8, source Smart App (via AI Daily Brief host), episode `the-best-claude-design-use-cases`, fp `6979b2902d4da518`
- **HTML is better suited than Markdown for representing 'mixed doneness' in project specifications, allowing native encoding of locked, open, and provisional states through visual hierarchy and interactive elements without extensive meta-commentary.**
  - tier 2, confidence 0.8, source AI Daily Brief host, episode `the-best-way-to-talk-to-your-agents`, fp `6810265ddf7e868b`
- **The 'calibration problem' in agentic work involves determining the optimal level of structure to impose on an agent, as overspecifying limits the agent's capabilities while underspecifying leads to generic output or excessive clarifying questions.**
  - tier 3, confidence 0.75, source AI Daily Brief host, episode `the-best-way-to-talk-to-your-agents`, fp `fb24d20db11a5bd7`
- **Modern AI models, such as those used in Ideogram, automatically rewrite and expand user-provided prompts into more detailed and structured instructions in the background to improve output quality.**
  - tier 2, confidence 0.8, source AI Daily Brief (Host), episode `the-ultimate-ai-catch-up-guide`, fp `c2f0522c6ef44678`
- **Google launched a "Skills" feature in Chrome that allows users to save and reuse AI prompts for the Gemini assistant, functioning as a prompt library for one-click workflows.**
  - tier 1, confidence 0.9, source Google (Logan Kilpatrick, official announcement), episode `vibe-coding-gets-an-upgrade`, fp `810b0f5b335037bf`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Frontier model capabilities (2026)**: GPT-4.5 (rumoured, 2025), Claude 4 (Anthropic roadmap), and Gemini 2.5 Ultra achieve near-saturation on standard reasoning benchmarks with minimal prompting; engineering effort shifts toward multi-agent coordination, long-context fidelity, tool-use reliability, and domain-specific calibration.",
  "content": "\n  - ### Recent Developments and Model-Specific Prompting Shifts (2025-2026)\n\n  - **GPT-5.6 Prompting Best Practices (OpenAI)**: OpenAI's official prompting guide for GPT-5.6 (summarised by developer Ollie Leeman) introduces several counter-intuitive shifts from previous generations:\n    - **Instruction Deduplication**: Repeating instructions in a prompt is now actively discouraged. OpenAI found that stating each instruction exactly once and removing redundancies raised benchmark scores by 10-15% while cutting token usage by up to 66%.\n    - **Thinking Effort Calibration**: The guide advises starting GPT-5.6's thinking effort setting one level lower than the previous model's default, as the new generation typically requires less compute to achieve similar results. Maximum effort should be reserved for genuinely hard problems.\n    - **Brevity Defaults**: GPT-5.6 defaults to shorter answers than GPT-5.5. Consequently, blanket \"keep it brief\" instructions added for older models can now cut necessary information. The guide recommends specifying exactly which information to retain rather than using generic brevity constraints.\n    - **Concrete Behavioral Tone**: Abstract adjectives like \"friendly\" or \"empathetic\" are less effective. The guide recommends spelling out specific writing behaviors (e.g., \"Name the customer's problem in your first line, give the fix as numbered steps, skip the apology paragraph\").\n\n  - **GPT-5.6 Soul and Codex Tenacity**: Eric Provencal (OpenAI Codex Team) notes that GPT-5.6 Soul is \"a lot more tenacious and thorough\" than previous models. This increased autonomy requires explicit boundaries in prompts to prevent unintended actions, such as specifying \"Keep the approved dates and budget figures unchanged\" or \"Prepare the message as a draft, don't send it.\"\n\n  - **GPT-5.4 Scope Creep and Verbosity**: Community feedback (e.g., Matt Schmidt) highlights that GPT-5.4 exhibits significant \"scope creep,\" often expanding tasks beyond user requests and providing excessively detailed, repetitive responses. This places a high cognitive burden on the prompter, requiring tighter constraint definitions to manage output length and focus.\n\n  - **Anthropic Claude 4.7 Delegation Strategy**: Cat Wu (Anthropic Claude Code team) recommends delegating tasks to Opus 4.7 rather than micromanaging. Users should provide the full goal, constraints, and acceptance criteria up front. Progressive clarification across multiple turns can actually reduce quality on 4.7, as the model is designed to act as a capable engineer handed a complete task specification.\n\n  - **Google Chrome \"Skills\" Feature**: Google launched a \"Skills\" feature in Chrome that allows users to save and reuse AI prompts for the Gemini assistant. This functions as a personal prompt library for one-click workflows, with examples including calculating nutrition stats or comparison shopping.\n\n  - **Prompting for AI as Tutor/Build Partner**: Practical advice from AI Daily Brief hosts emphasises explicitly demanding step-by-step explanations and full code blocks when using AI as a tutor or build partner. This prevents errors from partial copy-pasting and stops the AI from racing ahead with overly complex solutions. Users are advised to demand that the AI \"go back and do things more simply\" and to request the entire new document for copy-pasting to ensure accuracy.\n\n  - **Meta-Prompting and Automatic Expansion**: Modern AI models (e.g., Ideogram) increasingly rewrite and expand user-provided prompts into more detailed, structured instructions in the background to improve output quality. Additionally, hosts suggest using a primary AI partner to write prompts and specifications for other AI tools (e.g., using Claude to write prompts for Gemini's Nano Banana Pro), verifying the output for accuracy.\n\n  - **Design Prompting Defaults**: Claude Design's default aesthetic tends toward \"generic SaaS\" (e.g., Inter font, predictable gradients). To achieve distinctive designs, users must explicitly ban these defaults in their prompts."
}
```

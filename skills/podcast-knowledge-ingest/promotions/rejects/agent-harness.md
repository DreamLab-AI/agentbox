# Dossier: Agent Harness

- status: `candidate_rejected`
- target page: `Agent Harness.md`
- assertions: 9 across episodes: how-harness-as-a-service-will-change-agents, surprise-elon-anthropic-team-up-reshapes-ai-race, what-google-needs-to-do-at-io-this-week
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **A new report from Endor Labs found that GPT-5.5 operating within Cursor's harness achieved a 23.5% score on a security correctness benchmark, narrowly beating Cursor with Opus 4.7 (22.9%).**
  - tier 1, confidence 0.92, source Endor Labs / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `3e463fe7775ed389`
- **Switching GPT-5.5 from its native Codex harness to Cursor's harness increased its functionality benchmark score from 61.5% to 87.2%.**
  - tier 1, confidence 0.92, source Endor Labs / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `b98bca07e5cd96ec`
- **Sam Altman stated that the harness and the model are no longer separable, noting that he often cannot determine whether a successful agent outcome was due to the model or the harness.**
  - tier 2, confidence 0.9, source Sam Altman (via AI Daily Brief), episode `how-harness-as-a-service-will-change-agents`, fp `7effcd888af5b5fd`
- **The 'Harness as a Service' (HaaS) category is emerging, where companies sell access to pre-built agent runtimes that handle tool dispatch, sandboxing, and state management, similar to how AWS sells compute.**
  - tier 2, confidence 0.85, source AI Daily Brief Host, episode `how-harness-as-a-service-will-change-agents`, fp `4e7c055d25e463df`
- **The agent landscape has evolved through three phases: the 'weights phase' (model scaling), the 'context phase' (prompt engineering/RAG), and the current 'harness engineering phase' (environment optimization).**
  - tier 2, confidence 0.85, source Akshay (via AI Daily Brief), episode `how-harness-as-a-service-will-change-agents`, fp `d63e694c96030c43`
- **The Cursor SDK enables the creation of 'local hackable agents' that can be embedded into non-IDE environments like Gmail or Chrome plugins, allowing agents to operate on codebases outside of traditional development tools.**
  - tier 2, confidence 0.85, source Cursor / Jack Driscoll / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `e05d484e1575b400`
- **The 'Open Claw' era of open-source agent harnesses is analogous to the hobbyist era of computing, where users had to assemble their own systems, whereas 'Harness as a Service' represents the shift to pre-built, democratized infrastructure.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `how-harness-as-a-service-will-change-agents`, fp `4420d1379087502a`
- **The competitive landscape in AI has shifted from model capability comparisons to a focus on agent harnesses and workflows, with the competition between Codex and Claude Code being more significant than Opus versus GPT.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `surprise-elon-anthropic-team-up-reshapes-ai-race`, fp `f3ff9f9e18dca091`
- **Google faces a strategic challenge in consolidating its AI agent harness, with uncertainty over whether Gemini CLI, AI Studio, or another tool will be the core platform for work AI.**
  - tier 2, confidence 0.7, source AI Daily Brief host and Hater, episode `what-google-needs-to-do-at-io-this-week`, fp `93269d530af3930e`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - ## Current Landscape (2026)",
  "content": "  - ## Recent Developments (Q2 2026)\n    - **Harness-Model Indissociability** \u2014 Sam Altman has stated that the harness and the model are no longer separable, noting that he often cannot determine whether a successful agent outcome was due to the model or the harness: \"I no longer think of the harness and the model as these entirely separable things... I don't know how much credit [was it the model or the harness].\" This observation marks a shift in industry discourse from model-centric benchmarking to system-level evaluation, where the harness is recognised as a co-determinant of agent performance rather than a neutral wrapper.\n    - **Empirical Harness Impact** \u2014 A new report from Endor Labs found that GPT-5.5 operating within Cursor's harness achieved a 23.5% score on a security correctness benchmark, narrowly beating Cursor with Opus 4.7 (22.9%). More strikingly, switching GPT-5.5 from its native Codex harness to Cursor's harness increased its functionality benchmark score from 61.5% to 87.2%. These results provide concrete evidence that harness selection can outweigh model selection in determining agent capability, validating the \"harness engineering phase\" thesis.\n    - **Three-Phase Evolution** \u2014 The agent landscape has evolved through three distinct phases: the 'weights phase' (model scaling), the 'context phase' (prompt engineering/RAG), and the current 'harness engineering phase' (environment optimization). As summarised by Akshay in the AI Daily Brief: \"In phase one... everything was about the model... In phase two... you can change what the model sees... But... gets us to the third phase, the harness engineering phase.\" This framing positions harness engineering as the current frontier of AI system optimisation.\n    - **Harness as a Service (HaaS)** \u2014 A new infrastructure category is emerging where companies sell access to pre-built agent runtimes that handle tool dispatch, sandboxing, and state management, analogous to how AWS sells compute. The 'Open Claw' era of open-source agent harnesses is being characterised as analogous to the hobbyist era of computing, where users had to assemble their own systems, whereas HaaS represents the shift to pre-built, democratized infrastructure. As the AI Daily Brief host argued: \"The productivity revolution of the 1990s happened because users got Dell desktops, not because more people learn to assemble motherboards.\"\n    - **Competitive Landscape Shift** \u2014 The competitive landscape in AI has shifted from model capability comparisons to a focus on agent harnesses and workflows, with the competition between Codex and Claude Code being more significant than Opus versus GPT. The host noted: \"if you had to put your finger on the important competition of 2026, it's been way more about Codex versus Claude Code than it has been about Opus versus GPT.\" Meanwhile, Google faces a strategic challenge in consolidating its AI agent harness, with uncertainty over whether Gemini CLI, AI Studio, or another tool will be the core platform for work AI.\n    - **Cursor SDK and Local Hackable Agents** \u2014 The Cursor SDK enables the creation of 'local hackable agents' that can be embedded into non-IDE environments like Gmail or Chrome plugins, allowing agents to operate on codebases outside of traditional development tools. A demo by Jack Driscoll showed: \"The agent is effectively a cursor agent embedded directly into Gmail... Cursor SDK is the part that can actually go operate on a code base like a cursor agent would.\" This extends the harness concept beyond the IDE into general-purpose application contexts."
}
```

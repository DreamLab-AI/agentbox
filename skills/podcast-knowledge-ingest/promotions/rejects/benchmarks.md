# Dossier: Benchmarks

- status: `candidate_rejected`
- target page: `Benchmarks.md`
- assertions: 15 across episodes: dario-amodei-breaks-his-social-media-silence, does-gemini-31-pro-matter, gemini-3-launches-heres-everything-you-need-to-know, gpt-52-is-here, introducing-maturity-maps-a-new-way-to-measure-ai-adoption
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.83

## Assertions
- **Anthropic's internal 'Model 2' scores 62.8% on the internal V2 AIR&D code benchmark, compared to 50.3% for Mythos 5 and 54.8% for Mythos preview.**
  - tier 1, confidence 0.9, source Chris GPT / Anthropic Internal Data, episode `dario-amodei-breaks-his-social-media-silence`, fp `1ff6ac57c4f0e9f4`
- **Gemini 3.1 Pro achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens.**
  - tier 1, confidence 0.95, source Host (citing benchmark data and Akash Gupta's analysis), episode `does-gemini-31-pro-matter`, fp `82c4ca951ff14274`
- **Gemini 3.1 Pro scored 80.6% on the SWE-bench Verified agent decoding test, slightly trailing Claude Opus 4.6 which scored 80.8%.**
  - tier 1, confidence 0.9, source Host (citing benchmark results), episode `does-gemini-31-pro-matter`, fp `c6d9019448d5efb3`
- **Gemini 3.1 Pro lags behind competitors like Claude Sonnet 4.6, Opus 4.6, GPT 5.2, and GLM5 on real-world agentic performance evaluations, specifically the GDP-valve test.**
  - tier 2, confidence 0.8, source Host (citing Artificial Analysis and skeptical commentators), episode `does-gemini-31-pro-matter`, fp `b6e067f59559a18b`
- **Gemini 3 Pro achieved a score of 37.5% on the Humanity's Last Exam benchmark, surpassing GPT-5.1's score of 26.5%.**
  - tier 1, confidence 0.95, source Google / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `4dc57b54becc36f2`
- **Gemini 3 Pro scored 72.7% on the ScreenSpot Pro benchmark, doubling the previous state-of-the-art score of 36.2% held by Sonnet 4.5.**
  - tier 1, confidence 0.95, source Matt Schumer / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `318168a7d470b20a`
- **Gemini 3 Pro achieved a score of 31.1% on the ARC-AGI 2 benchmark, compared to 17.6% for GPT-5.1, with a 'deep think' mode pushing the score to 45.1%.**
  - tier 1, confidence 0.95, source Google / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `e669ce27ddf6dfb9`
- **Gemini 3 Pro is currently ranked number one across all major LMArena leaderboards, including text, vision, web development, coding, and math categories.**
  - tier 2, confidence 0.9, source LMArena / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `2a36877fb69df590`
- **GPT 5.2 achieved a score of 55.6% on the SWE-bench Pro coding benchmark, surpassing Claude Opus 4.5's score of 52%.**
  - tier 1, confidence 0.95, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `431d38d125ea42d7`
- **GPT 5.2 Pro achieved a state-of-the-art score of 90.5% on the ARC-AGI 2 benchmark at a cost of $11.64 per task, representing a 390x efficiency improvement over a previous unreleased OpenAI model that scored 88% at $4,500 per task.**
  - tier 1, confidence 0.95, source ARC Prize / AI Daily Brief Host, episode `gpt-52-is-here`, fp `e20b3cb8e01417dd`
- **GPT 5.2 Thinking scored 70.9% on GDP Val, an internal OpenAI benchmark for economically valuable knowledge work, compared to 38.8% for GPT 5.**
  - tier 1, confidence 0.95, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `bea2098b782bd985`
- **More than 480 studies and surveys from the last quarter went into the Q2 AI maturity maps.**
  - tier 1, confidence 0.98, source Host (AI DB / Super Intelligent), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `e69ecce194492514`
- **The combined survey respondent base for the Q2 maturity maps exceeds 150,000 professionals across more than 50 countries.**
  - tier 1, confidence 0.98, source Host (AI DB / Super Intelligent), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `3b2b9c760568acf6`
- **Jellyfish's AI coding benchmark used behavioral data for more than 200,000 engineers across 700 companies with 20 million PRs.**
  - tier 1, confidence 0.95, source Jellyfish (cited by host), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `4056b2bb4b195b4b`
- **The host predicts that ROI measurement efforts will see the biggest 'glow-up' in the coming quarters.**
  - tier 3, confidence 0.7, source Host, episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `15cbd203ead5d564`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  ## Current Landscape (2026)",
  "content": "  ## Recent Developments (2026)\n  Recent benchmark results and industry data highlight the rapid pace of capability improvement and the increasing sophistication of evaluation methodologies in 2026:\n\n  - **ARC-AGI-2 Efficiency and Performance**: GPT 5.2 Pro achieved a state-of-the-art score of 90.5% on the ARC-AGI 2 benchmark at a cost of $11.64 per task, representing a 390x efficiency improvement over a previous unreleased OpenAI model that scored 88% at $4,500 per task. This underscores the growing importance of cost-efficiency metrics alongside raw capability scores in frontier model evaluations.\n  - **Gemini 3.1 Pro Leap**: Gemini 3.1 Pro achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens. This rapid improvement in intelligence without incremental cost highlights the intensifying competition in the frontier model market.\n  - **Coding and Agentic Benchmarks**: GPT 5.2 achieved a score of 55.6% on the SWE-bench Pro coding benchmark, surpassing Claude Opus 4.5's score of 52%. Additionally, Gemini 3.1 Pro scored 80.6% on the SWE-bench Verified agent decoding test, slightly trailing Claude Opus 4.6 which scored 80.8%, indicating a tight race in agentic coding capabilities.\n  - **Humanity's Last Exam (HLE)**: Gemini 3 Pro achieved a score of 37.5% on the HLE benchmark, surpassing GPT-5.1's score of 26.5%, demonstrating continued progress in academic reasoning and expert-level knowledge tasks.\n  - **Economic Value Metrics**: GPT 5.2 Thinking scored 70.9% on GDP Val, an internal OpenAI benchmark for economically valuable knowledge work, compared to 38.8% for GPT 5. This reflects a shift toward benchmarks that measure real-world economic utility rather than just academic performance.\n  - **Multimodal and Computer Use**: Gemini 3 Pro scored 72.7% on the ScreenSpot Pro benchmark, doubling the previous state-of-the-art score of 36.2% held by Sonnet 4.5. This massive acceleration in computer-use agent capabilities is expected to significantly impact deployment timelines for autonomous agents.\n  - **Human Preference Leaderboards**: Gemini 3 Pro is currently ranked number one across all major LMArena leaderboards, including text, vision, web development, coding, and math categories, reinforcing the correlation between automated benchmark performance and human preference signals.\n  - **Maturity and Industry Data**: The combined survey respondent base for the Q2 2026 AI maturity maps exceeds 150,000 professionals across more than 50 countries, aggregating more than 480 studies and surveys. Notably, Jellyfish's AI coding benchmark used behavioral data for more than 200,000 engineers across 700 companies with 20 million PRs, providing large-scale empirical grounding for industry adoption metrics.\n\n  ## Current Landscape (2026)"
}
```

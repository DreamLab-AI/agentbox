# Dossier: Model Performance

- status: `candidate_rejected`
- target page: `Model Performance.md`
- assertions: 57 across episodes: autoresearch-agent-loops-and-the-future-of-work, can-open-models-solve-corporate-ai-washing, chatgpt-55-rumors-start-to-bubble, dario-amodei-breaks-his-social-media-silence, does-gemini-31-pro-matter, everything-you-need-to-know-about-ai-tokens, fable-5-raises-the-bar-for-ai-ambition, gemini-3-anticipation-reaches-fever-pitch, gemini-3-launches-heres-everything-you-need-to-know, gpt-52-is-here, gpt-54-first-test-results, grok-46-shows-how-fast-your-ai-options-are-expanding, how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, how-deepseek-v4-connects-to-the-us-grid, how-googles-ai-leaders-leaving-could-lead-to-better-ai-models-for-you, how-harness-as-a-service-will-change-agents, how-significant-are-ais-latest-math-breakthroughs, how-the-4-new-models-released-this-week-will-change-how-you-work, how-to-get-the-most-from-ai-this-summer, how-to-help-ai-do-your-work-better, how-to-use-opus-47-and-the-new-codex, is-kimi-k3-really-fable-class, openai-declares-code-red, opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war, real-world-ai-evaluations, the-5-biggest-ai-stories-to-watch-in-december, the-most-important-ai-news-from-google-io, the-most-important-ai-stories-this-week, the-next-wave-of-enterprise-ai, the-ultimate-ai-catch-up-guide, what-i-learned-testing-gpt-5-5
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Karpathy's shared session of the 'auto research' loop resulted in 83 experiments, of which 15 were kept, driving the validation BPB from 0.9979 down to 0.9697.**
  - tier 1, confidence 0.95, source Andrej Karpathy (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `d7e51269ea5c3d5f`
- **Independent testing of Qwen 3.8 Max has yielded mixed results, with some users reporting it as 'unusable' or significantly slower and less stable than competitors like Kimmy K3 and GPT 5.6, despite strong self-reported benchmarks.**
  - tier 2, confidence 0.7, source Independent Developers (Datum, Pavel Huryn) / AI Daily Brief Host, episode `can-open-models-solve-corporate-ai-washing`, fp `1aeb1152a243aa6b`
- **Anthropic's Claude Opus 4.5 is being positioned as a potential candidate for the most important model release of 2025 due to sustained positive reception.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `chatgpt-55-rumors-start-to-bubble`, fp `e0dd8a1590b972b7`
- **Z AI's GLM 5.3 model scores 28.3% on Terminal Bench 3.0, placing it approximately five points behind frontier models like Fable 5 and GPT 5.6 Soul, but 11 points ahead of Kimik 3.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Z AI Benchmark Data, episode `dario-amodei-breaks-his-social-media-silence`, fp `38b03c36bcc1d038`
- **Z AI's GLM 5.3 overtook Fable 5 on the Cyber Gym cybersecurity benchmark, jumping seven points from its predecessor, GLM 5.2.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Z AI Benchmark Data, episode `dario-amodei-breaks-his-social-media-silence`, fp `1b44e2319ef3b569`
- **Anthropic's internal 'Model 2' scores 62.8% on the internal V2 AIR&D code benchmark, compared to 50.3% for Mythos 5 and 54.8% for Mythos preview.**
  - tier 1, confidence 0.9, source Chris GPT / Anthropic Internal Data, episode `dario-amodei-breaks-his-social-media-silence`, fp `1ff6ac57c4f0e9f4`
- **Nathan Lambert argues that the AI community should stop being surprised by strong performance from Chinese labs, as they are genuinely good at what they do rather than just relying on distillation or benchmark maxing.**
  - tier 2, confidence 0.8, source Nathan Lambert, episode `dario-amodei-breaks-his-social-media-silence`, fp `bd482179b044483f`
- **Gemini 3.1 Pro achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens.**
  - tier 1, confidence 0.95, source Host (citing benchmark data and Akash Gupta's analysis), episode `does-gemini-31-pro-matter`, fp `82c4ca951ff14274`
- **According to Artificial Analysis, Gemini 3.1 Pro leads their overall intelligence index by four points ahead of Claude Opus 4.6 while costing less than half as much to run.**
  - tier 1, confidence 0.9, source Artificial Analysis (cited by Host), episode `does-gemini-31-pro-matter`, fp `a5bbc3603fea9b57`
- **Gemini 3.1 Pro scored 80.6% on the SWE-bench Verified agent decoding test, slightly trailing Claude Opus 4.6 which scored 80.8%.**
  - tier 1, confidence 0.9, source Host (citing benchmark results), episode `does-gemini-31-pro-matter`, fp `c6d9019448d5efb3`
- **Gemini 3.1 Pro is particularly strong in multimodal and visual tasks, such as generating complex SVGs, creating landing pages, and performing technical simulations like heat transfer analysis from CAD files.**
  - tier 2, confidence 0.85, source Host (citing user feedback and Google DeepMind examples), episode `does-gemini-31-pro-matter`, fp `7f7396e5e3a299ea`
- **Gemini 3.1 Pro lags behind competitors like Claude Sonnet 4.6, Opus 4.6, GPT 5.2, and GLM5 on real-world agentic performance evaluations, specifically the GDP-valve test.**
  - tier 2, confidence 0.8, source Host (citing Artificial Analysis and skeptical commentators), episode `does-gemini-31-pro-matter`, fp `b6e067f59559a18b`
- **Databricks found that Sonnet 5 was 1.7 times cheaper per token than Opus 4.8, but Opus 4.8 was cheaper per accepted task ($1.94 vs $2.09) because Sonnet required more iterations to achieve the same results.**
  - tier 1, confidence 0.9, source Nofar Gaspar (citing Databricks experiment), episode `everything-you-need-to-know-about-ai-tokens`, fp `62424b53a1cfb5e9`
- **Claude Fable 5 achieved a score of 80.3% on SWE-bench Pro, significantly outperforming GPT-5.5 (58.6%) and Opus 4.8 (69.2%).**
  - tier 1, confidence 0.95, source AI Daily Brief Host / Benchmark Data, episode `fable-5-raises-the-bar-for-ai-ambition`, fp `9ab7f0e9eadaf86b`
- **Business Insider reported that insiders described the upcoming Gemini 3 model as 'extremely impressive,' suggesting it could help Google reclaim the top spot in the generative AI market.**
  - tier 2, confidence 0.85, source Business Insider / Host, episode `gemini-3-anticipation-reaches-fever-pitch`, fp `f3394dfbf78da878`
- **OpenAI employees' visible excitement about Google's rumored Gemini 3 release is interpreted as a signal that OpenAI has a highly competitive model ('absolute monster') lined up for December.**
  - tier 2, confidence 0.7, source Host, episode `gemini-3-anticipation-reaches-fever-pitch`, fp `f6b97c6164692e9c`
- **Gemini 3 is anticipated to be the best and increasingly popular AI model for a considerable time, with neither OpenAI nor Anthropic having a strong answer soon.**
  - tier 3, confidence 0.5, source Chubby (X user) / Host, episode `gemini-3-anticipation-reaches-fever-pitch`, fp `cb29338cd0e900ba`
- **Google's Gemini app reached 650 million monthly active users and 13 million developers have built with their models as of the Gemini 3 launch.**
  - tier 1, confidence 0.98, source Google (Sundar Pichai announcement), episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `a55bec223cbc309b`
- **Gemini 3 Pro scored 72.7% on the ScreenSpot Pro benchmark, doubling the previous state-of-the-art score of 36.2% held by Sonnet 4.5.**
  - tier 1, confidence 0.95, source Matt Schumer / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `318168a7d470b20a`
- **Early user testing indicates Gemini 3 Pro is significantly faster and more consistent than previous models, with 'intelligence per second' described as 'off the charts' compared to GPT-5 Pro.**
  - tier 2, confidence 0.85, source Matt Schumer / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `fe3b1910aa38f383`
- **The launch of Gemini 3 is expected to alleviate 'AI bubble' concerns among investors by demonstrating that the industry has not hit a capability plateau.**
  - tier 2, confidence 0.85, source AI Daily Brief Host / Simon Smith, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `1b7bc810904c88e2`
- **While Gemini 3 Pro excels in coding and reasoning, early feedback suggests it may still lag behind Anthropic's models (Sonnet/Haiku) in nuanced creative writing and editorial judgment.**
  - tier 2, confidence 0.8, source Dan Shipper / Murdan Kland / AI Daily Brief Host, episode `gemini-3-launches-heres-everything-you-need-to-know`, fp `c51e0328069113bb`
- **GPT 5.2 achieved a score of 55.6% on the SWE-bench Pro coding benchmark, surpassing Claude Opus 4.5's score of 52%.**
  - tier 1, confidence 0.95, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `431d38d125ea42d7`
- **GPT 5.2 Pro achieved a state-of-the-art score of 90.5% on the ARC-AGI 2 benchmark at a cost of $11.64 per task, representing a 390x efficiency improvement over a previous unreleased OpenAI model that scored 88% at $4,500 per task.**
  - tier 1, confidence 0.95, source ARC Prize / AI Daily Brief Host, episode `gpt-52-is-here`, fp `e20b3cb8e01417dd`
- **GPT 5.2 Thinking scored 70.9% on GDP Val, an internal OpenAI benchmark for economically valuable knowledge work, compared to 38.8% for GPT 5.**
  - tier 1, confidence 0.95, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `bea2098b782bd985`
- **GPT 5.2 demonstrates significantly improved long-context retention, maintaining performance above 90% at 256K context length, whereas GPT 5.1 degraded from 90% at 8K to less than 50% at 256K.**
  - tier 1, confidence 0.9, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `65855bbff4046521`
- **GPT 5.2 exhibits a 30-40% reduction in hallucinations compared to its predecessor, GPT 5.1.**
  - tier 1, confidence 0.9, source OpenAI / AI Daily Brief Host, episode `gpt-52-is-here`, fp `6f96de96871bacdb`
- **Early testers report that GPT 5.2 Pro offers superior 'willingness to think' and deep reasoning capabilities, but suffers from significant speed penalties that make it less suitable for quick, iterative tasks compared to competitors like Claude Opus 4.5.**
  - tier 2, confidence 0.85, source Matt Schumer / AI Daily Brief Host, episode `gpt-52-is-here`, fp `e7ba4579cb49e3d4`
- **Critics such as Dan Shipper from Every characterize GPT 5.2 as an 'incremental upgrade' that is less creative and 'surprising' than GPT 5.1, despite its improvements in structured business outputs.**
  - tier 2, confidence 0.8, source Dan Shipper (Every) / AI Daily Brief Host, episode `gpt-52-is-here`, fp `20df046458ff12a2`
- **GPT-5.4 is OpenAI's most token-efficient reasoning model, using significantly fewer tokens to solve problems compared to GPT-5.2, which translates to reduced costs and faster speeds.**
  - tier 1, confidence 0.9, source OpenAI Announcement, episode `gpt-54-first-test-results`, fp `80d5d1cf005463be`
- **SpaceX AI's Grock 4.6 achieved an Artificial Analysis Intelligence Index score of 61, surpassing GPT 5.6 Soul and Fable 5 on GDPval benchmarks while maintaining a 60% lower per-token cost than GPT 5.6 Soul.**
  - tier 1, confidence 0.95, source AI Daily Brief Host / SpaceX AI / Artificial Analysis, episode `grok-46-shows-how-fast-your-ai-options-are-expanding`, fp `29c56d5e0cd5b147`
- **Anthropic's product development principle is to 'ride the exponential,' which involves building products that are useful today but designed to naturally improve as model capabilities increase, often resulting in the deletion of scaffolding code over time.**
  - tier 2, confidence 0.85, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `f069a87989ee5a44`
- **Non-technical users face a 'complexity ladder' gap where they can build simple front-end applications but struggle to transition to production-ready systems requiring data persistence, security, and performance engineering without explicit guidance.**
  - tier 2, confidence 0.8, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `6d613236c6855586`
- **DeepSeek V4 is not state-of-the-art compared to US frontier models but offers a new Pareto frontier by providing near-frontier performance at a fraction of the cost.**
  - tier 2, confidence 0.85, source Leo Synth Wave / Simon Willison / AI Daily Brief Host, episode `how-deepseek-v4-connects-to-the-us-grid`, fp `eed0debac32af677`
- **Meta's Muse Spark 1.2 model achieved a score of 82.9% on Terminal Bench 2.1 and 59.3% on Deep Sue, placing it between OpenAI's Opus 5 and GPT-5.6 Tera on the former and trailing the latter by approximately five points on the latter.**
  - tier 1, confidence 0.95, source AI Daily Brief Host, episode `how-googles-ai-leaders-leaving-could-lead-to-better-ai-models-for-you`, fp `29de865d717678df`
- **Switching GPT-5.5 from its native Codex harness to Cursor's harness increased its functionality benchmark score from 61.5% to 87.2%.**
  - tier 1, confidence 0.92, source Endor Labs / AI Daily Brief, episode `how-harness-as-a-service-will-change-agents`, fp `b98bca07e5cd96ec`
- **DeepSeek V4 Flash scored 50 on the Artificial Analysis Intelligence Index, costing only 3 cents per task, which is significantly cheaper than competitors like GLM 5.2 at 59 cents per task.**
  - tier 1, confidence 0.95, source Artificial Analysis Intelligence Index / DeepSeek, episode `how-significant-are-ais-latest-math-breakthroughs`, fp `180f64c5054a39df`
- **OpenAI's unreleased 'Astra' model solved or made substantial progress on 10 open questions in mathematics, with a total token spend of roughly $2,000 (averaging $200 per solution).**
  - tier 1, confidence 0.95, source OpenAI / Gnome Brown, episode `how-significant-are-ais-latest-math-breakthroughs`, fp `49bba4c4387211d1`
- **Domains with high verifiability, such as math, cyber, and code, are prone to automation first because they offer clearer reward signals and scalable testing, unlike domains with changing internal and external factors.**
  - tier 2, confidence 0.85, source Aaron Levy (Box), episode `how-significant-are-ais-latest-math-breakthroughs`, fp `9b81e828ff33a61f`
- **The 'capability overhang' of existing models is increasing, as weaker models can often reproduce frontier model discoveries if given the right conceptual hints, suggesting the gap between model generations is narrowing in specific tasks.**
  - tier 2, confidence 0.8, source Dan Shipper / Kevin Madura, episode `how-significant-are-ais-latest-math-breakthroughs`, fp `5676e52575dff934`
- **Grock 4.5 achieves near-frontier performance at significantly lower costs, costing 31 cents per task on the Artificial Analysis index compared to $1.80 for Opus 4.8 and $2.75 for Fable 5.**
  - tier 1, confidence 0.9, source Artificial Analysis / AI Daily Brief Host, episode `how-the-4-new-models-released-this-week-will-change-how-you-work`, fp `7f30a31a9d955a9e`
- **Ethan Mollick asserts that for intensive, high-stakes AI work, there are effectively only two viable primary systems currently: ChatGPT and Claude.**
  - tier 2, confidence 0.95, source Ethan Mollick (as reported by the AI Daily Brief host), episode `how-to-get-the-most-from-ai-this-summer`, fp `1de0c172fa613582`
- **Advanced AI models like GPT-5.6 Soul and Codex can perform complex verification tasks with high accuracy, such as checking 195 references in a book manuscript in 30 minutes without hallucinating page numbers or inventing text.**
  - tier 1, confidence 0.9, source Ethan Mollick (as reported by the AI Daily Brief host), episode `how-to-get-the-most-from-ai-this-summer`, fp `f1b430c1c33245e4`
- **Google improved the coding benchmark score for Gemini 3.7 Flash from 48.6% to 65.3% on the Deep Sweep benchmark compared to its predecessor, Gemini 3.6 Flash.**
  - tier 1, confidence 0.95, source AI Daily Brief host citing Google benchmark data, episode `how-to-help-ai-do-your-work-better`, fp `790f99ea3eb95b25`
- **Anthropic's Opus 4.7 model achieved a score of 80.6% on the Office QA Pro benchmark, up from 57.1% for the previous version.**
  - tier 1, confidence 0.95, source Host (AI Daily Brief) citing benchmark data, episode `how-to-use-opus-47-and-the-new-codex`, fp `e8b76ccb8f0f19ea`
- **On the Deepu coding benchmark, Kimmy K3 scored 67.5, placing it 8.5 points ahead of Opus 4.8 and 2.5 points behind Fable 5.**
  - tier 1, confidence 0.95, source AI Daily Brief host, episode `is-kimi-k3-really-fable-class`, fp `d5fc534d8765b2d0`
- **OpenAI research leader Mark Chen stated that the company has internal models performing at the level of Gemini 3 and is confident they will release them soon.**
  - tier 1, confidence 0.95, source Mark Chen (OpenAI Research Leader), episode `openai-declares-code-red`, fp `25df20840b0b17b7`
- **OpenAI's GPT-5.3 Codex scored 77.3% on Terminal Bench 2.0, surpassing Codex 5.2's 64% and Claude Opus 4.6's 65.4%.**
  - tier 1, confidence 0.9, source OpenAI (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `92f516885a0f4e88`
- **Andy Henny stated that GPT-5.3 Codex is roughly three times more token efficient than GPT-5.2, using 1/3 the tokens for similar intelligence.**
  - tier 2, confidence 0.8, source Andy Henny (via Host), episode `opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war`, fp `fc48ac2c482b45f6`
- **The host argues that traditional AI benchmarks are often saturated, gameable, and disconnected from the real world, making them poor indicators of actual model utility.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `real-world-ai-evaluations`, fp `636512f4e04a21b8`
- **DeepSeek released V3.2, a reasoning-first model for agents, which is reported to be approximately 30 times cheaper than Gemini 3.0 Pro.**
  - tier 1, confidence 0.85, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `f40ce2a9afc996c1`
- **Gemini 3.5 Flash is approximately three times faster than Gemini 3.1 Pro while delivering similar performance.**
  - tier 1, confidence 0.9, source AI Daily Brief host, episode `the-most-important-ai-news-from-google-io`, fp `97de5bfff46c78f7`
- **Google's Gemini 3 Flash model outperforms the previous generation Gemini 2.5 Pro while being three times faster and operating at a fraction of the cost.**
  - tier 1, confidence 0.95, source Sundar Pichai (Google CEO), episode `the-most-important-ai-stories-this-week`, fp `5f5bbfd42db5b8f7`
- **Microsoft's MAI models are strategically positioned to offer state-of-the-art performance at significantly lower costs, with Mustafa Suleyman claiming that tuned MAI models outperformed GPT-5.5 on quality while being 10x lower on cost for McKinsey's tasks.**
  - tier 2, confidence 0.85, source AI Daily Brief host, episode `the-next-wave-of-enterprise-ai`, fp `8df3e8125a98c4f2`
- **Between 2021 and 2025, the hallucination rate of state-of-the-art AI models decreased from 21.8% to approximately 0.7%, representing a 96% reduction.**
  - tier 1, confidence 0.9, source AI Daily Brief (Host), episode `the-ultimate-ai-catch-up-guide`, fp `b8dedf37be420846`
- **AI capabilities are currently doubling roughly every 4 months.**
  - tier 2, confidence 0.75, source AI Daily Brief (Host), episode `the-ultimate-ai-catch-up-guide`, fp `2a8af0fe9620d50e`
- **Anthropic published a postmortem on recent Claude Code quality issues on the same day as the GPT-5.5 release, confirming that users had experienced a decline in model performance, which was attributed to 'slop' shipped in the harness rather than the model itself.**
  - tier 2, confidence 0.85, source Host (AI Daily Brief), episode `what-i-learned-testing-gpt-5-5`, fp `032e4e4fa61ae6e2`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - However, limitations remain in complex reasoning, logic tasks, and robustness under diverse operational conditions.\n  - Standards and frameworks for model evaluation are becoming more comprehensive, incorporating expert human review alongside automated metrics to better reflect practical utility.",
  "content": "\n\n  ### Recent Developments (2025\u20132026)\n\n  - **Gemini 3 Launch Metrics**: Google's Gemini app reached 650 million monthly active users, and 13 million developers have built with their models as of the Gemini 3 launch. (Source: Google / Sundar Pichai announcement, confidence 0.98, tier 1)\n  - **Gemini 3 Pro Benchmark Performance**: Gemini 3 Pro scored 72.7% on the ScreenSpot Pro benchmark, doubling the previous state-of-the-art score of 36.2% held by Sonnet 4.5. (Source: Matt Schumer / AI Daily Brief Host, confidence 0.95, tier 1)\n  - **OpenAI Internal Models**: OpenAI research leader Mark Chen stated that the company has internal models performing at the level of Gemini 3 and is confident they will release them soon. (Source: Mark Chen (OpenAI Research Leader), confidence 0.95, tier 1)\n  - **GPT 5.2 Coding Benchmarks**: GPT 5.2 achieved a score of 55.6% on the SWE-bench Pro coding benchmark, surpassing Claude Opus 4.5's score of 52%. (Source: OpenAI / AI Daily Brief Host, confidence 0.95, tier 1)\n  - **GPT 5.2 Thinking Economic Value**: GPT 5.2 Thinking scored 70.9% on GDP Val, an internal OpenAI benchmark for economically valuable knowledge work, compared to 38.8% for GPT 5. (Source: OpenAI / AI Daily Brief Host, confidence 0.95, tier 1)\n  - **GPT 5.2 Pro Efficiency**: GPT 5.2 Pro achieved a state-of-the-art score of 90.5% on the ARC-AGI 2 benchmark at a cost of $11.64 per task, representing a 390x efficiency improvement over a previous unreleased OpenAI model that scored 88% at $4,500 per task. (Source: ARC Prize / AI Daily Brief Host, confidence 0.95, tier 1)\n  - **Gemini 3 Flash Efficiency**: Google's Gemini 3 Flash model outperforms the previous generation Gemini 2.5 Pro while being three times faster and operating at a fraction of the cost. (Source: Sundar Pichai (Google CEO), confidence 0.95, tier 1)\n  - **Gemini 3.1 Pro Progress**: Gemini 3.1 Pro achieved a score of 77.1% on the ARC-AGI 2 benchmark, a significant increase from Gemini 3 Pro's 31.1% score, while maintaining the same pricing of $2 per million input tokens. (Source: Host (citing benchmark data and Akash Gupta's analysis), confidence 0.95, tier 1)\n  - **Anthropic Opus 4.7 Improvements**: Anthropic's Opus 4.7 model achieved a score of 80.6% on the Office QA Pro benchmark, up from 57.1% for the previous version. (Source: Host (AI Daily Brief) citing benchmark data, confidence 0.95, tier 1)\n  - **Claude Fable 5 Performance**: Claude Fable 5 achieved a score of 80.3% on SWE-bench Pro, significantly outperforming GPT-5.5 (58.6%) and Opus 4.8 (69.2%). (Source: AI Daily Brief Host / Benchmark Data, confidence 0.95, tier 1)\n  - **Deepu Coding Benchmark**: On the Deepu coding benchmark, Kimmy K3 scored 67.5, placing it 8.5 points ahead of Opus 4.8 and 2.5 points behind Fable 5. (Source: AI Daily Brief host, confidence 0.95, tier 1)\n  - **High-Stakes AI System Selection**: Ethan Mollick asserts that for intensive, high-stakes AI work, there are effectively only two viable primary systems currently: ChatGPT and Claude. (Source: Ethan Mollick (as reported by the AI Daily Brief host), confidence 0.95, tier 2)"
}
```

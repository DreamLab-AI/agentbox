# Dossier: Image Generation

- status: `candidate_rejected`
- target page: `Image Generation.md`
- assertions: 5 across episodes: nano-banana-2-is-here, openai-declares-code-red, the-5-biggest-ai-stories-to-watch-in-december
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Google's Nano Banana 2, formally known as Gemini 3.1 Flash Image, is priced at approximately half the cost of Nano Banana Pro and delivers outputs in seconds.**
  - tier 1, confidence 0.95, source AI Daily Brief host / Google release, episode `nano-banana-2-is-here`, fp `88c748368c0c58b5`
- **Nano Banana 2 supports the integration of up to five characters and 14 objects from source images and supports outputs up to 4K resolution.**
  - tier 1, confidence 0.95, source AI Daily Brief host / Google release, episode `nano-banana-2-is-here`, fp `c94a2fcd2892d0dc`
- **VentureBeat argues that Nano Banana 2 represents the maturation of AI image generation from a creative novelty into a production-ready infrastructure component, driven by efficiency rather than pure capability.**
  - tier 2, confidence 0.85, source VentureBeat (reported by AI Daily Brief host), episode `nano-banana-2-is-here`, fp `50e90ffba5f610a1`
- **OpenAI's next generation image generation model is a priority under the code red, but its development status remains unclear.**
  - tier 2, confidence 0.8, source The Information (reported by Sam Alman), episode `openai-declares-code-red`, fp `7db54d9a503b02e8`
- **The host predicts that OpenAI will release an updated image generation model in December 2025 to match the native multimodality of Gemini 3.**
  - tier 3, confidence 0.55, source Host (AI Daily Brief), episode `the-5-biggest-ai-stories-to-watch-in-december`, fp `37b00544dd1184f5`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - ## Runway Gen 3\n  - [Introducing Gen-3 Alpha: A New Frontier for Video Generation (runwayml.com)](https://runwayml.com/blog/introducing-gen-3-alpha/)",
  "content": "\n\n  - ## Recent Developments\n  - **Google Nano Banana 2 (Gemini 3.1 Flash Image)**\n    - Priced at approximately half the cost of Nano Banana Pro, with outputs delivered in seconds, leveraging the cost and speed advantages of Google's flash models.\n    - Supports the integration of up to five characters and 14 objects from source images.\n    - Supports outputs up to 4K resolution.\n    - VentureBeat argues that Nano Banana 2 represents the maturation of AI image generation from a creative novelty into a production-ready infrastructure component, driven by efficiency rather than pure capability.\n  - **OpenAI Image Generation**\n    - OpenAI's next generation image generation model is a priority under the company's \"code red,\" though its development status remains unclear.\n    - Predictions suggest OpenAI may release an updated image generation model in December 2025 to match the native multimodality of Gemini 3."
}
```

# Dossier: World Model

- status: `candidate_rejected`
- target page: `World Model.md`
- assertions: 6 across episodes: the-ai-scientist-that-does-6-months-of-work-in-a-day, the-new-ai-org-chart, why-google-workspace-cli-is-such-a-big-deal
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -1.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -1.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **The core innovation of Cosmos is a structured, continuously updated world model that allows it to process orders of magnitude more information than fits in the context of long-context language models.**
  - tier 1, confidence 0.9, source Edison Scientific (Sam Rodriguez, CEO), episode `the-ai-scientist-that-does-6-months-of-work-in-a-day`, fp `46c62c9d80b2fe0f`
- **The 'world model' used in Cosmos is likely a knowledge graph to which agents add information, rather than a predictive simulation model as typically understood in AI research.**
  - tier 2, confidence 0.7, source Simon Smith (Analyst/Commentator), episode `the-ai-scientist-that-does-6-months-of-work-in-a-day`, fp `61dd170f8cd83dc0`
- **Block's proposed organizational model replaces traditional hierarchy with four core components: capabilities, a world model, an intelligence layer, and interfaces.**
  - tier 2, confidence 0.85, source Jack Dorsey, Roelof Botha, episode `the-new-ai-org-chart`, fp `a4969ad7a1f6e905`
- **A centralized 'world model' that holds a company's understanding may eventually converge with distributed, personally-owned agent intelligence.**
  - tier 3, confidence 0.55, source Host (AI Daily Brief), episode `the-new-ai-org-chart`, fp `4b18eda5364b9447`
- **Google's Genie 3 world model allows users to interact with a generated environment, such as a pirate colony, for approximately 60 seconds.**
  - tier 1, confidence 0.85, source AI Daily Brief Host, episode `why-google-workspace-cli-is-such-a-big-deal`, fp `f335a7d390a97b5c`
- **The release of Google's Genie 3 world model contributed to a decline in gaming company stocks on Wall Street, signaling early investor concerns about the disruption of traditional software and SaaS models.**
  - tier 2, confidence 0.75, source AI Daily Brief Host, episode `why-google-workspace-cli-is-such-a-big-deal`, fp `416cfde28e95b4ae`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - A key challenge is world model accuracy under distribution shift: models trained in simulation may diverge from real-world dynamics, causing policies to fail on deployment. Techniques such as domain randomisation, system identification, and sim-to-real transfer address this gap. Large-scale video generation models are increasingly explored as general-purpose world models trained on internet-scale data, with implications for [[Embodied AI Simulation]] research and the development of truly general [[Autonomous Agent]] systems.",
  "content": "- ### Recent Developments\n  - Recent industry and research developments have expanded the application and interpretation of world models beyond traditional reinforcement learning contexts. Google's Genie 3 world model allows users to interact with generated environments, such as a pirate colony, for approximately 60 seconds, demonstrating real-time interactive simulation capabilities. The release of Genie 3 contributed to a decline in gaming company stocks on Wall Street, signaling early investor concerns about the disruption of traditional software and SaaS models.\n  - In the enterprise and organizational design space, Block's proposed organizational model replaces traditional hierarchy with four core components: capabilities, a world model, an intelligence layer, and interfaces. In this context, the world model serves as a centralized repository for the company's understanding, a concept that may eventually converge with distributed, personally-owned agent intelligence. Additionally, the Cosmos system introduces a structured, continuously updated world model that allows it to process orders of magnitude more information than fits in the context of long-context language models. Analysts note that this implementation is likely a knowledge graph to which agents add information, rather than a predictive simulation model as typically understood in AI research."
}
```

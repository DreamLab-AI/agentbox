# Dossier: Compute Infrastructure

- status: `candidate_rejected`
- target page: `Compute Infrastructure.md`
- assertions: 10 across episodes: google-says-no-ads-planned-for-gemini, how-apples-ai-strategy-changes-with-a-new-ceo, nano-banana-2-is-here, the-ai-subsidy-era-is-over, the-most-important-ai-stories-this-week, the-way-we-use-ai-is-changing, who-cares-about-consumer-ai
- reasons: rubric_b_improvement -2.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 1.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.80

## Assertions
- **Analyst Jeff Puh of Highong Securities reported that Meta is deprioritizing the deployment of its custom silicon.**
  - tier 1, confidence 0.9, source Jeff Puh (Highong Securities), episode `google-says-no-ads-planned-for-gemini`, fp `598a59d6251feed0`
- **Meta is reportedly placing large orders from AMD's latest chips to meet short-term compute requirements more efficiently, rather than becoming one of Google's first large TPU customers.**
  - tier 1, confidence 0.85, source Jeff Puh (Highong Securities), episode `google-says-no-ads-planned-for-gemini`, fp `09b38574c416cc31`
- **It is increasingly unlikely that custom silicon initiatives by hyperscalers like Meta, OpenAI, and Anthropic will make sense in the context of rapidly accelerating compute needs.**
  - tier 2, confidence 0.75, source Host (AI Daily Brief), episode `google-says-no-ads-planned-for-gemini`, fp `d80e9d90c927d78b`
- **Investor Nikolai Goness has questioned the financial benefit of developing in-house chips, noting that AMD's total cost of ownership and performance per watt in their latest chips beat out anything Meta can do internally.**
  - tier 2, confidence 0.7, source Nikolai Goness (Investor), episode `google-says-no-ads-planned-for-gemini`, fp `077c9d20ffa386d5`
- **Amazon will provide 5 gigawatts of compute using its in-house Trainium chips to Anthropic as part of their new partnership.**
  - tier 1, confidence 0.95, source AI Daily Brief Host, episode `how-apples-ai-strategy-changes-with-a-new-ceo`, fp `1150cf73e2dc1daf`
- **Meta has signed a multi-billion dollar deal with Google to rent their TPUs as a training cluster, after previously exploring an outright purchase.**
  - tier 1, confidence 0.9, source The Information (reported by AI Daily Brief host), episode `nano-banana-2-is-here`, fp `1578a1f1f6a397da`
- **The physical constraints of compute infrastructure, including grid limitations and data center construction barriers, will act as a more powerful force for slowing AI diffusion than voluntary policy pauses.**
  - tier 3, confidence 0.6, source AI Daily Brief Host, episode `the-ai-subsidy-era-is-over`, fp `5b7f88a1206dd995`
- **OpenAI has committed to spending $38 billion renting servers from AWS over the next seven years.**
  - tier 1, confidence 0.9, source The Information, episode `the-most-important-ai-stories-this-week`, fp `770e145e86b010cb`
- **SpaceX disclosed in an SEC filing that Google agreed to pay $920 million per month to rent compute, with the deal running from October 2025 through June 2029 and granting access to at least 110,000 Nvidia GPUs.**
  - tier 1, confidence 0.95, source SpaceX SEC filing (reported by AI Daily Brief host), episode `the-way-we-use-ai-is-changing`, fp `0de60cadf9e1bcef`
- **Anthropic has committed to spending $200 billion with Google Cloud over a five-year period.**
  - tier 1, confidence 0.9, source The Information, episode `who-cares-about-consumer-ai`, fp `33ebc23f1e9770da`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **Software stack stabilisation**: PyTorch dominant (~62% Hugging Face models), JAX rising for research (~22%), TensorFlow legacy. Inference serving consolidated around vLLM (>60% open-source LLM deployments), SGLang growing, TensorRT-LLM proprietary leader. Triton kernel-DSL is the *de facto* portable kernel target across NVIDIA / AMD / Intel.",
  "content": "\n\n  - ### Recent Developments: Compute Procurement and Custom Silicon Economics (2025-2026)\n\n    Recent reporting and analyst commentary indicate a significant shift in how hyperscalers and frontier labs are sourcing compute, with a growing preference for immediate availability and off-the-shelf performance over long-term custom silicon development.\n\n    **Custom Silicon Deprioritisation**:\n    - **Meta**: Analyst Jeff Puh of Highong Securities reports that Meta is deprioritising the deployment of its custom silicon (MTIA), scaling back its in-house chip program to focus on immediate compute needs. Meta is reportedly placing large orders from AMD's latest chips (MI300X/MI325X/MI350X) to meet short-term requirements more efficiently, avoiding the 'NVIDIA tax' while potentially deploying custom silicon later for specialized workloads. Additionally, Meta has signed a multi-billion dollar deal with Google to rent TPUs as a training cluster, a shift from previously exploring an outright purchase.\n    - **Economic Rationale**: Investor Nikolai Goness has questioned the financial benefit of developing in-house chips, noting that AMD's total cost of ownership and performance per watt in their latest chips beat out anything Meta can do internally. The consensus among analysts is that the economics of custom silicon are less favorable than previously thought, as off-the-shelf solutions offer superior cost-performance ratios in the current cycle.\n\n    **Hyperscaler Compute Commitments**:\n    - **Amazon-Anthropic**: Amazon will provide 5 gigawatts of compute using its in-house Trainium chips (current and future generations) to Anthropic as part of their new partnership, underscoring the scale of non-NVIDIA training commitments.\n    - **OpenAI-AWS**: OpenAI has committed to spending $38 billion renting servers from AWS over the next seven years, a move that may make equity-for-compute deals more cost-effective for the lab.\n    - **Anthropic-Google Cloud**: Anthropic has committed to spending $200 billion with Google Cloud over a five-year period. This deal represents the lion's share of the $462 billion backlog Google announced during its recent earnings call.\n    - **Google-SpaceX**: SpaceX disclosed in an SEC filing that Google agreed to pay $920 million per month to rent compute, with the deal running from October 2025 through June 2029 and granting access to at least 110,000 Nvidia GPUs.\n\n    **Infrastructure as a Diffusion Constraint**:\n    - The physical constraints of compute infrastructure, including grid limitations, component shortages, and data center construction barriers, are increasingly viewed as a more powerful force for slowing AI diffusion than voluntary policy pauses. The sheer limitations of physics and supply chain logistics are acting as the primary throttle on the rate of AI adoption and model scaling."
}
```

# Dossier: Data Management

- status: `candidate_rejected`
- target page: `Data Management.md`
- assertions: 10 across episodes: how-the-best-companies-use-ai, introducing-maturity-maps-a-new-way-to-measure-ai-adoption
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5; completeness 0.50 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.50

## Assertions
- **A PwC study found that 75% of AI's economic gains are being captured by just 20% of companies, with these leaders being 2.6 times more likely to report that AI improves their ability to reinvent their business model.**
  - tier 1, confidence 0.95, source PwC (cited by host), episode `how-the-best-companies-use-ai`, fp `05f23b88435281c1`
- **Ramp's internal AI system, Glass, includes a marketplace called 'Dojo' containing over 350 reusable skills built by colleagues, which are shared across teams to standardize best practices.**
  - tier 1, confidence 0.95, source Seb Go to Jen, Ramp (cited by host), episode `how-the-best-companies-use-ai`, fp `ecb43a5c752f14bf`
- **McKinsey argues that more than 70% of talent for AI transformation should be in-house, as every tech and AI transformation is ultimately a people transformation that cannot be fully outsourced to consultants.**
  - tier 2, confidence 0.85, source McKinsey (cited by host), episode `how-the-best-companies-use-ai`, fp `83e3df82384c4b28`
- **Ramp built its internal AI infrastructure in-house rather than buying it because internal productivity is a competitive moat, it allows for same-day speed in fixing issues, and it provides direct insights for their external AI products.**
  - tier 2, confidence 0.85, source Seb Go to Jen, Ramp (cited by host), episode `how-the-best-companies-use-ai`, fp `59fef0941d8b2f27`
- **Deloitte found that 93% of AI spend goes to infrastructure with only 7% going to anything related to people.**
  - tier 1, confidence 0.95, source Deloitte (cited by host), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `328ce4e3fceafe90`
- **88% of sales teams say they use AI, but only 24% have it in their actual revenue workflows.**
  - tier 1, confidence 0.9, source Host (citing data), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `fc1dbfae66ee721f`
- **Only 23% of operations groups have a formal AI strategy.**
  - tier 1, confidence 0.9, source Host (citing a study), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `bdc1565bbda3d615`
- **The host identifies an 'adoption embedding gap' where high claimed adoption coexists with low depth and utilization across all function-specific surveys.**
  - tier 2, confidence 0.85, source Host, episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `ac83b84cdae2b1d6`
- **The host argues that data is not just one pillar of AI maturity but the 'floor constraint' that caps all other dimensions.**
  - tier 2, confidence 0.85, source Host, episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `f1420f0641214e83`
- **The host suggests that finance may eventually 'catapult' ahead of other functions in deployment depth because they will deploy AI more safely and effectively due to their existing governance structures.**
  - tier 3, confidence 0.6, source Host, episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `db2a0164e947b6a5`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - **MLflow, DVC, Weights & Biases** \u2014 ML-specific data and experiment tracking tools that extend classical data management practices into [[Machine Learning]] workflows.",
  "content": "\n\n- ### Recent Developments and Industry Insights\n  - **The Data Floor Constraint** \u2014 Recent analysis suggests that data is not merely one pillar of AI maturity but the \"floor constraint\" that caps all other dimensions. With 8 of 10 functions scoring a 1 or 1.5 on data maturity, organizations lack the proprietary context required to move beyond basic assisted usage, highlighting the critical role of data management in unlocking AI value.\n  - **The Adoption Embedding Gap** \u2014 A dominant finding across recent surveys is the \"adoption embedding gap,\" where high claimed adoption coexists with low depth and utilization. For instance, while 88% of sales teams report using AI, only 24% have integrated it into actual revenue workflows. Similarly, only 23% of operations groups have a formal AI strategy, indicating a significant \"applied capability overhang.\"\n  - **Investment Imbalance** \u2014 Deloitte research indicates that 93% of AI spend is directed toward infrastructure, with only 7% allocated to people-related initiatives. This imbalance underscores the argument that people are the primary bottleneck in AI adoption, a view supported by McKinsey, which argues that more than 70% of talent for AI transformation should be in-house, as every tech transformation is ultimately a people transformation.\n  - **Concentration of Value** \u2014 A PwC study found that 75% of AI's economic gains are being captured by just 20% of companies. These leaders are 2.6 times more likely to report that AI improves their ability to reinvent their business model, suggesting that superior data management and governance are key differentiators for top performers.\n  - **In-House Infrastructure as a Moat** \u2014 Companies like Ramp are building internal AI infrastructure in-house rather than relying on vendors, citing internal productivity as a competitive moat. This approach allows for same-day speed in fixing issues and provides direct insights for external AI products, reinforcing the strategic importance of owning the data and tooling stack.\n  - **Standardization via Internal Marketplaces** \u2014 Internal AI systems, such as Ramp's \"Glass\" platform, are incorporating marketplaces (e.g., \"Dojo\") containing over 350 reusable skills built by colleagues. These shared assets help standardize best practices across teams, reflecting a maturation of data and knowledge management within AI workflows.\n  - **Governance as a Catalyst** \u2014 There is emerging evidence that functions with strong existing governance structures, such as finance, may \"catapult\" ahead of other functions in deployment depth. Their established controls may allow for safer and more effective AI deployment, potentially reversing current perceptions of lagging adoption in these areas."
}
```

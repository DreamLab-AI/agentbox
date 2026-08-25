# Dossier: Business Intelligence

- status: `candidate_rejected`
- target page: `Business Intelligence.md`
- assertions: 5 across episodes: can-open-models-solve-corporate-ai-washing, how-the-best-companies-use-ai, introducing-maturity-maps-a-new-way-to-measure-ai-adoption
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Palantir reported quarterly revenue of $1.94 billion, representing a 93% year-over-year increase, with commercial sales growing 149% and net income reaching $1 billion.**
  - tier 1, confidence 0.95, source Palantir Earnings Report (cited by AI Daily Brief host), episode `can-open-models-solve-corporate-ai-washing`, fp `90340f011e3f3b76`
- **A PwC study found that 75% of AI's economic gains are being captured by just 20% of companies, with these leaders being 2.6 times more likely to report that AI improves their ability to reinvent their business model.**
  - tier 1, confidence 0.95, source PwC (cited by host), episode `how-the-best-companies-use-ai`, fp `05f23b88435281c1`
- **McKinsey's AI transformation manifesto reports that AI leaders achieved an average 20% EBITDA uplift, reaching break-even in 1-2 years and generating $3 in incremental EBITDA for every $1 invested.**
  - tier 1, confidence 0.95, source McKinsey (cited by host), episode `how-the-best-companies-use-ai`, fp `2938a9ff2dea2eea`
- **George Zarkadakis argues that while AI has made individuals 10x more productive, no company has become 10x more valuable because institutional AI requires distinct processes for coordination and signal extraction that individual AI lacks.**
  - tier 2, confidence 0.85, source George Zarkadakis (a16z opinion piece, cited by host), episode `how-the-best-companies-use-ai`, fp `322dbf26800dbc23`
- **88% of sales teams say they use AI, but only 24% have it in their actual revenue workflows.**
  - tier 1, confidence 0.9, source Host (citing data), episode `introducing-maturity-maps-a-new-way-to-measure-ai-adoption`, fp `fc1dbfae66ee721f`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "Modern BI emphasises self-service exploration and governed metric definitions so that analysts and business users share consistent measures across the enterprise.",
  "content": "\n- ### Recent Developments\n  - **Palantir Financial Performance**: Palantir reported quarterly revenue of $1.94 billion, representing a 93% year-over-year increase, with commercial sales growing 149% and net income reaching $1 billion. [source: Palantir Earnings Report (cited by AI Daily Brief host), confidence 0.95, tier 1]\n  - **PwC Study on AI Economic Gains**: A PwC study found that 75% of AI's economic gains are being captured by just 20% of companies, with these leaders being 2.6 times more likely to report that AI improves their ability to reinvent their business model. [source: PwC (cited by host), confidence 0.95, tier 1]\n  - **McKinsey AI Transformation Manifesto**: McKinsey's AI transformation manifesto reports that AI leaders achieved an average 20% EBITDA uplift, reaching break-even in 1-2 years and generating $3 in incremental EBITDA for every $1 invested. [source: McKinsey (cited by host), confidence 0.95, tier 1]\n  - **Institutional AI Productivity Gap**: George Zarkadakis argues that while AI has made individuals 10x more productive, no company has become 10x more valuable because institutional AI requires distinct processes for coordination and signal extraction that individual AI lacks. [source: George Zarkadakis (a16z opinion piece, cited by host), confidence 0.85, tier 2]\n  - **Sales Team AI Adoption**: 88% of sales teams say they use AI, but only 24% have it in their actual revenue workflows. [source: Host (citing data), confidence 0.9, tier 1]"
}
```

# Dossier: US-China AI Competition

- status: `candidate_survivor`
- target page: `US-China AI Competition.md`
- assertions: 5 across episodes: what-people-really-want-from-ai, why-everyone-is-debating-ai-policy, you-can-now-vibecode-mobile-apps, your-company-doesnt-need-an-ai-strategy

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Freelance creatives were identified as the group where AI's upside and downside most nearly canceled out, with 23% experiencing benefits and 17% experiencing downsides.**
  - tier 1, confidence 0.95, source Anthropic, episode `what-people-really-want-from-ai`, fp `867186335c583516`
- **Axios reported that the Trump administration is considering an executive order requiring US tech companies to only host Chinese AI models if they can guarantee security and take liability for any breaches.**
  - tier 1, confidence 0.9, source Axios, episode `why-everyone-is-debating-ai-policy`, fp `2b4c107961639d93`
- **Ryan Fedic of the American Enterprise Institute argued that the US should focus on industrial variables like high bandwidth memory production and data center construction timelines, rather than model benchmarks, to determine the outcome of the AI race.**
  - tier 2, confidence 0.85, source Ryan Fedic, episode `why-everyone-is-debating-ai-policy`, fp `93558c1cd95b7bdd`
- **Jensen Huang stated that China is well ahead of the US on energy, while the US leads on chips, and that China is right there on infrastructure and AI models.**
  - tier 2, confidence 0.85, source Jensen Huang, episode `you-can-now-vibecode-mobile-apps`, fp `4b86a830c6c79500`
- **Bloomberg reported that Commerce Secretary Howard Lutnick told ASML that the US government believed one of its EUV machines may have made its way into China.**
  - tier 1, confidence 0.9, source Bloomberg, episode `your-company-doesnt-need-an-ai-strategy`, fp `c71b7d7c950b489f`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Relationships",
  "content": "- ### Recent Developments\n  - **Regulatory & Security Measures**: Axios reported that the Trump administration is considering an executive order requiring US tech companies to only host Chinese AI models if they can guarantee security and take liability for any breaches. Additionally, the Commerce Department has circulated draft rules leveraging supply chain security powers to crack down on Chinese AI. *(Source: Axios, via podcast evidence, confidence 0.9)*\n  - **Supply Chain & Hardware**: Bloomberg reported that Commerce Secretary Howard Lutnick informed ASML that the US government believes one of its EUV (extreme ultraviolet) lithography machines may have made its way into China. *(Source: Bloomberg, via podcast evidence, confidence 0.9)*\n  - **Strategic Perspectives**: Jensen Huang stated that China is well ahead of the US on energy, while the US leads on chips, and that China is \"right there\" on infrastructure and AI models, noting that areas where the US leads are no longer guaranteed. *(Source: Jensen Huang, via podcast evidence, confidence 0.85)*\n  - **Industrial Variables**: Ryan Fedic of the American Enterprise Institute argued that the US should focus on industrial variables like high bandwidth memory production and data center construction timelines, rather than model benchmarks, to determine the outcome of the AI race. *(Source: Ryan Fedic, via podcast evidence, confidence 0.85)*\n  - **Labor Market Impact**: Freelance creatives were identified as the group where AI's upside and downside most nearly canceled out, with 23% experiencing benefits and 17% experiencing downsides. *(Source: Anthropic, via podcast evidence, confidence 0.95)*"
}
```

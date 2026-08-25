# Dossier: Export Controls

- status: `candidate_rejected`
- target page: `Export Controls.md`
- assertions: 14 across episodes: fable-5-shut-down-by-us-government, fable-is-back-heres-what-you-should-try-first, how-the-escalating-ai-wars-benefit-you, how-the-global-ai-race-has-changed, is-openai-the-new-github, microsofts-plan-to-make-people-less-angry-about-ai-and-electricity, real-world-ai-evaluations, your-company-doesnt-need-an-ai-strategy
- reasons: completeness 0.50 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 0.50

## Assertions
- **The US Department of Commerce issued an export control directive suspending access to Anthropic's Fable 5 and Mythos 5 models for all foreign nationals, including foreign-national Anthropic employees, citing national security authorities.**
  - tier 1, confidence 0.98, source Anthropic official tweet and blog post; Wall Street Journal, episode `fable-5-shut-down-by-us-government`, fp `ee7e3b86539e8188`
- **A significant portion of Anthropic's technical staff, including prominent figures like Andrej Karpathy, are not US citizens and are therefore prohibited from interacting with Fable 5 and Mythos 5 under the new export control directive.**
  - tier 1, confidence 0.9, source Rishi Sharma (via X); Transcript analysis, episode `fable-5-shut-down-by-us-government`, fp `6d49b73c53e02d54`
- **Industry experts and policy analysts criticize the US government's export control strategy as incoherent and self-defeating, arguing it fails to enforce existing controls on chips while arbitrarily restricting model access, thereby stifling US AI development.**
  - tier 2, confidence 0.85, source Chris Miller (Council on Foreign Relations); Dean Ball; Transcript analysis, episode `fable-5-shut-down-by-us-government`, fp `71259c2cc92a0e49`
- **Anthropic's Fable 5 model was cleared for global redeployment on July 1st after the US Department of Commerce lifted export controls that had been in place for approximately 19 days.**
  - tier 1, confidence 0.95, source Anthropic and US Department of Commerce (reported by AI Daily Brief host), episode `fable-is-back-heres-what-you-should-try-first`, fp `263fe465dd7c8bdf`
- **The US Commerce Department has eased export controls to allow the UAE government and approved companies to access advanced AI chips without a license.**
  - tier 1, confidence 0.95, source US Commerce Department (reported by AI Daily Brief), episode `how-the-escalating-ai-wars-benefit-you`, fp `d21b59a50b535d77`
- **Nvidia's H200 chips have been fully approved for export to China, with Chinese labs reportedly ordering hundreds of thousands of units to build large-scale training clusters.**
  - tier 1, confidence 0.9, source Podcast Host, episode `how-the-global-ai-race-has-changed`, fp `79fdc3deaa203bda`
- **US trade officials are considering a cap of 75,000 Nvidia H200 chips per customer for sales into China, alongside a total limit of one million units.**
  - tier 1, confidence 0.9, source Bloomberg (cited by Host), episode `is-openai-the-new-github`, fp `a2328b52475c6eb2`
- **The proposed US chip caps on China may be 'window dressing' to appease Washington hawks rather than a meaningful constraint, given the geopolitical complexities involving the Iran war and upcoming Trump-Xi meetings.**
  - tier 3, confidence 0.5, source Host, episode `is-openai-the-new-github`, fp `0e67e9152bed5750`
- **The US Commerce Department finalized approval for Nvidia H200 chip exports to China with conditions including third-party inspection of AI capabilities and a limit that Nvidia can ship only 50% as many chips to China as it sells to US customers.**
  - tier 1, confidence 0.95, source US Commerce Department / Transcript, episode `microsofts-plan-to-make-people-less-angry-about-ai-and-electricity`, fp `a1fe6c6d53e3858c`
- **Chinese customs officials have instructed agents that Nvidia H200 chips are not permitted to enter China, with one Reuters source describing the directive as 'basically a ban for now.'**
  - tier 1, confidence 0.9, source Reuters, episode `microsofts-plan-to-make-people-less-angry-about-ai-and-electricity`, fp `29fb8184b24bc74d`
- **Nvidia questioned the report of DeepSeek's smuggled Blackwell cluster, stating they have not seen substantiation of 'phantom data centers' but acknowledged the possibility of smuggling.**
  - tier 2, confidence 0.9, source Nvidia, episode `real-world-ai-evaluations`, fp `ad5265418d8cd85c`
- **DeepSeek has built a training cluster of several thousand Nvidia Blackwell chips, which are banned for export to China, by smuggling them via third-country data centers.**
  - tier 1, confidence 0.85, source The Information, episode `real-world-ai-evaluations`, fp `2eb6eb538e42eac6`
- **Beijing is holding emergency meetings with tech companies including Alibaba, ByteDance, and Tencent to assess demand for Nvidia H200 chips, suggesting preparation to allow their import.**
  - tier 1, confidence 0.85, source The Information, episode `real-world-ai-evaluations`, fp `9018f72b58b72a80`
- **Bloomberg reported that Commerce Secretary Howard Lutnick told ASML that the US government believed one of its EUV machines may have made its way into China.**
  - tier 1, confidence 0.9, source Bloomberg, episode `your-company-doesnt-need-an-ai-strategy`, fp `c71b7d7c950b489f`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "They shape global supply chains and strategic positioning, but raise enforcement challenges given the dual-use nature and digital portability of AI artefacts.",
  "content": "\n- ### Recent Developments\n  - **Model-Specific Export Controls (Anthropic):** The US Department of Commerce issued an export control directive suspending access to Anthropic's Fable 5 and Mythos 5 models for all foreign nationals, including foreign-national Anthropic employees, citing national security authorities. This directive prohibited non-US citizens, including prominent technical staff on visas, from interacting with these models. The controls were lifted on July 1st, allowing for the global redeployment of Fable 5 after approximately 19 days of suspension.\n  - **Nvidia H200 Exports to China:** The US Commerce Department finalized approval for Nvidia H200 chip exports to China with strict conditions, including third-party inspection of AI capabilities and a limit that Nvidia can ship only 50% as many chips to China as it sells to US customers. US trade officials are also considering a cap of 75,000 chips per customer and a total limit of one million units. Despite these US approvals, Chinese customs officials have instructed agents that H200 chips are not permitted to enter China, effectively constituting a temporary ban, while Beijing holds emergency meetings with tech companies to assess import demand.\n  - **Enforcement and Smuggling Concerns:** Reports indicate that DeepSeek has built a training cluster of several thousand Nvidia Blackwell chips, which are banned for export to China, by smuggling them via third-country data centers. Nvidia has questioned the substantiation of these \"phantom data centers\" but acknowledged the possibility of smuggling. Additionally, Commerce Secretary Howard Lutnick informed ASML that the US government believes one of its EUV lithography machines may have made its way into China.\n  - **UAE License Exemptions:** The US Commerce Department has eased export controls to allow the UAE government and approved companies to access advanced AI chips without a license, citing new technology protection measures under an export deal signed in May of the previous year."
}
```

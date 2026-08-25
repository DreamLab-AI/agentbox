# Dossier: AI Ethics

- status: `candidate_rejected`
- target page: `AI Ethics.md`
- assertions: 8 across episodes: beating-the-ai-doom-cycle, how-to-make-chatgpt-ads-not-suck, is-ai-doom-going-out-of-style, the-big-questions-shaping-the-consumer-ai-battle, val-kilmers-ai-resurrection, what-the-pope-actually-said-about-ai
- reasons: rubric_b_improvement -2.0 <= 0.0; rubric_a_improvement -2.0 < -0.5; completeness 0.25 < 0.6

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): -2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 0.25

## Assertions
- **Public backlash against AI is intensifying, evidenced by commencement speakers like Eric Schmidt and Gloria Cordfield being booed for mentioning AI's impact on jobs and society.**
  - tier 2, confidence 0.85, source AI Daily Brief Host / Journalists, episode `beating-the-ai-doom-cycle`, fp `7abf16664efb7c08`
- **OpenAI's advertising strategy is guided by principles of answer independence, conversational privacy, and mission alignment, ensuring ads do not influence AI responses.**
  - tier 1, confidence 0.95, source OpenAI official announcement, episode `how-to-make-chatgpt-ads-not-suck`, fp `55be13bd2c213256`
- **OpenAI is undergoing a 'messaging pivot' from framing AI as a replacement for humanity to framing it as a tool to augment and elevate people.**
  - tier 3, confidence 0.6, source Noah Smith, episode `is-ai-doom-going-out-of-style`, fp `ac655c6c0b0dcd41`
- **QuitGPT.org reports that 2.5 million people have participated in a boycott of ChatGPT following OpenAI's deal with the Pentagon.**
  - tier 1, confidence 0.85, source QuitGPT.org (as cited by the host), episode `the-big-questions-shaping-the-consumer-ai-battle`, fp `7522201546b5c694`
- **The host suggests that the partisan divide in American politics is currently a more powerful driver of consumer AI adoption choices than specific discrete AI ethical issues.**
  - tier 2, confidence 0.75, source Host (AI Daily Brief), episode `the-big-questions-shaping-the-consumer-ai-battle`, fp `e991f85b5f67bef2`
- **Raymond Arroyo criticized the AI-generated Val Kilmer performance as 'digital necromancy,' arguing it denies the actor's uniquely human choices and saddles the deceased with a performance he has no agency over.**
  - tier 2, confidence 0.85, source Raymond Arroyo, episode `val-kilmers-ai-resurrection`, fp `c23cc2d92da8e7be`
- **Pope Leo XIV released his first encyclical, 'Magnifica Humanitatis', which argues that human value cannot be reduced to intelligence benchmarks and that AI systems lack the relational and spiritual perspective of human beings.**
  - tier 2, confidence 0.9, source Pope Leo XIV, episode `what-the-pope-actually-said-about-ai`, fp `c2535ccab6df66b4`
- **The encyclical 'Magnifica Humanitatis' warns that the control of health data by entities creates structural leverage over future markets and needs, describing it as a potential instrument of dominance rather than a common good.**
  - tier 2, confidence 0.9, source Pope Leo XIV, episode `what-the-pope-actually-said-about-ai`, fp `15a7211544f763b0`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Bender, E. et al. (2021). On the Dangers of Stochastic Parrots: Can Language Models Be Too Big? FAccT 2021.",
  "content": "\n\n  #### Recent Developments\n\n  - **Public Backlash and Political Polarization**: Public sentiment toward AI is increasingly shaped by political divides rather than discrete ethical issues. This is evidenced by commencement speakers like Eric Schmidt and Gloria Cordfield being booed for discussing AI's societal impact. Additionally, the QuitGPT.org boycott, which claims 2.5 million participants following OpenAI's deal with the Pentagon, has gained traction partly due to the partisan resonance of OpenAI executives' political affiliations.\n  - **OpenAI\u2019s Strategic Shifts**: OpenAI has adopted a \"messaging pivot\" from framing AI as a replacement for humanity to positioning it as a tool for human augmentation. Concurrently, its advertising strategy is guided by principles of answer independence and conversational privacy, ensuring that ads do not influence AI responses or compromise user data.\n  - **Religious and Philosophical Critiques**: Pope Leo XIV\u2019s encyclical *Magnifica Humanitatis* argues that human value cannot be reduced to intelligence benchmarks, emphasizing that AI lacks the relational and spiritual perspective inherent to human wisdom. The document also warns that the control of health data by private entities creates structural leverage over future markets, potentially serving as an instrument of dominance rather than a common good.\n  - **Ethical Concerns in Media**: Critics like Raymond Arroyo have condemned AI-generated performances of deceased actors, such as Val Kilmer, as \"digital necromancy.\" This practice is argued to deny the actor\u2019s uniquely human choices and saddle the deceased with a performance over which they have no agency."
}
```

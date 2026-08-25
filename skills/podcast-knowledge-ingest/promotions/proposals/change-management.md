# Dossier: Change Management

- status: `candidate_survivor`
- target page: `Change Management.md`
- assertions: 9 across episodes: ceo-led-ai-gets-3x-the-roi, context-graphs-ais-next-big-idea, the-self-driving-company, weird-vibes-at-ai-india-summit, why-agents-make-every-job-a-startup, why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Employee resistance to AI agents in the United States has increased significantly from 5% to 20%, contrasting with executive optimism about workforce integration.**
  - tier 3, confidence 0.65, source KPMG Quarterly Pulse Survey, episode `ceo-led-ai-gets-3x-the-roi`, fp `58ef64e2c75c96b8`
- **The role of the individual contributor in enterprise AI will shift to 'manager of agents,' requiring new responsibilities for providing oversight, escalation paths, and coordination between various agents, similar to managing human teams.**
  - tier 2, confidence 0.9, source Aaron Levy (Box), episode `context-graphs-ais-next-big-idea`, fp `d45916b88e6beebc`
- **The transition to agentic work does not eliminate problems but shifts the nature of the problems organizations must solve, such as managing new bottlenecks in code review or data integration.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `the-self-driving-company`, fp `05d322d6f345ac14`
- **A 'pull' adoption strategy, where engineers use AI agents in public spaces like Slack, is more effective for driving cross-organizational adoption than a 'push' mandate, as it allows other teams to observe benefits firsthand.**
  - tier 2, confidence 0.8, source Host (AI Daily Brief), episode `the-self-driving-company`, fp `8f78bacf4f2634bd`
- **The primary barrier to enterprise AI adoption is a lack of dedicated time for employees to learn new tools, rather than a lack of tool utility.**
  - tier 2, confidence 0.8, source AI Daily Brief host, episode `weird-vibes-at-ai-india-summit`, fp `a8a5e2e358a7bde9`
- **The host asserts that organizations will need to design new architectures of support, including prioritization tools, pacing infrastructure, and cross-functional coordination systems, to prevent burnout and manage the output of AI agents.**
  - tier 2, confidence 0.8, source AI Daily Brief Host, episode `why-agents-make-every-job-a-startup`, fp `a057527447af50ca`
- **Workday research found that 53% of reinvested time saved from AI is allocated to systems and infrastructure, compared to only 29% allocated to people and workforce development.**
  - tier 1, confidence 0.95, source Workday survey (reported by AI Daily Brief host), episode `why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai`, fp `b048e1da905eec7b`
- **Employees whose managers explicitly expect AI usage are 2.6 times more AI proficient than the baseline employee in the Section study, which is the strongest multiplier identified.**
  - tier 1, confidence 0.9, source Section survey (reported by AI Daily Brief host), episode `why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai`, fp `f9ccea994fbd2699`
- **The host posits that companies are often failing to provide employees with the necessary tools and time to experiment, instead 'dropping LLMs on top of their heads' with outdated enterprise deployments.**
  - tier 2, confidence 0.8, source AI Daily Brief host, episode `why-deeply-integrating-ai-3xs-likelihood-of-financial-gains-from-ai`, fp `193ebaecc173cef6`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Governance of change at enterprise scale demands integration with enterprise architecture, programme management, and risk management functions so that individual changes are evaluated for cumulative systemic effects, avoiding the fragmented adoption that produces technical debt and conflicting process variants.",
  "content": "\n- ### Recent Developments\n  - Recent survey data highlights a growing disconnect between executive optimism and employee readiness in AI adoption. While 71% of executives report good progress toward an integrated AI-human workforce, employee resistance to AI agents in the United States has increased significantly from 5% to 20%, suggesting a potential gap in adoption readiness that change management programmes must address through targeted communication and support. [source: KPMG Quarterly Pulse Survey, confidence 0.65, tier 3]\n  - The role of the individual contributor in enterprise AI is shifting toward that of a 'manager of agents,' requiring new responsibilities for providing oversight, escalation paths, and coordination between various agents, similar to managing human teams. As noted by Aaron Levy (Box), this transition redefines professional identity and demands new competencies in supervising autonomous systems. [source: Aaron Levy (Box), confidence 0.9, tier 2]\n  - The transition to agentic work does not eliminate organisational problems but shifts their nature, such as managing new bottlenecks in code review or data integration. Change management must therefore anticipate that moving to self-driving modalities introduces new categories of operational friction rather than simply removing existing ones. [source: Host (AI Daily Brief), confidence 0.8, tier 2]\n  - Evidence suggests that a 'pull' adoption strategy, where engineers use AI agents in public spaces like Slack, is more effective for driving cross-organizational adoption than a 'push' mandate. By allowing other teams to observe benefits firsthand, organisations can mitigate inherent reluctance to change and address skepticism in advance. [source: Host (AI Daily Brief), confidence 0.8, tier 2]\n  - A primary barrier to enterprise AI adoption is identified as a lack of dedicated time for employees to learn new tools, rather than a lack of tool utility. Many companies fail to provide the necessary tools and time to experiment, instead 'dropping LLMs on top of their heads' with outdated enterprise deployments, which hinders effective [[Workforce Development]]. [source: AI Daily Brief host, confidence 0.8, tier 2]\n  - Workday research indicates an imbalance in how time saved from AI is reinvested: 53% is allocated to systems and infrastructure, compared to only 29% for people and workforce development. This disparity suggests that change management strategies may be under-investing in the human capital required to sustain technological gains. [source: Workday survey (reported by AI Daily Brief host), confidence 0.95, tier 1]\n  - Managerial expectation is a significant driver of proficiency; employees whose managers explicitly expect AI usage are 2.6 times more AI proficient than the baseline employee. This highlights the critical role of leadership in signalling priority and shaping [[Human Factors]] within the change process. [source: Section survey (reported by AI Daily Brief host), confidence 0.9, tier 1]\n  - To prevent burnout and manage the output of AI agents, organisations will need to design new architectures of support, including prioritization tools, pacing infrastructure, and cross-functional coordination systems. These structural changes are essential to translating AI capabilities into sustainable [[Operational Efficiency]] and value. [source: AI Daily Brief Host, confidence 0.8, tier 2]"
}
```

# Dossier: Automation

- status: `candidate_rejected`
- target page: `Automation.md`
- assertions: 11 across episodes: beating-the-ai-doom-cycle, can-todays-ai-replace-12-of-work, claude-code-is-now-writing-claude-code, how-ai-is-changing-how-companies-get-built, how-people-actually-use-ai-agents, how-to-build-a-personal-agentic-operating-system, how-to-get-the-most-out-of-fable-5-and-gpt-56-sol, where-the-economy-thrives-after-ai
- reasons: rubric_b_improvement -2.0 <= 0.0

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 2.0
- rubric-B improvement (after vs before): -2.0
- answer-completeness: 1.00

## Assertions
- **Citadel CEO Ken Griffin reported that AI agents are completing high-level financial research tasks that previously took master's or PhD holders weeks or months in a matter of hours or days, resulting in a 15-25% productivity boost for the firm.**
  - tier 1, confidence 0.95, source Ken Griffin (Citadel CEO), episode `beating-the-ai-doom-cycle`, fp `a171b6a8b42ce8fc`
- **Anthropic CEO Dario Amodei has predicted a 10% overall unemployment rate and a 50% unemployment rate for entry-level white-collar jobs due to AI automation.**
  - tier 2, confidence 0.85, source Dario Amodei (Anthropic CEO), episode `beating-the-ai-doom-cycle`, fp `7d280f5552b7ab13`
- **Microsoft AI CEO Mustafa Suleyman has stated that all white-collar work could be automated by AI within 18 months.**
  - tier 2, confidence 0.85, source Mustafa Suleyman (Microsoft AI CEO), episode `beating-the-ai-doom-cycle`, fp `6f8b5e65e4f79b81`
- **Economist Alex Emos's essay 'What Will Be Scarce' argues that the 'relational sector,' where human provenance adds economic value, will rise proportionally to savings in automated sectors.**
  - tier 3, confidence 0.7, source Alex Emos (Economist) / AI Daily Brief Host, episode `beating-the-ai-doom-cycle`, fp `10418881145d583e`
- **MIT's Project Iceberg study estimates that current AI systems can automate approximately 11.7% of wage-earning skills in the US workforce, representing $1.2 trillion in wages.**
  - tier 1, confidence 0.95, source MIT Project Iceberg / CNBC, episode `can-todays-ai-replace-12-of-work`, fp `f6069e022c935358`
- **The prediction that 90% of code would be written by AI by September 2025 was only off by a couple of months, as evidenced by Claude Code's current capabilities.**
  - tier 2, confidence 0.75, source Ethan Malik, episode `claude-code-is-now-writing-claude-code`, fp `ac6ed09c00651fa1`
- **The surge in solopreneurship is driven by AI acting as a 'technical co-founder' and 'sales and marketing first hire,' filling skill gaps that previously required hiring.**
  - tier 2, confidence 0.8, source Stripe (via AI Daily Brief host), episode `how-ai-is-changing-how-companies-get-built`, fp `045de2f442ec082e`
- **Software engineering accounts for approximately 50% of all tool calls in Anthropic's agent usage data, while back-office automation is the second largest category at 9.1%.**
  - tier 1, confidence 0.96, source Anthropic Study / AI Daily Brief Host, episode `how-people-actually-use-ai-agents`, fp `b1796d4e2166354b`
- **Automations in an Agent OS should only be applied to workflows that have been manually trusted, should initially produce drafts for review, and must always include logging to track actions.**
  - tier 2, confidence 0.9, source Nofar Gaspar, episode `how-to-build-a-personal-agentic-operating-system`, fp `90b6a6c8309886f9`
- **Claude Devs categorizes agentic loops into four types: turn-based, goal-based, time-based, and proactive, each with different trigger and stop criteria.**
  - tier 2, confidence 0.9, source Claude Devs (Anthropic), episode `how-to-get-the-most-out-of-fable-5-and-gpt-56-sol`, fp `9c0db586ce474d15`
- **Starbucks, with a market cap of $112 billion, reversed its automation strategy after concluding that handwritten notes, ceramic cups, and better seating increased customer satisfaction and dwell time.**
  - tier 1, confidence 0.95, source Alex Imas (via NLW reading), episode `where-the-economy-thrives-after-ai`, fp `fc3e826a58e130d0`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "  - Open challenges as of 2026 centre on trust and control: proving ROI, orchestrating multi-agent systems (single-task bots are giving way to co-ordinated agents), and enforcing \"governance-as-code\" for security and compliance under regimes such as the EU AI Act, SOC 2 and HIPAA. Physical/embodied AI is the emerging frontier, with Capgemini reporting 79% of large organisations already engaging with it.",
  "content": "\n\n- ### Recent Developments & Industry Insights (2025\u20132026)\n  - **Productivity Gains in Finance** \u2014 Citadel CEO Ken Griffin reported that AI agents are completing high-level financial research tasks that previously took master's or PhD holders weeks or months in a matter of hours or days, resulting in a 15-25% productivity boost for the firm. Griffin stated at a Stanford Business School discussion: \"work that we would usually do with people with master's and PhDs in finance over the course of weeks or months is being done by AI agents over the course of hours or days. He said the firm is seeing a 15 to 25% productivity boost.\"\n  - **Labor Market Projections** \u2014 Anthropic CEO Dario Amodei has predicted a 10% overall unemployment rate and a 50% unemployment rate for entry-level white-collar jobs due to AI automation. Microsoft AI CEO Mustafa Suleyman has stated that all white-collar work could be automated by AI within 18 months. These predictions highlight the rapid pace of displacement expected in knowledge work sectors.\n  - **Economic Shifts** \u2014 Economist Alex Emos's essay 'What Will Be Scarce' argues that the 'relational sector,' where human provenance adds economic value, will rise proportionally to savings in automated sectors. This suggests a bifurcation of the economy into automated efficiency and human-centric value.\n  - **Workforce Impact Data** \u2014 MIT's Project Iceberg study estimates that current AI systems can automate approximately 11.7% of wage-earning skills in the US workforce, representing $1.2 trillion in wages. This quantifies the immediate economic exposure to automation.\n  - **Software Engineering Automation** \u2014 The prediction that 90% of code would be written by AI by September 2025 was only off by a couple of months, as evidenced by Claude Code's current capabilities. Anthropic's agent usage data shows that software engineering accounts for approximately 50% of all tool calls, while back-office automation is the second largest category at 9.1%.\n  - **Solopreneurship & AI Co-founders** \u2014 The surge in solopreneurship is driven by AI acting as a 'technical co-founder' and 'sales and marketing first hire,' filling skill gaps that previously required hiring. Stripe reports that AI-influenced user journeys now represent four times the share of new signups, suggesting AI is driving sales for solo operators.\n  - **Best Practices for Agent Automation** \u2014 Experts recommend that automations in an Agent OS should only be applied to workflows that have been manually trusted, should initially produce drafts for review, and must always include logging to track actions. Claude Devs categorizes agentic loops into four types: turn-based, goal-based, time-based, and proactive, each with different trigger and stop criteria.\n  - **Counter-trends in Hospitality** \u2014 Starbucks, with a market cap of $112 billion, reversed its automation strategy after concluding that handwritten notes, ceramic cups, and better seating increased customer satisfaction and dwell time. CEO Brian Nichols noted that these small details and hospitality drive satisfaction, leading to more baristas being hired per store and automation being rolled back."
}
```

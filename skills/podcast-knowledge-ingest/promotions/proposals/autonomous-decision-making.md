# Dossier: Autonomous Decision Making

- status: `candidate_survivor`
- target page: `Autonomous Decision Making.md`
- assertions: 5 across episodes: autoresearch-agent-loops-and-the-future-of-work, how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger, the-most-important-ai-lesson-for-businesses-from-2025, the-rise-of-the-zero-human-company, the-self-driving-company

## Scores
- judge ok: True  error: None
- rubric-A improvement (after vs before): 1.0
- rubric-B improvement (after vs before): 2.0
- answer-completeness: 1.00

## Assertions
- **Karpathy's shared session of the 'auto research' loop resulted in 83 experiments, of which 15 were kept, driving the validation BPB from 0.9979 down to 0.9697.**
  - tier 1, confidence 0.95, source Andrej Karpathy (via podcast transcript), episode `autoresearch-agent-loops-and-the-future-of-work`, fp `d7e51269ea5c3d5f`
- **Anthropic is prioritizing 'horizontal agents' for enterprise use, focusing on repetitive, regulatory-compliant back-office tasks (like KYC) rather than just creative co-pilot tasks, requiring bespoke deployment of applied AI engineers.**
  - tier 2, confidence 0.85, source Mike Kger (Chief Product Officer, Anthropic), episode `how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger`, fp `2c7956aaf620e4c3`
- **Gartner predicts that by 2028, agents will make 15% of work decisions autonomously and a third of software applications will have Agentic AI integrated.**
  - tier 1, confidence 0.9, source Gartner, episode `the-most-important-ai-lesson-for-businesses-from-2025`, fp `8fa402cf94fd3ae0`
- **Ben Broca built the Pulsia platform in approximately one month by 'skipping to the end state' where AI can do everything, rather than iteratively testing limitations, leveraging new models like Opus 4.5 and Codex 5.2.**
  - tier 2, confidence 0.85, source Ben Broca, episode `the-rise-of-the-zero-human-company`, fp `650933d1457f2b51`
- **Replit's internal AI agents saved 30% of human pull request review time by assessing risk levels and escalating only when necessary.**
  - tier 1, confidence 0.95, source Amjad Masad (Replit CEO), episode `the-self-driving-company`, fp `858f4f0fb4a04184`

## Draft splice edit
```json
{
  "mode": "insert_after",
  "anchor": "- ### Provenance",
  "content": "- ### Recent Developments\n- Karpathy's shared session of the 'auto research' loop resulted in 83 experiments, of which 15 were kept, driving the validation BPB from 0.9979 down to 0.9697. [source: Andrej Karpathy (via podcast transcript), confidence 0.95, tier 1]\n- Anthropic is prioritizing 'horizontal agents' for enterprise use, focusing on repetitive, regulatory-compliant back-office tasks (like KYC) rather than just creative co-pilot tasks, requiring bespoke deployment of applied AI engineers. [source: Mike Kger (Chief Product Officer, Anthropic), confidence 0.85, tier 2]\n- Gartner predicts that by 2028, agents will make 15% of work decisions autonomously and a third of software applications will have Agentic AI integrated. [source: Gartner, confidence 0.9, tier 1]\n- Ben Broca built the Pulsia platform in approximately one month by 'skipping to the end state' where AI can do everything, rather than iteratively testing limitations, leveraging new models like Opus 4.5 and Codex 5.2. [source: Ben Broca, confidence 0.85, tier 2]\n- Replit's internal AI agents saved 30% of human pull request review time by assessing risk levels and escalating only when necessary. [source: Amjad Masad (Replit CEO), confidence 0.95, tier 1]\n- ### Provenance"
}
```

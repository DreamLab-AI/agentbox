The material above is a diagrams-as-code distillation of a software system I did not write: one Markdown file per subsystem topic, with Mermaid diagrams and prose that cite the source as path:line. You do not have the source; the distillation is all you get.

I am deciding whether to take responsibility for running this system in production. I need the problems, not the strengths. Every finding you report will be checked by an engineer against the code and its tests before anyone acts on it, so a false alarm costs a test and a missed defect costs an incident: when in doubt, report it and say how sure you are.

Rules:

1. No scores, no ratings, no praise, no summary of what the system does well. If you find yourself writing a compliment, delete it.
2. Report the {{COUNT}} most consequential problems you can find, ranked by the damage they would do in production: security, then data loss or custody, correctness, operability, maintainability.
3. Prioritise contradictions: places where one part of the material (a decision record, a comment, a header, a document) claims something another part shows is false. Then: guarantees that hold only on the happy path, single points of failure, state that a crash or restart loses, and anything that works for one tenant, user or instance but not for two.
4. The authors mark some problems themselves (Tension, Debt, Drift, Open). Those count, but look hardest for the ones they did not mark, and say which is which.
5. Write each problem in exactly this shape:

### F-01 — one-line title
- Topics: the topic ids where you saw it, e.g. CP-03.2
- Evidence: the specific claim and the conflicting fact from the material, with the path:line citations the material gives
- Failure: the concrete production scenario
- Confidence: high, medium or low; say "inferred" if you are reasoning beyond what the material shows
- Marked by authors: yes (which marker) or no

6. Finish with a section headed "## Not judgeable from this material": up to five things you would need to see before signing off.

# Quality Gates & Workflow Phases

The quality-gate thresholds enforced by the skill and the five-phase (plus EDD
sub-phase) execution workflow.

## Comprehensive Quality Gates

- **Coverage**: 85% minimum, 95% critical paths, 100% new code
- **Security**: SAST/DAST scanning, zero critical/high vulnerabilities
- **Accessibility**: WCAG AA/AAA compliance (85% color contrast, 80% keyboard nav)
- **Chaos Testing**: Network resilience (70%), resource exhaustion (75%), graceful degradation (80%)
- **Contract Validation**: Schema validation, backward compatibility
- **Defect Prediction**: ML-powered with F1 > 0.8
- **Evidence Coverage** (NEW v1.2.0): Every shipped feature has an EXP-NNN; every EXP has executed evidence with receipts; auditor distinct from producer; `regression_critical` expectations have a `stabilized_by` test reference; zero stale evidence (>30d or post-SHA-drift)

## Workflow Phases

```
Phase 1: REQUIREMENTS & PLANNING
├── Architect agent analyzes requirements
├── Requirements-validation domain verifies specs
├── Code-intelligence builds knowledge graph
└── SONA retrieves similar project patterns

Phase 1.5: EXPECTATION AUTHORING (NEW v1.2.0 — EDD step 1)
├── expectation-author agent + human draft EXP-NNN artifacts
├── Each expectation: behaviour + edge cases + counter-examples
├── Specificity rule: precise numbers, ordering, error modes
├── Workshop pattern for shared business logic
└── GATE: human signs off expectations as `accepted` before coder runs

Phase 2: DEVELOPMENT (Parallel)
├── Coder agent writes implementation against EXP-NNN + SPEC + ADR
├── Test-generation creates tests IN PARALLEL
├── Security-architect reviews for vulnerabilities
└── Coverage-analysis identifies gaps

Phase 2.5: EVIDENCE PRODUCTION & AUDIT (NEW v1.2.0 — EDD steps 3-4)
├── evidence-producer executes scenarios per expectation
│   ├── Required receipts: command, raw output, timestamp, git SHA
│   └── Three evidence categories: executable / partial / not-executable
├── evidence-auditor (DIFFERENT model family) independently verifies
│   ├── Mandate: find counter-example, do not confirm
│   └── RUN VIA CODEX: invoke `/codex:adversarial-review` (Codex/GPT) as the
│       auditor — GPT is a genuinely different model family from the Claude
│       producer, which is exactly what the anti-fox rule requires. Fail-open:
│       if the codex plugin / Codex CLI is unavailable, fall back to a Claude
│       `reviewer`/`evidence-auditor` subagent and note the degraded (same-family) audit.
├── Human adversarial review (EDD step 5)
└── Loop back to Phase 2 if gaps found (EDD step 6)

Phase 3: QUALITY GATES
├── Quality-assessment evaluates readiness
├── Defect-intelligence predicts bugs
├── Visual-accessibility checks WCAG compliance
├── Chaos-resilience validates fault tolerance
└── Evidence Coverage gate (NEW v1.2.0 — sixth gate)
    ├── Every feature has ≥1 expectation
    ├── Every expectation has executed evidence with receipts
    ├── Auditor distinct from producer
    ├── Stale evidence = 0 (>30d or post-SHA-drift triggers re-run)
    └── regression_critical expectations have stabilized_by reference

Phase 3.5: STABILIZATION (NEW v1.2.0 — EDD step 7)
├── tdd-stabilizer converts proven expectations into automated tests
├── Test ID linked to EXP-NNN via `stabilized_by` frontmatter field
└── Expectation status moves from `proven` -> `stable`

Phase 4: DEPLOYMENT
├── Deployment agent manages CI/CD
├── Contract-testing validates API compatibility
└── Performance agent benchmarks

Phase 5: LEARNING
├── ReasoningBank stores test patterns AND high-quality expectation patterns
├── SONA optimizes future builds
├── Cross-project transfer enables reuse (incl. expectation libraries)
└── Archive: EXP + evidence + test reference becomes living docs
```

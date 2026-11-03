# Responsibilities and actual participants

Assign responsibility before assigning a model. The catalogue below preserves
the old role vocabulary for migration and planning; these labels do not create
workers, choose models or establish tools are installed. A single maintainer
can perform several roles sequentially. Delegate only when available and
authorised, with a bounded task, owned files and a clear return artefact.

| Role labels | Responsibility and observable result |
|---|---|
| architect | Domain/interface choices, constraints and decision record when warranted |
| coder | Implementation and causal explanation of the diff |
| reviewer | Scoped findings grounded in source and evidence |
| browser-agent | An actual browser journey and retained observations |
| deployer | Authorised release/activation operations and separate receipts |
| expectation-author | Behaviour, boundaries and counterexamples agreed with the requester |
| tdd-stabilizer | A meaningful permanent test linked to the expectation and an executed result |
| test-strategist | Appropriate seams, fixtures, controls and applicability |
| unit-test-generator | Local behavioural tests |
| integration-test-generator | Tests through real component boundaries |
| e2e-test-generator | Supported end-user journeys and their environment limits |
| coverage-analyzer | Measured coverage and uncovered important behaviour |
| mutation-tester | Evidence that selected tests detect meaningful altered behaviour |
| defect-predictor | Only an available, validated prediction tool; otherwise exploratory review without prediction claims |
| flaky-test-hunter | Reproduction rate, environment/seed and a diagnosed source of instability |
| chaos-engineer | Bounded fault experiments and effects |
| resilience-validator | Recovery, loss and service-level observations under a specified workload |
| evidence-producer | Commands, raw observations and exact input/configuration identity |
| evidence-auditor | Independent examination and an additional counterexample probe when required |
| security-architect | Trust boundaries and threat assumptions |
| security-implementer | Tested changes to relevant controls |
| security-tester | Authorised boundary probes with supported controls |
| sast-scanner | Completed static-analysis results and their scope |
| dast-scanner | Authorised dynamic checks against a named target |
| compliance-auditor | Evidence against applicable criteria; not an automatic certification |
| memory-indexer | Host-provided knowledge maintenance, if available and authorised |
| trajectory-tracker | Actual attempts and outcomes retained under the host's data policy |
| reasoning-bank-manager | Curated reusable patterns with provenance and limits |
| cross-project-transfer | Check whether a prior lesson's assumptions apply to this consumer |
| sona-optimizer, q-learning-optimizer | Historical extension labels; no corresponding runtime is supplied here |
| tdd-red-phase | A failing meaningful case with correct setup |
| tdd-green-phase | The smallest sufficient repair and passing case/control |
| tdd-refactor-phase | Simpler structure with preserved observed behaviour |

The original catalogue contains 34 labels. Coordination labels such as
`unified-coordinator`, `event-bridge` and `mcp-coordinator` also appeared in a
descriptive config; they remain host responsibilities, not additional workers.

Record actual execution/agent IDs, model identities, inputs, tools and outputs
when participant provenance matters. A role label or provider alias cannot
establish independent review. If policy requires a different model family,
verify that relationship for the actual producer and auditor. Same-family
advice remains useful and is labelled as such. Unknown identities do not earn
independence credit.

An advisor is useful before difficult interface decisions, after repeated
failed repairs and over the final diff. If no advisor exists, reassess the
hypothesis yourself and record any unmet required review. Do not invent a
successful consultation. For one real integration, see
[Agentbox](ecosystem-agentbox.md).

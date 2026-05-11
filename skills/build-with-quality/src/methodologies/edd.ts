/**
 * Expectation-Driven Development (EDD)
 *
 * Introduced in build-with-quality v1.2.0.
 *
 * EDD is the design-time conversation layer between human intent and AI
 * implementation. It captures the requirements that don't fit in an
 * `assert` (qualitative, relational, systemic) and demands the agent
 * produce executed evidence (not narration) that each expectation is met.
 *
 * EDD does NOT replace TDD or BDD — it runs before them and hands proven
 * scenarios off as inputs to TDD/BDD for permanent regression coverage.
 *
 * See ../../EDD-PROTOCOL.md for the full playbook.
 */

// ============================================================================
// Expectation artifact (EXP-NNN)
// ============================================================================

export type ExpectationPriority = 'critical' | 'high' | 'medium' | 'low';

export type EvidenceCategory =
  | 'executable'           // gold: functions, APIs, scripts
  | 'partially-verifiable' // medium: plans, dry-runs, schema validations
  | 'not-executable';      // low: UI rendering, manual flows, hardware

export type ExpectationStatus =
  | 'draft'    // authored, not yet accepted
  | 'accepted' // human signed off, ready for implementation
  | 'proven'   // evidence produced and audited
  | 'stable'   // stabilized as automated test (regression_critical only)
  | 'stale';   // evidence older than 30d or post-SHA-drift

export type AuthoredBy =
  | 'human'
  | 'pair'                 // two humans
  | 'swarm-spec-workshop'; // multi-agent + human collaborative draft

export interface Expectation {
  id: string;                    // e.g. EXP-042
  parent_spec?: string;          // BHIL link, e.g. SPEC-012
  linked_adrs?: string[];        // e.g. [ADR-007, ADR-008]
  parent_task?: string;          // BHIL link, e.g. TASK-101
  priority: ExpectationPriority;
  regression_critical: boolean;  // if true, stabilization mandatory
  evidence_category: EvidenceCategory;
  status: ExpectationStatus;
  authored_by: AuthoredBy;
  expectation: string;           // single-sentence claim + body
  in_scope: string[];            // edge cases this expectation MUST cover
  out_of_scope: string[];        // adjacent concerns in other expectations
  counter_examples: string[];    // behaviour that would falsify (must NOT happen)
  stabilized_by?: string;        // test reference, e.g. tests/cart.test.ts::discount_then_tax
  created_at: string;            // ISO 8601
  updated_at: string;
}

// ============================================================================
// Evidence artifact (EXP-NNN.evidence.md)
// ============================================================================

export type AuditorVerdict = 'pass' | 'fail' | 'inconclusive';

export interface EvidenceScenario {
  scenario_label: string;
  command: string;               // exact command/invocation that was run
  raw_output: string;            // unsummarised output
  verdict: 'pass' | 'fail';
  notes?: string;
}

export interface EvidenceReceipt {
  expectation_id: string;        // links back to EXP-NNN
  git_sha: string;               // SHA of code under test
  produced_by: string;           // agent identity, e.g. agent:claude-sonnet-4-6
  produced_at: string;           // ISO 8601
  audited_by: string;            // agent identity, MUST differ from produced_by
  audited_at: string;
  auditor_model_family: string;  // MUST differ from producer model family
  producer_model_family: string;
  auditor_verdict: AuditorVerdict;
  auditor_counter_examples_attempted: number;
  auditor_counter_examples_found: number;
  scenarios: EvidenceScenario[];
  stabilized_by?: string;        // test reference once Step 7 complete
  human_verify_required: boolean; // true for not-executable category
  human_verified_at?: string;
}

// ============================================================================
// EDD loop and protocol
// ============================================================================

export type EDDStep =
  | 'formulate'
  | 'implement'
  | 'produce-evidence'
  | 'audit'
  | 'human-challenge'
  | 'iterate'
  | 'stabilize';

export interface EDDLoopState {
  expectation_id: string;
  current_step: EDDStep;
  iteration: number;
  history: { step: EDDStep; at: string; actor: string }[];
}

export const EDD_LOOP: { step: EDDStep; actor: string; description: string }[] = [
  {
    step: 'formulate',
    actor: 'human + expectation-author',
    description:
      'Author EXP-NNN with frontmatter, body, in-scope, out-of-scope, counter-examples',
  },
  {
    step: 'implement',
    actor: 'coder',
    description: 'Implement against EXP + SPEC + ADR. TDD red-green-refactor cycle inside.',
  },
  {
    step: 'produce-evidence',
    actor: 'evidence-producer',
    description:
      'Execute scenarios per expectation. Capture command, raw output, timestamp, git SHA. Tool use required.',
  },
  {
    step: 'audit',
    actor: 'evidence-auditor',
    description:
      'Independent verification by DIFFERENT agent on DIFFERENT model family. Mandate: find counter-example, do not confirm. MUST run >=1 adversarial probe.',
  },
  {
    step: 'human-challenge',
    actor: 'human',
    description:
      'Adversarial review: subjective qualities, taste, scope gaps, "what input would break this?"',
  },
  {
    step: 'iterate',
    actor: 'orchestrator',
    description: 'If gaps found, loop back to implement. If satisfied, proceed to stabilize.',
  },
  {
    step: 'stabilize',
    actor: 'tdd-stabilizer',
    description:
      'For regression_critical EXPs, generate automated test. Set stabilized_by. Status: proven -> stable.',
  },
];

// ============================================================================
// Evidence Coverage gate
// ============================================================================

export interface EvidenceCoverageGateResult {
  passed: boolean;
  every_feature_has_expectation: boolean;
  every_expectation_has_evidence: boolean;
  evidence_has_receipts: boolean;
  auditor_distinct_from_producer: boolean;
  auditor_model_family_distinct: boolean;
  regression_critical_have_stabilizer: boolean;
  stale_evidence_count: number;
  counter_example_probes_per_expectation_min: number;
  failures: string[];
}

export function checkEvidenceCoverage(
  expectations: Expectation[],
  evidence: EvidenceReceipt[],
): EvidenceCoverageGateResult {
  const failures: string[] = [];
  const evidenceById = new Map(evidence.map((e) => [e.expectation_id, e] as const));

  let allHaveEvidence = true;
  let allReceipts = true;
  let allDistinctAuditor = true;
  let allDistinctFamily = true;
  let allRegStabilized = true;
  let staleCount = 0;
  let minProbes = Number.POSITIVE_INFINITY;

  for (const exp of expectations) {
    const ev = evidenceById.get(exp.id);
    if (!ev) {
      allHaveEvidence = false;
      failures.push(`${exp.id}: no evidence produced`);
      continue;
    }

    if (!ev.git_sha || !ev.produced_at || ev.scenarios.length === 0) {
      allReceipts = false;
      failures.push(`${exp.id}: evidence missing receipts (sha/timestamp/scenarios)`);
    }
    for (const s of ev.scenarios) {
      if (!s.command || !s.raw_output) {
        allReceipts = false;
        failures.push(`${exp.id}: scenario "${s.scenario_label}" missing command or raw output`);
      }
    }

    if (ev.produced_by === ev.audited_by) {
      allDistinctAuditor = false;
      failures.push(`${exp.id}: auditor must differ from producer (anti-fox)`);
    }
    if (ev.producer_model_family === ev.auditor_model_family) {
      allDistinctFamily = false;
      failures.push(
        `${exp.id}: auditor model family (${ev.auditor_model_family}) must differ from producer (${ev.producer_model_family})`,
      );
    }

    if (exp.regression_critical && !ev.stabilized_by) {
      allRegStabilized = false;
      failures.push(`${exp.id}: regression_critical but no stabilized_by test reference`);
    }

    if (isStale(ev)) {
      staleCount += 1;
      failures.push(`${exp.id}: evidence is stale (>30d or post-SHA-drift)`);
    }

    minProbes = Math.min(minProbes, ev.auditor_counter_examples_attempted);
  }

  if (!Number.isFinite(minProbes)) minProbes = 0;
  if (minProbes < 1 && expectations.length > 0) {
    failures.push('At least one expectation has zero auditor counter-example probes');
  }

  const passed =
    allHaveEvidence &&
    allReceipts &&
    allDistinctAuditor &&
    allDistinctFamily &&
    allRegStabilized &&
    staleCount === 0 &&
    minProbes >= 1;

  return {
    passed,
    every_feature_has_expectation: expectations.length > 0,
    every_expectation_has_evidence: allHaveEvidence,
    evidence_has_receipts: allReceipts,
    auditor_distinct_from_producer: allDistinctAuditor,
    auditor_model_family_distinct: allDistinctFamily,
    regression_critical_have_stabilizer: allRegStabilized,
    stale_evidence_count: staleCount,
    counter_example_probes_per_expectation_min: minProbes,
    failures,
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isStale(ev: EvidenceReceipt, currentSha?: string): boolean {
  const age = Date.now() - new Date(ev.produced_at).getTime();
  if (age > THIRTY_DAYS_MS) return true;
  if (currentSha && currentSha !== ev.git_sha) return true;
  return false;
}

// ============================================================================
// Templates
// ============================================================================

export const EXPECTATION_TEMPLATE = `---
id: EXP-{NUMBER}
parent_spec: {SPEC_ID}
linked_adrs: [{ADR_IDS}]
priority: {PRIORITY}            # critical | high | medium | low
regression_critical: {BOOL}     # if true, stabilization mandatory
evidence_category: {CATEGORY}   # executable | partially-verifiable | not-executable
status: draft
authored_by: {AUTHOR}           # human | pair | swarm-spec-workshop
---

## Expectation: {SINGLE_SENTENCE_CLAIM}

{2-6 sentences describing the behaviour. Be specific about numbers,
boundaries, ordering, error modes. Mention what should NOT happen as
explicitly as what should.}

### In scope
- {edge case 1}
- {edge case 2}

### Out of scope (intentionally)
- {adjacent concern, belongs in another EXP}

### Counter-examples (must NOT happen)
- {behaviour that would falsify this expectation}
`;

export const EVIDENCE_TEMPLATE = `---
expectation_id: EXP-{NUMBER}
git_sha: {SHA}
produced_by: {PRODUCER_AGENT}
producer_model_family: {PRODUCER_FAMILY}
produced_at: {ISO8601}
audited_by: {AUDITOR_AGENT}
auditor_model_family: {AUDITOR_FAMILY}    # MUST differ from producer_model_family
audited_at: {ISO8601}
auditor_verdict: {pass|fail|inconclusive}
auditor_counter_examples_attempted: {N}
auditor_counter_examples_found: {M}
human_verify_required: {BOOL}
stabilized_by: {TEST_REFERENCE}            # required if regression_critical
---

## Scenario 1: {label}

**Command:**
\`\`\`
{exact command/invocation}
\`\`\`

**Raw output:**
\`\`\`
{unsummarised output}
\`\`\`

**Verdict:** {✅ matches expectation | ❌ counter-example found}

## Scenario 2: {label}
...

## Auditor adversarial probe (not run by producer)

**Command:** {auditor's chosen counter-example scenario}
**Raw output:** {actual output}
**Verdict:** {✅ no counter-example | ❌ found counter-example: {detail}}
`;

// ============================================================================
// Helper functions
// ============================================================================

export function createExpectation(
  number: number,
  expectation: string,
  options: Partial<Omit<Expectation, 'id' | 'expectation' | 'created_at' | 'updated_at'>> = {},
): Expectation {
  const now = new Date().toISOString();
  const exp: Expectation = {
    id: `EXP-${String(number).padStart(3, '0')}`,
    expectation,
    priority: options.priority ?? 'medium',
    regression_critical: options.regression_critical ?? false,
    evidence_category: options.evidence_category ?? 'executable',
    status: options.status ?? 'draft',
    authored_by: options.authored_by ?? 'human',
    in_scope: options.in_scope ?? [],
    out_of_scope: options.out_of_scope ?? [],
    counter_examples: options.counter_examples ?? [],
    created_at: now,
    updated_at: now,
  };
  // exactOptionalPropertyTypes: only assign when defined.
  if (options.parent_spec !== undefined) exp.parent_spec = options.parent_spec;
  if (options.linked_adrs !== undefined) exp.linked_adrs = options.linked_adrs;
  if (options.parent_task !== undefined) exp.parent_task = options.parent_task;
  if (options.stabilized_by !== undefined) exp.stabilized_by = options.stabilized_by;
  return exp;
}

/**
 * Validates the anti-fox separation rule. Throws if producer and auditor
 * share an agent identity or share a model family — these are the two
 * forbidden configurations from the EDD protocol.
 */
export function assertAntiFoxSeparation(
  producerAgent: string,
  auditorAgent: string,
  producerFamily: string,
  auditorFamily: string,
): void {
  if (producerAgent === auditorAgent) {
    throw new Error(
      `EDD anti-fox violation: producer and auditor must be different agents (got "${producerAgent}" for both)`,
    );
  }
  if (producerFamily === auditorFamily) {
    throw new Error(
      `EDD anti-fox violation: producer and auditor must be on different model families (both on "${producerFamily}")`,
    );
  }
}

/**
 * Returns true when the expectation can ship. Rules:
 *   1. Status must be 'proven' (evidence produced + audited) or 'stable'
 *   2. If regression_critical, status must be 'stable' (i.e. stabilized_by set)
 */
export function canShipExpectation(exp: Expectation): boolean {
  if (exp.regression_critical) {
    return exp.status === 'stable' && Boolean(exp.stabilized_by);
  }
  return exp.status === 'proven' || exp.status === 'stable';
}

// ============================================================================
// Documentation
// ============================================================================

/**
 * EDD methodology overview used by orchestrator agents to brief sub-agents.
 */
export const EDD_GUIDE = {
  purpose:
    'Design-time conversation layer between human intent and AI implementation. Captures expectations that TDD/BDD assertions cannot express.',
  loop: EDD_LOOP,
  evidenceCategories: {
    executable: 'Gold standard. Producer runs the code and shows real output.',
    partiallyVerifiable: 'Plans/dry-runs (Terraform plan, schema validate). Confidence medium.',
    notExecutable:
      'UI, third-party, hardware. Producer narrates, human must spot-check. Confidence low.',
  },
  antiFox: {
    rule: 'evidence-producer and evidence-auditor MUST be different agents on different model families.',
    rationale:
      'Same agent grading own work has structural bias. Same model family inherits same blind spots.',
    enforcement: 'assertAntiFoxSeparation() throws; checkEvidenceCoverage() fails the gate.',
  },
  stabilization: {
    rule: 'regression_critical expectations MUST have a stabilized_by test reference before shipping.',
    rationale:
      'Evidence is a snapshot that decays silently. Tests are the regression alarm. Both layers required.',
  },
  versioning: {
    staleness_days: 30,
    sha_drift_invalidates: true,
  },
} as const;

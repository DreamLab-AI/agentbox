/**
 * DDD, ADR, and TDD Methodology Support
 * Explicit methodology guidance for the Build with Quality skill
 */

// ============================================================================
// Domain-Driven Design (DDD) Support
// ============================================================================

export interface BoundedContext {
  name: string;
  description: string;
  ubiquitousLanguage: Record<string, string>;
  aggregates: AggregateDefinition[];
  domainEvents: string[];
  integrationPoints: string[];
}

export interface AggregateDefinition {
  name: string;
  root: EntityDefinition;
  entities: EntityDefinition[];
  valueObjects: ValueObjectDefinition[];
  invariants: string[];
}

export interface EntityDefinition {
  name: string;
  identity: string;
  properties: PropertyDefinition[];
  behaviors: string[];
}

export interface ValueObjectDefinition {
  name: string;
  properties: PropertyDefinition[];
  validationRules: string[];
}

export interface PropertyDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface DDDAnalysis {
  contexts: BoundedContext[];
  contextMap: ContextMapRelation[];
  strategicPatterns: string[];
  tacticalPatterns: string[];
}

export interface ContextMapRelation {
  upstream: string;
  downstream: string;
  relationType: 'partnership' | 'shared-kernel' | 'customer-supplier' | 'conformist' | 'anticorruption-layer' | 'open-host-service' | 'published-language';
}

/**
 * DDD Analysis Guide
 */
export const DDD_GUIDE = {
  strategicDesign: {
    steps: [
      '1. Identify subdomains (Core, Supporting, Generic)',
      '2. Define bounded contexts for each subdomain',
      '3. Establish ubiquitous language within each context',
      '4. Map relationships between contexts (Context Map)',
      '5. Identify integration patterns needed',
    ],
    questions: [
      'What are the core business capabilities?',
      'Where do domain experts use different terms for similar concepts?',
      'What are the natural boundaries in the business process?',
      'Which parts change together vs independently?',
    ],
  },
  tacticalDesign: {
    patterns: {
      aggregate: 'Cluster of entities and value objects with a root entity',
      entity: 'Object with identity that persists over time',
      valueObject: 'Immutable object defined by its attributes',
      domainEvent: 'Something that happened that domain experts care about',
      repository: 'Abstraction for aggregate persistence',
      factory: 'Encapsulates complex object creation',
      domainService: 'Stateless operation that doesn\'t belong to an entity',
    },
    guidelines: [
      'Keep aggregates small - prefer smaller transaction boundaries',
      'Reference other aggregates by ID, not direct reference',
      'Use domain events for cross-aggregate communication',
      'Validate invariants in aggregate root',
      'Make value objects immutable',
    ],
  },
};

// ============================================================================
// Architecture Decision Records (ADR) Support
// ============================================================================

export interface ADR {
  id: string;
  title: string;
  status: ADRStatus;
  date: string;
  context: string;
  decision: string;
  consequences: {
    positive: string[];
    negative: string[];
    risks: string[];
  };
  alternatives: ADRAlternative[];
  relatedADRs?: string[];
  supersedes?: string;
  supersededBy?: string;
}

export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface ADRAlternative {
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  rejectionReason: string;
}

/**
 * ADR Template
 */
export const ADR_TEMPLATE = `# ADR-{NUMBER}: {TITLE}

## Status
{STATUS} - {DATE}

## Context
{CONTEXT}
- What is the issue that we're seeing that is motivating this decision?
- What forces are at play (technical, political, social, project)?

## Decision
{DECISION}
- What is the change that we're proposing and/or doing?

## Consequences

### Positive
{POSITIVE_CONSEQUENCES}

### Negative
{NEGATIVE_CONSEQUENCES}

### Risks
{RISKS}

## Alternatives Considered

### Alternative 1: {ALT_TITLE}
- Description: {ALT_DESCRIPTION}
- Pros: {ALT_PROS}
- Cons: {ALT_CONS}
- Rejection reason: {REJECTION_REASON}

## Related Decisions
- {RELATED_ADRS}

## Notes
{NOTES}
`;

/**
 * Common ADR Categories for Software Projects
 */
export const ADR_CATEGORIES = {
  architecture: [
    'Monolith vs Microservices',
    'API Design (REST, GraphQL, gRPC)',
    'Database Selection',
    'Caching Strategy',
    'Message Queue Selection',
    'Authentication/Authorization Approach',
  ],
  technology: [
    'Programming Language',
    'Framework Selection',
    'ORM/Database Access',
    'Testing Framework',
    'Build Tool',
    'CI/CD Pipeline',
  ],
  patterns: [
    'Error Handling Strategy',
    'Logging Approach',
    'Configuration Management',
    'State Management',
    'Event Sourcing',
    'CQRS',
  ],
  operations: [
    'Deployment Strategy',
    'Monitoring Approach',
    'Disaster Recovery',
    'Scaling Strategy',
    'Security Controls',
  ],
};

// ============================================================================
// Test-Driven Development (TDD) Support
// ============================================================================

export interface TDDCycle {
  phase: TDDPhase;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  artifacts: string[];
  notes: string[];
}

export type TDDPhase = 'red' | 'green' | 'refactor';

export interface TDDSession {
  feature: string;
  cycles: TDDCycle[];
  currentCycle: number;
  testFile: string;
  implementationFile: string;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * TDD Workflow Guide
 */
export const TDD_GUIDE = {
  redPhase: {
    name: 'RED - Write a Failing Test',
    steps: [
      '1. Write a test for the next bit of functionality',
      '2. Run the test and verify it FAILS',
      '3. Failure should be for the expected reason (not syntax error)',
      '4. Test should be minimal - test ONE thing',
    ],
    principles: [
      'Write the test BEFORE the implementation',
      'Test should express intent clearly',
      'Use descriptive test names (should_do_X_when_Y)',
      'Arrange-Act-Assert structure',
    ],
    antiPatterns: [
      'Writing multiple tests at once',
      'Writing test after implementation',
      'Testing implementation details instead of behavior',
    ],
  },
  greenPhase: {
    name: 'GREEN - Make the Test Pass',
    steps: [
      '1. Write the SIMPLEST code to make the test pass',
      '2. Don\'t worry about elegance yet',
      '3. Run the test and verify it PASSES',
      '4. All previous tests should still pass',
    ],
    principles: [
      'Write minimum code to pass - no more',
      'It\'s OK to hardcode initially',
      'Don\'t anticipate future requirements',
      'YAGNI - You Ain\'t Gonna Need It',
    ],
    antiPatterns: [
      'Writing more code than needed',
      'Optimizing prematurely',
      'Adding features not covered by tests',
    ],
  },
  refactorPhase: {
    name: 'REFACTOR - Improve the Code',
    steps: [
      '1. Look for code smells and duplication',
      '2. Refactor while keeping tests green',
      '3. Run tests after each small change',
      '4. Improve both production AND test code',
    ],
    principles: [
      'Tests are your safety net',
      'Small, incremental changes',
      'If tests break, revert immediately',
      'Apply DRY, SOLID principles',
    ],
    refactoringTargets: [
      'Remove duplication',
      'Improve naming',
      'Extract methods/classes',
      'Simplify conditionals',
      'Remove dead code',
    ],
  },
  cycleRules: [
    'Never skip a phase',
    'Complete full cycles before moving on',
    'Commit after each green phase',
    'Keep cycles short (5-10 minutes ideally)',
  ],
};

/**
 * TDD Test Patterns
 */
export const TDD_PATTERNS = {
  unitTest: {
    structure: `
describe('{Unit Under Test}', () => {
  describe('{method/behavior}', () => {
    it('should {expected behavior} when {condition}', () => {
      // Arrange
      const sut = createSystemUnderTest();

      // Act
      const result = sut.doSomething();

      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});`,
    namingConventions: [
      'should_ReturnX_WhenY',
      'should_ThrowError_WhenInvalidInput',
      'should_CallDependency_WhenConditionMet',
    ],
  },
  integrationTest: {
    structure: `
describe('{Feature} Integration', () => {
  beforeAll(async () => {
    // Setup test environment
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should {end-to-end behavior}', async () => {
    // Arrange - setup real dependencies

    // Act - exercise the full flow

    // Assert - verify final state
  });
});`,
  },
  testDoubles: {
    stub: 'Returns predefined values, no verification',
    mock: 'Verifies interactions occurred',
    fake: 'Working implementation (e.g., in-memory DB)',
    spy: 'Records calls for later verification',
  },
};

// ============================================================================
// Combined Methodology Workflow
// ============================================================================

export interface MethodologyWorkflow {
  phase: string;
  ddd: DDDActivity[];
  adr: ADRActivity[];
  tdd: TDDActivity[];
}

export interface DDDActivity {
  activity: string;
  output: string;
}

export interface ADRActivity {
  activity: string;
  output: string;
}

export interface TDDActivity {
  activity: string;
  output: string;
}

/**
 * Integrated DDD + ADR + TDD Workflow
 */
export const METHODOLOGY_WORKFLOW: MethodologyWorkflow[] = [
  {
    phase: '1. Discovery & Strategic Design',
    ddd: [
      { activity: 'Identify core domain and subdomains', output: 'Domain map' },
      { activity: 'Define bounded contexts', output: 'Context diagram' },
      { activity: 'Establish ubiquitous language', output: 'Glossary' },
      { activity: 'Create context map', output: 'Integration patterns' },
    ],
    adr: [
      { activity: 'ADR-001: Architecture style decision', output: 'docs/adr/001-architecture-style.md' },
      { activity: 'ADR-002: Bounded context boundaries', output: 'docs/adr/002-context-boundaries.md' },
    ],
    tdd: [],
  },
  {
    phase: '2. Technical Design',
    ddd: [
      { activity: 'Design aggregates for each context', output: 'Aggregate diagrams' },
      { activity: 'Define entities and value objects', output: 'Domain model' },
      { activity: 'Identify domain events', output: 'Event catalog' },
    ],
    adr: [
      { activity: 'ADR-003: Database per context vs shared', output: 'docs/adr/003-database-strategy.md' },
      { activity: 'ADR-004: Event communication', output: 'docs/adr/004-event-strategy.md' },
      { activity: 'ADR-005: Technology stack', output: 'docs/adr/005-tech-stack.md' },
    ],
    tdd: [],
  },
  {
    phase: '3. Implementation (Per Feature)',
    ddd: [
      { activity: 'Implement aggregate root', output: 'src/domain/{context}/{aggregate}.ts' },
      { activity: 'Implement value objects', output: 'src/domain/{context}/value-objects/' },
      { activity: 'Implement repository interface', output: 'src/domain/{context}/repositories/' },
    ],
    adr: [
      { activity: 'Document significant implementation decisions', output: 'docs/adr/' },
    ],
    tdd: [
      { activity: 'RED: Write failing test for aggregate behavior', output: 'tests/domain/{aggregate}.test.ts' },
      { activity: 'GREEN: Implement minimum code to pass', output: 'src/domain/{aggregate}.ts' },
      { activity: 'REFACTOR: Clean up, extract value objects', output: 'Improved code' },
      { activity: 'Repeat cycle for each behavior', output: 'Complete test coverage' },
    ],
  },
  {
    phase: '4. Integration',
    ddd: [
      { activity: 'Implement anti-corruption layers', output: 'src/infrastructure/acl/' },
      { activity: 'Implement domain event handlers', output: 'src/application/handlers/' },
    ],
    adr: [
      { activity: 'Document integration patterns used', output: 'docs/adr/' },
    ],
    tdd: [
      { activity: 'Write integration tests for context boundaries', output: 'tests/integration/' },
      { activity: 'Write contract tests for APIs', output: 'tests/contracts/' },
    ],
  },
];

// ============================================================================
// Export helper functions
// ============================================================================

export function createADR(
  number: number,
  title: string,
  context: string,
  decision: string,
  consequences: ADR['consequences'],
  alternatives: ADRAlternative[] = []
): ADR {
  return {
    id: `ADR-${String(number).padStart(3, '0')}`,
    title,
    status: 'proposed',
    date: new Date().toISOString().split('T')[0]!,
    context,
    decision,
    consequences,
    alternatives,
  };
}

export function createTDDSession(
  feature: string,
  testFile: string,
  implementationFile: string
): TDDSession {
  return {
    feature,
    cycles: [],
    currentCycle: 0,
    testFile,
    implementationFile,
    startedAt: new Date(),
  };
}

export function analyzeDomainForDDD(requirements: string): Partial<DDDAnalysis> {
  // This would be enhanced with actual NLP/AI analysis
  return {
    strategicPatterns: ['Bounded Context', 'Context Map', 'Ubiquitous Language'],
    tacticalPatterns: ['Aggregate', 'Entity', 'Value Object', 'Domain Event', 'Repository'],
  };
}

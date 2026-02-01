/**
 * Claude Code V3 + Agentic QE Combined Skill
 * "Build with Quality" - Optimal project building with integrated quality engineering
 *
 * @module @claude-flow/build-with-quality-skill
 * @version 1.0.0
 */

// Core exports
export * from './core/types.js';
export * from './core/interfaces.js';

// Memory exports
export { UnifiedMemory, HNSWIndex } from './memory/index.js';
export type { UnifiedMemoryConfig, HNSWConfig, SearchResult } from './memory/index.js';

// Coordination exports
export { QueenCoordinator } from './coordination/index.js';

// Events exports
export { EventBus, createEvent } from './events/index.js';

// Agents exports
export {
  AgentFactory,
  ALL_AGENTS,
  CLAUDE_CODE_V3_AGENTS,
  AGENTIC_QE_AGENTS,
  SHARED_AGENTS,
} from './agents/index.js';
export type { AgentDefinition } from './agents/index.js';

// Routing exports
export { TinyDancerRouter } from './routing/index.js';

// Quality exports
export { QualityGate } from './quality/index.js';

// Workflow exports
export { BuildWithQualityOrchestrator } from './workflows/index.js';

// Methodologies exports (DDD, ADR, TDD)
export {
  DDD_GUIDE,
  ADR_TEMPLATE,
  ADR_CATEGORIES,
  TDD_GUIDE,
  TDD_PATTERNS,
  METHODOLOGY_WORKFLOW,
  createADR,
  createTDDSession,
  analyzeDomainForDDD,
} from './methodologies/index.js';
export type {
  BoundedContext,
  AggregateDefinition,
  EntityDefinition,
  ValueObjectDefinition,
  DDDAnalysis,
  ADR,
  ADRStatus,
  ADRAlternative,
  TDDCycle,
  TDDPhase,
  TDDSession,
  MethodologyWorkflow,
} from './methodologies/index.js';

// ============================================================================
// Main Skill Class
// ============================================================================

import type {
  SkillContext,
  SkillResult,
  SwarmConfig,
  SwarmId,
  SessionId,
} from './core/types.js';
import type { ISkill, ICoordinator, IMemory, IEventBus, IModelRouter, IQualityGate, IWorkflowOrchestrator } from './core/interfaces.js';
import { createSwarmId } from './core/types.js';
import { UnifiedMemory } from './memory/index.js';
import { QueenCoordinator } from './coordination/index.js';
import { EventBus } from './events/index.js';
import { AgentFactory } from './agents/index.js';
import { TinyDancerRouter } from './routing/index.js';
import { QualityGate } from './quality/index.js';
import { BuildWithQualityOrchestrator } from './workflows/index.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  id: createSwarmId('build-with-quality'),
  topology: 'hierarchical-mesh',
  maxAgents: 100,
  domains: [
    { name: 'development', source: 'claude-code-v3', agents: ['architect', 'coder', 'reviewer', 'deployer'], maxConcurrent: 4 },
    { name: 'quality', source: 'agentic-qe', agents: ['test-strategist', 'coverage-analyzer', 'defect-predictor', 'chaos-engineer'], maxConcurrent: 4 },
    { name: 'security', source: 'claude-code-v3', agents: ['security-architect', 'sast-scanner', 'compliance-auditor'], maxConcurrent: 2 },
    { name: 'learning', source: 'shared', agents: ['sona-optimizer', 'reasoning-bank-manager', 'cross-project-transfer'], maxConcurrent: 2 },
    { name: 'coordination', source: 'shared', agents: ['unified-coordinator', 'event-bridge'], maxConcurrent: 1 },
  ],
  learning: {
    sonaMode: 'balanced',
    reasoningBankEnabled: true,
    dreamCyclesEnabled: true,
    qLearning: {
      coverageOptimization: true,
      stateDimensions: 12,
      learningRate: 0.01,
      discountFactor: 0.99,
      explorationRate: 0.1,
    },
  },
  modelRouting: {
    complexityThresholds: {
      haiku: [0, 20],
      sonnet: [20, 70],
      opus: [70, 100],
    },
    flashAttention: true,
    tokenReductionTarget: 0.75,
    confidenceEscalationThreshold: 0.6,
    multiModelVotingThreshold: 0.85,
  },
  qualityGates: {
    coverageMinimum: 85,
    securityScanRequired: true,
    accessibilityLevel: 'AA',
    chaosValidation: true,
    contractValidation: true,
    defectPredictionThreshold: 0.3,
  },
  hooks: {
    preBuild: ['analyze_requirements', 'retrieve_similar_patterns', 'select_optimal_topology'],
    duringDevelopment: ['parallel_test_generation', 'continuous_coverage_analysis', 'real_time_defect_prediction'],
    preDeployment: ['quality_gate_enforcement', 'contract_validation', 'chaos_resilience_check'],
    postDeployment: ['pattern_persistence', 'learning_consolidation', 'cross_project_transfer'],
  },
};

// ============================================================================
// Build with Quality Skill
// ============================================================================

export class BuildWithQualitySkill implements ISkill {
  readonly name = '@claude-flow/build-with-quality-skill';
  readonly version = '1.0.0';

  private coordinator: QueenCoordinator;
  private memory: UnifiedMemory;
  private eventBus: EventBus;
  private modelRouter: TinyDancerRouter;
  private qualityGate: QualityGate;
  private workflowOrchestrator: BuildWithQualityOrchestrator;
  private agentFactory: AgentFactory;

  private config: SwarmConfig;
  private initialized = false;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };

    // Initialize components
    this.coordinator = new QueenCoordinator(this.config.id);
    this.memory = new UnifiedMemory({
      sonaMode: this.config.learning.sonaMode,
    });
    this.eventBus = new EventBus();
    this.modelRouter = new TinyDancerRouter(this.config.modelRouting);
    this.qualityGate = new QualityGate();
    this.workflowOrchestrator = new BuildWithQualityOrchestrator();
    this.agentFactory = new AgentFactory();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize components
    await this.coordinator.initialize(this.config);
    await this.memory.initialize();
    await this.modelRouter.initialize();
    await this.qualityGate.initialize(this.config.qualityGates);
    await this.workflowOrchestrator.initialize(this.coordinator, this.memory);

    // Connect components
    this.workflowOrchestrator.setEventBus(this.eventBus);
    this.workflowOrchestrator.setModelRouter(this.modelRouter);
    this.workflowOrchestrator.setQualityGate(this.qualityGate);

    // Set up cross-domain event bridges
    this.setupEventBridges();

    // Spawn initial agents
    await this.spawnInitialAgents();

    this.initialized = true;

    console.log(`✓ ${this.name} v${this.version} initialized`);
    console.log(`  - Agents: ${this.coordinator.listAgents().length}/${this.config.maxAgents}`);
    console.log(`  - Topology: ${this.config.topology}`);
    console.log(`  - SONA Mode: ${this.config.learning.sonaMode}`);
    console.log(`  - Flash Attention: ${this.config.modelRouting.flashAttention ? 'enabled' : 'disabled'}`);
  }

  async shutdown(): Promise<void> {
    await this.coordinator.shutdown();
    await this.memory.shutdown();
    this.initialized = false;
  }

  // ============================================================================
  // Main Execution
  // ============================================================================

  async execute(context: SkillContext): Promise<SkillResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`\n▶ Executing "Build with Quality" workflow`);
    console.log(`  Project: ${context.projectPath}`);
    console.log(`  Requirements: ${context.requirements.slice(0, 100)}...`);

    const result = await this.workflowOrchestrator.executeBuildWithQuality(context);

    console.log(`\n${result.success ? '✓' : '✗'} Workflow ${result.success ? 'completed' : 'failed'}`);
    console.log(`  - Duration: ${result.metrics.totalDuration}ms`);
    console.log(`  - Tests Generated: ${result.metrics.testsGenerated}`);
    console.log(`  - Coverage: ${result.metrics.coverageAchieved}%`);
    console.log(`  - Defects Prevented: ${result.metrics.defectsPrevented}`);
    console.log(`  - Tokens Saved: ${result.metrics.tokensSaved}`);
    console.log(`  - Quality Score: ${result.qualityReport.overallScore.toFixed(1)}/100`);

    return result;
  }

  // ============================================================================
  // Component Access
  // ============================================================================

  getCoordinator(): ICoordinator {
    return this.coordinator;
  }

  getMemory(): IMemory {
    return this.memory;
  }

  getEventBus(): IEventBus {
    return this.eventBus;
  }

  getModelRouter(): IModelRouter {
    return this.modelRouter;
  }

  getQualityGate(): IQualityGate {
    return this.qualityGate;
  }

  getWorkflowOrchestrator(): IWorkflowOrchestrator {
    return this.workflowOrchestrator;
  }

  getAgentFactory(): AgentFactory {
    return this.agentFactory;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): {
    agents: { total: number; byDomain: Record<string, number>; bySource: Record<string, number> };
    memory: { totalPatterns: number; searchLatency: number };
    routing: { totalDecisions: number; tokensSaved: number };
    swarm: { healthy: boolean; activeTaskCount: number };
  } {
    return {
      agents: this.agentFactory.getStats(),
      memory: this.memory.getStats(),
      routing: this.modelRouter.getRoutingStats(),
      swarm: this.coordinator.getSwarmStatus(),
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventBridges(): void {
    // Bridge V3 code events to QE test generation
    this.eventBus.bridge('code:written', 'test:generated', (event) => ({
      ...event,
      payload: { ...event.payload as object, trigger: 'code-change' },
    }));

    // Bridge coverage gaps to development
    this.eventBus.bridge('coverage:gap-detected', 'task:created', (event) => ({
      ...event,
      payload: { ...event.payload as object, type: 'implementation' },
    }));

    // Correlate test generation with coverage analysis
    this.eventBus.correlate(
      ['test:generated', 'coverage:gap-detected'],
      async (events) => {
        console.log('Correlated events:', events.map((e) => e.type));
      }
    );
  }

  private async spawnInitialAgents(): Promise<void> {
    for (const domainConfig of this.config.domains) {
      for (const agentName of domainConfig.agents) {
        try {
          const agent = this.agentFactory.createAgent(agentName);
          await this.coordinator.registerAgent(agent);
        } catch (error) {
          console.warn(`Could not spawn agent ${agentName}:`, error);
        }
      }
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new Build with Quality skill instance
 */
export function createBuildWithQualitySkill(
  config?: Partial<SwarmConfig>
): BuildWithQualitySkill {
  return new BuildWithQualitySkill(config);
}

/**
 * Quick start: Create and initialize the skill
 */
export async function initializeBuildWithQualitySkill(
  config?: Partial<SwarmConfig>
): Promise<BuildWithQualitySkill> {
  const skill = createBuildWithQualitySkill(config);
  await skill.initialize();
  return skill;
}

/**
 * Execute a build with quality workflow
 */
export async function buildWithQuality(
  projectPath: string,
  requirements: string,
  config?: Partial<SwarmConfig>
): Promise<SkillResult> {
  const skill = await initializeBuildWithQualitySkill(config);

  const context: SkillContext = {
    sessionId: `session_${Date.now()}` as SessionId,
    projectPath,
    requirements,
    config: skill['config'],
  };

  try {
    return await skill.execute(context);
  } finally {
    await skill.shutdown();
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default BuildWithQualitySkill;

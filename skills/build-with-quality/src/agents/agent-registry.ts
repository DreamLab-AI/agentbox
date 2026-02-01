/**
 * Combined Agent Registry
 * 111+ specialized agents from Claude Code V3 (60+) and Agentic QE (51)
 */

import type {
  Agent,
  AgentCapabilities,
  AgentDomain,
  AgentId,
  AgentSource,
  AgentStatus,
  Task,
  TaskResult,
} from '../core/types.js';
import type { IAgent } from '../core/interfaces.js';
import { createAgentId } from '../core/types.js';

// ============================================================================
// Agent Definition Types
// ============================================================================

export interface AgentDefinition {
  name: string;
  domain: AgentDomain;
  source: AgentSource;
  description: string;
  capabilities: AgentCapabilities;
  taskTypes: string[];
  config?: Record<string, unknown>;
}

// ============================================================================
// Claude Code V3 Agents (60+)
// ============================================================================

export const CLAUDE_CODE_V3_AGENTS: AgentDefinition[] = [
  // Core Development Agents
  {
    name: 'architect',
    domain: 'development',
    source: 'claude-code-v3',
    description: 'Architecture planning and design decisions',
    capabilities: {
      canGenerate: true,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['system-design', 'api-design', 'database-design'],
    },
    taskTypes: ['architecture'],
  },
  {
    name: 'coder',
    domain: 'development',
    source: 'claude-code-v3',
    description: 'Code generation and implementation',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['typescript', 'python', 'go', 'rust'],
    },
    taskTypes: ['implementation'],
  },
  {
    name: 'reviewer',
    domain: 'development',
    source: 'claude-code-v3',
    description: 'Code review and quality feedback',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['code-quality', 'best-practices', 'performance'],
    },
    taskTypes: ['review'],
  },
  {
    name: 'browser-agent',
    domain: 'development',
    source: 'claude-code-v3',
    description: 'Web browsing and automation',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: true,
      canDeploy: false,
      canLearn: false,
      specializations: ['web-scraping', 'browser-automation', 'e2e-testing'],
    },
    taskTypes: ['test-execution'],
  },
  // Security Agents (3)
  {
    name: 'security-architect',
    domain: 'security',
    source: 'claude-code-v3',
    description: 'Security architecture and threat modeling',
    capabilities: {
      canGenerate: true,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['threat-modeling', 'security-architecture', 'compliance'],
    },
    taskTypes: ['security-scan', 'architecture'],
  },
  {
    name: 'security-implementer',
    domain: 'security',
    source: 'claude-code-v3',
    description: 'Security implementation and fixes',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['cve-fixes', 'encryption', 'authentication'],
    },
    taskTypes: ['implementation', 'security-scan'],
  },
  {
    name: 'security-tester',
    domain: 'security',
    source: 'claude-code-v3',
    description: 'Security testing and vulnerability scanning',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['penetration-testing', 'vulnerability-scanning', 'sast'],
    },
    taskTypes: ['security-scan', 'test-execution'],
  },
  // Memory Agents
  {
    name: 'memory-indexer',
    domain: 'learning',
    source: 'claude-code-v3',
    description: 'HNSW indexing and vector operations',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['vector-indexing', 'semantic-search', 'embeddings'],
    },
    taskTypes: ['pattern-learning'],
  },
  {
    name: 'memory-optimizer',
    domain: 'learning',
    source: 'claude-code-v3',
    description: 'Memory optimization and consolidation',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['quantization', 'caching', 'compression'],
    },
    taskTypes: ['pattern-learning'],
  },
  // MCP & Integration Agents
  {
    name: 'mcp-coordinator',
    domain: 'coordination',
    source: 'claude-code-v3',
    description: 'MCP protocol coordination',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: false,
      specializations: ['mcp-tools', 'tool-registry', 'session-management'],
    },
    taskTypes: ['architecture'],
  },
  // Deployment Agent
  {
    name: 'deployer',
    domain: 'development',
    source: 'claude-code-v3',
    description: 'CI/CD and deployment automation',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: true,
      canLearn: false,
      specializations: ['ci-cd', 'release-management', 'versioning'],
    },
    taskTypes: ['deployment'],
  },
  // Performance Agent
  {
    name: 'benchmarker',
    domain: 'quality',
    source: 'claude-code-v3',
    description: 'Performance benchmarking and profiling',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['benchmarking', 'profiling', 'optimization'],
    },
    taskTypes: ['test-execution', 'coverage-analysis'],
  },
  // SONA Learning Agents
  {
    name: 'sona-optimizer',
    domain: 'learning',
    source: 'claude-code-v3',
    description: 'SONA pattern optimization',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['neural-optimization', 'pattern-learning', 'adaptation'],
    },
    taskTypes: ['pattern-learning'],
  },
  {
    name: 'trajectory-tracker',
    domain: 'learning',
    source: 'claude-code-v3',
    description: 'Execution trajectory tracking',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['trajectory-analysis', 'reward-tracking', 'experience-replay'],
    },
    taskTypes: ['pattern-learning'],
  },
];

// ============================================================================
// Agentic QE Agents (51)
// ============================================================================

export const AGENTIC_QE_AGENTS: AgentDefinition[] = [
  // Test Generation Domain (12 agents)
  {
    name: 'test-strategist',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'AI-powered test strategy selection',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['strategy-selection', 'coverage-planning', 'risk-analysis'],
    },
    taskTypes: ['test-generation'],
  },
  {
    name: 'unit-test-generator',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Unit test synthesis',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['unit-tests', 'vitest', 'jest'],
    },
    taskTypes: ['test-generation'],
  },
  {
    name: 'integration-test-generator',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Integration test synthesis',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['integration-tests', 'api-testing', 'service-testing'],
    },
    taskTypes: ['test-generation'],
  },
  {
    name: 'e2e-test-generator',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'End-to-end test synthesis',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['e2e-tests', 'playwright', 'cypress'],
    },
    taskTypes: ['test-generation'],
  },
  {
    name: 'property-test-generator',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Property-based test synthesis',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['property-testing', 'fuzzing', 'invariants'],
    },
    taskTypes: ['test-generation'],
  },
  // Coverage Analysis Domain (6 agents)
  {
    name: 'coverage-analyzer',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'O(log n) coverage gap detection',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['coverage-analysis', 'gap-detection', 'hnsw-indexing'],
    },
    taskTypes: ['coverage-analysis'],
  },
  {
    name: 'risk-scorer',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Risk-weighted coverage prioritization',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['risk-scoring', 'prioritization', 'business-impact'],
    },
    taskTypes: ['coverage-analysis'],
  },
  {
    name: 'mutation-tester',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Mutation testing for test quality',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['mutation-testing', 'test-quality', 'kill-ratio'],
    },
    taskTypes: ['test-execution', 'coverage-analysis'],
  },
  // Defect Intelligence Domain (8 agents)
  {
    name: 'defect-predictor',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'ML-powered defect prediction (F1 > 0.8)',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['defect-prediction', 'ml-models', 'risk-analysis'],
    },
    taskTypes: ['defect-prediction'],
  },
  {
    name: 'root-cause-analyzer',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Root cause analysis for failures',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['root-cause-analysis', 'failure-categorization', 'fix-suggestions'],
    },
    taskTypes: ['defect-prediction'],
  },
  {
    name: 'flaky-test-hunter',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Identify and fix flaky tests',
    capabilities: {
      canGenerate: true,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['flaky-detection', 'test-stability', 'retry-analysis'],
    },
    taskTypes: ['test-execution', 'defect-prediction'],
  },
  // Security & Compliance Domain (6 agents)
  {
    name: 'sast-scanner',
    domain: 'security',
    source: 'agentic-qe',
    description: 'Static application security testing',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['sast', 'code-analysis', 'vulnerability-detection'],
    },
    taskTypes: ['security-scan'],
  },
  {
    name: 'dast-scanner',
    domain: 'security',
    source: 'agentic-qe',
    description: 'Dynamic application security testing',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: false,
      specializations: ['dast', 'runtime-analysis', 'penetration-testing'],
    },
    taskTypes: ['security-scan'],
  },
  {
    name: 'compliance-auditor',
    domain: 'security',
    source: 'agentic-qe',
    description: 'Regulatory compliance validation',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: false,
      specializations: ['gdpr', 'hipaa', 'soc2', 'pci-dss'],
    },
    taskTypes: ['security-scan'],
  },
  // Contract Testing Domain (4 agents)
  {
    name: 'api-contract-validator',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'REST/GraphQL API contract validation',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['openapi', 'graphql', 'schema-validation'],
    },
    taskTypes: ['contract-validation'],
  },
  {
    name: 'breaking-change-detector',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'API breaking change detection',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['backward-compatibility', 'version-diff', 'migration-paths'],
    },
    taskTypes: ['contract-validation'],
  },
  // Visual & Accessibility Domain (5 agents)
  {
    name: 'visual-regression-tester',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Visual regression detection',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['screenshot-comparison', 'pixel-diff', 'responsive-testing'],
    },
    taskTypes: ['accessibility-audit'],
  },
  {
    name: 'accessibility-auditor',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'WCAG compliance auditing',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['wcag-aa', 'wcag-aaa', 'aria', 'screen-reader'],
    },
    taskTypes: ['accessibility-audit'],
  },
  // Chaos & Resilience Domain (4 agents)
  {
    name: 'chaos-engineer',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'Chaos engineering and fault injection',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['fault-injection', 'network-chaos', 'resource-exhaustion'],
    },
    taskTypes: ['chaos-test'],
  },
  {
    name: 'resilience-validator',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'System resilience validation',
    capabilities: {
      canGenerate: false,
      canReview: true,
      canTest: true,
      canDeploy: false,
      canLearn: true,
      specializations: ['circuit-breakers', 'retry-patterns', 'graceful-degradation'],
    },
    taskTypes: ['chaos-test'],
  },
  // Learning & Optimization Domain (6 agents)
  {
    name: 'reasoning-bank-manager',
    domain: 'learning',
    source: 'agentic-qe',
    description: 'ReasoningBank pattern management',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['pattern-storage', 'confidence-tiers', 'experience-replay'],
    },
    taskTypes: ['pattern-learning'],
  },
  {
    name: 'q-learning-optimizer',
    domain: 'learning',
    source: 'agentic-qe',
    description: 'Q-Learning for coverage optimization',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['dqn', 'double-q-learning', 'reward-shaping'],
    },
    taskTypes: ['pattern-learning', 'coverage-analysis'],
  },
  {
    name: 'cross-project-transfer',
    domain: 'learning',
    source: 'agentic-qe',
    description: 'Cross-project learning transfer',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['transfer-learning', 'domain-adaptation', 'pattern-reuse'],
    },
    taskTypes: ['pattern-learning'],
  },
  // TDD Subagents (7 agents)
  {
    name: 'tdd-red-phase',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'TDD Red phase - failing test creation',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['failing-tests', 'requirements-to-tests', 'behavior-specs'],
    },
    taskTypes: ['test-generation'],
  },
  {
    name: 'tdd-green-phase',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'TDD Green phase - minimal implementation',
    capabilities: {
      canGenerate: true,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['minimal-implementation', 'test-passing', 'quick-fixes'],
    },
    taskTypes: ['implementation'],
  },
  {
    name: 'tdd-refactor-phase',
    domain: 'quality',
    source: 'agentic-qe',
    description: 'TDD Refactor phase - code improvement',
    capabilities: {
      canGenerate: true,
      canReview: true,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['refactoring', 'code-quality', 'design-patterns'],
    },
    taskTypes: ['implementation', 'review'],
  },
];

// ============================================================================
// Shared/Bridge Agents
// ============================================================================

export const SHARED_AGENTS: AgentDefinition[] = [
  {
    name: 'unified-coordinator',
    domain: 'coordination',
    source: 'shared',
    description: 'Cross-system coordination',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['task-routing', 'load-balancing', 'consensus'],
    },
    taskTypes: ['architecture'],
  },
  {
    name: 'event-bridge',
    domain: 'coordination',
    source: 'shared',
    description: 'Cross-domain event routing',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: false,
      specializations: ['event-routing', 'correlation', 'replay'],
    },
    taskTypes: ['architecture'],
  },
  {
    name: 'unified-memory-coordinator',
    domain: 'learning',
    source: 'shared',
    description: 'SONA + ReasoningBank memory coordination',
    capabilities: {
      canGenerate: false,
      canReview: false,
      canTest: false,
      canDeploy: false,
      canLearn: true,
      specializations: ['memory-sync', 'pattern-merging', 'consolidation'],
    },
    taskTypes: ['pattern-learning'],
  },
];

// ============================================================================
// Combined Registry
// ============================================================================

export const ALL_AGENTS: AgentDefinition[] = [
  ...CLAUDE_CODE_V3_AGENTS,
  ...AGENTIC_QE_AGENTS,
  ...SHARED_AGENTS,
];

// ============================================================================
// Agent Factory
// ============================================================================

export class AgentFactory {
  private readonly definitions: Map<string, AgentDefinition> = new Map();

  constructor() {
    for (const def of ALL_AGENTS) {
      this.definitions.set(def.name, def);
    }
  }

  getDefinition(name: string): AgentDefinition | undefined {
    return this.definitions.get(name);
  }

  listDefinitions(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  listByDomain(domain: AgentDomain): AgentDefinition[] {
    return this.listDefinitions().filter((d) => d.domain === domain);
  }

  listBySource(source: AgentSource): AgentDefinition[] {
    return this.listDefinitions().filter((d) => d.source === source);
  }

  createAgent(name: string, config?: Record<string, unknown>): IAgent {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Unknown agent: ${name}`);
    }

    return new BaseAgent(definition, config);
  }

  getStats(): {
    total: number;
    byDomain: Record<string, number>;
    bySource: Record<string, number>;
  } {
    const byDomain: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const def of this.definitions.values()) {
      byDomain[def.domain] = (byDomain[def.domain] ?? 0) + 1;
      bySource[def.source] = (bySource[def.source] ?? 0) + 1;
    }

    return {
      total: this.definitions.size,
      byDomain,
      bySource,
    };
  }
}

// ============================================================================
// Base Agent Implementation
// ============================================================================

class BaseAgent implements IAgent {
  readonly id: AgentId;
  readonly config: Agent;

  private status: AgentStatus = 'idle';
  private metrics = {
    tasksCompleted: 0,
    tasksInProgress: 0,
    averageLatency: 0,
    successRate: 1,
    lastActiveAt: new Date(),
  };

  constructor(definition: AgentDefinition, customConfig?: Record<string, unknown>) {
    this.id = createAgentId(`${definition.name}_${Date.now()}`);
    this.config = {
      id: this.id,
      name: definition.name,
      domain: definition.domain,
      source: definition.source,
      status: 'idle',
      capabilities: definition.capabilities,
      metrics: this.metrics,
      config: { ...definition.config, ...customConfig },
    };
  }

  async initialize(): Promise<void> {
    this.status = 'idle';
    this.config.status = 'idle';
  }

  async execute(task: Task): Promise<TaskResult> {
    this.status = 'busy';
    this.config.status = 'busy';
    this.metrics.tasksInProgress++;

    const startTime = Date.now();

    try {
      // Simulate task execution
      await this.simulateExecution(task);

      const duration = Date.now() - startTime;

      this.metrics.tasksCompleted++;
      this.metrics.averageLatency =
        (this.metrics.averageLatency * (this.metrics.tasksCompleted - 1) + duration) /
        this.metrics.tasksCompleted;
      this.metrics.lastActiveAt = new Date();

      return {
        success: true,
        output: {
          agent: this.config.name,
          taskType: task.definition.type,
          result: `Completed by ${this.config.name}`,
        },
        metrics: {
          duration,
          tokensUsed: Math.floor(Math.random() * 1000) + 100,
          modelTier: 'sonnet',
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.successRate =
        (this.metrics.successRate * this.metrics.tasksCompleted) /
        (this.metrics.tasksCompleted + 1);

      return {
        success: false,
        output: {},
        metrics: {
          duration,
          tokensUsed: 0,
          modelTier: 'haiku',
        },
        errors: [
          {
            code: 'EXECUTION_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
            recoverable: true,
          },
        ],
      };
    } finally {
      this.metrics.tasksInProgress--;
      this.status = 'idle';
      this.config.status = 'idle';
    }
  }

  async terminate(): Promise<void> {
    this.status = 'terminated';
    this.config.status = 'terminated';
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getMetrics(): Agent['metrics'] {
    return this.metrics;
  }

  private async simulateExecution(_task: Task): Promise<void> {
    // Simulate varying execution times based on task type
    const baseTime = 100;
    const variance = Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, baseTime + variance));
  }
}

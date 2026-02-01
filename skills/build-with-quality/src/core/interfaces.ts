/**
 * Core interfaces for the combined skill
 */

import type {
  Agent,
  AgentId,
  Event,
  EventHandler,
  EventType,
  MemoryQuery,
  MemorySearchResult,
  Pattern,
  PatternId,
  QualityGateConfig,
  QualityGateResult,
  RoutingDecision,
  SkillContext,
  SkillResult,
  SwarmConfig,
  SwarmId,
  Task,
  TaskDefinition,
  TaskId,
  TaskPriority,
  TaskResult,
} from './types.js';

// ============================================================================
// Agent Interface
// ============================================================================

export interface IAgent {
  readonly id: AgentId;
  readonly config: Agent;

  initialize(): Promise<void>;
  execute(task: Task): Promise<TaskResult>;
  terminate(): Promise<void>;
  getStatus(): Agent['status'];
  getMetrics(): Agent['metrics'];
}

// ============================================================================
// Coordinator Interface (Queen Coordinator)
// ============================================================================

export interface ICoordinator {
  readonly swarmId: SwarmId;

  initialize(config: SwarmConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Agent Management
  registerAgent(agent: IAgent): Promise<void>;
  unregisterAgent(agentId: AgentId): Promise<void>;
  getAgent(agentId: AgentId): IAgent | undefined;
  listAgents(): IAgent[];

  // Task Management
  submitTask(definition: TaskDefinition, priority?: TaskPriority): Promise<TaskId>;
  cancelTask(taskId: TaskId): Promise<boolean>;
  getTaskStatus(taskId: TaskId): Task | undefined;
  awaitTask(taskId: TaskId): Promise<TaskResult>;

  // Swarm Operations
  getSwarmStatus(): SwarmStatus;
  scaleAgents(domain: string, count: number): Promise<void>;

  // Consensus
  proposeDecision(proposal: ConsensusProposal): Promise<ConsensusResult>;
}

export interface SwarmStatus {
  id: SwarmId;
  healthy: boolean;
  agentCount: number;
  activeTaskCount: number;
  queuedTaskCount: number;
  averageLatency: number;
  throughput: number;
}

export interface ConsensusProposal {
  type: 'task-assignment' | 'resource-allocation' | 'quality-decision';
  payload: Record<string, unknown>;
  requiredQuorum: number;
}

export interface ConsensusResult {
  approved: boolean;
  votes: { agentId: AgentId; vote: boolean; reasoning?: string }[];
  finalDecision: Record<string, unknown>;
}

// ============================================================================
// Memory Interface (Unified SONA + ReasoningBank)
// ============================================================================

export interface IMemory {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Pattern Storage
  storePattern(pattern: Omit<Pattern, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<PatternId>;
  getPattern(id: PatternId): Promise<Pattern | undefined>;
  updatePattern(id: PatternId, updates: Partial<Pattern>): Promise<void>;
  deletePattern(id: PatternId): Promise<boolean>;

  // Search (HNSW-powered)
  search(query: MemoryQuery): Promise<MemorySearchResult[]>;
  semanticSearch(text: string, limit?: number): Promise<MemorySearchResult[]>;

  // Learning Operations
  recordSuccess(patternId: PatternId): Promise<void>;
  recordFailure(patternId: PatternId): Promise<void>;
  consolidatePatterns(): Promise<number>; // Dream Cycles

  // Statistics
  getStats(): MemoryStats;
}

export interface MemoryStats {
  totalPatterns: number;
  patternsByType: Record<string, number>;
  patternsByTier: Record<string, number>;
  averageConfidence: number;
  searchLatency: number;
}

// ============================================================================
// Event Bus Interface
// ============================================================================

export interface IEventBus {
  emit<T>(event: Event<T>): Promise<void>;
  on<T>(type: EventType | string, handler: EventHandler<T>): () => void;
  once<T>(type: EventType | string, handler: EventHandler<T>): () => void;
  off(type: EventType | string, handler: EventHandler): void;
  waitFor<T>(type: EventType | string, timeout?: number): Promise<Event<T>>;
}

// ============================================================================
// Model Router Interface (TinyDancer)
// ============================================================================

export interface IModelRouter {
  initialize(): Promise<void>;

  // Routing
  route(task: TaskDefinition): Promise<RoutingDecision>;
  escalate(currentTier: RoutingDecision, reason: string): Promise<RoutingDecision>;

  // Metrics
  recordOutcome(decision: RoutingDecision, success: boolean, quality: number): Promise<void>;
  getRoutingStats(): RoutingStats;
}

export interface RoutingStats {
  totalDecisions: number;
  tierDistribution: Record<string, number>;
  averageConfidence: number;
  escalationRate: number;
  tokensSaved: number;
}

// ============================================================================
// Quality Gate Interface
// ============================================================================

export interface IQualityGate {
  initialize(config: QualityGateConfig): Promise<void>;

  // Gate Checks
  checkAll(context: QualityContext): Promise<QualityGateResult>;
  checkCoverage(context: QualityContext): Promise<QualityGateResult>;
  checkSecurity(context: QualityContext): Promise<QualityGateResult>;
  checkAccessibility(context: QualityContext): Promise<QualityGateResult>;
  checkContracts(context: QualityContext): Promise<QualityGateResult>;
  checkChaos(context: QualityContext): Promise<QualityGateResult>;

  // Defect Prediction
  predictDefects(context: QualityContext): Promise<DefectPrediction[]>;
}

export interface QualityContext {
  projectPath: string;
  sourceFiles: string[];
  testFiles: string[];
  coverageReport?: CoverageReport;
  securityReport?: SecurityReport;
}

export interface CoverageReport {
  overall: number;
  byFile: Record<string, number>;
  uncoveredLines: { file: string; lines: number[] }[];
  uncoveredBranches: { file: string; branches: string[] }[];
}

export interface SecurityReport {
  vulnerabilities: Vulnerability[];
  complianceScore: number;
  recommendations: string[];
}

export interface Vulnerability {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  file: string;
  line: number;
  description: string;
  fix?: string;
}

export interface DefectPrediction {
  file: string;
  probability: number;
  riskFactors: string[];
  suggestedAction: string;
}

// ============================================================================
// Workflow Orchestrator Interface
// ============================================================================

export interface IWorkflowOrchestrator {
  initialize(coordinator: ICoordinator, memory: IMemory): Promise<void>;

  // Workflow Execution
  executeBuildWithQuality(context: SkillContext): Promise<SkillResult>;

  // Phase Execution
  executeRequirementsPhase(context: SkillContext): Promise<PhaseResult>;
  executeDevelopmentPhase(context: SkillContext): Promise<PhaseResult>;
  executeQualityPhase(context: SkillContext): Promise<PhaseResult>;
  executeDeploymentPhase(context: SkillContext): Promise<PhaseResult>;
  executeLearningPhase(context: SkillContext): Promise<PhaseResult>;

  // Hooks
  registerHook(phase: string, hook: WorkflowHook): void;
  unregisterHook(phase: string, hookId: string): void;
}

export interface PhaseResult {
  phase: string;
  success: boolean;
  duration: number;
  artifacts: string[];
  metrics: Record<string, number>;
  errors?: string[];
}

export type WorkflowHook = (context: SkillContext) => Promise<void>;

// ============================================================================
// Skill Interface
// ============================================================================

export interface ISkill {
  readonly name: string;
  readonly version: string;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  execute(context: SkillContext): Promise<SkillResult>;

  // Component Access
  getCoordinator(): ICoordinator;
  getMemory(): IMemory;
  getEventBus(): IEventBus;
  getModelRouter(): IModelRouter;
  getQualityGate(): IQualityGate;
  getWorkflowOrchestrator(): IWorkflowOrchestrator;
}

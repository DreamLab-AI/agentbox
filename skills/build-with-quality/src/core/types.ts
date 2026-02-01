/**
 * Core type definitions for the Claude Code V3 + Agentic QE combined skill
 */

// ============================================================================
// Identifiers
// ============================================================================

export type AgentId = string & { readonly __brand: 'AgentId' };
export type SwarmId = string & { readonly __brand: 'SwarmId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type PatternId = string & { readonly __brand: 'PatternId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

export function createAgentId(id: string): AgentId {
  return id as AgentId;
}

export function createSwarmId(id: string): SwarmId {
  return id as SwarmId;
}

export function createTaskId(id: string): TaskId {
  return id as TaskId;
}

export function createPatternId(id: string): PatternId {
  return id as PatternId;
}

// ============================================================================
// Agent Types and States
// ============================================================================

export type AgentDomain =
  | 'development'
  | 'quality'
  | 'security'
  | 'learning'
  | 'coordination';

export type AgentSource = 'claude-code-v3' | 'agentic-qe' | 'shared';

export type AgentStatus = 'idle' | 'active' | 'busy' | 'error' | 'terminated';

export interface AgentCapabilities {
  canGenerate: boolean;
  canReview: boolean;
  canTest: boolean;
  canDeploy: boolean;
  canLearn: boolean;
  specializations: string[];
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksInProgress: number;
  averageLatency: number;
  successRate: number;
  lastActiveAt: Date;
}

export interface Agent {
  id: AgentId;
  name: string;
  domain: AgentDomain;
  source: AgentSource;
  status: AgentStatus;
  capabilities: AgentCapabilities;
  metrics: AgentMetrics;
  config: Record<string, unknown>;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskType =
  | 'architecture'
  | 'implementation'
  | 'review'
  | 'test-generation'
  | 'test-execution'
  | 'coverage-analysis'
  | 'security-scan'
  | 'deployment'
  | 'chaos-test'
  | 'contract-validation'
  | 'accessibility-audit'
  | 'defect-prediction'
  | 'pattern-learning';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskDefinition {
  type: TaskType;
  description: string;
  input: Record<string, unknown>;
  expectedOutput?: Record<string, unknown>;
  constraints?: TaskConstraints;
}

export interface TaskConstraints {
  maxDuration?: number;
  requiredCoverage?: number;
  securityLevel?: 'basic' | 'standard' | 'strict';
  qualityGate?: QualityGateConfig;
}

export interface Task {
  id: TaskId;
  definition: TaskDefinition;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgent?: AgentId;
  result?: TaskResult;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskResult {
  success: boolean;
  output: Record<string, unknown>;
  metrics: TaskMetrics;
  errors?: TaskError[];
}

export interface TaskMetrics {
  duration: number;
  tokensUsed: number;
  modelTier: ModelTier;
  coverageAchieved?: number;
  qualityScore?: number;
}

export interface TaskError {
  code: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

// ============================================================================
// Model Routing (TinyDancer)
// ============================================================================

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelRoutingConfig {
  complexityThresholds: {
    haiku: [number, number];
    sonnet: [number, number];
    opus: [number, number];
  };
  flashAttention: boolean;
  tokenReductionTarget: number;
  confidenceEscalationThreshold: number;
  multiModelVotingThreshold: number;
}

export interface RoutingDecision {
  selectedTier: ModelTier;
  complexity: number;
  confidence: number;
  reasoning: string;
  fallbackChain: ModelTier[];
}

// ============================================================================
// Quality Gates
// ============================================================================

export interface QualityGateConfig {
  coverageMinimum: number;
  securityScanRequired: boolean;
  accessibilityLevel: 'A' | 'AA' | 'AAA';
  chaosValidation: boolean;
  contractValidation: boolean;
  defectPredictionThreshold: number;
}

export interface QualityGateResult {
  passed: boolean;
  gates: QualityGateCheck[];
  overallScore: number;
  recommendations: string[];
}

export interface QualityGateCheck {
  name: string;
  passed: boolean;
  score: number;
  threshold: number;
  details: Record<string, unknown>;
}

// ============================================================================
// Memory and Learning
// ============================================================================

export type SONAMode = 'real-time' | 'balanced' | 'research' | 'edge' | 'batch';

export type ConfidenceTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Pattern {
  id: PatternId;
  type: PatternType;
  content: Record<string, unknown>;
  embedding: number[];
  confidence: number;
  confidenceTier: ConfidenceTier;
  source: AgentSource;
  usageCount: number;
  successRate: number;
  createdAt: Date;
  lastUsedAt: Date;
}

export type PatternType =
  | 'test-strategy'
  | 'code-structure'
  | 'architecture'
  | 'security-fix'
  | 'coverage-strategy'
  | 'defect-pattern'
  | 'workflow';

export interface MemoryQuery {
  text?: string;
  embedding?: number[];
  type?: PatternType;
  minConfidence?: number;
  limit?: number;
}

export interface MemorySearchResult {
  pattern: Pattern;
  similarity: number;
  relevanceScore: number;
}

// ============================================================================
// Events
// ============================================================================

export type EventType =
  | 'agent:spawned'
  | 'agent:terminated'
  | 'task:created'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'quality:gate-checked'
  | 'quality:gate-passed'
  | 'quality:gate-failed'
  | 'coverage:gap-detected'
  | 'coverage:gap-filled'
  | 'learning:pattern-stored'
  | 'learning:pattern-retrieved'
  | 'code:written'
  | 'test:generated'
  | 'test:executed'
  | 'security:scan-completed'
  | 'deployment:started'
  | 'deployment:completed';

export interface Event<T = unknown> {
  id: string;
  type: EventType;
  payload: T;
  source: AgentId | 'system';
  timestamp: Date;
  correlationId?: string;
}

export type EventHandler<T = unknown> = (event: Event<T>) => Promise<void>;

// ============================================================================
// Swarm Configuration
// ============================================================================

export type SwarmTopology =
  | 'hierarchical-mesh'
  | 'full-mesh'
  | 'strict-hierarchical'
  | 'centralized';

export interface SwarmConfig {
  id: SwarmId;
  topology: SwarmTopology;
  maxAgents: number;
  domains: DomainConfig[];
  learning: LearningConfig;
  modelRouting: ModelRoutingConfig;
  qualityGates: QualityGateConfig;
  hooks: HooksConfig;
}

export interface DomainConfig {
  name: AgentDomain;
  source: AgentSource;
  agents: string[];
  maxConcurrent: number;
}

export interface LearningConfig {
  sonaMode: SONAMode;
  reasoningBankEnabled: boolean;
  dreamCyclesEnabled: boolean;
  qLearning: QLearningConfig;
}

export interface QLearningConfig {
  coverageOptimization: boolean;
  stateDimensions: number;
  learningRate: number;
  discountFactor: number;
  explorationRate: number;
}

export interface HooksConfig {
  preBuild: string[];
  duringDevelopment: string[];
  preDeployment: string[];
  postDeployment: string[];
}

// ============================================================================
// Skill Interface
// ============================================================================

export interface SkillContext {
  sessionId: SessionId;
  projectPath: string;
  requirements: string;
  config: Partial<SwarmConfig>;
}

export interface SkillResult {
  success: boolean;
  artifacts: Artifact[];
  metrics: SkillMetrics;
  qualityReport: QualityGateResult;
  learningsStored: number;
}

export interface Artifact {
  type: 'code' | 'test' | 'config' | 'documentation' | 'report';
  path: string;
  content?: string;
  metadata: Record<string, unknown>;
}

export interface SkillMetrics {
  totalDuration: number;
  agentsUsed: number;
  tasksCompleted: number;
  tokensUsed: number;
  tokensSaved: number;
  coverageAchieved: number;
  testsGenerated: number;
  defectsFound: number;
  defectsPrevented: number;
}

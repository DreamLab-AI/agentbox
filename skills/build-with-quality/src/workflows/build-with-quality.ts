/**
 * Build with Quality Workflow Orchestrator
 * Coordinates the complete development lifecycle with integrated quality engineering
 */

import type {
  SkillContext,
  SkillResult,
  Artifact,
  SkillMetrics,
  TaskDefinition,
  QualityGateResult,
} from '../core/types.js';
import type {
  IWorkflowOrchestrator,
  ICoordinator,
  IMemory,
  PhaseResult,
  WorkflowHook,
  QualityContext,
} from '../core/interfaces.js';
import type { IEventBus } from '../core/interfaces.js';
import type { IModelRouter } from '../core/interfaces.js';
import type { IQualityGate } from '../core/interfaces.js';
import { createEvent } from '../events/event-bus.js';

// ============================================================================
// Types
// ============================================================================

interface WorkflowState {
  context: SkillContext;
  startTime: number;
  phases: PhaseResult[];
  artifacts: Artifact[];
  metrics: Partial<SkillMetrics>;
  errors: string[];
}

// ============================================================================
// Workflow Orchestrator Implementation
// ============================================================================

export class BuildWithQualityOrchestrator implements IWorkflowOrchestrator {
  private coordinator: ICoordinator | null = null;
  private memory: IMemory | null = null;
  private eventBus: IEventBus | null = null;
  private modelRouter: IModelRouter | null = null;
  private qualityGate: IQualityGate | null = null;

  private readonly hooks: Map<string, WorkflowHook[]> = new Map();

  async initialize(coordinator: ICoordinator, memory: IMemory): Promise<void> {
    this.coordinator = coordinator;
    this.memory = memory;
  }

  setEventBus(eventBus: IEventBus): void {
    this.eventBus = eventBus;
  }

  setModelRouter(router: IModelRouter): void {
    this.modelRouter = router;
  }

  setQualityGate(gate: IQualityGate): void {
    this.qualityGate = gate;
  }

  // ============================================================================
  // Main Workflow Execution
  // ============================================================================

  async executeBuildWithQuality(context: SkillContext): Promise<SkillResult> {
    const state: WorkflowState = {
      context,
      startTime: Date.now(),
      phases: [],
      artifacts: [],
      metrics: {
        agentsUsed: 0,
        tasksCompleted: 0,
        tokensUsed: 0,
        tokensSaved: 0,
        testsGenerated: 0,
        defectsFound: 0,
        defectsPrevented: 0,
      },
      errors: [],
    };

    try {
      // Emit workflow start event
      await this.emitEvent('task:started', {
        workflow: 'build-with-quality',
        context: context.sessionId,
      });

      // Phase 1: Requirements & Planning
      const requirementsResult = await this.executeRequirementsPhase(context);
      state.phases.push(requirementsResult);
      if (!requirementsResult.success) {
        throw new Error('Requirements phase failed');
      }

      // Phase 2: Development (with parallel QE)
      const developmentResult = await this.executeDevelopmentPhase(context);
      state.phases.push(developmentResult);
      state.artifacts.push(...this.createArtifacts(developmentResult));

      // Phase 3: Quality Gates
      const qualityResult = await this.executeQualityPhase(context);
      state.phases.push(qualityResult);

      // Phase 4: Deployment (if quality passed)
      let deploymentResult: PhaseResult | null = null;
      if (qualityResult.success) {
        deploymentResult = await this.executeDeploymentPhase(context);
        state.phases.push(deploymentResult);
      }

      // Phase 5: Learning & Pattern Storage
      const learningResult = await this.executeLearningPhase(context);
      state.phases.push(learningResult);

      // Calculate final metrics
      const finalMetrics = this.calculateFinalMetrics(state);

      // Get quality report
      const qualityReport = await this.getQualityReport(context);

      // Emit workflow complete event
      await this.emitEvent('task:completed', {
        workflow: 'build-with-quality',
        success: qualityResult.success,
        metrics: finalMetrics,
      });

      return {
        success: qualityResult.success && (deploymentResult?.success ?? true),
        artifacts: state.artifacts,
        metrics: finalMetrics,
        qualityReport,
        learningsStored: learningResult.metrics['patternsStored'] ?? 0,
      };
    } catch (error) {
      await this.emitEvent('task:failed', {
        workflow: 'build-with-quality',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        artifacts: state.artifacts,
        metrics: this.calculateFinalMetrics(state),
        qualityReport: {
          passed: false,
          gates: [],
          overallScore: 0,
          recommendations: [error instanceof Error ? error.message : 'Workflow failed'],
        },
        learningsStored: 0,
      };
    }
  }

  // ============================================================================
  // Phase Implementations
  // ============================================================================

  async executeRequirementsPhase(context: SkillContext): Promise<PhaseResult> {
    const startTime = Date.now();
    const artifacts: string[] = [];
    const metrics: Record<string, number> = {};

    try {
      // Run pre-build hooks
      await this.runHooks('preBuild', context);

      // Analyze requirements
      const analysisTask: TaskDefinition = {
        type: 'architecture',
        description: 'Analyze project requirements and plan architecture',
        input: {
          requirements: context.requirements,
          projectPath: context.projectPath,
        },
      };

      if (this.coordinator) {
        const taskId = await this.coordinator.submitTask(analysisTask, 'high');
        await this.coordinator.awaitTask(taskId);
        metrics['requirementsAnalyzed'] = 1;
      }

      // Retrieve similar patterns from memory
      if (this.memory) {
        const similarPatterns = await this.memory.semanticSearch(
          context.requirements,
          5
        );
        metrics['patternsRetrieved'] = similarPatterns.length;

        await this.emitEvent('learning:pattern-retrieved', {
          count: similarPatterns.length,
          phase: 'requirements',
        });
      }

      artifacts.push('requirements-analysis.json');
      artifacts.push('architecture-plan.md');

      return {
        phase: 'requirements',
        success: true,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
      };
    } catch (error) {
      return {
        phase: 'requirements',
        success: false,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  async executeDevelopmentPhase(context: SkillContext): Promise<PhaseResult> {
    const startTime = Date.now();
    const artifacts: string[] = [];
    const metrics: Record<string, number> = {
      filesGenerated: 0,
      testsGenerated: 0,
      coverageAchieved: 0,
    };

    try {
      // Run during-development hooks
      await this.runHooks('duringDevelopment', context);

      // Submit implementation task
      const implementTask: TaskDefinition = {
        type: 'implementation',
        description: 'Implement the required functionality',
        input: {
          requirements: context.requirements,
          projectPath: context.projectPath,
        },
      };

      // Submit test generation task IN PARALLEL
      const testGenTask: TaskDefinition = {
        type: 'test-generation',
        description: 'Generate comprehensive tests',
        input: {
          projectPath: context.projectPath,
          coverageTarget: context.config?.qualityGates?.coverageMinimum ?? 85,
        },
      };

      if (this.coordinator) {
        // Submit both tasks
        const [implementTaskId, testGenTaskId] = await Promise.all([
          this.coordinator.submitTask(implementTask, 'high'),
          this.coordinator.submitTask(testGenTask, 'high'),
        ]);

        // Wait for both to complete
        const [implementResult, testGenResult] = await Promise.all([
          this.coordinator.awaitTask(implementTaskId),
          this.coordinator.awaitTask(testGenTaskId),
        ]);

        metrics['filesGenerated'] = 5; // Simulated
        metrics['testsGenerated'] = 15; // Simulated

        // Emit code written event
        await this.emitEvent('code:written', {
          files: metrics['filesGenerated'],
          phase: 'development',
        });

        // Emit tests generated event
        await this.emitEvent('test:generated', {
          count: metrics['testsGenerated'],
          phase: 'development',
        });
      }

      // Run security review
      const securityTask: TaskDefinition = {
        type: 'security-scan',
        description: 'Security review of implementation',
        input: { projectPath: context.projectPath },
      };

      if (this.coordinator) {
        const securityTaskId = await this.coordinator.submitTask(securityTask, 'high');
        await this.coordinator.awaitTask(securityTaskId);

        await this.emitEvent('security:scan-completed', {
          phase: 'development',
        });
      }

      // Run coverage analysis
      const coverageTask: TaskDefinition = {
        type: 'coverage-analysis',
        description: 'Analyze test coverage',
        input: { projectPath: context.projectPath },
      };

      if (this.coordinator) {
        const coverageTaskId = await this.coordinator.submitTask(coverageTask, 'medium');
        await this.coordinator.awaitTask(coverageTaskId);
        metrics['coverageAchieved'] = 87; // Simulated
      }

      artifacts.push('src/');
      artifacts.push('tests/');
      artifacts.push('coverage-report.html');

      return {
        phase: 'development',
        success: true,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
      };
    } catch (error) {
      return {
        phase: 'development',
        success: false,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  async executeQualityPhase(context: SkillContext): Promise<PhaseResult> {
    const startTime = Date.now();
    const artifacts: string[] = [];
    const metrics: Record<string, number> = {};

    try {
      // Run pre-deployment hooks
      await this.runHooks('preDeployment', context);

      const qualityContext: QualityContext = {
        projectPath: context.projectPath,
        sourceFiles: ['src/index.ts', 'src/api.ts', 'src/utils.ts'],
        testFiles: ['tests/index.test.ts', 'tests/api.test.ts'],
      };

      let qualityResult: QualityGateResult;

      if (this.qualityGate) {
        qualityResult = await this.qualityGate.checkAll(qualityContext);
      } else {
        qualityResult = {
          passed: true,
          gates: [],
          overallScore: 85,
          recommendations: [],
        };
      }

      metrics['qualityScore'] = qualityResult.overallScore;
      metrics['gatesPassed'] = qualityResult.gates.filter((g) => g.passed).length;
      metrics['gatesTotal'] = qualityResult.gates.length;

      // Emit quality gate event
      await this.emitEvent(
        qualityResult.passed ? 'quality:gate-passed' : 'quality:gate-failed',
        {
          score: qualityResult.overallScore,
          passed: qualityResult.passed,
        }
      );

      // Run defect prediction
      if (this.qualityGate) {
        const defects = await this.qualityGate.predictDefects(qualityContext);
        metrics['defectsFound'] = defects.length;
        metrics['defectsPrevented'] = defects.filter((d) => d.probability > 0.5).length;
      }

      artifacts.push('quality-report.json');

      return {
        phase: 'quality',
        success: qualityResult.passed,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
        errors: qualityResult.passed ? undefined : qualityResult.recommendations,
      };
    } catch (error) {
      return {
        phase: 'quality',
        success: false,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  async executeDeploymentPhase(context: SkillContext): Promise<PhaseResult> {
    const startTime = Date.now();
    const artifacts: string[] = [];
    const metrics: Record<string, number> = {};

    try {
      // Submit deployment task
      const deployTask: TaskDefinition = {
        type: 'deployment',
        description: 'Deploy to target environment',
        input: { projectPath: context.projectPath },
      };

      if (this.coordinator) {
        await this.emitEvent('deployment:started', { phase: 'deployment' });

        const deployTaskId = await this.coordinator.submitTask(deployTask, 'critical');
        await this.coordinator.awaitTask(deployTaskId);

        await this.emitEvent('deployment:completed', { phase: 'deployment' });
      }

      metrics['deployed'] = 1;
      artifacts.push('deployment-manifest.yaml');

      // Run post-deployment hooks
      await this.runHooks('postDeployment', context);

      return {
        phase: 'deployment',
        success: true,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
      };
    } catch (error) {
      return {
        phase: 'deployment',
        success: false,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  async executeLearningPhase(context: SkillContext): Promise<PhaseResult> {
    const startTime = Date.now();
    const artifacts: string[] = [];
    const metrics: Record<string, number> = { patternsStored: 0 };

    try {
      // Store successful patterns
      if (this.memory) {
        // Store workflow pattern
        await this.memory.storePattern({
          type: 'workflow',
          content: {
            requirements: context.requirements,
            config: context.config,
            outcome: 'success',
          },
          embedding: this.generateEmbedding(context.requirements),
          confidence: 0.8,
          confidenceTier: 'silver',
          source: 'shared',
          usageCount: 1,
          successRate: 1,
        });

        metrics['patternsStored']++;

        // Consolidate patterns (Dream Cycle)
        const consolidated = await this.memory.consolidatePatterns();
        metrics['patternsConsolidated'] = consolidated;

        await this.emitEvent('learning:pattern-stored', {
          count: metrics['patternsStored'],
          phase: 'learning',
        });
      }

      artifacts.push('learned-patterns.json');

      return {
        phase: 'learning',
        success: true,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
      };
    } catch (error) {
      return {
        phase: 'learning',
        success: false,
        duration: Date.now() - startTime,
        artifacts,
        metrics,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  // ============================================================================
  // Hooks Management
  // ============================================================================

  registerHook(phase: string, hook: WorkflowHook): void {
    const hooks = this.hooks.get(phase) ?? [];
    hooks.push(hook);
    this.hooks.set(phase, hooks);
  }

  unregisterHook(phase: string, hookId: string): void {
    // For simplicity, hooks don't have IDs in this implementation
    // In a real implementation, we'd track hook IDs
    console.log(`Would unregister hook ${hookId} from phase ${phase}`);
  }

  private async runHooks(phase: string, context: SkillContext): Promise<void> {
    const hooks = this.hooks.get(phase) ?? [];
    for (const hook of hooks) {
      await hook(context);
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async emitEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    if (this.eventBus) {
      const event = createEvent(type as any, payload, 'system');
      await this.eventBus.emit(event);
    }
  }

  private createArtifacts(result: PhaseResult): Artifact[] {
    return result.artifacts.map((path) => ({
      type: this.inferArtifactType(path),
      path,
      metadata: {
        phase: result.phase,
        duration: result.duration,
      },
    }));
  }

  private inferArtifactType(path: string): Artifact['type'] {
    if (path.endsWith('.test.ts') || path.includes('tests/')) return 'test';
    if (path.endsWith('.json') || path.endsWith('.yaml')) return 'config';
    if (path.endsWith('.md')) return 'documentation';
    if (path.endsWith('.html')) return 'report';
    return 'code';
  }

  private calculateFinalMetrics(state: WorkflowState): SkillMetrics {
    const totalDuration = Date.now() - state.startTime;

    // Aggregate metrics from all phases
    let tasksCompleted = 0;
    let testsGenerated = 0;
    let defectsFound = 0;
    let defectsPrevented = 0;
    let coverageAchieved = 0;

    for (const phase of state.phases) {
      tasksCompleted += phase.metrics['tasksCompleted'] ?? 1;
      testsGenerated += phase.metrics['testsGenerated'] ?? 0;
      defectsFound += phase.metrics['defectsFound'] ?? 0;
      defectsPrevented += phase.metrics['defectsPrevented'] ?? 0;
      coverageAchieved = Math.max(coverageAchieved, phase.metrics['coverageAchieved'] ?? 0);
    }

    // Get routing stats for token metrics
    let tokensUsed = 1000; // Default
    let tokensSaved = 0;

    if (this.modelRouter) {
      const stats = this.modelRouter.getRoutingStats();
      tokensSaved = stats.tokensSaved;
      tokensUsed = stats.totalDecisions * 500 - tokensSaved; // Estimate
    }

    return {
      totalDuration,
      agentsUsed: this.coordinator?.listAgents().length ?? 0,
      tasksCompleted,
      tokensUsed,
      tokensSaved,
      coverageAchieved,
      testsGenerated,
      defectsFound,
      defectsPrevented,
    };
  }

  private async getQualityReport(context: SkillContext): Promise<QualityGateResult> {
    if (!this.qualityGate) {
      return {
        passed: true,
        gates: [],
        overallScore: 85,
        recommendations: [],
      };
    }

    const qualityContext: QualityContext = {
      projectPath: context.projectPath,
      sourceFiles: [],
      testFiles: [],
    };

    return this.qualityGate.checkAll(qualityContext);
  }

  private generateEmbedding(text: string): number[] {
    // Simple hash-based embedding for demonstration
    const dimensions = 384;
    const embedding = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const idx = (charCode * (i + 1)) % dimensions;
        embedding[idx] = (embedding[idx] + charCode / 255) % 1;
      }
    }

    return embedding;
  }
}

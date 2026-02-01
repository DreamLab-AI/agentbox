/**
 * Queen Coordinator
 * Unified swarm coordination engine with Byzantine fault-tolerant consensus
 * Merges Claude Code V3 and Agentic QE coordination patterns
 */

import type {
  Agent,
  AgentDomain,
  AgentId,
  SwarmId,
  Task,
  TaskDefinition,
  TaskId,
  TaskPriority,
  TaskResult,
  SwarmConfig,
} from '../core/types.js';
import type {
  IAgent,
  ICoordinator,
  SwarmStatus,
  ConsensusProposal,
  ConsensusResult,
} from '../core/interfaces.js';
import { createTaskId, createSwarmId } from '../core/types.js';

// ============================================================================
// Types
// ============================================================================

interface QueuedTask {
  task: Task;
  resolve: (result: TaskResult) => void;
  reject: (error: Error) => void;
}

interface DomainState {
  name: AgentDomain;
  agents: Set<AgentId>;
  taskQueue: QueuedTask[];
  activeTaskCount: number;
  maxConcurrent: number;
}

// ============================================================================
// Queen Coordinator Implementation
// ============================================================================

export class QueenCoordinator implements ICoordinator {
  readonly swarmId: SwarmId;

  private config: SwarmConfig | null = null;
  private readonly agents: Map<AgentId, IAgent> = new Map();
  private readonly domains: Map<AgentDomain, DomainState> = new Map();
  private readonly tasks: Map<TaskId, Task> = new Map();
  private readonly taskPromises: Map<TaskId, QueuedTask> = new Map();

  private healthy = false;
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  // Metrics
  private totalTasksCompleted = 0;
  private totalLatency = 0;
  private consensusRounds = 0;

  constructor(swarmId?: SwarmId) {
    this.swarmId = swarmId ?? createSwarmId(`swarm_${Date.now()}`);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async initialize(config: SwarmConfig): Promise<void> {
    this.config = config;

    // Initialize domains
    for (const domainConfig of config.domains) {
      this.domains.set(domainConfig.name, {
        name: domainConfig.name,
        agents: new Set(),
        taskQueue: [],
        activeTaskCount: 0,
        maxConcurrent: domainConfig.maxConcurrent,
      });
    }

    // Start task processing loop
    this.processingInterval = setInterval(
      () => void this.processTaskQueues(),
      100 // Process every 100ms
    );

    this.healthy = true;
  }

  async shutdown(): Promise<void> {
    this.healthy = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Terminate all agents
    const terminationPromises = Array.from(this.agents.values()).map((agent) =>
      agent.terminate()
    );
    await Promise.all(terminationPromises);

    this.agents.clear();
    this.domains.clear();
    this.tasks.clear();
    this.taskPromises.clear();
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  async registerAgent(agent: IAgent): Promise<void> {
    const agentConfig = agent.config;

    // Validate domain exists
    const domain = this.domains.get(agentConfig.domain);
    if (!domain) {
      throw new Error(`Unknown domain: ${agentConfig.domain}`);
    }

    // Check max agents
    if (this.config && this.agents.size >= this.config.maxAgents) {
      throw new Error(`Maximum agent count reached: ${this.config.maxAgents}`);
    }

    // Initialize agent
    await agent.initialize();

    // Register
    this.agents.set(agent.id, agent);
    domain.agents.add(agent.id);
  }

  async unregisterAgent(agentId: AgentId): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Remove from domain
    const domain = this.domains.get(agent.config.domain);
    if (domain) {
      domain.agents.delete(agentId);
    }

    // Terminate
    await agent.terminate();

    this.agents.delete(agentId);
  }

  getAgent(agentId: AgentId): IAgent | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): IAgent[] {
    return Array.from(this.agents.values());
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  async submitTask(
    definition: TaskDefinition,
    priority: TaskPriority = 'medium'
  ): Promise<TaskId> {
    const taskId = createTaskId(`task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

    const task: Task = {
      id: taskId,
      definition,
      priority,
      status: 'pending',
      createdAt: new Date(),
    };

    this.tasks.set(taskId, task);

    // Route to appropriate domain
    const domain = this.routeTaskToDomain(definition);
    const domainState = this.domains.get(domain);

    if (!domainState) {
      task.status = 'failed';
      task.result = {
        success: false,
        output: {},
        metrics: { duration: 0, tokensUsed: 0, modelTier: 'haiku' },
        errors: [{ code: 'NO_DOMAIN', message: `No domain found for task type: ${definition.type}`, recoverable: false }],
      };
      return taskId;
    }

    // Create promise for task completion
    const taskPromise = new Promise<TaskResult>((resolve, reject) => {
      this.taskPromises.set(taskId, {
        task,
        resolve,
        reject,
      });
    });

    // Queue the task
    const queuedTask = this.taskPromises.get(taskId)!;
    domainState.taskQueue.push(queuedTask);

    // Sort by priority
    this.sortQueue(domainState.taskQueue);

    task.status = 'queued';

    return taskId;
  }

  async cancelTask(taskId: TaskId): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'in-progress') {
      // Cannot cancel in-progress tasks easily
      return false;
    }

    task.status = 'cancelled';

    // Remove from queue
    for (const domain of this.domains.values()) {
      domain.taskQueue = domain.taskQueue.filter((qt) => qt.task.id !== taskId);
    }

    // Reject the promise
    const taskPromise = this.taskPromises.get(taskId);
    if (taskPromise) {
      taskPromise.reject(new Error('Task cancelled'));
      this.taskPromises.delete(taskId);
    }

    return true;
  }

  getTaskStatus(taskId: TaskId): Task | undefined {
    return this.tasks.get(taskId);
  }

  async awaitTask(taskId: TaskId): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return task.result!;
    }

    const taskPromise = this.taskPromises.get(taskId);
    if (!taskPromise) {
      throw new Error(`Task promise not found: ${taskId}`);
    }

    return new Promise<TaskResult>((resolve, reject) => {
      const originalResolve = taskPromise.resolve;
      const originalReject = taskPromise.reject;

      taskPromise.resolve = (result) => {
        originalResolve(result);
        resolve(result);
      };

      taskPromise.reject = (error) => {
        originalReject(error);
        reject(error);
      };
    });
  }

  // ============================================================================
  // Swarm Operations
  // ============================================================================

  getSwarmStatus(): SwarmStatus {
    let totalActiveTaskCount = 0;
    let totalQueuedTaskCount = 0;

    for (const domain of this.domains.values()) {
      totalActiveTaskCount += domain.activeTaskCount;
      totalQueuedTaskCount += domain.taskQueue.length;
    }

    const avgLatency =
      this.totalTasksCompleted > 0
        ? this.totalLatency / this.totalTasksCompleted
        : 0;

    return {
      id: this.swarmId,
      healthy: this.healthy,
      agentCount: this.agents.size,
      activeTaskCount: totalActiveTaskCount,
      queuedTaskCount: totalQueuedTaskCount,
      averageLatency: avgLatency,
      throughput: this.totalTasksCompleted,
    };
  }

  async scaleAgents(domainName: string, count: number): Promise<void> {
    const domain = this.domains.get(domainName as AgentDomain);
    if (!domain) {
      throw new Error(`Unknown domain: ${domainName}`);
    }

    const currentCount = domain.agents.size;

    if (count > currentCount) {
      // Scale up - would create new agents (needs agent factory)
      console.log(`Would scale up ${domainName} from ${currentCount} to ${count}`);
    } else if (count < currentCount) {
      // Scale down - remove excess agents
      const toRemove = currentCount - count;
      const agentIds = Array.from(domain.agents);

      for (let i = 0; i < toRemove; i++) {
        const agentId = agentIds[i];
        if (agentId) {
          await this.unregisterAgent(agentId);
        }
      }
    }
  }

  // ============================================================================
  // Byzantine Consensus
  // ============================================================================

  async proposeDecision(proposal: ConsensusProposal): Promise<ConsensusResult> {
    this.consensusRounds++;

    // Get agents to vote
    const voters = this.selectVoters(proposal);
    if (voters.length === 0) {
      return {
        approved: false,
        votes: [],
        finalDecision: {},
      };
    }

    // Collect votes
    const votes: ConsensusResult['votes'] = [];
    let approvals = 0;

    for (const agent of voters) {
      // Simulate voting based on agent status
      const vote = agent.getStatus() !== 'error';
      votes.push({
        agentId: agent.id,
        vote,
        reasoning: vote ? 'Agent healthy and available' : 'Agent in error state',
      });

      if (vote) approvals++;
    }

    // Byzantine fault tolerance: need > 2/3 approval
    const quorumMet = approvals >= Math.ceil((voters.length * 2) / 3);
    const thresholdMet = approvals >= proposal.requiredQuorum;

    return {
      approved: quorumMet && thresholdMet,
      votes,
      finalDecision: {
        ...proposal.payload,
        consensus: quorumMet && thresholdMet,
        approvalRate: approvals / voters.length,
      },
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private routeTaskToDomain(definition: TaskDefinition): AgentDomain {
    // Route based on task type
    const typeToDomin: Record<string, AgentDomain> = {
      architecture: 'development',
      implementation: 'development',
      review: 'development',
      deployment: 'development',
      'test-generation': 'quality',
      'test-execution': 'quality',
      'coverage-analysis': 'quality',
      'defect-prediction': 'quality',
      'chaos-test': 'quality',
      'contract-validation': 'quality',
      'accessibility-audit': 'quality',
      'security-scan': 'security',
      'pattern-learning': 'learning',
    };

    return typeToDomin[definition.type] ?? 'development';
  }

  private sortQueue(queue: QueuedTask[]): void {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    queue.sort((a, b) => {
      const aPriority = priorityOrder[a.task.priority];
      const bPriority = priorityOrder[b.task.priority];
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.task.createdAt.getTime() - b.task.createdAt.getTime();
    });
  }

  private async processTaskQueues(): Promise<void> {
    if (!this.healthy) return;

    for (const domain of this.domains.values()) {
      // Check if we can process more tasks
      while (
        domain.activeTaskCount < domain.maxConcurrent &&
        domain.taskQueue.length > 0
      ) {
        const queuedTask = domain.taskQueue.shift();
        if (!queuedTask) break;

        // Find available agent
        const agent = this.findAvailableAgent(domain);
        if (!agent) {
          // Put task back in queue
          domain.taskQueue.unshift(queuedTask);
          break;
        }

        // Execute task
        domain.activeTaskCount++;
        queuedTask.task.status = 'in-progress';
        queuedTask.task.startedAt = new Date();
        queuedTask.task.assignedAgent = agent.id;

        void this.executeTask(agent, queuedTask, domain);
      }
    }
  }

  private findAvailableAgent(domain: DomainState): IAgent | undefined {
    for (const agentId of domain.agents) {
      const agent = this.agents.get(agentId);
      if (agent && agent.getStatus() === 'idle') {
        return agent;
      }
    }
    return undefined;
  }

  private async executeTask(
    agent: IAgent,
    queuedTask: QueuedTask,
    domain: DomainState
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const result = await agent.execute(queuedTask.task);

      queuedTask.task.status = result.success ? 'completed' : 'failed';
      queuedTask.task.result = result;
      queuedTask.task.completedAt = new Date();

      this.totalTasksCompleted++;
      this.totalLatency += Date.now() - startTime;

      queuedTask.resolve(result);
    } catch (error) {
      queuedTask.task.status = 'failed';
      queuedTask.task.result = {
        success: false,
        output: {},
        metrics: {
          duration: Date.now() - startTime,
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
      queuedTask.task.completedAt = new Date();

      queuedTask.reject(error instanceof Error ? error : new Error('Unknown error'));
    } finally {
      domain.activeTaskCount--;
      this.taskPromises.delete(queuedTask.task.id);
    }
  }

  private selectVoters(proposal: ConsensusProposal): IAgent[] {
    // Select agents based on proposal type
    const relevantDomains: AgentDomain[] = [];

    switch (proposal.type) {
      case 'task-assignment':
        relevantDomains.push('development', 'quality', 'coordination');
        break;
      case 'resource-allocation':
        relevantDomains.push('coordination', 'development');
        break;
      case 'quality-decision':
        relevantDomains.push('quality', 'security');
        break;
    }

    const voters: IAgent[] = [];
    for (const domainName of relevantDomains) {
      const domain = this.domains.get(domainName);
      if (domain) {
        for (const agentId of domain.agents) {
          const agent = this.agents.get(agentId);
          if (agent) voters.push(agent);
        }
      }
    }

    return voters;
  }
}

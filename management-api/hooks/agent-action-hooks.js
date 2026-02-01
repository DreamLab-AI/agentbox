/**
 * Claude-Flow Agent Action Hooks
 *
 * Integrates with claude-flow hooks system to emit agent action events
 * for visualization in VisionFlow.
 *
 * Usage in claude-flow:
 *   claude-flow hooks route --task "My task"
 *
 * The hooks system will call our endpoints when agents perform actions.
 */

const { agentEventPublisher, AgentActionType } = require('../utils/agent-event-publisher');

// Agent ID registry - maps agent names to numeric IDs for binary protocol
const agentRegistry = new Map();
let nextAgentId = 1;

// Node ID registry - maps target identifiers to numeric IDs
const nodeRegistry = new Map();
let nextNodeId = 1;

/**
 * Get or create a numeric agent ID from agent name/identifier
 */
function getAgentId(agentName) {
  if (typeof agentName === 'number') return agentName;

  if (!agentRegistry.has(agentName)) {
    agentRegistry.set(agentName, nextAgentId++);
  }
  return agentRegistry.get(agentName);
}

/**
 * Get or create a numeric node ID from target identifier
 */
function getNodeId(target) {
  if (typeof target === 'number') return target;

  const key = String(target);
  if (!nodeRegistry.has(key)) {
    nodeRegistry.set(key, nextNodeId++);
  }
  return nodeRegistry.get(key);
}

/**
 * Map action verb to action type
 */
function mapActionType(action) {
  const actionLower = String(action).toLowerCase();

  if (actionLower.includes('query') || actionLower.includes('read') || actionLower.includes('get') || actionLower.includes('fetch')) {
    return AgentActionType.QUERY;
  }
  if (actionLower.includes('update') || actionLower.includes('modify') || actionLower.includes('edit') || actionLower.includes('patch')) {
    return AgentActionType.UPDATE;
  }
  if (actionLower.includes('create') || actionLower.includes('add') || actionLower.includes('insert') || actionLower.includes('new') || actionLower.includes('write')) {
    return AgentActionType.CREATE;
  }
  if (actionLower.includes('delete') || actionLower.includes('remove') || actionLower.includes('drop')) {
    return AgentActionType.DELETE;
  }
  if (actionLower.includes('link') || actionLower.includes('connect') || actionLower.includes('associate') || actionLower.includes('spawn')) {
    return AgentActionType.LINK;
  }
  if (actionLower.includes('transform') || actionLower.includes('convert') || actionLower.includes('process') || actionLower.includes('analyze')) {
    return AgentActionType.TRANSFORM;
  }

  // Default to query
  return AgentActionType.QUERY;
}

/**
 * Hook handlers for different claude-flow events
 */
const hookHandlers = {
  /**
   * Called when a task starts
   */
  'pre-task': (data) => {
    const { taskId, description, agent } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'coordinator'),
      target_node_id: getNodeId(taskId || 'task-queue'),
      action_type: AgentActionType.CREATE,
      duration_ms: 50,
      metadata: {
        hook: 'pre-task',
        taskId,
        description: description?.substring(0, 100)
      }
    });
  },

  /**
   * Called when a task completes
   */
  'post-task': (data) => {
    const { taskId, success, agent, quality } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'coordinator'),
      target_node_id: getNodeId(taskId || 'task-queue'),
      action_type: success ? AgentActionType.UPDATE : AgentActionType.DELETE,
      duration_ms: 100,
      metadata: {
        hook: 'post-task',
        taskId,
        success,
        quality
      }
    });
  },

  /**
   * Called before a file edit
   */
  'pre-edit': (data) => {
    const { filePath, operation, agent } = data;
    const actionType = operation === 'create' ? AgentActionType.CREATE
      : operation === 'delete' ? AgentActionType.DELETE
        : AgentActionType.UPDATE;

    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'coder'),
      target_node_id: getNodeId(filePath),
      action_type: actionType,
      duration_ms: 150,
      metadata: {
        hook: 'pre-edit',
        filePath,
        operation
      }
    });
  },

  /**
   * Called after a file edit
   */
  'post-edit': (data) => {
    const { filePath, success, agent } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'coder'),
      target_node_id: getNodeId(filePath),
      action_type: success ? AgentActionType.UPDATE : AgentActionType.QUERY,
      duration_ms: 200,
      metadata: {
        hook: 'post-edit',
        filePath,
        success
      }
    });
  },

  /**
   * Called before command execution
   */
  'pre-command': (data) => {
    const { command, agent } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'executor'),
      target_node_id: getNodeId('shell'),
      action_type: AgentActionType.TRANSFORM,
      duration_ms: 50,
      metadata: {
        hook: 'pre-command',
        command: command?.substring(0, 50)
      }
    });
  },

  /**
   * Called after command execution
   */
  'post-command': (data) => {
    const { command, exitCode, agent } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'executor'),
      target_node_id: getNodeId('shell'),
      action_type: exitCode === 0 ? AgentActionType.UPDATE : AgentActionType.DELETE,
      duration_ms: 100,
      metadata: {
        hook: 'post-command',
        command: command?.substring(0, 50),
        exitCode
      }
    });
  },

  /**
   * Called when routing a task to an agent
   */
  'route': (data) => {
    const { task, agent, context } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId('router'),
      target_node_id: getAgentId(agent || 'worker'),
      action_type: AgentActionType.LINK,
      duration_ms: 75,
      metadata: {
        hook: 'route',
        task: task?.substring(0, 100),
        targetAgent: agent
      }
    });
  },

  /**
   * Called when an agent spawns
   */
  'agent-spawn': (data) => {
    const { agentId, agentType, parent } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(parent || 'coordinator'),
      target_node_id: getAgentId(agentId || agentType),
      action_type: AgentActionType.CREATE,
      duration_ms: 200,
      metadata: {
        hook: 'agent-spawn',
        agentId,
        agentType
      }
    });
  },

  /**
   * Called when an agent terminates
   */
  'agent-terminate': (data) => {
    const { agentId, agentType, parent } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agentId || agentType),
      target_node_id: getAgentId(parent || 'coordinator'),
      action_type: AgentActionType.DELETE,
      duration_ms: 100,
      metadata: {
        hook: 'agent-terminate',
        agentId,
        agentType
      }
    });
  },

  /**
   * Called when memory is accessed
   */
  'memory-access': (data) => {
    const { key, operation, agent } = data;
    const actionType = operation === 'store' ? AgentActionType.CREATE
      : operation === 'delete' ? AgentActionType.DELETE
        : AgentActionType.QUERY;

    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(agent || 'memory-manager'),
      target_node_id: getNodeId(`memory:${key}`),
      action_type: actionType,
      duration_ms: 50,
      metadata: {
        hook: 'memory-access',
        key,
        operation
      }
    });
  },

  /**
   * Generic action hook
   */
  'action': (data) => {
    const { source, target, action, duration, metadata } = data;
    return agentEventPublisher.emitAgentAction({
      source_agent_id: getAgentId(source || 'unknown'),
      target_node_id: getNodeId(target || 'unknown'),
      action_type: mapActionType(action || 'query'),
      duration_ms: duration || 100,
      metadata: {
        hook: 'action',
        ...metadata
      }
    });
  }
};

/**
 * Process incoming hook event
 */
function processHookEvent(hookName, data) {
  const handler = hookHandlers[hookName];
  if (handler) {
    return handler(data);
  }

  // Fallback to generic action handler
  return hookHandlers['action']({
    source: data.agent || data.source,
    target: data.target || data.taskId || data.filePath,
    action: hookName,
    metadata: data
  });
}

/**
 * Get registry statistics
 */
function getRegistryStats() {
  return {
    agents: agentRegistry.size,
    nodes: nodeRegistry.size,
    agentList: Array.from(agentRegistry.entries()).map(([name, id]) => ({ name, id })),
    nodeList: Array.from(nodeRegistry.entries()).slice(0, 50).map(([name, id]) => ({ name, id }))
  };
}

module.exports = {
  hookHandlers,
  processHookEvent,
  getAgentId,
  getNodeId,
  mapActionType,
  getRegistryStats
};

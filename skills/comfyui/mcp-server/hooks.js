/**
 * Claude-Flow Hooks Integration for ComfyUI
 *
 * Integrates ComfyUI workflow execution with claude-flow hooks system
 * for coordination, memory management, and session tracking.
 *
 * Usage:
 *   npx claude-flow@alpha hooks pre-task --description "ComfyUI workflow"
 *   npx claude-flow@alpha hooks post-task --task-id "workflow-123"
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;

/**
 * Hooks state manager
 */
class HooksManager {
  constructor() {
    this.activeSessions = new Map();
    this.workflowMetrics = new Map();
    this.memoryKeyPrefix = 'swarm/comfyui';
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `comfyui-${uuidv4()}`;
  }

  /**
   * Generate memory key
   */
  getMemoryKey(sessionId, workflowId, suffix = '') {
    const key = `${this.memoryKeyPrefix}/${sessionId}/${workflowId}`;
    return suffix ? `${key}/${suffix}` : key;
  }

  /**
   * Store data in claude-flow memory
   */
  async storeMemory(key, value, namespace = 'coordination') {
    try {
      // Call claude-flow memory storage
      const { execSync } = require('child_process');
      const memoryData = JSON.stringify(value);

      execSync(
        `npx claude-flow@alpha hooks memory-store --key "${key}" --value '${memoryData}' --namespace "${namespace}"`,
        { stdio: 'pipe' }
      );

      return true;
    } catch (error) {
      console.error(`Failed to store memory [${key}]:`, error.message);
      return false;
    }
  }

  /**
   * Retrieve data from claude-flow memory
   */
  async retrieveMemory(key, namespace = 'coordination') {
    try {
      const { execSync } = require('child_process');

      const result = execSync(
        `npx claude-flow@alpha hooks memory-retrieve --key "${key}" --namespace "${namespace}"`,
        { stdio: 'pipe', encoding: 'utf-8' }
      );

      return JSON.parse(result);
    } catch (error) {
      console.error(`Failed to retrieve memory [${key}]:`, error.message);
      return null;
    }
  }

  /**
   * Notify claude-flow system
   */
  async notify(message, level = 'info') {
    try {
      const { execSync } = require('child_process');
      execSync(
        `npx claude-flow@alpha hooks notify --message "${message}" --level "${level}"`,
        { stdio: 'pipe' }
      );
    } catch (error) {
      console.error('Failed to send notification:', error.message);
    }
  }
}

const manager = new HooksManager();

/**
 * Pre-workflow hook - Called before workflow execution
 *
 * @param {Object} context - Workflow context
 * @param {string} context.workflowId - Unique workflow identifier
 * @param {Object} context.workflow - ComfyUI workflow object
 * @param {Object} context.params - Execution parameters
 * @param {string} context.sessionId - Optional session ID
 * @returns {Object} Updated context with session info
 */
async function preWorkflow(context) {
  const sessionId = context.sessionId || manager.generateSessionId();
  const workflowId = context.workflowId || uuidv4();
  const timestamp = new Date().toISOString();

  console.log(`[PreWorkflow] Session: ${sessionId}, Workflow: ${workflowId}`);

  // Create session tracking
  const sessionData = {
    sessionId,
    workflowId,
    status: 'initializing',
    startTime: timestamp,
    workflow: {
      nodes: Object.keys(context.workflow || {}).length,
      params: context.params || {}
    },
    metadata: {
      createdAt: timestamp,
      version: '1.0.0'
    }
  };

  manager.activeSessions.set(sessionId, sessionData);

  // Store in claude-flow memory
  const memoryKey = manager.getMemoryKey(sessionId, workflowId, 'state');
  await manager.storeMemory(memoryKey, sessionData);

  // Initialize metrics
  manager.workflowMetrics.set(workflowId, {
    startTime: Date.now(),
    progress: 0,
    steps: [],
    errors: []
  });

  // Notify system
  await manager.notify(
    `ComfyUI workflow ${workflowId} starting in session ${sessionId}`,
    'info'
  );

  // Execute claude-flow pre-task hook
  try {
    const { execSync } = require('child_process');
    execSync(
      `npx claude-flow@alpha hooks pre-task --description "ComfyUI Workflow ${workflowId}"`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    console.warn('Failed to execute pre-task hook:', error.message);
  }

  return {
    ...context,
    sessionId,
    workflowId,
    timestamp,
    hookData: sessionData
  };
}

/**
 * Post-workflow hook - Called after workflow completion
 *
 * @param {Object} context - Workflow context from preWorkflow
 * @param {Object} result - Workflow execution result
 * @param {boolean} result.success - Whether workflow succeeded
 * @param {Object} result.outputs - Generated outputs
 * @param {string} result.error - Error message if failed
 * @returns {Object} Final result with metadata
 */
async function postWorkflow(context, result) {
  const { sessionId, workflowId } = context;
  const timestamp = new Date().toISOString();
  const metrics = manager.workflowMetrics.get(workflowId);

  console.log(`[PostWorkflow] Session: ${sessionId}, Success: ${result.success}`);

  // Calculate execution time
  const executionTime = metrics ? Date.now() - metrics.startTime : 0;

  // Update session data
  const sessionData = manager.activeSessions.get(sessionId);
  if (sessionData) {
    sessionData.status = result.success ? 'completed' : 'failed';
    sessionData.endTime = timestamp;
    sessionData.executionTime = executionTime;
    sessionData.result = {
      success: result.success,
      outputs: result.outputs || {},
      error: result.error || null
    };
  }

  // Store final state in memory
  const memoryKey = manager.getMemoryKey(sessionId, workflowId, 'result');
  await manager.storeMemory(memoryKey, {
    ...sessionData,
    metrics: {
      executionTime,
      progress: metrics?.progress || 100,
      steps: metrics?.steps || [],
      errors: metrics?.errors || []
    }
  });

  // Store metrics separately
  const metricsKey = manager.getMemoryKey(sessionId, workflowId, 'metrics');
  await manager.storeMemory(metricsKey, {
    workflowId,
    executionTime,
    success: result.success,
    nodeCount: context.workflow ? Object.keys(context.workflow).length : 0,
    outputCount: result.outputs ? Object.keys(result.outputs).length : 0,
    timestamp
  });

  // Notify system
  const status = result.success ? 'completed successfully' : 'failed';
  await manager.notify(
    `ComfyUI workflow ${workflowId} ${status} (${executionTime}ms)`,
    result.success ? 'info' : 'error'
  );

  // Execute claude-flow post-task hook
  try {
    const { execSync } = require('child_process');
    execSync(
      `npx claude-flow@alpha hooks post-task --task-id "${workflowId}" --success ${result.success}`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    console.warn('Failed to execute post-task hook:', error.message);
  }

  // Clean up
  manager.workflowMetrics.delete(workflowId);

  // Keep session data for 5 minutes before cleanup
  setTimeout(() => {
    manager.activeSessions.delete(sessionId);
  }, 5 * 60 * 1000);

  return {
    ...result,
    sessionId,
    workflowId,
    executionTime,
    timestamp,
    metrics: metrics || {}
  };
}

/**
 * Progress hook - Called during workflow execution
 *
 * @param {Object} context - Workflow context
 * @param {Object} progress - Progress information
 * @param {number} progress.percent - Completion percentage (0-100)
 * @param {string} progress.step - Current step description
 * @param {string} progress.nodeId - Current node ID
 * @param {Object} progress.data - Additional progress data
 */
async function onProgress(context, progress) {
  const { sessionId, workflowId } = context;
  const timestamp = new Date().toISOString();

  console.log(
    `[Progress] Workflow: ${workflowId}, ` +
    `Step: ${progress.step}, ` +
    `Progress: ${progress.percent}%`
  );

  // Update metrics
  const metrics = manager.workflowMetrics.get(workflowId);
  if (metrics) {
    metrics.progress = progress.percent;
    metrics.steps.push({
      timestamp,
      step: progress.step,
      nodeId: progress.nodeId,
      percent: progress.percent,
      data: progress.data || {}
    });
  }

  // Store progress in memory (throttled to avoid excessive writes)
  const shouldStore = progress.percent % 10 === 0 || progress.percent === 100;
  if (shouldStore) {
    const progressKey = manager.getMemoryKey(sessionId, workflowId, 'progress');
    await manager.storeMemory(progressKey, {
      workflowId,
      sessionId,
      percent: progress.percent,
      currentStep: progress.step,
      nodeId: progress.nodeId,
      timestamp,
      steps: metrics?.steps || []
    });
  }

  // Update session data
  const sessionData = manager.activeSessions.get(sessionId);
  if (sessionData) {
    sessionData.progress = progress.percent;
    sessionData.currentStep = progress.step;
    sessionData.lastUpdate = timestamp;
  }
}

/**
 * Error hook - Called when workflow encounters an error
 *
 * @param {Object} context - Workflow context
 * @param {Object} error - Error information
 * @param {string} error.message - Error message
 * @param {string} error.stack - Error stack trace
 * @param {string} error.nodeId - Node that caused error
 * @param {Object} error.details - Additional error details
 */
async function onError(context, error) {
  const { sessionId, workflowId } = context;
  const timestamp = new Date().toISOString();

  console.error(
    `[Error] Workflow: ${workflowId}, ` +
    `Node: ${error.nodeId || 'unknown'}, ` +
    `Message: ${error.message}`
  );

  // Update metrics
  const metrics = manager.workflowMetrics.get(workflowId);
  if (metrics) {
    metrics.errors.push({
      timestamp,
      message: error.message,
      nodeId: error.nodeId,
      stack: error.stack,
      details: error.details || {}
    });
  }

  // Store error in memory
  const errorKey = manager.getMemoryKey(sessionId, workflowId, 'error');
  await manager.storeMemory(errorKey, {
    workflowId,
    sessionId,
    error: {
      message: error.message,
      nodeId: error.nodeId,
      stack: error.stack,
      details: error.details || {}
    },
    timestamp,
    allErrors: metrics?.errors || []
  });

  // Update session data
  const sessionData = manager.activeSessions.get(sessionId);
  if (sessionData) {
    sessionData.status = 'error';
    sessionData.lastError = {
      message: error.message,
      timestamp
    };
  }

  // Notify system
  await manager.notify(
    `ComfyUI workflow ${workflowId} error: ${error.message}`,
    'error'
  );
}

/**
 * Session end hook - Called when session is ending
 *
 * @param {string} sessionId - Session identifier
 * @param {boolean} exportMetrics - Whether to export metrics
 * @returns {Object} Session summary
 */
async function sessionEnd(sessionId, exportMetrics = true) {
  console.log(`[SessionEnd] Session: ${sessionId}`);

  const sessionData = manager.activeSessions.get(sessionId);
  if (!sessionData) {
    console.warn(`Session ${sessionId} not found`);
    return null;
  }

  const summary = {
    sessionId,
    status: sessionData.status,
    duration: sessionData.endTime
      ? new Date(sessionData.endTime) - new Date(sessionData.startTime)
      : null,
    workflows: [sessionData.workflowId],
    metrics: sessionData.result || {}
  };

  // Store session summary
  const summaryKey = `${manager.memoryKeyPrefix}/${sessionId}/summary`;
  await manager.storeMemory(summaryKey, summary);

  // Export metrics if requested
  if (exportMetrics) {
    try {
      const { execSync } = require('child_process');
      execSync(
        `npx claude-flow@alpha hooks session-end --session-id "${sessionId}" --export-metrics true`,
        { stdio: 'pipe' }
      );
    } catch (error) {
      console.warn('Failed to execute session-end hook:', error.message);
    }
  }

  // Notify system
  await manager.notify(
    `ComfyUI session ${sessionId} ended with status: ${sessionData.status}`,
    'info'
  );

  // Clean up
  manager.activeSessions.delete(sessionId);

  return summary;
}

/**
 * Session restore hook - Restore previous session state
 *
 * @param {string} sessionId - Session identifier to restore
 * @returns {Object} Restored session data
 */
async function sessionRestore(sessionId) {
  console.log(`[SessionRestore] Session: ${sessionId}`);

  try {
    const { execSync } = require('child_process');
    execSync(
      `npx claude-flow@alpha hooks session-restore --session-id "${sessionId}"`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    console.warn('Failed to execute session-restore hook:', error.message);
  }

  // Retrieve session data from memory
  const summaryKey = `${manager.memoryKeyPrefix}/${sessionId}/summary`;
  const sessionData = await manager.retrieveMemory(summaryKey);

  if (sessionData) {
    manager.activeSessions.set(sessionId, sessionData);
    await manager.notify(`ComfyUI session ${sessionId} restored`, 'info');
  }

  return sessionData;
}

/**
 * Get active sessions
 *
 * @returns {Array} List of active sessions
 */
function getActiveSessions() {
  return Array.from(manager.activeSessions.values());
}

/**
 * Get workflow metrics
 *
 * @param {string} workflowId - Workflow identifier
 * @returns {Object} Workflow metrics
 */
function getWorkflowMetrics(workflowId) {
  return manager.workflowMetrics.get(workflowId) || null;
}

/**
 * Register hooks with claude-flow system
 */
async function registerHooks() {
  console.log('[Hooks] Registering ComfyUI hooks with claude-flow...');

  try {
    const { execSync } = require('child_process');

    // Register hook handlers
    execSync(
      `npx claude-flow@alpha hooks register --service "comfyui" --handlers "preWorkflow,postWorkflow,onProgress,onError"`,
      { stdio: 'pipe' }
    );

    console.log('[Hooks] Successfully registered ComfyUI hooks');
    return true;
  } catch (error) {
    console.error('[Hooks] Failed to register hooks:', error.message);
    return false;
  }
}

// Export hooks and utilities
module.exports = {
  // Hook functions
  preWorkflow,
  postWorkflow,
  onProgress,
  onError,
  sessionEnd,
  sessionRestore,

  // Utilities
  getActiveSessions,
  getWorkflowMetrics,
  registerHooks,

  // Manager instance (for advanced usage)
  manager
};

// CLI interface for testing
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  (async () => {
    switch (command) {
      case 'register':
        await registerHooks();
        break;

      case 'test-pre':
        const preContext = await preWorkflow({
          workflow: { node1: {}, node2: {} },
          params: { test: true }
        });
        console.log('Pre-workflow result:', JSON.stringify(preContext, null, 2));
        break;

      case 'test-post':
        const postContext = {
          sessionId: 'test-session',
          workflowId: 'test-workflow'
        };
        const result = await postWorkflow(postContext, {
          success: true,
          outputs: { image: 'output.png' }
        });
        console.log('Post-workflow result:', JSON.stringify(result, null, 2));
        break;

      case 'sessions':
        const sessions = getActiveSessions();
        console.log('Active sessions:', JSON.stringify(sessions, null, 2));
        break;

      default:
        console.log(`
ComfyUI Claude-Flow Hooks Integration

Usage:
  node hooks.js register          # Register hooks with claude-flow
  node hooks.js test-pre          # Test pre-workflow hook
  node hooks.js test-post         # Test post-workflow hook
  node hooks.js sessions          # Show active sessions

Integration Example:
  const { preWorkflow, postWorkflow } = require('./hooks');

  // Before execution
  const context = await preWorkflow({ workflow, params });

  // During execution
  await onProgress(context, { percent: 50, step: 'Processing' });

  // After execution
  await postWorkflow(context, { success: true, outputs });
        `);
    }
  })();
}

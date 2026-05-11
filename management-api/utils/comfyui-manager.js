/**
 * ComfyUI Workflow Manager
 * Manages workflow submission, execution tracking, and event broadcasting
 *
 * Connects to a real ComfyUI instance via HTTP + WebSocket.  The server URL
 * is read from COMFYUI_URL (default http://localhost:8188).  If the backend
 * is unreachable, workflow submissions return 503 Service Unavailable rather
 * than producing simulated/fake results.
 */

const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class ComfyUIManager extends EventEmitter {
  constructor(logger, metrics) {
    super();
    this.logger = logger;
    this.metrics = metrics;
    this.workflows = new Map(); // workflowId -> workflow info
    this.queue = [];
    this.subscribers = new Map(); // workflowId -> Set of clientIds
    this.outputsDir = process.env.COMFYUI_OUTPUTS || '/home/devuser/comfyui/output';
    this.comfyuiUrl = (process.env.COMFYUI_URL || 'http://localhost:8188').replace(/\/$/, '');

    // Ensure output directory exists
    if (!fs.existsSync(this.outputsDir)) {
      fs.mkdirSync(this.outputsDir, { recursive: true });
    }
  }

  /**
   * Check whether the ComfyUI backend is reachable.
   * @returns {Promise<boolean>}
   */
  async _isBackendAvailable() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.comfyuiUrl}/system_stats`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Submit a workflow to the real ComfyUI /prompt endpoint.
   * @returns {Promise<{prompt_id: string}>}
   * @throws {Error} if the backend is unreachable or rejects the prompt.
   */
  async _submitToBackend(workflow) {
    const res = await fetch(`${this.comfyuiUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ComfyUI /prompt returned ${res.status}: ${body}`);
    }
    return res.json();
  }

  /**
   * Poll the ComfyUI /history endpoint for a given prompt_id.
   * @returns {Promise<object|null>}
   */
  async _pollHistory(promptId) {
    try {
      const res = await fetch(`${this.comfyuiUrl}/history/${promptId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data[promptId] || null;
    } catch {
      return null;
    }
  }

  /**
   * Submit workflow for execution
   */
  async submitWorkflow(workflow, options = {}) {
    const workflowId = uuidv4();
    const { priority = 'normal', gpu = 'local' } = options;

    const workflowInfo = {
      workflowId,
      workflow,
      priority,
      gpu,
      status: 'queued',
      progress: 0,
      currentNode: null,
      startTime: null,
      completionTime: null,
      outputs: [],
      error: null,
      queuePosition: this.queue.length
    };

    this.workflows.set(workflowId, workflowInfo);

    // Add to queue based on priority
    if (priority === 'high') {
      this.queue.unshift(workflowId);
    } else {
      this.queue.push(workflowId);
    }

    this.logger.info({ workflowId, priority, gpu }, 'Workflow queued');
    this.emit('workflow:queued', workflowInfo);

    if (this.metrics.recordComfyUIWorkflow) {
      this.metrics.recordComfyUIWorkflow('queued');
    }

    // Process queue
    this._processQueue();

    return {
      workflowId,
      queuePosition: workflowInfo.queuePosition
    };
  }

  /**
   * Get workflow status
   */
  async getWorkflowStatus(workflowId) {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * Cancel workflow
   */
  async cancelWorkflow(workflowId) {
    const workflowInfo = this.workflows.get(workflowId);

    if (!workflowInfo) {
      return false;
    }

    if (workflowInfo.status === 'completed' || workflowInfo.status === 'failed') {
      return false;
    }

    workflowInfo.status = 'cancelled';
    workflowInfo.completionTime = Date.now();

    // Remove from queue if queued
    const queueIndex = this.queue.indexOf(workflowId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    this.logger.info({ workflowId }, 'Workflow cancelled');
    this.emit('workflow:cancelled', workflowInfo);

    if (this.metrics.recordComfyUIWorkflow) {
      this.metrics.recordComfyUIWorkflow('cancelled');
    }

    return true;
  }

  /**
   * List available models
   */
  async listModels(type) {
    const modelTypes = {
      checkpoints: process.env.COMFYUI_MODELS_CHECKPOINTS || '/home/devuser/comfyui/models/checkpoints',
      loras: process.env.COMFYUI_MODELS_LORAS || '/home/devuser/comfyui/models/loras',
      vae: process.env.COMFYUI_MODELS_VAE || '/home/devuser/comfyui/models/vae',
      controlnet: process.env.COMFYUI_MODELS_CONTROLNET || '/home/devuser/comfyui/models/controlnet',
      upscale: process.env.COMFYUI_MODELS_UPSCALE || '/home/devuser/comfyui/models/upscale_models'
    };

    const modelsDir = type ? modelTypes[type] : null;
    const models = [];

    if (modelsDir && fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir);

      for (const file of files) {
        const fullPath = path.join(modelsDir, file);
        const stats = fs.statSync(fullPath);

        if (stats.isFile()) {
          models.push({
            name: file,
            type: type || 'unknown',
            size: stats.size,
            hash: null // Could add hash calculation if needed
          });
        }
      }
    } else if (!type) {
      // If no type specified, scan all model directories
      for (const [modelType, modelDir] of Object.entries(modelTypes)) {
        if (fs.existsSync(modelDir)) {
          const typeModels = await this.listModels(modelType);
          models.push(...typeModels);
        }
      }
    }

    return models;
  }

  /**
   * List outputs
   */
  async listOutputs(options = {}) {
    const { workflowId, limit = 50 } = options;
    const outputs = [];

    if (!fs.existsSync(this.outputsDir)) {
      return outputs;
    }

    const files = fs.readdirSync(this.outputsDir);

    for (const file of files.slice(0, limit)) {
      const fullPath = path.join(this.outputsDir, file);

      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const stats = fs.statSync(fullPath);

      if (stats.isFile()) {
        // Extract workflow ID from filename if present
        const fileWorkflowId = file.match(/^([a-f0-9-]+)_/)?.[1];

        if (!workflowId || fileWorkflowId === workflowId) {
          outputs.push({
            filename: file,
            workflowId: fileWorkflowId || 'unknown',
            type: path.extname(file).slice(1),
            size: stats.size,
            createdAt: stats.mtimeMs,
            url: `/v1/comfyui/output/${file}`
          });
        }
      }
    }

    return outputs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Subscribe to all workflow events
   */
  subscribe(callback) {
    const eventTypes = ['workflow:queued', 'workflow:started', 'workflow:progress', 'workflow:completed', 'workflow:cancelled', 'workflow:error'];

    const handler = (event) => callback(event);

    eventTypes.forEach(event => {
      this.on(event, handler);
    });

    return () => {
      eventTypes.forEach(event => {
        this.off(event, handler);
      });
    };
  }

  /**
   * Subscribe to specific workflow
   */
  subscribeToWorkflow(workflowId, clientId) {
    if (!this.subscribers.has(workflowId)) {
      this.subscribers.set(workflowId, new Set());
    }

    this.subscribers.get(workflowId).add(clientId);
  }

  /**
   * Unsubscribe from specific workflow
   */
  unsubscribeFromWorkflow(workflowId, clientId) {
    const subs = this.subscribers.get(workflowId);
    if (subs) {
      subs.delete(clientId);
    }
  }

  /**
   * Process workflow queue — submits to the real ComfyUI backend.
   *
   * If the backend is unreachable the workflow is marked as failed with a
   * ServiceUnavailable error.  No simulated/fake results are ever produced.
   */
  async _processQueue() {
    if (this.queue.length === 0) {
      return;
    }

    const workflowId = this.queue.shift();
    const workflowInfo = this.workflows.get(workflowId);

    if (!workflowInfo || workflowInfo.status !== 'queued') {
      return;
    }

    // Guard: verify backend is reachable before attempting submission.
    const available = await this._isBackendAvailable();
    if (!available) {
      workflowInfo.status = 'failed';
      workflowInfo.error = 'ComfyUI backend is unavailable (503 Service Unavailable)';
      workflowInfo.completionTime = Date.now();
      this.logger.error({ workflowId, comfyuiUrl: this.comfyuiUrl }, 'ComfyUI backend unreachable — workflow failed');
      this.emit('workflow:error', {
        type: 'workflow:error',
        workflowId,
        error: workflowInfo.error,
        timestamp: Date.now(),
      });
      if (this.metrics.recordComfyUIWorkflow) {
        this.metrics.recordComfyUIWorkflow('failed');
      }
      // Continue draining the queue — next item may succeed if backend recovers.
      this._processQueue();
      return;
    }

    // Submit to the real ComfyUI instance.
    try {
      const response = await this._submitToBackend(workflowInfo.workflow);
      workflowInfo.promptId = response.prompt_id;
      workflowInfo.status = 'running';
      workflowInfo.startTime = Date.now();

      this.logger.info({ workflowId, promptId: response.prompt_id }, 'Workflow submitted to ComfyUI');
      this.emit('workflow:started', workflowInfo);

      if (this.metrics.recordComfyUIWorkflow) {
        this.metrics.recordComfyUIWorkflow('started');
      }

      // Poll the ComfyUI /history endpoint for completion.
      this._pollForCompletion(workflowId, response.prompt_id);
    } catch (err) {
      workflowInfo.status = 'failed';
      workflowInfo.error = `Failed to submit workflow to ComfyUI: ${err.message}`;
      workflowInfo.completionTime = Date.now();

      this.logger.error({ workflowId, error: err.message }, 'Workflow submission to ComfyUI failed');
      this.emit('workflow:error', {
        type: 'workflow:error',
        workflowId,
        error: workflowInfo.error,
        timestamp: Date.now(),
      });
      if (this.metrics.recordComfyUIWorkflow) {
        this.metrics.recordComfyUIWorkflow('failed');
      }
      this._processQueue();
    }
  }

  /**
   * Poll the ComfyUI /history endpoint until the prompt completes or fails.
   * Polling interval: 2 s.  Timeout: 30 min.
   */
  _pollForCompletion(workflowId, promptId) {
    const workflowInfo = this.workflows.get(workflowId);
    if (!workflowInfo) return;

    const maxPollMs = 30 * 60 * 1000; // 30 minutes
    const pollIntervalMs = 2000;
    const startedAt = Date.now();

    const interval = setInterval(async () => {
      // Check for cancellation.
      if (workflowInfo.status === 'cancelled') {
        clearInterval(interval);
        this._processQueue();
        return;
      }

      // Timeout guard.
      if (Date.now() - startedAt > maxPollMs) {
        clearInterval(interval);
        workflowInfo.status = 'failed';
        workflowInfo.error = 'Workflow timed out after 30 minutes';
        workflowInfo.completionTime = Date.now();
        this.logger.error({ workflowId, promptId }, 'Workflow timed out');
        this.emit('workflow:error', {
          type: 'workflow:error',
          workflowId,
          error: workflowInfo.error,
          timestamp: Date.now(),
        });
        if (this.metrics.recordComfyUIWorkflow) {
          this.metrics.recordComfyUIWorkflow('failed');
        }
        this._processQueue();
        return;
      }

      try {
        const history = await this._pollHistory(promptId);
        if (!history) return; // Not done yet — keep polling.

        clearInterval(interval);

        const statusStr = history.status && history.status.status_str;
        if (statusStr === 'error' || history.status?.completed === false) {
          workflowInfo.status = 'failed';
          workflowInfo.error = history.status?.messages
            ? JSON.stringify(history.status.messages)
            : 'ComfyUI reported execution error';
          workflowInfo.completionTime = Date.now();
          this.logger.error({ workflowId, promptId }, 'ComfyUI workflow execution failed');
          this.emit('workflow:error', {
            type: 'workflow:error',
            workflowId,
            error: workflowInfo.error,
            timestamp: Date.now(),
          });
          if (this.metrics.recordComfyUIWorkflow) {
            this.metrics.recordComfyUIWorkflow('failed');
          }
        } else {
          workflowInfo.outputs = history.outputs || [];
          // _completeWorkflow calls _processQueue internally.
          this._completeWorkflow(workflowId);
          return;
        }

        this._processQueue();
      } catch (err) {
        this.logger.warn({ workflowId, promptId, error: err.message }, 'History poll error (will retry)');
      }
    }, pollIntervalMs);
  }

  /**
   * Complete workflow
   */
  _completeWorkflow(workflowId) {
    const workflowInfo = this.workflows.get(workflowId);
    if (!workflowInfo) return;

    workflowInfo.status = 'completed';
    workflowInfo.progress = 100;
    workflowInfo.completionTime = Date.now();

    const duration = (workflowInfo.completionTime - workflowInfo.startTime) / 1000;

    this.logger.info({ workflowId, duration }, 'Workflow completed');
    this.emit('workflow:completed', {
      type: 'workflow:completed',
      workflowId,
      duration,
      timestamp: Date.now()
    });

    if (this.metrics.recordComfyUIWorkflow) {
      this.metrics.recordComfyUIWorkflow('completed', duration);
    }

    // Process next in queue
    this._processQueue();
  }
}

module.exports = ComfyUIManager;

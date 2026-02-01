/**
 * ComfyUI Workflow Manager
 * Manages workflow submission, execution tracking, and event broadcasting
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

    // Ensure output directory exists
    if (!fs.existsSync(this.outputsDir)) {
      fs.mkdirSync(this.outputsDir, { recursive: true });
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
   * Process workflow queue
   */
  async _processQueue() {
    // This would integrate with actual ComfyUI execution
    // For now, simulate execution
    if (this.queue.length === 0) {
      return;
    }

    const workflowId = this.queue.shift();
    const workflowInfo = this.workflows.get(workflowId);

    if (!workflowInfo || workflowInfo.status !== 'queued') {
      return;
    }

    workflowInfo.status = 'running';
    workflowInfo.startTime = Date.now();

    this.logger.info({ workflowId }, 'Workflow started');
    this.emit('workflow:started', workflowInfo);

    if (this.metrics.recordComfyUIWorkflow) {
      this.metrics.recordComfyUIWorkflow('started');
    }

    // Simulate progress updates
    // In real implementation, this would listen to ComfyUI API events
    this._simulateProgress(workflowId);
  }

  /**
   * Simulate workflow progress (replace with actual ComfyUI integration)
   */
  _simulateProgress(workflowId) {
    const workflowInfo = this.workflows.get(workflowId);
    if (!workflowInfo) return;

    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      workflowInfo.progress = progress;
      workflowInfo.currentNode = `node_${Math.floor(progress / 10)}`;

      this.emit('workflow:progress', {
        type: 'workflow:progress',
        workflowId,
        progress,
        currentNode: workflowInfo.currentNode,
        timestamp: Date.now()
      });

      if (progress >= 100) {
        clearInterval(interval);
        this._completeWorkflow(workflowId);
      }
    }, 1000);
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

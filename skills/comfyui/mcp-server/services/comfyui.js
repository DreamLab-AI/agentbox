const { EventEmitter } = require('events');
const WebSocket = require('ws');

/**
 * ComfyUI API Client Service (Singleton)
 * Provides HTTP and WebSocket connections to ComfyUI backend
 */
class ComfyUIService extends EventEmitter {
  constructor() {
    super();

    if (ComfyUIService.instance) {
      return ComfyUIService.instance;
    }

    this.baseUrl = process.env.COMFYUI_URL || 'http://localhost:8188';
    this.wsUrl = this.baseUrl.replace('http', 'ws') + '/ws';
    this.ws = null;
    this.connected = false;
    this.reconnectInterval = 5000;
    this.reconnectTimer = null;
    this.clientId = this._generateClientId();

    // Job tracking
    this.jobs = new Map();

    ComfyUIService.instance = this;
  }

  /**
   * Generate unique client ID
   */
  _generateClientId() {
    return `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Establish WebSocket and HTTP connections
   */
  async connect() {
    if (this.connected) {
      return true;
    }

    try {
      // Test HTTP connection
      const response = await fetch(`${this.baseUrl}/system_stats`);
      if (!response.ok) {
        throw new Error(`HTTP connection failed: ${response.status}`);
      }

      // Establish WebSocket connection
      await this._connectWebSocket();

      this.connected = true;
      this.emit('connected', { clientId: this.clientId });
      return true;
    } catch (error) {
      this.emit('error', { type: 'connection', error: error.message });
      this._scheduleReconnect();
      throw error;
    }
  }

  /**
   * Establish WebSocket connection
   */
  _connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${this.wsUrl}?clientId=${this.clientId}`);

        this.ws.on('open', () => {
          console.log('[ComfyUI] WebSocket connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          this._handleWebSocketMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('[ComfyUI] WebSocket error:', error.message);
          this.emit('error', { type: 'websocket', error: error.message });
        });

        this.ws.on('close', () => {
          console.log('[ComfyUI] WebSocket disconnected');
          this.connected = false;
          this.emit('disconnected');
          this._scheduleReconnect();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  _handleWebSocketMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const { type, data: msgData } = message;

      switch (type) {
        case 'status':
          this.emit('status', msgData);
          break;

        case 'progress':
          this.emit('progress', {
            value: msgData.value,
            max: msgData.max,
            promptId: msgData.prompt_id
          });

          // Update job tracking
          if (msgData.prompt_id && this.jobs.has(msgData.prompt_id)) {
            const job = this.jobs.get(msgData.prompt_id);
            job.progress = { value: msgData.value, max: msgData.max };
          }
          break;

        case 'executing':
          const nodeId = msgData.node;
          const promptId = msgData.prompt_id;

          this.emit('executing', { nodeId, promptId });

          // Update job status
          if (promptId && this.jobs.has(promptId)) {
            const job = this.jobs.get(promptId);
            job.status = 'executing';
            job.currentNode = nodeId;
          }

          // Null node means execution completed
          if (nodeId === null && promptId) {
            this._handleExecutionComplete(promptId);
          }
          break;

        case 'executed':
          this.emit('executed', {
            nodeId: msgData.node,
            promptId: msgData.prompt_id,
            output: msgData.output
          });

          // Track outputs
          if (msgData.prompt_id && this.jobs.has(msgData.prompt_id)) {
            const job = this.jobs.get(msgData.prompt_id);
            if (!job.outputs) job.outputs = {};
            job.outputs[msgData.node] = msgData.output;
          }
          break;

        case 'execution_error':
          this.emit('error', {
            type: 'execution',
            promptId: msgData.prompt_id,
            nodeId: msgData.node_id,
            error: msgData.exception_message,
            traceback: msgData.traceback
          });

          // Update job status
          if (msgData.prompt_id && this.jobs.has(msgData.prompt_id)) {
            const job = this.jobs.get(msgData.prompt_id);
            job.status = 'failed';
            job.error = msgData.exception_message;
          }
          break;

        default:
          // Forward unknown message types
          this.emit('message', message);
      }
    } catch (error) {
      console.error('[ComfyUI] Error parsing WebSocket message:', error);
    }
  }

  /**
   * Handle execution completion
   */
  _handleExecutionComplete(promptId) {
    if (!this.jobs.has(promptId)) return;

    const job = this.jobs.get(promptId);
    job.status = 'completed';
    job.endTime = Date.now();
    job.duration = job.endTime - job.startTime;

    this.emit('execution_complete', {
      promptId,
      duration: job.duration,
      outputs: job.outputs
    });
  }

  /**
   * Schedule reconnection attempt
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log('[ComfyUI] Attempting to reconnect...');
      try {
        await this.connect();
      } catch (error) {
        console.error('[ComfyUI] Reconnection failed:', error.message);
      }
    }, this.reconnectInterval);
  }

  /**
   * Submit workflow prompt for execution
   * @param {Object} workflow - ComfyUI workflow object
   * @returns {Promise<Object>} Response with prompt_id
   */
  async submitPrompt(workflow) {
    try {
      const response = await fetch(`${this.baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: workflow,
          client_id: this.clientId
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Submit prompt failed: ${response.status} - ${error}`);
      }

      const result = await response.json();

      // Track job
      if (result.prompt_id) {
        this.jobs.set(result.prompt_id, {
          promptId: result.prompt_id,
          workflow,
          startTime: Date.now(),
          status: 'queued',
          progress: { value: 0, max: 1 },
          outputs: {}
        });
      }

      return result;
    } catch (error) {
      this.emit('error', { type: 'submit', error: error.message });
      throw error;
    }
  }

  /**
   * Get current queue status
   * @returns {Promise<Object>} Queue information
   */
  async getQueue() {
    try {
      const response = await fetch(`${this.baseUrl}/queue`);

      if (!response.ok) {
        throw new Error(`Get queue failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'queue', error: error.message });
      throw error;
    }
  }

  /**
   * Get execution history
   * @param {string} promptId - Optional specific prompt ID
   * @returns {Promise<Object>} History data
   */
  async getHistory(promptId = null) {
    try {
      const url = promptId
        ? `${this.baseUrl}/history/${promptId}`
        : `${this.baseUrl}/history`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Get history failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'history', error: error.message });
      throw error;
    }
  }

  /**
   * Cancel prompt execution
   * @param {string} promptId - Prompt ID to cancel
   * @returns {Promise<void>}
   */
  async cancelPrompt(promptId) {
    try {
      const response = await fetch(`${this.baseUrl}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delete: [promptId]
        })
      });

      if (!response.ok) {
        throw new Error(`Cancel prompt failed: ${response.status}`);
      }

      // Update job tracking
      if (this.jobs.has(promptId)) {
        const job = this.jobs.get(promptId);
        job.status = 'cancelled';
      }

      this.emit('cancelled', { promptId });
    } catch (error) {
      this.emit('error', { type: 'cancel', error: error.message });
      throw error;
    }
  }

  /**
   * Get available models
   * @param {string} type - Model type (checkpoints, loras, vae, etc.)
   * @returns {Promise<Array>} List of available models
   */
  async getModels(type = null) {
    try {
      const response = await fetch(`${this.baseUrl}/object_info`);

      if (!response.ok) {
        throw new Error(`Get models failed: ${response.status}`);
      }

      const objectInfo = await response.json();

      if (!type) {
        return objectInfo;
      }

      // Extract specific model type
      const modelMap = {
        'checkpoints': 'CheckpointLoaderSimple',
        'loras': 'LoraLoader',
        'vae': 'VAELoader',
        'upscale_models': 'UpscaleModelLoader',
        'controlnet': 'ControlNetLoader'
      };

      const nodeType = modelMap[type] || type;

      if (objectInfo[nodeType] && objectInfo[nodeType].input && objectInfo[nodeType].input.required) {
        const firstInput = Object.values(objectInfo[nodeType].input.required)[0];
        if (Array.isArray(firstInput) && Array.isArray(firstInput[0])) {
          return firstInput[0];
        }
      }

      return [];
    } catch (error) {
      this.emit('error', { type: 'models', error: error.message });
      throw error;
    }
  }

  /**
   * Get system statistics
   * @returns {Promise<Object>} System stats (devices, memory, etc.)
   */
  async getSystemStats() {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`);

      if (!response.ok) {
        throw new Error(`Get system stats failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.emit('error', { type: 'stats', error: error.message });
      throw error;
    }
  }

  /**
   * Get job status
   * @param {string} promptId - Prompt ID
   * @returns {Object|null} Job metadata or null if not found
   */
  getJob(promptId) {
    return this.jobs.get(promptId) || null;
  }

  /**
   * Get all tracked jobs
   * @returns {Array} Array of job metadata
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up old jobs
   * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
   */
  cleanupJobs(maxAge = 3600000) {
    const now = Date.now();
    for (const [promptId, job] of this.jobs.entries()) {
      if (job.endTime && (now - job.endTime) > maxAge) {
        this.jobs.delete(promptId);
      }
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.jobs.clear();
    this.emit('disconnected');
  }

  /**
   * Check if service is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
module.exports = new ComfyUIService();

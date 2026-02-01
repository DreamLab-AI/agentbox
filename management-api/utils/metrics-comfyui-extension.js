/**
 * ComfyUI Metrics Extensions
 * Add these to the main metrics.js file
 */

const client = require('prom-client');

// ComfyUI-specific metrics
const comfyuiWorkflowTotal = new client.Counter({
  name: 'comfyui_workflow_total',
  help: 'Total number of ComfyUI workflows',
  labelNames: ['status']
});

const comfyuiWorkflowDuration = new client.Histogram({
  name: 'comfyui_workflow_duration_seconds',
  help: 'Duration of ComfyUI workflow execution',
  labelNames: ['gpu_type'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600]
});

const comfyuiWorkflowErrors = new client.Counter({
  name: 'comfyui_workflow_errors_total',
  help: 'Total number of ComfyUI workflow errors',
  labelNames: ['error_type']
});

const comfyuiGpuUtilization = new client.Gauge({
  name: 'comfyui_gpu_utilization',
  help: 'GPU utilization percentage for ComfyUI',
  labelNames: ['gpu_id']
});

const comfyuiVramUsage = new client.Gauge({
  name: 'comfyui_vram_usage_bytes',
  help: 'VRAM usage in bytes for ComfyUI',
  labelNames: ['gpu_id']
});

const comfyuiQueueLength = new client.Gauge({
  name: 'comfyui_queue_length',
  help: 'Number of workflows in queue'
});

/**
 * Helper function to record ComfyUI workflow events
 */
function recordComfyUIWorkflow(status, duration, gpuType = 'local') {
  comfyuiWorkflowTotal.inc({ status });

  if (duration !== undefined && duration !== null) {
    comfyuiWorkflowDuration.observe({ gpu_type: gpuType }, duration);
  }
}

/**
 * Record ComfyUI workflow error
 */
function recordComfyUIError(errorType) {
  comfyuiWorkflowErrors.inc({ error_type: errorType });
}

/**
 * Set GPU metrics
 */
function setComfyUIGpuMetrics(gpuId, utilization, vramUsage) {
  if (utilization !== undefined && utilization !== null) {
    comfyuiGpuUtilization.set({ gpu_id: gpuId }, utilization);
  }

  if (vramUsage !== undefined && vramUsage !== null) {
    comfyuiVramUsage.set({ gpu_id: gpuId }, vramUsage);
  }
}

/**
 * Set queue length
 */
function setComfyUIQueueLength(length) {
  comfyuiQueueLength.set(length);
}

/**
 * Register all ComfyUI metrics with the provided registry
 */
function registerComfyUIMetrics(register) {
  register.registerMetric(comfyuiWorkflowTotal);
  register.registerMetric(comfyuiWorkflowDuration);
  register.registerMetric(comfyuiWorkflowErrors);
  register.registerMetric(comfyuiGpuUtilization);
  register.registerMetric(comfyuiVramUsage);
  register.registerMetric(comfyuiQueueLength);
}

module.exports = {
  // Metrics objects
  metrics: {
    comfyuiWorkflowTotal,
    comfyuiWorkflowDuration,
    comfyuiWorkflowErrors,
    comfyuiGpuUtilization,
    comfyuiVramUsage,
    comfyuiQueueLength
  },

  // Helper functions
  recordComfyUIWorkflow,
  recordComfyUIError,
  setComfyUIGpuMetrics,
  setComfyUIQueueLength,
  registerComfyUIMetrics
};

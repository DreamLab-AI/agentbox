/**
 * Default configuration for ComfyUI MCP Server
 */

export const DEFAULT_CONFIG = {
  // ComfyUI connection
  comfyui: {
    url: process.env.COMFYUI_URL || 'http://localhost:8188',
    wsUrl: process.env.COMFYUI_WS_URL || 'ws://localhost:8188/ws',
    timeout: parseInt(process.env.COMFYUI_TIMEOUT || '300000', 10), // 5 minutes
    retryAttempts: parseInt(process.env.COMFYUI_RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.COMFYUI_RETRY_DELAY || '2000', 10),
  },

  // Output management
  output: {
    dir: process.env.COMFYUI_OUTPUT_DIR || '/home/devuser/ComfyUI/output',
    watchInterval: parseInt(process.env.OUTPUT_WATCH_INTERVAL || '1000', 10),
    cleanupAge: parseInt(process.env.OUTPUT_CLEANUP_AGE || '86400000', 10), // 24 hours
    thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE || '512', 10),
    patterns: ['*.png', '*.jpg', '*.mp4', '*.webm'],
  },

  // Workflow execution
  workflow: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_WORKFLOWS || '4', 10),
    defaultPriority: process.env.DEFAULT_PRIORITY || 'normal',
    queueTimeout: parseInt(process.env.QUEUE_TIMEOUT || '600000', 10), // 10 minutes
  },

  // Display capture (Playwright)
  display: {
    enabled: process.env.DISPLAY_CAPTURE_ENABLED !== 'false',
    url: process.env.COMFYUI_URL || 'http://localhost:8188',
    displayEnv: process.env.DISPLAY || ':1',
    browser: process.env.DISPLAY_BROWSER || 'chromium',
    headless: process.env.DISPLAY_HEADLESS !== 'false',
    screenshotQuality: parseInt(process.env.SCREENSHOT_QUALITY || '90', 10),
    viewport: {
      width: parseInt(process.env.DISPLAY_WIDTH || '1920', 10),
      height: parseInt(process.env.DISPLAY_HEIGHT || '1080', 10)
    },
  },

  // LLM integration
  llm: {
    provider: process.env.LLM_PROVIDER || 'anthropic',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '4096', 10),
    zaiUrl: process.env.ZAI_URL || 'http://localhost:9600/chat',
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  },

  // Prometheus metrics
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT || '9601', 10),
    prefix: process.env.METRICS_PREFIX || 'comfyui_mcp_',
  },

  // MCP server
  server: {
    name: 'comfyui-mcp-server',
    version: '1.0.0',
    transport: process.env.MCP_TRANSPORT || 'stdio',
  },

  // Model paths
  models: {
    checkpointsDir: process.env.CHECKPOINTS_DIR || '/models/checkpoints',
    lorasDir: process.env.LORAS_DIR || '/models/loras',
    vaesDir: process.env.VAES_DIR || '/models/vae',
    embeddingsDir: process.env.EMBEDDINGS_DIR || '/models/embeddings',
    upscaleModelsDir: process.env.UPSCALE_MODELS_DIR || '/models/upscale_models',
  },
};

/**
 * Workflow templates for common operations
 */
export const WORKFLOW_TEMPLATES = {
  text2img: 'text2img_basic.json',
  img2img: 'img2img_basic.json',
  upscale: 'upscale_basic.json',
  inpaint: 'inpaint_basic.json',
  controlnet: 'controlnet_basic.json',
};

/**
 * Supported model types
 */
export const MODEL_TYPES = {
  CHECKPOINT: 'checkpoint',
  LORA: 'lora',
  VAE: 'vae',
  EMBEDDING: 'embedding',
  UPSCALE: 'upscale_model',
  CONTROLNET: 'controlnet',
};

/**
 * Priority levels for workflow execution
 */
export const PRIORITY_LEVELS = {
  LOW: 0,
  NORMAL: 5,
  HIGH: 10,
  CRITICAL: 15,
};

/**
 * Workflow execution states
 */
export const WORKFLOW_STATES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

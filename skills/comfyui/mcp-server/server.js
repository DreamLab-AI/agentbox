#!/usr/bin/env node
/**
 * ComfyUI MCP Server
 * Exposes ComfyUI tools as MCP-compatible endpoints for AI image/video generation
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');

class ComfyUIClient extends EventEmitter {
    constructor(serverUrl = 'http://localhost:8188') {
        super();
        this.serverUrl = serverUrl;
        this.wsUrl = serverUrl.replace('http', 'ws') + '/ws';
        this.ws = null;
        this.jobTracking = new Map();
        this.reconnectInterval = 5000;
        this.connectWebSocket();
    }

    connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.on('open', () => {
                console.error('[comfyui-mcp] WebSocket connected');
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleWebSocketMessage(message);
                } catch (err) {
                    console.error('[comfyui-mcp] WS message parse error:', err);
                }
            });

            this.ws.on('error', (err) => {
                console.error('[comfyui-mcp] WebSocket error:', err.message);
            });

            this.ws.on('close', () => {
                console.error('[comfyui-mcp] WebSocket closed, reconnecting...');
                setTimeout(() => this.connectWebSocket(), this.reconnectInterval);
            });
        } catch (err) {
            console.error('[comfyui-mcp] Failed to connect WebSocket:', err);
            setTimeout(() => this.connectWebSocket(), this.reconnectInterval);
        }
    }

    handleWebSocketMessage(message) {
        const { type, data } = message;

        // Track progress for active jobs
        if (type === 'progress' && data?.prompt_id) {
            const jobId = data.prompt_id;
            if (this.jobTracking.has(jobId)) {
                this.emit('progress', {
                    jobId,
                    value: data.value,
                    max: data.max,
                    node: data.node
                });
            }
        }

        // Track execution completion
        if (type === 'executed' && data?.prompt_id) {
            const jobId = data.prompt_id;
            if (this.jobTracking.has(jobId)) {
                this.emit('executed', { jobId, data });
            }
        }

        // Track execution errors
        if (type === 'execution_error' && data?.prompt_id) {
            const jobId = data.prompt_id;
            if (this.jobTracking.has(jobId)) {
                this.emit('error', { jobId, error: data });
            }
        }
    }

    async httpRequest(path, method = 'GET', body = null) {
        const url = `${this.serverUrl}${path}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    async submitWorkflow(workflow) {
        const response = await this.httpRequest('/prompt', 'POST', { prompt: workflow });
        const jobId = response.prompt_id;

        if (jobId) {
            this.jobTracking.set(jobId, {
                submitted: Date.now(),
                status: 'queued',
                workflow
            });
        }

        return { jobId, ...response };
    }

    async getJobStatus(jobId) {
        const tracked = this.jobTracking.get(jobId);
        if (!tracked) {
            return { found: false, jobId };
        }

        try {
            const history = await this.httpRequest('/history/' + jobId);
            if (history[jobId]) {
                return {
                    found: true,
                    jobId,
                    status: history[jobId].status?.status_str || 'completed',
                    outputs: history[jobId].outputs,
                    tracked: tracked.status
                };
            }

            // Check queue
            const queue = await this.httpRequest('/queue');
            const inQueue = queue.queue_running?.some(item => item[1] === jobId) ||
                           queue.queue_pending?.some(item => item[1] === jobId);

            return {
                found: true,
                jobId,
                status: inQueue ? 'queued' : tracked.status,
                tracked: tracked.status
            };
        } catch (err) {
            return {
                found: true,
                jobId,
                status: 'error',
                error: err.message
            };
        }
    }

    async cancelJob(jobId) {
        try {
            await this.httpRequest('/interrupt', 'POST');
            this.jobTracking.delete(jobId);
            return { success: true, jobId };
        } catch (err) {
            return { success: false, jobId, error: err.message };
        }
    }

    async listModels() {
        try {
            const models = await this.httpRequest('/models');
            return { success: true, models };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async listOutputs() {
        try {
            const view = await this.httpRequest('/view');
            return { success: true, outputs: view };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async captureDisplay(displayNum = 1) {
        const { execSync } = require('child_process');
        const fs = require('fs');
        const path = require('path');

        try {
            const tmpFile = path.join('/tmp', `display_${displayNum}_${Date.now()}.png`);
            execSync(`DISPLAY=:${displayNum} import -window root ${tmpFile}`);

            const imageData = fs.readFileSync(tmpFile, 'base64');
            fs.unlinkSync(tmpFile);

            return {
                success: true,
                image: imageData,
                format: 'png',
                display: displayNum
            };
        } catch (err) {
            return {
                success: false,
                error: err.message
            };
        }
    }

    buildText2ImgWorkflow(params) {
        const {
            prompt,
            width = 1024,
            height = 1024,
            seed = Math.floor(Math.random() * 1000000),
            steps = 20,
            cfg_scale = 1.0,
            sampler_name = 'euler',
            scheduler = 'simple',
            denoise = 1.0,
            guidance = 3.5
        } = params;

        return {
            "6": {
                "inputs": { "text": prompt, "clip": ["30", 1] },
                "class_type": "CLIPTextEncode"
            },
            "8": {
                "inputs": {
                    "samples": ["31", 0],
                    "vae": ["30", 2]
                },
                "class_type": "VAEDecode"
            },
            "9": {
                "inputs": {
                    "filename_prefix": "ComfyUI",
                    "images": ["8", 0]
                },
                "class_type": "SaveImage"
            },
            "27": {
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1
                },
                "class_type": "EmptySD3LatentImage"
            },
            "30": {
                "inputs": {
                    "ckpt_name": "flux1-schnell-fp8.safetensors"
                },
                "class_type": "CheckpointLoaderSimple"
            },
            "31": {
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg_scale,
                    "sampler_name": sampler_name,
                    "scheduler": scheduler,
                    "denoise": denoise,
                    "model": ["30", 0],
                    "positive": ["6", 0],
                    "negative": ["33", 0],
                    "latent_image": ["27", 0]
                },
                "class_type": "KSampler"
            },
            "33": {
                "inputs": {
                    "text": "",
                    "clip": ["30", 1]
                },
                "class_type": "CLIPTextEncode"
            }
        };
    }

    async generateImage(params) {
        try {
            const workflow = this.buildText2ImgWorkflow(params);
            return await this.submitWorkflow(workflow);
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async chatToWorkflow(prompt, llmEndpoint = 'http://localhost:9600/chat') {
        try {
            const systemPrompt = `You are a ComfyUI workflow generator. Convert natural language requests into valid ComfyUI workflow JSON.
Return ONLY valid JSON workflow structure with numbered nodes, inputs, and class_type fields.`;

            const response = await fetch(llmEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: `${systemPrompt}\n\nUser request: ${prompt}`,
                    timeout: 30000
                })
            });

            if (!response.ok) {
                throw new Error(`LLM request failed: ${response.statusText}`);
            }

            const data = await response.json();
            const workflow = JSON.parse(data.response || data.message || '{}');

            return {
                success: true,
                workflow,
                original_prompt: prompt
            };
        } catch (err) {
            return {
                success: false,
                error: err.message,
                original_prompt: prompt
            };
        }
    }
}

class ComfyUIMCPServer {
    constructor() {
        this.client = new ComfyUIClient(
            process.env.COMFYUI_URL || 'http://localhost:8188'
        );

        // Listen for progress updates
        this.client.on('progress', (data) => {
            console.error(`[comfyui-mcp] Progress ${data.jobId}: ${data.value}/${data.max}`);
        });

        this.client.on('executed', (data) => {
            console.error(`[comfyui-mcp] Job ${data.jobId} completed`);
        });

        this.client.on('error', (data) => {
            console.error(`[comfyui-mcp] Job ${data.jobId} error:`, data.error);
        });
    }

    getToolSchemas() {
        return [
            {
                name: 'workflow_submit',
                description: 'Submit a ComfyUI workflow JSON for execution',
                inputSchema: {
                    type: 'object',
                    properties: {
                        workflow: {
                            type: 'object',
                            description: 'Complete ComfyUI workflow JSON with numbered nodes'
                        }
                    },
                    required: ['workflow']
                }
            },
            {
                name: 'workflow_status',
                description: 'Check status of a submitted job by ID',
                inputSchema: {
                    type: 'object',
                    properties: {
                        job_id: {
                            type: 'string',
                            description: 'Job ID returned from workflow submission'
                        }
                    },
                    required: ['job_id']
                }
            },
            {
                name: 'workflow_cancel',
                description: 'Cancel a running job',
                inputSchema: {
                    type: 'object',
                    properties: {
                        job_id: {
                            type: 'string',
                            description: 'Job ID to cancel'
                        }
                    },
                    required: ['job_id']
                }
            },
            {
                name: 'model_list',
                description: 'List available models (checkpoints, loras, vae)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['all', 'checkpoints', 'loras', 'vae'],
                            description: 'Type of models to list',
                            default: 'all'
                        }
                    }
                }
            },
            {
                name: 'image_generate',
                description: 'Convenience text2img generation using FLUX model',
                inputSchema: {
                    type: 'object',
                    properties: {
                        prompt: {
                            type: 'string',
                            description: 'Text prompt for image generation'
                        },
                        width: {
                            type: 'integer',
                            description: 'Image width in pixels',
                            default: 1024,
                            minimum: 256,
                            maximum: 2048
                        },
                        height: {
                            type: 'integer',
                            description: 'Image height in pixels',
                            default: 1024,
                            minimum: 256,
                            maximum: 2048
                        },
                        steps: {
                            type: 'integer',
                            description: 'Number of sampling steps',
                            default: 20,
                            minimum: 1,
                            maximum: 100
                        },
                        cfg_scale: {
                            type: 'number',
                            description: 'CFG scale',
                            default: 1.0
                        },
                        seed: {
                            type: 'integer',
                            description: 'Seed for reproducibility (random if not set)'
                        }
                    },
                    required: ['prompt']
                }
            },
            {
                name: 'video_generate',
                description: 'Generate video using AnimateDiff or similar',
                inputSchema: {
                    type: 'object',
                    properties: {
                        prompt: {
                            type: 'string',
                            description: 'Text prompt for video generation'
                        },
                        frames: {
                            type: 'integer',
                            description: 'Number of frames',
                            default: 16
                        },
                        width: {
                            type: 'integer',
                            default: 512
                        },
                        height: {
                            type: 'integer',
                            default: 512
                        }
                    },
                    required: ['prompt']
                }
            },
            {
                name: 'display_capture',
                description: 'Capture screenshot from X display (default :1)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        display: {
                            type: 'integer',
                            description: 'Display number to capture',
                            default: 1
                        }
                    }
                }
            },
            {
                name: 'output_list',
                description: 'List generated outputs from ComfyUI',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'chat_workflow',
                description: 'Convert natural language to ComfyUI workflow using LLM',
                inputSchema: {
                    type: 'object',
                    properties: {
                        prompt: {
                            type: 'string',
                            description: 'Natural language description of desired workflow'
                        },
                        llm_endpoint: {
                            type: 'string',
                            description: 'LLM endpoint URL',
                            default: 'http://localhost:9600/chat'
                        }
                    },
                    required: ['prompt']
                }
            }
        ];
    }

    async handleToolCall(toolName, params) {
        try {
            let result;

            switch (toolName) {
                case 'workflow_submit':
                    result = await this.client.submitWorkflow(params.workflow);
                    break;

                case 'workflow_status':
                    result = await this.client.getJobStatus(params.job_id);
                    break;

                case 'workflow_cancel':
                    result = await this.client.cancelJob(params.job_id);
                    break;

                case 'model_list':
                    result = await this.client.listModels();
                    break;

                case 'image_generate':
                    result = await this.client.generateImage(params);
                    break;

                case 'video_generate':
                    result = {
                        success: false,
                        error: 'Video generation not yet implemented - use workflow_submit with AnimateDiff workflow'
                    };
                    break;

                case 'display_capture':
                    result = await this.client.captureDisplay(params.display || 1);
                    break;

                case 'output_list':
                    result = await this.client.listOutputs();
                    break;

                case 'chat_workflow':
                    result = await this.client.chatToWorkflow(
                        params.prompt,
                        params.llm_endpoint
                    );
                    break;

                default:
                    result = { success: false, error: `Unknown tool: ${toolName}` };
            }

            // Format response
            if (!result.success && result.error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${result.error}`
                        }
                    ],
                    isError: true
                };
            }

            // Format success response based on tool
            let responseText = this.formatResponse(toolName, result);

            return {
                content: [
                    {
                        type: 'text',
                        text: responseText
                    }
                ]
            };

        } catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error invoking tool: ${err.message}`
                    }
                ],
                isError: true
            };
        }
    }

    formatResponse(toolName, result) {
        let text = '';

        switch (toolName) {
            case 'workflow_submit':
                text = `# Workflow Submitted\n\n`;
                text += `**Job ID:** ${result.jobId}\n`;
                text += `**Queue Position:** ${result.number || 'N/A'}\n\n`;
                text += `Use \`workflow_status\` with job_id \`${result.jobId}\` to check progress.\n`;
                break;

            case 'workflow_status':
                text = `# Job Status\n\n`;
                text += `**Job ID:** ${result.jobId}\n`;
                text += `**Status:** ${result.status}\n`;
                if (result.outputs) {
                    text += `**Outputs:** ${JSON.stringify(result.outputs, null, 2)}\n`;
                }
                break;

            case 'workflow_cancel':
                text = `# Job Cancelled\n\n`;
                text += `**Job ID:** ${result.jobId}\n`;
                text += result.success ? 'Successfully interrupted.\n' : `Error: ${result.error}\n`;
                break;

            case 'model_list':
                text = `# Available Models\n\n`;
                text += `\`\`\`json\n${JSON.stringify(result.models, null, 2)}\n\`\`\`\n`;
                break;

            case 'image_generate':
                text = `# Image Generation Started\n\n`;
                text += `**Job ID:** ${result.jobId}\n`;
                text += `**Status:** Job queued for execution\n\n`;
                text += `Use \`workflow_status\` to check completion.\n`;
                break;

            case 'display_capture':
                text = `# Display Captured\n\n`;
                text += `**Display:** :${result.display}\n`;
                text += `**Format:** ${result.format}\n`;
                text += `**Image Size:** ${result.image?.length || 0} bytes (base64)\n\n`;
                text += `Image data available in result.\n`;
                break;

            case 'output_list':
                text = `# ComfyUI Outputs\n\n`;
                text += `\`\`\`json\n${JSON.stringify(result.outputs, null, 2)}\n\`\`\`\n`;
                break;

            case 'chat_workflow':
                text = `# Workflow Generated from Prompt\n\n`;
                text += `**Original Prompt:** ${result.original_prompt}\n\n`;
                text += `**Generated Workflow:**\n\`\`\`json\n${JSON.stringify(result.workflow, null, 2)}\n\`\`\`\n\n`;
                text += `Use \`workflow_submit\` to execute this workflow.\n`;
                break;

            default:
                text = JSON.stringify(result, null, 2);
        }

        return text;
    }

    async start() {
        const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
        const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
        const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

        const server = new Server(
            {
                name: 'comfyui',
                version: '1.0.0'
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );

        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: this.getToolSchemas()
            };
        });

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            return await this.handleToolCall(name, args || {});
        });

        const transport = new StdioServerTransport();
        await server.connect(transport);

        console.error('[comfyui-mcp] Server started');
    }
}

// Start server
const mcpServer = new ComfyUIMCPServer();
mcpServer.start().catch((err) => {
    console.error('[comfyui-mcp] Failed to start:', err);
    process.exit(1);
});

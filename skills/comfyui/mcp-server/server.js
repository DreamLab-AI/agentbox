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

        options.signal = AbortSignal.timeout(30000);
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        return text ? JSON.parse(text) : {};
    }

    async submitWorkflow(workflow) {
        const prompt = workflow?.prompt || workflow;
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) throw new Error('Expected an API workflow graph');
        const response = await this.httpRequest('/prompt', 'POST', { prompt });
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
        if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(jobId)) {
            throw new Error('Invalid job ID');
        }
        const history = await this.httpRequest('/history/' + encodeURIComponent(jobId));
        if (history[jobId]) {
            const item = history[jobId];
            return { found: true, jobId, status: item.status?.status_str === 'error'
                ? 'error' : item.status?.completed ? 'completed' : 'unknown',
                outputs: item.outputs || {}, diagnostics: item.status?.messages || [] };
        }
        const queue = await this.httpRequest('/queue');
        const running = queue.queue_running?.some(item => item[1] === jobId);
        const pending = queue.queue_pending?.some(item => item[1] === jobId);
        return { found: running || pending || false, jobId,
            status: running ? 'running' : pending ? 'queued' : 'unknown' };
    }

    async cancelJob(jobId) {
        const queue = await this.httpRequest('/queue');
        if (queue.queue_pending?.some(item => item[1] === jobId)) {
            await this.httpRequest('/queue', 'POST', { delete: [jobId] });
            return { success: true, jobId };
        }
        if (queue.queue_running?.some(item => item[1] === jobId)) {
            await this.httpRequest('/interrupt', 'POST', { prompt_id: jobId });
            return { success: true, jobId };
        }
        return { success: false, jobId, error: 'Job is not queued or running' };
    }

    async safeFree() {
        const idle = q => !(q.queue_running?.length || q.queue_pending?.length);
        const queue = await this.httpRequest('/queue');
        if (!idle(queue)) return { success: false, skipped: true, reason: 'queue is not idle',
            running: queue.queue_running?.length || 0, pending: queue.queue_pending?.length || 0 };
        const vram = stats => {
            const free = (stats?.devices || []).map(d => d.vram_free).filter(Number.isFinite);
            return free.length ? { free: Math.max(...free) } : null;
        };
        const before = vram(await this.httpRequest('/system_stats'));
        await this.httpRequest('/free', 'POST', { unload_models: true, free_memory: true });
        // /free is asynchronous: re-read state, and never issue a second free.
        const after = await this.httpRequest('/queue');
        return { success: true, skipped: false, vram_before: before,
            vram_after: vram(await this.httpRequest('/system_stats')), job_appeared_meanwhile: !idle(after),
            message: 'Unload requested; compare vram_before and vram_after' };
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
        const history = await this.httpRequest('/history?max_items=50');
        return { success: true, outputs: Object.entries(history).map(([jobId, item]) =>
            ({ jobId, status: item.status, outputs: item.outputs || {} })) };
    }


}

class ComfyUIMCPServer {
    constructor() {
        this.client = new ComfyUIClient(
            process.env.COMFYUI_URL || 'http://comfyui:8188'
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
            { name: 'node_info', description: 'Inspect live node schemas and available model choices before building a workflow.', inputSchema: { type: 'object', properties: { node_class: { type: 'string' } } } },
            { name: 'workflow_queue', description: 'Read running and pending prompt IDs.', inputSchema: { type: 'object', properties: {} } },
            { name: 'memory_free', description: 'Unload idle models and free GPU memory between stages; refuses while jobs are active.', inputSchema: { type: 'object', properties: {} } },
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
                description: 'Cancel the specified queued or running job; never interrupt an unrelated job',
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
                name: 'output_list',
                description: 'List generated outputs from ComfyUI',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            }
        ];
    }

    async handleToolCall(toolName, params) {
        try {
            let result;

            switch (toolName) {
                case 'node_info':
                    result = await this.client.httpRequest('/object_info' + (params.node_class ? '/' + encodeURIComponent(params.node_class) : ''));
                    break;
                case 'workflow_queue':
                    result = await this.client.httpRequest('/queue');
                    break;
                case 'memory_free': {
                    result = await this.client.safeFree();
                    break;
                }

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

                case 'output_list':
                    result = await this.client.listOutputs();
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

module.exports = { ComfyUIClient, ComfyUIMCPServer };
if (require.main === module) {
    const mcpServer = new ComfyUIMCPServer();
    mcpServer.start().catch((err) => {
        console.error('[comfyui-mcp] Failed to start:', err);
        process.exit(1);
    });
}

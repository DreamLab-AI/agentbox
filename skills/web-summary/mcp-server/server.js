#!/usr/bin/env node
/**
 * Web Summary MCP Server
 * Exposes web-summary skill tools as MCP-compatible endpoints
 */

const { spawn } = require('child_process');
const readline = require('readline');

class WebSummaryMCPServer {
    constructor() {
        this.toolProcess = null;
        this.toolPath = process.env.WEB_SUMMARY_TOOL_PATH ||
                       '/home/devuser/.claude/skills/web-summary/tools/web_summary_tool.py';
        this.initializeTool();
    }

    initializeTool() {
        // Spawn the Python tool process
        this.toolProcess = spawn('python3', [this.toolPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ZAI_CONTAINER_URL: process.env.ZAI_CONTAINER_URL || 'http://localhost:9600',
                GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || ''
            }
        });

        this.toolProcess.stderr.on('data', (data) => {
            console.error(`[web-summary-tool] ${data}`);
        });

        this.toolProcess.on('exit', (code) => {
            console.error(`[web-summary-tool] Exited with code ${code}`);
            // Auto-restart on failure
            setTimeout(() => this.initializeTool(), 1000);
        });
    }

    async invokeTool(tool, params) {
        return new Promise((resolve, reject) => {
            const request = { tool, params };
            const requestJson = JSON.stringify(request) + '\n';

            let responseData = '';

            const lineReader = readline.createInterface({
                input: this.toolProcess.stdout
            });

            const timeout = setTimeout(() => {
                lineReader.close();
                reject(new Error('Tool invocation timeout'));
            }, 60000);

            lineReader.once('line', (line) => {
                clearTimeout(timeout);
                lineReader.close();

                try {
                    const response = JSON.parse(line);
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response.result);
                    }
                } catch (err) {
                    reject(new Error(`Invalid JSON response: ${line}`));
                }
            });

            this.toolProcess.stdin.write(requestJson);
        });
    }

    getToolSchemas() {
        return [
            {
                name: 'summarize_url',
                description: 'Summarize content from any URL including YouTube videos',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL to summarize (web page or YouTube video)'
                        },
                        length: {
                            type: 'string',
                            enum: ['short', 'medium', 'long'],
                            description: 'Length of summary',
                            default: 'medium'
                        },
                        include_topics: {
                            type: 'boolean',
                            description: 'Include semantic topic links',
                            default: true
                        }
                    },
                    required: ['url']
                }
            },
            {
                name: 'youtube_transcript',
                description: 'Extract transcript from YouTube video',
                inputSchema: {
                    type: 'object',
                    properties: {
                        video_id: {
                            type: 'string',
                            description: 'YouTube video ID or full URL'
                        },
                        language: {
                            type: 'string',
                            description: 'Language code (e.g., "en", "es")',
                            default: 'en'
                        }
                    },
                    required: ['video_id']
                }
            },
            {
                name: 'generate_topics',
                description: 'Generate semantic topic links from text',
                inputSchema: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'Text to analyze for topics'
                        },
                        max_topics: {
                            type: 'integer',
                            description: 'Maximum number of topics to extract',
                            default: 10
                        },
                        format: {
                            type: 'string',
                            enum: ['logseq', 'obsidian', 'plain'],
                            description: 'Output format for topic links',
                            default: 'logseq'
                        }
                    },
                    required: ['text']
                }
            }
        ];
    }

    async handleToolCall(toolName, params) {
        try {
            const result = await this.invokeTool(toolName, params);

            if (!result.success) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${result.error || 'Unknown error occurred'}`
                        }
                    ],
                    isError: true
                };
            }

            // Format response based on tool type
            let responseText = '';

            if (toolName === 'summarize_url') {
                responseText = `# Summary of ${result.url}\n\n`;
                responseText += `**Source Type:** ${result.source_type}\n\n`;
                responseText += `## Summary\n\n${result.summary}\n\n`;

                if (result.topics && result.topics.length > 0) {
                    responseText += `## Topics\n\n${result.topics.join(', ')}\n`;
                }
            } else if (toolName === 'youtube_transcript') {
                responseText = `# YouTube Transcript\n\n`;
                responseText += `**Video ID:** ${result.video_id}\n`;
                responseText += `**Language:** ${result.language}\n`;
                responseText += `**Segments:** ${result.segments}\n\n`;
                responseText += `## Transcript\n\n${result.transcript}\n`;
            } else if (toolName === 'generate_topics') {
                responseText = `# Generated Topics (${result.count})\n\n`;
                responseText += result.topics.join('\n');
            }

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

    async start() {
        const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
        const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
        const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

        const server = new Server(
            {
                name: 'web-summary',
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

        console.error('[web-summary-mcp] Server started');
    }
}

// Start server
const mcpServer = new WebSummaryMCPServer();
mcpServer.start().catch((err) => {
    console.error('[web-summary-mcp] Failed to start:', err);
    process.exit(1);
});

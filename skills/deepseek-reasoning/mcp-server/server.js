#!/usr/bin/env node
/**
 * DeepSeek Reasoning MCP Server
 * Bridges devuser (Claude Code) to deepseek-user for special model reasoning
 *
 * Architecture:
 *   Claude Code → MCP Server → deepseek-user → DeepSeek API
 */

const { spawn } = require('child_process');
const path = require('path');

const TOOL_PATH = path.join(__dirname, '../tools/deepseek_client.js');
const DEEPSEEK_USER = process.env.DEEPSEEK_USER || 'deepseek-user';

class DeepSeekReasoningMCPServer {
  constructor() {
    this.tools = [
      {
        name: 'deepseek_reason',
        description: 'Complex multi-step reasoning with structured chain-of-thought output',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Question or problem requiring reasoning'
            },
            context: {
              type: 'string',
              description: 'Background information or constraints'
            },
            max_steps: {
              type: 'integer',
              description: 'Maximum reasoning steps to allow (1-20)',
              default: 10,
              minimum: 1,
              maximum: 20
            },
            format: {
              type: 'string',
              enum: ['prose', 'structured', 'steps'],
              description: 'Output format preference',
              default: 'structured'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'deepseek_analyze',
        description: 'Code or system analysis with root cause reasoning',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Code to analyze'
            },
            issue: {
              type: 'string',
              description: 'Problem or issue description'
            },
            language: {
              type: 'string',
              description: 'Programming language',
              enum: ['javascript', 'typescript', 'python', 'rust', 'go', 'java', 'cpp', 'other']
            },
            depth: {
              type: 'string',
              enum: ['quick', 'normal', 'deep'],
              description: 'Analysis depth',
              default: 'normal'
            }
          },
          required: ['code', 'issue']
        }
      },
      {
        name: 'deepseek_plan',
        description: 'Task planning with dependency analysis and reasoning',
        inputSchema: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: 'What to achieve'
            },
            constraints: {
              type: 'string',
              description: 'Limitations, requirements, or prerequisites'
            },
            context: {
              type: 'string',
              description: 'Existing system or project context'
            },
            granularity: {
              type: 'string',
              enum: ['coarse', 'medium', 'fine'],
              description: 'Task breakdown granularity',
              default: 'medium'
            }
          },
          required: ['goal']
        }
      }
    ];
  }

  async handleToolCall(name, params) {
    const args = ['--tool', name];

    // Convert params to JSON argument
    args.push('--params', JSON.stringify(params));

    return this._executeAsDeepSeekUser(args);
  }

  async _executeAsDeepSeekUser(args) {
    return new Promise((resolve, reject) => {
      // Execute as deepseek-user via sudo
      const sudoArgs = [
        '-u', DEEPSEEK_USER,
        'node', TOOL_PATH,
        ...args
      ];

      const proc = spawn('sudo', sudoArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`DeepSeek client failed (code ${code}): ${stderr}`));
        } else {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse DeepSeek output: ${e.message}\nOutput: ${stdout}`));
          }
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn process: ${err.message}`));
      });
    });
  }

  async start() {
    console.error('DeepSeek Reasoning MCP Server starting...');
    console.error(`Bridge: devuser → ${DEEPSEEK_USER} → DeepSeek API`);

    // MCP protocol: Read JSON-RPC requests from stdin, write responses to stdout
    process.stdin.setEncoding('utf8');

    let buffer = '';

    process.stdin.on('data', async (chunk) => {
      buffer += chunk;

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line);
          const response = await this.handleRequest(request);
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
          console.error('Request error:', error);
          process.stdout.write(JSON.stringify({
            error: error.message,
            request: line.substring(0, 100)
          }) + '\n');
        }
      }
    });

    process.stdin.on('end', () => {
      console.error('DeepSeek Reasoning MCP Server shutting down...');
      process.exit(0);
    });

    console.error('DeepSeek Reasoning MCP Server ready');
    console.error(`Tools: ${this.tools.map(t => t.name).join(', ')}`);
  }

  async handleRequest(request) {
    const { method, params, id } = request;

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'deepseek-reasoning',
              version: '1.0.0'
            }
          }
        };
      }

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.tools
          }
        };
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params;

        const result = await this.handleToolCall(name, args);

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
              }
            ]
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown method: ${method}`
        }
      };

    } catch (error) {
      console.error('Handler error:', error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error.message
        }
      };
    }
  }
}

// Start server
const server = new DeepSeekReasoningMCPServer();
server.start().catch((error) => {
  console.error('Failed to start DeepSeek Reasoning MCP Server:', error);
  process.exit(1);
});

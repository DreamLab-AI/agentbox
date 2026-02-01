#!/usr/bin/env node
/**
 * Perplexity MCP Server
 * Exposes Perplexity research tools via MCP protocol
 */

const { spawn } = require('child_process');
const path = require('path');

const TOOL_PATH = path.join(__dirname, '../tools/perplexity_client.py');

class PerplexityMCPServer {
  constructor() {
    this.tools = [
      {
        name: 'perplexity_search',
        description: 'Quick search with real-time web access and citations',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            model: {
              type: 'string',
              enum: ['sonar', 'sonar-pro', 'sonar-reasoning'],
              description: 'Model to use (sonar=fast, sonar-pro=deep, sonar-reasoning=complex)',
              default: 'sonar'
            },
            timeframe: {
              type: 'string',
              enum: ['day', 'week', 'month', 'year'],
              description: 'Recency filter for sources'
            },
            sources: {
              type: 'integer',
              description: 'Number of sources to return (1-20)',
              default: 5,
              minimum: 1,
              maximum: 20
            }
          },
          required: ['query']
        }
      },
      {
        name: 'perplexity_research',
        description: 'Deep research with structured output and comprehensive citations',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Research topic'
            },
            context: {
              type: 'string',
              description: 'Additional background context'
            },
            format: {
              type: 'string',
              enum: ['prose', 'table', 'bullet', 'executive', 'report'],
              description: 'Output format',
              default: 'prose'
            },
            uk_focus: {
              type: 'boolean',
              description: 'Prioritize UK/EU sources and context',
              default: true
            },
            timeframe: {
              type: 'string',
              description: 'Recency constraint (e.g., "90 days", "1 year")'
            },
            sources: {
              type: 'integer',
              description: 'Number of sources to cite (5-20)',
              default: 10,
              minimum: 5,
              maximum: 20
            }
          },
          required: ['topic']
        }
      },
      {
        name: 'perplexity_generate_prompt',
        description: 'Generate optimized Perplexity prompt using best practices',
        inputSchema: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: 'What you want to achieve'
            },
            context: {
              type: 'string',
              description: 'Background information'
            },
            constraints: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific requirements or limitations'
            },
            uk_focus: {
              type: 'boolean',
              description: 'Add UK/European context',
              default: true
            }
          },
          required: ['goal']
        }
      }
    ];
  }

  async handleToolCall(name, params) {
    const args = ['--mode', this._getModeForTool(name)];

    // Build command line args
    if (name === 'perplexity_search') {
      args.push(params.query);
      if (params.model) args.push('--model', params.model);
      if (params.timeframe) args.push('--timeframe', params.timeframe);
      if (params.sources) args.push('--sources', params.sources.toString());
    } else if (name === 'perplexity_research') {
      args.push(params.topic);
      if (params.context) args.push('--context', params.context);
      if (params.format) args.push('--format', params.format);
      if (params.uk_focus) args.push('--uk-focus');
      if (params.timeframe) args.push('--timeframe', params.timeframe);
      if (params.sources) args.push('--sources', params.sources.toString());
    } else if (name === 'perplexity_generate_prompt') {
      args.push(params.goal);
      if (params.context) args.push('--context', params.context);
      if (params.uk_focus) args.push('--uk-focus');
    }

    return this._executePython(args);
  }

  _getModeForTool(toolName) {
    const modeMap = {
      'perplexity_search': 'search',
      'perplexity_research': 'research',
      'perplexity_generate_prompt': 'generate'
    };
    return modeMap[toolName] || 'search';
  }

  async _executePython(args) {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [TOOL_PATH, ...args]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        } else {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}`));
          }
        }
      });

      python.on('error', (err) => {
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });
    });
  }

  async start() {
    console.log('Perplexity MCP Server starting...');

    // MCP protocol: Read requests from stdin, write responses to stdout
    process.stdin.setEncoding('utf8');

    let buffer = '';

    process.stdin.on('data', async (chunk) => {
      buffer += chunk;

      // Process complete JSON messages
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line);
          const response = await this.handleRequest(request);
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
          process.stdout.write(JSON.stringify({
            error: error.message,
            request: line
          }) + '\n');
        }
      }
    });

    process.stdin.on('end', () => {
      console.log('Perplexity MCP Server shutting down...');
      process.exit(0);
    });

    console.log('Perplexity MCP Server ready');
  }

  async handleRequest(request) {
    const { method, params } = request;

    if (method === 'tools/list') {
      return {
        tools: this.tools
      };
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;

      try {
        const result = await this.handleToolCall(name, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    }

    return {
      error: `Unknown method: ${method}`
    };
  }
}

// Start server
const server = new PerplexityMCPServer();
server.start().catch((error) => {
  console.error('Failed to start Perplexity MCP Server:', error);
  process.exit(1);
});

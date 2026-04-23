#!/usr/bin/env node
// ============================================================================
// OpenAI Codex MCP Server v2.0.0
// Exposes GPT-5.4 coding capabilities as MCP tools for cross-agent delegation
// Runs as openai-user (UID 1002), called by devuser (Ruflo) via MCP bridge
// ============================================================================

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.4';

const server = new Server(
  { name: 'openai-codex', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'codex_generate',
      description: `Delegate complex reasoning or architectural coding tasks to OpenAI Codex (${MODEL}). Use for second-opinion code generation, algorithm design, or cross-model verification.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The precise coding task, reasoning problem, or architectural question',
          },
          language: {
            type: 'string',
            description: 'Target programming language or framework (default: typescript)',
          },
          system_prompt: {
            type: 'string',
            description: 'Optional system prompt override for specialized behavior',
          },
          max_tokens: {
            type: 'number',
            description: 'Maximum tokens in response (default: 4096)',
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature 0-2 (default: 0.2 for code)',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'codex_review',
      description: `Submit code for review by OpenAI ${MODEL}. Returns analysis of bugs, improvements, and security issues.`,
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The code to review',
          },
          language: {
            type: 'string',
            description: 'Programming language of the code',
          },
          focus: {
            type: 'string',
            enum: ['bugs', 'security', 'performance', 'readability', 'all'],
            description: 'Review focus area (default: all)',
          },
        },
        required: ['code'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'codex_generate': {
        const {
          prompt,
          language = 'typescript',
          system_prompt,
          max_tokens = 4096,
          temperature = 0.2,
        } = args;

        const systemMsg = system_prompt ||
          `You are an expert Codex developer. Generate optimal, production-ready ${language} code. ` +
          'Be concise. Include only the code and brief inline comments where non-obvious.';

        const response = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: prompt },
          ],
          max_tokens,
          temperature,
        });

        const content = response.choices[0].message.content;
        const usage = response.usage;

        return {
          content: [
            {
              type: 'text',
              text: content + (usage
                ? `\n\n---\n_Model: ${MODEL} | Tokens: ${usage.prompt_tokens}→${usage.completion_tokens} (${usage.total_tokens} total)_`
                : ''),
            },
          ],
        };
      }

      case 'codex_review': {
        const { code, language = 'unknown', focus = 'all' } = args;

        const focusInstructions = {
          bugs: 'Focus exclusively on bugs, logic errors, and edge cases.',
          security: 'Focus exclusively on security vulnerabilities (OWASP Top 10, injection, auth issues).',
          performance: 'Focus exclusively on performance bottlenecks, memory leaks, and optimization opportunities.',
          readability: 'Focus exclusively on code clarity, naming, structure, and maintainability.',
          all: 'Review for bugs, security issues, performance problems, and readability improvements.',
        };

        const response = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: `You are a senior code reviewer. ${focusInstructions[focus] || focusInstructions.all} ` +
                'Format as: **Issue** (severity: critical/high/medium/low) followed by explanation and fix.',
            },
            {
              role: 'user',
              content: `Review this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
            },
          ],
          max_tokens: 4096,
          temperature: 0.1,
        });

        return {
          content: [{ type: 'text', text: response.choices[0].message.content }],
        };
      }

      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Codex Error (${MODEL}): ${err.message}${err.status ? ` [HTTP ${err.status}]` : ''}`,
        },
      ],
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[openai-codex] MCP server started (model: ${MODEL})`);
}

main().catch((err) => {
  console.error('[openai-codex] Fatal:', err);
  process.exit(1);
});

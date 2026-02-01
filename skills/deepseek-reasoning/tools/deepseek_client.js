#!/usr/bin/env node
/**
 * DeepSeek Special Model Client
 * Executes as deepseek-user, calls special endpoint
 *
 * Must run as deepseek-user (UID 1004) for credential access
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(process.env.HOME, '.config/deepseek/config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error(JSON.stringify({
    error: 'Failed to load DeepSeek configuration',
    path: configPath,
    message: error.message
  }));
  process.exit(1);
}

const API_KEY = config.apiKey;
// Use standard endpoint with reasoner model instead of special endpoint
const BASE_URL = 'https://api.deepseek.com';
const MODEL = 'deepseek-reasoner'; // Reasoner model with thinking capability

class DeepSeekClient {
  constructor() {
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.7;
  }

  async makeRequest(messages, options = {}) {
    // For deepseek-reasoner: temperature, top_p, etc. are not supported
    const requestBody = {
      model: MODEL,
      messages,
      max_tokens: options.maxTokens || this.maxTokens,
      stream: false
    };

    // Don't include unsupported parameters for reasoning model
    // (temperature, top_p, presence_penalty, frequency_penalty have no effect)

    const data = JSON.stringify(requestBody);

    // Parse URL
    const url = new URL(BASE_URL + '/v1/chat/completions');

    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(requestOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API error ${res.statusCode}: ${body}`));
            return;
          }
          try {
            const response = JSON.parse(body);
            resolve(response);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async reason(params) {
    const { query, context, max_steps = 10, format = 'structured' } = params;

    let prompt = `You are a reasoning AI. Think step-by-step and provide detailed reasoning.\n\n`;
    prompt += `Question: ${query}\n`;

    if (context) {
      prompt += `Context: ${context}\n`;
    }

    prompt += `\nProvide your reasoning in ${max_steps} steps or fewer. `;

    if (format === 'structured') {
      prompt += `Format as:\nStep 1: [thought] → [conclusion]\nStep 2: [thought] → [conclusion]\n...\nFinal Answer: [answer]`;
    } else if (format === 'steps') {
      prompt += `Format as numbered steps with clear conclusions.`;
    }

    const messages = [{ role: 'user', content: prompt }];

    const response = await this.makeRequest(messages, { maxTokens: 2048 });

    // deepseek-reasoner returns reasoning_content (CoT) + content (answer)
    const message = response.choices[0].message;

    return {
      reasoning: {
        thinking: message.reasoning_content || 'No reasoning trace',
        answer: message.content,
        format,
        query
      },
      usage: response.usage,
      model: response.model
    };
  }

  async analyze(params) {
    const { code, issue, language = 'unknown', depth = 'normal' } = params;

    const depthMap = {
      quick: 'Provide a quick analysis',
      normal: 'Provide a thorough analysis',
      deep: 'Provide an exhaustive deep-dive analysis with multiple perspectives'
    };

    const prompt = `${depthMap[depth]} of this code issue.

Language: ${language}

Issue: ${issue}

Code:
\`\`\`${language}
${code}
\`\`\`

Provide:
1. Root cause analysis with reasoning
2. Why this causes the observed issue
3. Recommended fixes with rationale
4. Potential side effects

Format as structured analysis with clear reasoning for each point.`;

    const messages = [{ role: 'user', content: prompt }];

    const response = await this.makeRequest(messages, { maxTokens: 3072 });

    const message = response.choices[0].message;

    return {
      analysis: {
        thinking: message.reasoning_content || 'No reasoning trace',
        result: message.content,
        issue,
        language,
        depth
      },
      usage: response.usage,
      model: response.model
    };
  }

  async plan(params) {
    const { goal, constraints, context, granularity = 'medium' } = params;

    const granularityMap = {
      coarse: 'high-level phases (3-5 major steps)',
      medium: 'actionable tasks (10-20 tasks)',
      fine: 'detailed subtasks (30-50 fine-grained steps)'
    };

    let prompt = `You are a planning AI. Break down this goal into ${granularityMap[granularity]}.\n\n`;
    prompt += `Goal: ${goal}\n`;

    if (constraints) {
      prompt += `Constraints: ${constraints}\n`;
    }

    if (context) {
      prompt += `Context: ${context}\n`;
    }

    prompt += `\nProvide:
1. Phases/stages with clear objectives
2. Tasks/steps within each phase
3. Dependencies between tasks
4. Reasoning for the plan structure
5. Critical path identification

Format as structured plan with reasoning for each decision.`;

    const messages = [{ role: 'user', content: prompt }];

    const response = await this.makeRequest(messages, { maxTokens: 3072 });

    const message = response.choices[0].message;

    return {
      plan: {
        thinking: message.reasoning_content || 'No reasoning trace',
        result: message.content,
        goal,
        granularity
      },
      usage: response.usage,
      model: response.model
    };
  }

  async handleTool(tool, params) {
    switch (tool) {
      case 'deepseek_reason':
        return this.reason(params);
      case 'deepseek_analyze':
        return this.analyze(params);
      case 'deepseek_plan':
        return this.plan(params);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: deepseek_client.js --tool <name> --params <json>');
    process.exit(1);
  }

  let tool, params;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tool' && i + 1 < args.length) {
      tool = args[++i];
    } else if (args[i] === '--params' && i + 1 < args.length) {
      try {
        params = JSON.parse(args[++i]);
      } catch (e) {
        console.error(JSON.stringify({
          error: 'Invalid JSON params',
          message: e.message
        }));
        process.exit(1);
      }
    }
  }

  if (!tool) {
    console.error(JSON.stringify({
      error: 'Missing --tool argument'
    }));
    process.exit(1);
  }

  if (!params) {
    console.error(JSON.stringify({
      error: 'Missing --params argument'
    }));
    process.exit(1);
  }

  try {
    const client = new DeepSeekClient();
    const result = await client.handleTool(tool, params);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      tool,
      params
    }));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      error: 'Fatal error',
      message: error.message,
      stack: error.stack
    }));
    process.exit(1);
  });
}

module.exports = { DeepSeekClient };

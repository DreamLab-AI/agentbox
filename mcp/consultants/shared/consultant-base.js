'use strict';

/**
 * BaseConsultant — common scaffolding for every MCP server under
 * mcp/consultants/<name>/. Wraps the @modelcontextprotocol/sdk wire
 * (stdio transport, tool registration, error envelopes), the JSONL
 * audit log (memory-logger.js), and a per-call timeout so each
 * concrete consultant only has to implement three async functions.
 *
 * Usage:
 *   const { BaseConsultant } = require('../shared/consultant-base');
 *   const consultant = new BaseConsultant({
 *     name: 'codex',
 *     description: 'OpenAI Codex Rust CLI consultant',
 *     model: 'gpt-5.5',
 *     callConsult: async ({ question, context_excerpt, format }) => ({
 *       response, model, tokens, cost_usd, citations,
 *     }),
 *     healthCheck: async () => ({ ok, model, last_error }),
 *     estimateCost: async ({ question_size, expected_response_size }) => ({
 *       estimated_tokens, estimated_usd,
 *     }),
 *   });
 *   consultant.start();
 *
 * @see PRD-005 §Wire contract
 * @see ADR-011 §Tool surface
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } =
  require('@modelcontextprotocol/sdk/types.js');

const crypto = require('crypto');
const { MemoryLogger } = require('./memory-logger');

const DEFAULT_TIMEOUT_MS = 120_000;

class BaseConsultant {
  /**
   * @param {object}   opts
   * @param {string}   opts.name              short id (used in logs and tool envelopes)
   * @param {string}   opts.description       passed through to MCP listTools
   * @param {string}   opts.model             concrete model id reported in /health
   * @param {Function} opts.callConsult       async ({question, context_excerpt, format}) => {response, model, tokens, cost_usd, citations}
   * @param {Function} opts.healthCheck       async () => {ok, model, last_error}
   * @param {Function} opts.estimateCost      async ({question_size, expected_response_size}) => {estimated_tokens, estimated_usd}
   * @param {number}   [opts.timeout_ms]      per-call timeout (default 120_000)
   * @param {string}   [opts.log_dir]         override JSONL log directory
   * @param {object}   [opts.logger]          structured logger (pino-style); defaults to console
   */
  constructor(opts) {
    if (!opts || !opts.name)         throw new Error('BaseConsultant: name required');
    if (!opts.callConsult)           throw new Error('BaseConsultant: callConsult required');
    if (!opts.healthCheck)           throw new Error('BaseConsultant: healthCheck required');
    if (!opts.estimateCost)          throw new Error('BaseConsultant: estimateCost required');

    this.name        = opts.name;
    this.description = opts.description || `Consult ${opts.name}`;
    this.model       = opts.model       || 'unknown';
    this.callConsult  = opts.callConsult;
    this.healthCheck  = opts.healthCheck;
    this.estimateCost = opts.estimateCost;
    this.timeout_ms   = opts.timeout_ms || DEFAULT_TIMEOUT_MS;
    this.logger       = opts.logger     || console;
    this.memlog       = new MemoryLogger({
      consultant: this.name,
      log_dir:    opts.log_dir,
    });

    this.server = new Server(
      { name: `consultant-${this.name}`, version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    this._registerHandlers();
  }

  _registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this._toolList(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args = {} } = req.params;
      try {
        if (name === 'consult')       return this._envelope(await this._handleConsult(args));
        if (name === 'health')        return this._envelope(await this._handleHealth());
        if (name === 'cost_estimate') return this._envelope(await this._handleEstimate(args));
        throw new Error(`unknown tool: ${name}`);
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              consultant: this.name,
              error: err.message || String(err),
            }, null, 2),
          }],
          isError: true,
        };
      }
    });
  }

  _toolList() {
    return [
      {
        name: 'consult',
        description: `${this.description}. Submit a question and optional context excerpt; receive the consultant's answer with model, token usage, cost, and any citations.`,
        inputSchema: {
          type: 'object',
          properties: {
            question:        { type: 'string', description: 'The question or task to put to the consultant.' },
            context_excerpt: { type: 'string', description: 'Curated context the coordinator wants the consultant to see. Keep this small — the coordinator picks what matters.' },
            format:          { type: 'string', enum: ['markdown', 'plain', 'json'], description: 'Preferred response format. Default markdown.' },
            timeout_ms:      { type: 'number', description: 'Override the per-call timeout. Capped at 600000.' },
          },
          required: ['question'],
        },
      },
      {
        name: 'health',
        description: `Liveness + auth probe for the ${this.name} consultant. Returns ok/model/last_error without consuming a paid call.`,
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'cost_estimate',
        description: `Estimate the USD cost of a consult call given question size and (optionally) expected response size, both in tokens.`,
        inputSchema: {
          type: 'object',
          properties: {
            question_size:           { type: 'number', description: 'Approximate token count of the question + context excerpt.' },
            expected_response_size:  { type: 'number', description: 'Approximate token count of the expected response. Default 800.' },
          },
          required: ['question_size'],
        },
      },
    ];
  }

  async _handleConsult(args) {
    if (typeof args.question !== 'string' || args.question.trim().length === 0) {
      throw new Error('question is required and must be a non-empty string');
    }
    const t0 = Date.now();
    const timeout_ms = Math.min(args.timeout_ms || this.timeout_ms, 600_000);

    let result;
    try {
      result = await this._withTimeout(
        this.callConsult({
          question:        args.question,
          context_excerpt: args.context_excerpt || '',
          format:          args.format || 'markdown',
        }),
        timeout_ms
      );
    } catch (err) {
      this.memlog.log({
        ok: false,
        consultant: this.name,
        question:   args.question,
        context_size: (args.context_excerpt || '').length,
        error:      err.message || String(err),
        latency_ms: Date.now() - t0,
      });
      throw err;
    }

    const consultHash = crypto.createHash('sha256')
      .update(`${this.name}:${args.question}`)
      .digest('hex')
      .slice(0, 12);

    const envelope = {
      ok:         true,
      consultant: this.name,
      response:   result.response,
      model:      result.model || this.model,
      tokens:     result.tokens || {},
      cost_usd:   typeof result.cost_usd === 'number' ? result.cost_usd : null,
      citations:  Array.isArray(result.citations) ? result.citations : [],
      latency_ms: Date.now() - t0,
    };
    envelope.consultation_urn = `urn:agentbox:activity:sha256-12-${consultHash}`;
    envelope.source_urn = process.env.AGENTBOX_URN
      || process.env.AGENTBOX_DID
      || `urn:agentbox:agent:consultant-${this.name}`;

    this.memlog.log({
      ok:           true,
      consultant:   this.name,
      question:     args.question,
      context_size: (args.context_excerpt || '').length,
      response_len: typeof result.response === 'string' ? result.response.length : 0,
      model:        envelope.model,
      tokens:       envelope.tokens,
      cost_usd:     envelope.cost_usd,
      latency_ms:   envelope.latency_ms,
      citations:    envelope.citations.length,
      consultation_urn: envelope.consultation_urn,
    });

    return envelope;
  }

  async _handleHealth() {
    try {
      const h = await this._withTimeout(this.healthCheck(), 10_000);
      return {
        ok:           !!h.ok,
        consultant:   this.name,
        model:        h.model || this.model,
        last_error:   h.last_error || null,
        last_check_at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok:           false,
        consultant:   this.name,
        model:        this.model,
        last_error:   err.message || String(err),
        last_check_at: new Date().toISOString(),
      };
    }
  }

  async _handleEstimate(args) {
    if (typeof args.question_size !== 'number' || args.question_size < 0) {
      throw new Error('question_size must be a non-negative number');
    }
    const expected = typeof args.expected_response_size === 'number' && args.expected_response_size >= 0
      ? args.expected_response_size
      : 800;
    const result = await this.estimateCost({
      question_size:           args.question_size,
      expected_response_size:  expected,
    });
    return {
      consultant:        this.name,
      estimated_tokens:  result.estimated_tokens || { prompt: args.question_size, completion: expected },
      estimated_usd:     typeof result.estimated_usd === 'number' ? result.estimated_usd : 0,
      currency:          'USD',
    };
  }

  _envelope(body) {
    return {
      content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    };
  }

  _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`consultant ${this.name}: timed out after ${ms} ms`)), ms);
      Promise.resolve(promise).then(
        v => { clearTimeout(t); resolve(v); },
        e => { clearTimeout(t); reject(e); }
      );
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.error(`[consultant-${this.name}] ready on stdio (model=${this.model})`);
  }
}

module.exports = { BaseConsultant };

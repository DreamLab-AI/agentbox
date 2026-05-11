'use strict';

/**
 * /v1/pay/* -- HTTP 402 Web Ledger payment routes.
 *
 * Bridges the management API to the embedded solid-pod-rs payment module
 * running on localhost. Routes that require balance state or TXO validation
 * proxy to solid-pod-rs; the cost estimator runs locally using env-var tiers.
 *
 * Routes:
 *
 *   GET  /v1/pay/info     -- service payment metadata (chains, tokens, operator DID)
 *   GET  /v1/pay/balance  -- query user balance by DID (NIP-98 auth required)
 *   POST /v1/pay/deposit  -- submit TXO deposit proof
 *   POST /v1/pay/estimate -- pre-flight cost estimate for a job (local computation)
 *   POST /v1/pay/buy      -- buy DREAM tokens with sats
 *   POST /v1/pay/withdraw -- withdraw sats by burning DREAM tokens
 *
 * Environment:
 *
 *   SOLID_POD_PORT        -- port of the solid-pod-rs instance (default: 8484)
 *   BASE_COST_SATS        -- base cost per unit in satoshis (default: 10)
 *   DREAM_PER_SAT         -- DREAM tokens minted per sat (default: 10)
 *   INFERENCE_MULTIPLIER  -- cost multiplier for inference tier (default: 10)
 *   IMAGE_GEN_MULTIPLIER  -- cost multiplier for image-gen tier (default: 100)
 *   ANALYTICS_MULTIPLIER  -- cost multiplier for analytics tier (default: 5)
 *   HOLD_BUFFER_RATIO     -- hold buffer above estimated cost (default: 1.2)
 *   AGENTBOX_PUBKEY       -- operator BIP-340 x-only pubkey hex
 *
 * Auth: all routes are behind the global onRequest auth hook (bearer/NIP-98).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POD_BASE = `http://127.0.0.1:${process.env.SOLID_POD_PORT || 8484}`;

const BASE_COST_SATS       = parseInt(process.env.BASE_COST_SATS, 10) || 10;
const DREAM_PER_SAT        = parseFloat(process.env.DREAM_PER_SAT) || 10;
const INFERENCE_MULTIPLIER = parseFloat(process.env.INFERENCE_MULTIPLIER) || 10;
const IMAGE_GEN_MULTIPLIER = parseFloat(process.env.IMAGE_GEN_MULTIPLIER) || 100;
const ANALYTICS_MULTIPLIER = parseFloat(process.env.ANALYTICS_MULTIPLIER) || 5;
const HOLD_BUFFER_RATIO    = parseFloat(process.env.HOLD_BUFFER_RATIO) || 1.2;

const TIER_MULTIPLIERS = Object.freeze({
  'inference':  INFERENCE_MULTIPLIER,
  'image-gen':  IMAGE_GEN_MULTIPLIER,
  'analytics':  ANALYTICS_MULTIPLIER,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Proxy-fetch a solid-pod-rs payment endpoint. Returns { status, headers, body }
 * or throws with a descriptive error and statusCode property on failure.
 */
async function podFetch(method, urlPath, { body, headers, logger } = {}) {
  const url = `${POD_BASE}${urlPath}`;
  const opts = {
    method,
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  logger.debug({ url, method }, 'payments: pod-rs proxy call');

  let res;
  try {
    res = await fetch(url, opts);
  } catch (fetchErr) {
    logger.error({ url, err: fetchErr.message }, 'payments: pod-rs unreachable');
    const err = new Error(`Payment service unreachable: ${fetchErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    logger.warn({ url, status: res.status, body: json }, 'payments: pod-rs error response');
    const err = new Error(json.error || json.message || `Payment service returned ${res.status}`);
    err.statusCode = res.status >= 500 ? 502 : res.status;
    err.upstream = json;
    throw err;
  }

  return {
    status: res.status,
    headers: res.headers,
    body: json,
  };
}

/**
 * Extract the caller DID from the request auth context.
 * NIP-98 auth populates req.auth.pubkey; bearer auth has no identity.
 * Returns `did:nostr:<hex>` or null.
 */
function callerDid(req) {
  const auth = req.auth || {};
  if (auth.mode === 'nip98' && auth.pubkey) {
    return `did:nostr:${auth.pubkey}`;
  }
  return null;
}

/**
 * Forward NIP-98 auth headers to the pod-rs proxy so it can attribute
 * the request to the correct identity.
 */
function authHeaders(req) {
  const h = {};
  const authHeader = req.headers.authorization;
  if (authHeader) {
    h['Authorization'] = authHeader;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

async function paymentRoutes(fastify, options) {
  const { logger, metrics } = options;

  // -------------------------------------------------------------------
  // GET /v1/pay/info -- service payment metadata
  // -------------------------------------------------------------------
  fastify.get('/v1/pay/info', {
    schema: {
      tags: ['payments'],
      description: 'Service payment metadata: supported chains, token config, base cost, operator DID',
      response: {
        200: {
          type: 'object',
          properties: {
            chains:        { type: 'array', items: { type: 'string' } },
            base_cost_sats: { type: 'number' },
            dream_per_sat: { type: 'number' },
            currency:      { type: 'string' },
            token_ticker:  { type: 'string' },
            operator_did:  { type: ['string', 'null'] },
            tiers:         { type: 'object' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    // Attempt to fetch upstream info from solid-pod-rs for chain list
    let upstream = null;
    try {
      const result = await podFetch('GET', '/pay/.info', { logger });
      upstream = result.body;
    } catch (err) {
      logger.warn({ err: err.message }, 'payments: pod-rs /pay/.info unreachable, returning local config');
    }

    const operatorPubkey = process.env.AGENTBOX_PUBKEY || process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || null;
    const operatorDid = operatorPubkey ? `did:nostr:${operatorPubkey}` : null;

    return {
      chains:         (upstream && upstream.chains) || ['btc'],
      base_cost_sats: BASE_COST_SATS,
      dream_per_sat:  DREAM_PER_SAT,
      currency:       'sats',
      token_ticker:   'DREAM',
      operator_did:   operatorDid,
      tiers: {
        inference:  { multiplier: INFERENCE_MULTIPLIER,  cost_sats: BASE_COST_SATS * INFERENCE_MULTIPLIER },
        'image-gen': { multiplier: IMAGE_GEN_MULTIPLIER, cost_sats: BASE_COST_SATS * IMAGE_GEN_MULTIPLIER },
        analytics:  { multiplier: ANALYTICS_MULTIPLIER,  cost_sats: BASE_COST_SATS * ANALYTICS_MULTIPLIER },
      },
      ...(upstream || {}),
    };
  });

  // -------------------------------------------------------------------
  // GET /v1/pay/balance -- query user balance by DID
  // -------------------------------------------------------------------
  fastify.get('/v1/pay/balance', {
    schema: {
      tags: ['payments'],
      description: 'Query caller balance (NIP-98 auth required to identify DID)',
      response: {
        200: {
          type: 'object',
          properties: {
            did:           { type: 'string' },
            balance_sats:  { type: 'number' },
            dream_balance: { type: 'number' },
            currency:      { type: 'string' },
            token_ticker:  { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const did = callerDid(req);
    if (!did) {
      return reply.code(401).send({
        error: 'identity-required',
        message: 'NIP-98 auth is required to query balance. Bearer auth does not carry an identity.',
      });
    }

    let result;
    try {
      result = await podFetch('GET', '/pay/.balance', {
        headers: authHeaders(req),
        logger,
      });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: err.message,
      });
    }

    const balanceSats = result.body.balance_sats
      ?? parseInt(result.headers.get('X-Balance') || '0', 10);
    const currency = result.body.currency
      || result.headers.get('X-Pay-Currency')
      || 'sats';

    reply.header('X-Balance', String(balanceSats));
    reply.header('X-Pay-Currency', currency);

    return {
      did,
      balance_sats: balanceSats,
      dream_balance: balanceSats * DREAM_PER_SAT,
      currency,
      token_ticker: 'DREAM',
      ...result.body,
    };
  });

  // -------------------------------------------------------------------
  // POST /v1/pay/deposit -- submit TXO deposit proof
  // -------------------------------------------------------------------
  fastify.post('/v1/pay/deposit', {
    schema: {
      tags: ['payments'],
      description: 'Submit a TXO deposit proof to credit the caller balance',
      body: {
        type: 'object',
        required: ['txo_uri', 'amount_sats'],
        properties: {
          txo_uri:     { type: 'string', description: 'TXO URI e.g. txo:btc:txid:vout' },
          amount_sats: { type: 'number', minimum: 1, description: 'Amount in satoshis' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            credited:      { type: 'boolean' },
            txo_uri:       { type: 'string' },
            amount_sats:   { type: 'number' },
            new_balance:   { type: 'number' },
            dream_balance: { type: 'number' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const did = callerDid(req);
    if (!did) {
      return reply.code(401).send({
        error: 'identity-required',
        message: 'NIP-98 auth is required for deposits.',
      });
    }

    const { txo_uri, amount_sats } = req.body;

    logger.info({ did, txo_uri, amount_sats }, 'payments: deposit request');

    let result;
    try {
      result = await podFetch('POST', '/pay/.deposit', {
        body: { txo_uri, amount_sats },
        headers: authHeaders(req),
        logger,
      });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: err.message,
      });
    }

    const newBalance = result.body.new_balance ?? result.body.balance_sats ?? amount_sats;

    return {
      credited: true,
      txo_uri,
      amount_sats,
      new_balance: newBalance,
      dream_balance: newBalance * DREAM_PER_SAT,
      ...result.body,
    };
  });

  // -------------------------------------------------------------------
  // POST /v1/pay/estimate -- pre-flight cost estimate (local computation)
  // -------------------------------------------------------------------
  fastify.post('/v1/pay/estimate', {
    schema: {
      tags: ['payments'],
      description: 'Pre-flight cost estimate for a job. Computed locally from env-var tiers.',
      body: {
        type: 'object',
        required: ['endpoint', 'units'],
        properties: {
          endpoint: {
            type: 'string',
            enum: ['inference', 'image-gen', 'analytics'],
            description: 'Job endpoint tier',
          },
          units: {
            type: 'number',
            minimum: 1,
            description: 'Number of units (tokens, images, queries)',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            endpoint:       { type: 'string' },
            units:          { type: 'number' },
            estimated_sats: { type: 'number' },
            hold_sats:      { type: 'number' },
            dream_tokens:   { type: 'number' },
            rate:           { type: 'number' },
            breakdown: {
              type: 'object',
              properties: {
                base_cost_sats: { type: 'number' },
                multiplier:     { type: 'number' },
                per_unit_sats:  { type: 'number' },
                units:          { type: 'number' },
                hold_buffer:    { type: 'number' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { endpoint, units } = req.body;

    const multiplier = TIER_MULTIPLIERS[endpoint];
    if (multiplier === undefined) {
      return reply.code(400).send({
        error: 'unknown-tier',
        message: `Unknown endpoint tier: ${endpoint}. Valid: ${Object.keys(TIER_MULTIPLIERS).join(', ')}`,
      });
    }

    const perUnitSats = BASE_COST_SATS * multiplier;
    const estimatedSats = perUnitSats * units;
    const holdSats = Math.ceil(estimatedSats * HOLD_BUFFER_RATIO);
    const dreamTokens = estimatedSats * DREAM_PER_SAT;

    return {
      endpoint,
      units,
      estimated_sats: estimatedSats,
      hold_sats:      holdSats,
      dream_tokens:   dreamTokens,
      rate:           DREAM_PER_SAT,
      breakdown: {
        base_cost_sats: BASE_COST_SATS,
        multiplier,
        per_unit_sats:  perUnitSats,
        units,
        hold_buffer:    HOLD_BUFFER_RATIO,
      },
    };
  });

  // -------------------------------------------------------------------
  // POST /v1/pay/buy -- buy DREAM tokens with sats
  // -------------------------------------------------------------------
  fastify.post('/v1/pay/buy', {
    schema: {
      tags: ['payments'],
      description: 'Buy DREAM tokens with sat balance. cost_sats = ceil(amount / rate)',
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: 1, description: 'DREAM tokens to purchase' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            purchased:        { type: 'boolean' },
            dream_amount:     { type: 'number' },
            cost_sats:        { type: 'number' },
            rate:             { type: 'number' },
            new_sat_balance:  { type: 'number' },
            new_dream_balance: { type: 'number' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        402: {
          type: 'object',
          properties: {
            error:         { type: 'string' },
            message:       { type: 'string' },
            required_sats: { type: 'number' },
            balance_sats:  { type: 'number' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const did = callerDid(req);
    if (!did) {
      return reply.code(401).send({
        error: 'identity-required',
        message: 'NIP-98 auth is required to buy DREAM tokens.',
      });
    }

    const { amount } = req.body;
    const costSats = Math.ceil(amount / DREAM_PER_SAT);

    // Check balance first
    let balanceResult;
    try {
      balanceResult = await podFetch('GET', '/pay/.balance', {
        headers: authHeaders(req),
        logger,
      });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: err.message,
      });
    }

    const currentBalance = balanceResult.body.balance_sats
      ?? parseInt(balanceResult.headers.get('X-Balance') || '0', 10);

    if (currentBalance < costSats) {
      reply.header('X-Cost', String(costSats));
      reply.header('X-Pay-Currency', 'sats');
      reply.header('X-Balance', String(currentBalance));
      return reply.code(402).send({
        error: 'insufficient-balance',
        message: `Insufficient sat balance. Need ${costSats} sats, have ${currentBalance}.`,
        required_sats: costSats,
        balance_sats: currentBalance,
      });
    }

    // Execute the purchase via pod-rs
    let buyResult;
    try {
      buyResult = await podFetch('POST', '/pay/.buy', {
        body: { dream_amount: amount, cost_sats: costSats },
        headers: authHeaders(req),
        logger,
      });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: err.message,
      });
    }

    const newSatBalance = buyResult.body.new_sat_balance ?? (currentBalance - costSats);
    const newDreamBalance = buyResult.body.new_dream_balance ?? amount;

    logger.info({ did, dream_amount: amount, cost_sats: costSats }, 'payments: DREAM purchase completed');

    return {
      purchased: true,
      dream_amount: amount,
      cost_sats: costSats,
      rate: DREAM_PER_SAT,
      new_sat_balance: newSatBalance,
      new_dream_balance: newDreamBalance,
      ...buyResult.body,
    };
  });

  // -------------------------------------------------------------------
  // POST /v1/pay/withdraw -- withdraw sats by burning DREAM
  // -------------------------------------------------------------------
  fastify.post('/v1/pay/withdraw', {
    schema: {
      tags: ['payments'],
      description: 'Withdraw sats by burning DREAM tokens. sats_received = floor(amount / rate)',
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: 1, description: 'DREAM tokens to burn' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            withdrawn:         { type: 'boolean' },
            dream_burned:      { type: 'number' },
            sats_received:     { type: 'number' },
            rate:              { type: 'number' },
            new_sat_balance:   { type: 'number' },
            new_dream_balance: { type: 'number' },
          },
        },
        401: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        402: {
          type: 'object',
          properties: {
            error:          { type: 'string' },
            message:        { type: 'string' },
            required_dream: { type: 'number' },
            dream_balance:  { type: 'number' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const did = callerDid(req);
    if (!did) {
      return reply.code(401).send({
        error: 'identity-required',
        message: 'NIP-98 auth is required to withdraw.',
      });
    }

    const { amount } = req.body;
    const satsReceived = Math.floor(amount / DREAM_PER_SAT);

    if (satsReceived <= 0) {
      return reply.code(400).send({
        error: 'amount-too-small',
        message: `Amount ${amount} DREAM yields 0 sats at rate ${DREAM_PER_SAT}. Minimum: ${DREAM_PER_SAT} DREAM.`,
      });
    }

    // Check DREAM balance first
    let balanceResult;
    try {
      balanceResult = await podFetch('GET', '/pay/.balance', {
        headers: authHeaders(req),
        logger,
      });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: err.message,
      });
    }

    const currentSatBalance = balanceResult.body.balance_sats
      ?? parseInt(balanceResult.headers.get('X-Balance') || '0', 10);
    const currentDreamBalance = (balanceResult.body.dream_balance !== undefined)
      ? balanceResult.body.dream_balance
      : currentSatBalance * DREAM_PER_SAT;

    if (currentDreamBalance < amount) {
      reply.header('X-Cost', String(amount));
      reply.header('X-Pay-Currency', 'DREAM');
      reply.header('X-Balance', String(currentDreamBalance));
      return reply.code(402).send({
        error: 'insufficient-dream-balance',
        message: `Insufficient DREAM balance. Need ${amount}, have ${currentDreamBalance}.`,
        required_dream: amount,
        dream_balance: currentDreamBalance,
      });
    }

    // Execute the withdrawal via pod-rs
    let withdrawResult;
    try {
      withdrawResult = await podFetch('POST', '/pay/.withdraw', {
        body: { dream_amount: amount, sats_received: satsReceived },
        headers: authHeaders(req),
        logger,
      });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: err.message,
      });
    }

    const newSatBalance = withdrawResult.body.new_sat_balance ?? (currentSatBalance + satsReceived);
    const newDreamBalance = withdrawResult.body.new_dream_balance ?? (currentDreamBalance - amount);

    logger.info({ did, dream_burned: amount, sats_received: satsReceived }, 'payments: DREAM withdrawal completed');

    return {
      withdrawn: true,
      dream_burned: amount,
      sats_received: satsReceived,
      rate: DREAM_PER_SAT,
      new_sat_balance: newSatBalance,
      new_dream_balance: newDreamBalance,
      ...withdrawResult.body,
    };
  });
}

module.exports = paymentRoutes;

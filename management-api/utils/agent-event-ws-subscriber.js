/**
 * Agent Event WS Subscriber (ADR-014 / ADR-059 — Phase 2 + 3)
 *
 * Connects to the integrating host's `/wss/agent-events` endpoint and
 * routes inbound events into the existing `agentEventPublisher` pubsub
 * with `direction: "inbound"`. Hot path for `user_interaction` events
 * (focus/select/hover/drag) so agents can observe user attention.
 *
 * Replaces the legacy `agent-event-bridge.js` TCP outbound bridge in
 * Phase 2 by carrying both directions on one WebSocket.
 *
 * Subprotocol: `vc-agent-events.v1`
 *
 * Configuration (agentbox.toml):
 *   [adapters.events]
 *   host_ws_url = "ws://visionflow_container:4000/wss/agent-events"
 *
 * Or env override: AGENTBOX_HOST_WS_URL
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { agentEventPublisher } = require('./agent-event-publisher');

const SUBPROTOCOL = 'vc-agent-events.v1';
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30000;

class AgentEventWsSubscriber {
  constructor(options = {}) {
    this.url = options.url || process.env.AGENTBOX_HOST_WS_URL;
    this.logger = options.logger || console;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.persistInbound = options.persistInbound !== false; // default true (recommendation #6)
    this.jsonlPath = options.jsonlPath ||
      process.env.AGENTBOX_INBOUND_EVENTS_LOG ||
      '/var/lib/agentbox/events/inbound.jsonl';
    this._unsubscribePublisher = null;

    // Subscribe to outbound events from the publisher; forward over WS
    // so agents → VisionClaw still works on the same socket.
    this._unsubscribePublisher = agentEventPublisher.subscribe((event) => {
      if (event.direction === 'inbound') return; // don't echo back
      this._forwardOutbound(event);
    });
  }

  /**
   * Start the subscriber. No-op if URL is not configured.
   */
  async start() {
    if (!this.url) {
      this.logger.info('[agent-events-ws] AGENTBOX_HOST_WS_URL not set — subscriber disabled');
      return;
    }
    this._connect();
  }

  /**
   * Stop subscriber, close socket, unsubscribe from publisher.
   */
  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._unsubscribePublisher) {
      this._unsubscribePublisher();
      this._unsubscribePublisher = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.connected = false;
  }

  status() {
    return {
      url: this.url || null,
      connected: this.connected,
      reconnectAttempt: this.reconnectAttempt,
      persistInbound: this.persistInbound,
      jsonlPath: this.persistInbound ? this.jsonlPath : null,
    };
  }

  _connect() {
    try {
      this.ws = new WebSocket(this.url, [SUBPROTOCOL]);
    } catch (err) {
      this.logger.error(`[agent-events-ws] WebSocket construction failed: ${err.message}`);
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.logger.info(`[agent-events-ws] connected to ${this.url} (subprotocol=${this.ws.protocol})`);
    });

    this.ws.on('message', (data) => {
      let text;
      if (typeof data === 'string') {
        text = data;
      } else if (Buffer.isBuffer(data)) {
        text = data.toString('utf8');
      } else {
        return; // ignore non-text frames in Phase 2
      }
      this._handleInbound(text);
    });

    this.ws.on('error', (err) => {
      this.logger.warn(`[agent-events-ws] error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.ws = null;
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_INITIAL_MS * Math.pow(2, Math.min(this.reconnectAttempt, 6))
    );
    this.logger.debug(`[agent-events-ws] reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _forwardOutbound(event) {
    if (!this.connected || !this.ws) return;
    try {
      this.ws.send(JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`[agent-events-ws] send failed: ${err.message}`);
    }
  }

  _handleInbound(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      this.logger.warn(`[agent-events-ws] malformed inbound JSON: ${err.message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      return;
    }

    // Tag with direction so subscribers can filter cheaply.
    parsed.direction = 'inbound';

    // Persist to JSONL (recommendation #6) when enabled.
    if (this.persistInbound) {
      this._appendJsonl(parsed);
    }

    // Re-publish through the publisher so all in-process subscribers
    // (including legacy bridge consumers and skill handlers) see it.
    // Use raw EventEmitter emit; emitAgentAction would assign a new id.
    agentEventPublisher.emit('event', parsed);
    if (parsed.type === 'agent_action') {
      agentEventPublisher.emit('agent_action', parsed);
    } else if (parsed.type === 'user_interaction') {
      agentEventPublisher.emit('user_interaction', parsed);
    }
  }

  _appendJsonl(obj) {
    try {
      const dir = path.dirname(this.jsonlPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.jsonlPath, JSON.stringify(obj) + '\n');
    } catch (err) {
      this.logger.debug(`[agent-events-ws] jsonl append failed: ${err.message}`);
    }
  }

  /**
   * Convenience: subscribe to inbound events with a filter spec.
   * filterSpec: { kind?: string, target_urn_prefix?: string, session_pubkey?: string }
   */
  static subscribeInbound(filterSpec, handler) {
    const wrapped = (event) => {
      if (event.direction !== 'inbound') return;
      if (filterSpec.kind && event.kind !== filterSpec.kind) return;
      if (filterSpec.target_urn_prefix &&
          !(event.target_urn || '').startsWith(filterSpec.target_urn_prefix)) return;
      if (filterSpec.session_pubkey && event.session_pubkey !== filterSpec.session_pubkey) return;
      handler(event);
    };
    return agentEventPublisher.subscribe(wrapped);
  }
}

let singletonSubscriber = null;

async function initializeAgentEventWsSubscriber(options = {}) {
  if (singletonSubscriber) return singletonSubscriber;
  singletonSubscriber = new AgentEventWsSubscriber(options);
  await singletonSubscriber.start();
  return singletonSubscriber;
}

function getAgentEventWsSubscriber() {
  return singletonSubscriber;
}

module.exports = {
  AgentEventWsSubscriber,
  initializeAgentEventWsSubscriber,
  getAgentEventWsSubscriber,
  SUBPROTOCOL,
};

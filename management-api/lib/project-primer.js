'use strict';

/**
 * project-primer — AI primer/synopsis generator for sovereign project tracking.
 *
 * PRD-017 §3 (AI primers/synopses) + ADR-011 (consultants: the paid Z.AI / GLM
 * model is the consultant tier; the main Claude session is never re-invoked).
 *
 * helm generates project primers by shelling the Claude CLI. We reject that
 * stack and re-express the capability on the sovereign substrate: the same
 * Z.AI / GLM endpoint the `zai` consultant and the kind-30840 session-summary
 * hook already use (anthropic-shaped `/v1/messages`, `x-api-key` +
 * `anthropic-version`), with the primer/synopsis persisted through the EXISTING
 * memory adapter slot (RuVector, namespace `project-tracking-primers`) under a
 * canonical `urn:agentbox:memory:<scope>:primer-<sha256-12>` minted via
 * `lib/uris.js`. No new adapter slot; durable state rides the memory adapter.
 *
 * Invariants:
 *   - Consultant tier only (ADR-011): summarisation runs on the paid Z.AI model,
 *     one external hop, mirroring `config/hooks/nostr-session-summary.py`. The
 *     primer prompt carries project METADATA (name, language, remote, recent
 *     commit summary) — never source, never absolute host paths in the body.
 *   - 2-slot concurrency cap (the helm `withAISlot` pattern): no more than two
 *     primer generations run at once, so a batch scan cannot stampede the
 *     consultant endpoint. Excess callers queue and are handed a slot on release.
 *   - Self-gating: `configured()` is true only when a Z.AI key
 *     (ZAI_ANTHROPIC_API_KEY || ZAI_API_KEY) is present. When false, `primer()`
 *     is a no-op returning {primer:null, synopsis:null, model:null, urn:null}
 *     (the caller maps this to primer status `none`).
 *   - Bounded: every fetch is aborted after ZAI_TIMEOUT_MS (~120s) so a hung
 *     consultant never wedges a scan.
 *   - Canonical identity: the primer URN is minted through `lib/uris.js`
 *     (kind `memory`, scope = AGENTBOX_PUBKEY, content-addressed local id) — no
 *     ad-hoc template-literal URNs.
 */

const crypto = require('crypto');
const uris = require('./uris');

// ~120s upper bound on the consultant call (the session-summary hook allows
// 180s for whole transcripts; a primer prompt is far smaller).
const ZAI_TIMEOUT_MS = 120_000;
const ZAI_MAX_TOKENS = 1200;
const DEFAULT_ZAI_BASE = 'https://api.z.ai/api/anthropic';
const DEFAULT_MODEL = 'glm-5.2';
const PRIMER_NAMESPACE = 'project-tracking-primers';

// helm's withAISlot cap — at most two consultant generations in flight at once.
const MAX_AI_SLOTS = 2;

const PRIMER_SYSTEM = (
  'You are a senior software consultant writing an onboarding primer for an '
  + 'engineer who has never seen the project. You are given only repository '
  + 'metadata (name, language, remote, recent commit activity), not the source. '
  + 'Output ONLY a single JSON object, no prose, no markdown fences. Schema: '
  + '{"primer": string (a short, structured technical primer of 1-2 paragraphs '
  + 'describing what the project is, its language/stack, and what the recent '
  + 'activity suggests is being worked on; never invent specifics the metadata '
  + 'does not support), "synopsis": string (one sentence, under 160 characters, '
  + 'capturing the project at a glance)}.'
);

/**
 * PrimerGenerator — wraps the Z.AI/GLM consultant for project primers.
 *
 * @param {object} deps
 * @param {object} [deps.logger]        - logger with .warn/.info (optional)
 * @param {object} [deps.manifest]      - parsed agentbox.toml manifest
 * @param {object} [deps.memoryAdapter] - resolved memory adapter slot
 */
class PrimerGenerator {
  constructor({ logger, manifest, memoryAdapter } = {}) {
    this.logger = logger || null;
    this.manifest = manifest || {};
    this.memoryAdapter = memoryAdapter || null;

    // Per-instance withAISlot semaphore state (2-slot cap).
    this._activeSlots = 0;
    this._slotQueue = [];
  }

  /**
   * True only when a Z.AI consultant key is present. When false, primer()
   * short-circuits to nulls and the project's primer status is `none`.
   */
  configured() {
    return Boolean(_zaiKey());
  }

  /**
   * Generate (and persist) a primer + synopsis for a tracked project.
   *
   * @param {object} project - TrackedProject-shaped metadata
   * @returns {Promise<{primer:string|null, synopsis:string|null, model:string|null, urn:string|null}>}
   */
  async primer(project) {
    if (!this.configured()) {
      return { primer: null, synopsis: null, model: null, urn: null };
    }
    const proj = project || {};
    const model = this._model();

    const { primer, synopsis } = await this._withAISlot(() => this._consult(proj, model));
    if (!primer && !synopsis) {
      return { primer: null, synopsis: null, model, urn: null };
    }

    const urn = this._mintUrn(proj);
    await this._persist(proj, { primer, synopsis, model, urn });

    return { primer, synopsis, model, urn };
  }

  // ---- internals -----------------------------------------------------------

  _model() {
    const fromManifest = this.manifest
      && this.manifest.project_tracking
      && this.manifest.project_tracking.primer_model;
    return fromManifest || process.env.AGENTBOX_ZAI_MODEL || DEFAULT_MODEL;
  }

  /**
   * Acquire one of MAX_AI_SLOTS, run `fn`, release on completion. Excess
   * callers queue and are handed a slot when one frees (helm withAISlot).
   */
  async _withAISlot(fn) {
    await this._acquireSlot();
    try {
      return await fn();
    } finally {
      this._releaseSlot();
    }
  }

  _acquireSlot() {
    return new Promise((resolve) => {
      if (this._activeSlots < MAX_AI_SLOTS) {
        this._activeSlots += 1;
        resolve();
      } else {
        this._slotQueue.push(resolve);
      }
    });
  }

  _releaseSlot() {
    const next = this._slotQueue.shift();
    if (next) {
      // Hand the live slot straight to the next waiter; count is unchanged.
      next();
    } else {
      this._activeSlots = Math.max(0, this._activeSlots - 1);
    }
  }

  /** Call the Z.AI/GLM consultant; return {primer, synopsis} (nulls on failure). */
  async _consult(project, model) {
    const base = (process.env.ZAI_URL || '').replace(/\/+$/, '') || DEFAULT_ZAI_BASE;
    const url = `${base}/v1/messages`;
    const apiKey = _zaiKey();

    const payload = {
      model,
      max_tokens: ZAI_MAX_TOKENS,
      system: PRIMER_SYSTEM,
      messages: [{ role: 'user', content: _buildPrompt(project) }],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ZAI_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`Z.AI /v1/messages returned ${resp.status}`);
      }
      const body = await resp.json();
      const text = _anthropicText(body);
      const obj = _parseJsonObject(text);
      const primer = typeof obj.primer === 'string' ? obj.primer.trim() : '';
      const synopsis = typeof obj.synopsis === 'string' ? obj.synopsis.trim() : '';
      return { primer: primer || null, synopsis: synopsis || null };
    } catch (err) {
      this._warn(`primer generation failed (non-fatal): ${err && err.message ? err.message : err}`);
      return { primer: null, synopsis: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Mint the canonical primer URN through uris.js (kind `memory`, scope =
   * AGENTBOX_PUBKEY, content-addressed local id). Content addressing keys the
   * URN to the project identity so re-generation upserts the same resource.
   */
  _mintUrn(project) {
    const pubkey = process.env.AGENTBOX_PUBKEY || '';
    const identity = project.remote || project.path || project.id || project.name || '';
    const localId = `primer-${_sha12(JSON.stringify({ kind: 'project-primer', identity }))}`;
    try {
      return uris.mint({ kind: 'memory', pubkey: pubkey || undefined, localId });
    } catch (err) {
      this._warn(`primer URN mint failed (non-fatal): ${err && err.message ? err.message : err}`);
      return null;
    }
  }

  /** Persist primer+synopsis through the memory adapter (store or dispatch). */
  async _persist(project, record) {
    const adapter = this.memoryAdapter;
    if (!adapter) return;
    const key = _slug(project.id || project.name || project.path || 'project');
    const value = JSON.stringify({
      ...record,
      slug: key,
      generatedAt: new Date().toISOString(),
    });
    try {
      if (typeof adapter.store === 'function') {
        await adapter.store(key, value, PRIMER_NAMESPACE);
      } else if (typeof adapter.dispatch === 'function') {
        await adapter.dispatch({ op: 'store', key, value, namespace: PRIMER_NAMESPACE });
      }
    } catch (err) {
      this._warn(`primer persist failed (non-fatal): ${err && err.message ? err.message : err}`);
    }
  }

  _warn(msg) {
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(`[project-primer] ${msg}`);
    }
  }
}

// ---- module helpers --------------------------------------------------------

function _zaiKey() {
  return process.env.ZAI_ANTHROPIC_API_KEY || process.env.ZAI_API_KEY || '';
}

/** Build the consultant user-prompt from project metadata only. */
function _buildPrompt(project) {
  const lines = ['Repository metadata:'];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      lines.push(`- ${label}: ${value}`);
    }
  };
  add('Name', project.name);
  add('Language', project.language);
  add('Remote', project.remote);
  add('Default branch', project.branch);
  add('Last commit', project.lastCommitIso);
  add('Commits in last 30 days', project.commits30d);
  add('Open issues', project.openIssues);
  add('Stars', project.stars);

  const summary = _recentCommitSummary(project);
  if (summary) {
    lines.push('', 'Recent commit activity:', summary);
  }
  return lines.join('\n');
}

/** Distil whatever recent-commit shape the project carries into prose. */
function _recentCommitSummary(project) {
  if (typeof project.commitSummary === 'string' && project.commitSummary.trim()) {
    return project.commitSummary.trim();
  }
  if (Array.isArray(project.recentCommits) && project.recentCommits.length) {
    return project.recentCommits
      .map((c) => (typeof c === 'string' ? c : (c && (c.message || c.subject)) || ''))
      .filter(Boolean)
      .map((m) => `- ${m}`)
      .join('\n');
  }
  if (Array.isArray(project.commitDays) && project.commitDays.length) {
    const active = project.commitDays.filter((d) => d && d.count > 0);
    if (active.length) {
      const total = active.reduce((acc, d) => acc + (d.count || 0), 0);
      return `${total} commit(s) across ${active.length} active day(s) in the last 30 days.`;
    }
  }
  return '';
}

/** Concatenate anthropic content[].text blocks (mirrors the Python hook). */
function _anthropicText(body) {
  const content = body && body.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object' && b.type === 'text')
    .map((b) => String(b.text || ''))
    .join('')
    .trim();
}

/** Best-effort extraction of the first JSON object from the model output. */
function _parseJsonObject(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) {
    const parts = t.split('```');
    t = parts.length >= 2 ? parts[1] : t;
    if (t.startsWith('json')) t = t.slice(4);
    t = t.trim();
  }
  const start = t.indexOf('{');
  if (start === -1) return {};
  // Walk to the matching brace so trailing prose does not break JSON.parse.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const obj = JSON.parse(t.slice(start, i + 1));
          return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
        } catch {
          return {};
        }
      }
    }
  }
  return {};
}

/** Content hash matching the uris.js / bc20 convention: sha256-12-<12 hex>. */
function _sha12(input) {
  const hex = crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
  return `sha256-12-${hex.slice(0, 12)}`;
}

function _slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96) || 'project';
}

module.exports = { PrimerGenerator };

/**
 * enrichment-review-pane.js — Broker Review Surface (G6, PRD-013).
 *
 * Renders KnowledgeEnrichment broker cases as a two-pane visual diff
 * with inline approval actions. This is the primary human interface for
 * reviewing agent-proposed knowledge enrichments before they are
 * committed back to source pods via the Write-Back Saga (G4).
 *
 * Data flow:
 *   VisionClaw BrokerActor  -->  WebSocket (broker:new_case)
 *     -->  agentbox broker-bridge (SSE relay)
 *     -->  this pane (renders diff + provenance + action buttons)
 *     -->  POST /api/broker/bridge/cases/:id/decide (broker-bridge)
 *     -->  broker-bridge proxies to VisionClaw + triggers write-back
 *
 * Attribution
 * -----------
 * Pane shape from linkedobjects/browser (Melvin Carvalho, AGPL-3.0).
 * The KnowledgeEnrichmentCase type and broker vocabulary are documented
 * in docs/reference/_vocab/agbx.md. Judgment Broker ADR-041 defines
 * the six decision outcomes. PRD-013 specifies the G6 surface contract.
 */

import { html, render } from '../losos/html.js';

const CASE_TYPES = [
  'KnowledgeEnrichmentCase',
  'agbx:KnowledgeEnrichmentCase',
];

const DECISION_OUTCOMES = [
  { key: 'approve',   label: 'Approve',   cls: 'lo-btn-approve',   title: 'Approve enrichment and trigger write-back' },
  { key: 'reject',    label: 'Reject',    cls: 'lo-btn-reject',    title: 'Reject enrichment — no write-back' },
  { key: 'amend',     label: 'Amend',     cls: 'lo-btn-amend',     title: 'Return to agent with amendment instructions' },
  { key: 'delegate',  label: 'Delegate',  cls: 'lo-btn-delegate',  title: 'Route to a domain expert for review' },
  { key: 'promote',   label: 'Promote',   cls: 'lo-btn-promote',   title: 'Elevate enrichment and trigger write-back' },
  { key: 'precedent', label: 'Precedent', cls: 'lo-btn-precedent', title: 'Flag for future auto-approval' },
];

export default {
  id: 'enrichment-review',
  label: 'Enrichment Review',
  icon: '⚖',
  surface: 'S12',
  matches: CASE_TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) =>
      CASE_TYPES.includes(t) ||
      String(t).endsWith('KnowledgeEnrichmentCase')
    );
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const caseId = doc.id || doc['@id'] || doc.case_id || subject.value;
    const category = doc.category || doc['agbx:category'] || 'KnowledgeEnrichment';
    const status = doc.status || doc['agbx:status'] || 'pending';
    const createdAt = doc.created_at || doc['agbx:createdAt'] || '';

    // Subject reference — the node being enriched
    const subjectRef = doc.subject_ref || doc['agbx:subjectRef'] || {};
    const subjectUrn = subjectRef.urn || subjectRef['@id'] || '';
    const subjectLabel = subjectRef.label || subjectRef.name || subjectUrn || 'unknown';

    // Source content (left pane) and proposed enrichment (right pane)
    const sourceContent = doc.source_content || doc['agbx:sourceContent'] || doc.from_state || '';
    const proposedEnrichment = doc.proposed_enrichment || doc['agbx:proposedEnrichment'] || doc.to_state || '';

    // Provenance
    const proposedBy = doc.proposed_by || doc['agbx:proposedBy'] || '';
    const agentIdentity = doc.agent_identity || doc['agbx:agentIdentity'] || proposedBy;
    const reasoningSummary = doc.reasoning_summary || doc['agbx:reasoningSummary'] || '';
    const reasoningHash = doc.reasoning_hash || doc['agbx:reasoningHash'] || '';
    const brokerDid = doc.broker_did || doc['agbx:brokerDid'] || '';

    // Enrichment type classification
    const enrichmentType = doc.enrichment_type || doc['agbx:enrichmentType'] || _inferType(sourceContent, proposedEnrichment);

    // Determine the broker API base — prefer explicit config, fall back
    // to the current origin (same-host deployment) or the well-known
    // VisionClaw dev port.
    const brokerApiBase = doc._broker_api || '';

    render(container, html`
      <article class="lo-enrichment-review">
        <header>
          <h1>Enrichment Review</h1>
          <div class="lo-case-meta">
            <span class="lo-case-id">Case: <code>${caseId}</code></span>
            <span class="lo-case-status lo-status-${status}">${status}</span>
            ${enrichmentType ? html`<span class="lo-enrichment-type">${enrichmentType}</span>` : ''}
          </div>
          <p class="lo-subject-ref">
            Subject: <a href="${subjectUrn}">${subjectLabel}</a>
            ${createdAt ? html` <time>${createdAt}</time>` : ''}
          </p>
        </header>

        <section class="lo-diff-container">
          <div class="lo-diff-pane lo-diff-source">
            <h2>Source Content</h2>
            <div class="lo-diff-body">${_renderContent(sourceContent)}</div>
          </div>
          <div class="lo-diff-divider"></div>
          <div class="lo-diff-pane lo-diff-proposed">
            <h2>Proposed Enrichment</h2>
            <div class="lo-diff-body">${_renderContent(proposedEnrichment)}</div>
          </div>
        </section>

        <section class="lo-provenance-trailer">
          <h2>Provenance</h2>
          <dl>
            ${proposedBy ? html`
              <dt>Proposed by</dt>
              <dd>${_renderDid(proposedBy)}</dd>
            ` : ''}
            ${agentIdentity && agentIdentity !== proposedBy ? html`
              <dt>Agent identity</dt>
              <dd>${_renderDid(agentIdentity)}</dd>
            ` : ''}
            ${brokerDid ? html`
              <dt>Broker</dt>
              <dd>${_renderDid(brokerDid)}</dd>
            ` : ''}
            ${reasoningSummary ? html`
              <dt>Reasoning</dt>
              <dd class="lo-reasoning">${reasoningSummary}</dd>
            ` : ''}
            ${reasoningHash ? html`
              <dt>Reasoning hash</dt>
              <dd><code class="lo-hash">${reasoningHash}</code></dd>
            ` : ''}
            ${subjectUrn ? html`
              <dt>Subject URN</dt>
              <dd><code>${subjectUrn}</code></dd>
            ` : ''}
          </dl>
        </section>

        <section class="lo-actions" data-case-id="${caseId}" data-broker-api="${brokerApiBase}">
          ${DECISION_OUTCOMES.map((d) => html`
            <button
              class="lo-action-btn ${d.cls}"
              data-decision="${d.key}"
              title="${d.title}"
            >${d.label}</button>
          `)}
        </section>

        <div class="lo-action-feedback" aria-live="polite"></div>

        <section class="lo-live-events" aria-live="polite">
          <span class="lo-live-indicator" title="Real-time updates"></span>
          <span class="lo-live-status">Connecting...</span>
        </section>

        <footer class="lo-attrib">
          Pane: agentbox <code>enrichment-review-pane</code>. Surface: S12.
          Vocabulary: <a href="/docs/reference/_vocab/agbx.md">agbx</a>.
          Broker: <a href="https://github.com/DreamLab-AI/VisionClaw">ADR-041</a>.
        </footer>
      </article>
    `);

    // Wire up action buttons after render
    _bindActions(container, caseId, brokerApiBase);

    // Subscribe to real-time broker events via SSE bridge
    _subscribeBrokerEvents(container, caseId, brokerApiBase);
  },
};

// ---------------------------------------------------------------------------
// Action handling
// ---------------------------------------------------------------------------

/**
 * Bind click handlers on the decision buttons. Each button POSTs to the
 * VisionClaw broker REST API and updates the feedback region.
 */
function _bindActions(container, caseId, brokerApiBase) {
  const actionsEl = container.querySelector('.lo-actions');
  const feedbackEl = container.querySelector('.lo-action-feedback');
  if (!actionsEl) return;

  actionsEl.addEventListener('click', async (evt) => {
    const btn = evt.target.closest('[data-decision]');
    if (!btn) return;

    const decision = btn.dataset.decision;
    const allBtns = actionsEl.querySelectorAll('.lo-action-btn');

    // For amend and delegate, prompt for a note
    let note = '';
    if (decision === 'amend' || decision === 'delegate') {
      note = _promptForNote(decision);
      if (note === null) return; // cancelled
    }

    // Disable all buttons during the request
    allBtns.forEach((b) => { b.disabled = true; });
    _setFeedback(feedbackEl, 'pending', `Submitting ${decision} decision...`);

    try {
      const apiBase = brokerApiBase || '';
      const url = `${apiBase}/api/broker/bridge/cases/${encodeURIComponent(caseId)}/decide`;

      const body = {
        decision,
        case_id: caseId,
        timestamp: new Date().toISOString(),
      };
      if (note) body.note = note;

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`${resp.status} ${errText}`);
      }

      const result = await resp.json().catch(() => ({}));
      _setFeedback(feedbackEl, 'success',
        `Decision "${decision}" recorded.${result.writeback_triggered ? ' Write-back triggered.' : ''}`
      );

      // Mark the decided button and disable all permanently
      btn.classList.add('lo-btn-decided');
      allBtns.forEach((b) => { b.disabled = true; });

    } catch (err) {
      _setFeedback(feedbackEl, 'error', `Failed: ${err.message}`);
      // Re-enable buttons so the reviewer can retry
      allBtns.forEach((b) => { b.disabled = false; });
    }
  });
}

/**
 * Prompt the reviewer for a note (amend instructions or delegate target).
 * Returns the note string or null if cancelled.
 */
function _promptForNote(decision) {
  const label = decision === 'amend'
    ? 'Enter amendment instructions for the agent:'
    : 'Enter the DID or name of the delegate:';
  // globalThis.prompt is available in browser environments where this
  // pane runs (the linked objects viewer is a web surface).
  if (typeof globalThis.prompt === 'function') {
    return globalThis.prompt(label);
  }
  return '';
}

/**
 * Update the feedback region with status and message.
 */
function _setFeedback(el, status, message) {
  if (!el) return;
  el.className = `lo-action-feedback lo-feedback-${status}`;
  el.textContent = message;
}

// ---------------------------------------------------------------------------
// Real-time event subscription (SSE bridge)
// ---------------------------------------------------------------------------

/**
 * Subscribe to broker events via the SSE bridge endpoint. Updates the
 * pane's live indicator and reacts to case-specific events (decided,
 * claimed by another reviewer, etc.).
 */
function _subscribeBrokerEvents(container, caseId, brokerApiBase) {
  const liveIndicator = container.querySelector('.lo-live-indicator');
  const liveStatus = container.querySelector('.lo-live-status');
  const feedbackEl = container.querySelector('.lo-action-feedback');

  if (!liveIndicator || !liveStatus) return;
  if (typeof EventSource === 'undefined') {
    liveStatus.textContent = 'Live updates unavailable';
    return;
  }

  const apiBase = brokerApiBase || '';
  const url = `${apiBase}/api/broker/bridge/events`;
  let es;

  try {
    es = new EventSource(url);
  } catch {
    liveStatus.textContent = 'SSE connection failed';
    return;
  }

  es.addEventListener('connected', () => {
    liveIndicator.classList.add('lo-live-connected');
    liveStatus.textContent = 'Live';
  });

  es.addEventListener('broker:case_decided', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.case_id === caseId || (data.payload && data.payload.case_id === caseId)) {
        const decision = data.decision || (data.payload && data.payload.decision) || 'unknown';
        _setFeedback(feedbackEl, 'info',
          `Case decided externally: "${decision}".`
        );
        // Disable action buttons — the case is no longer pending
        const allBtns = container.querySelectorAll('.lo-action-btn');
        allBtns.forEach((b) => { b.disabled = true; });
      }
    } catch { /* ignore parse errors */ }
  });

  es.addEventListener('broker:case_claimed', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.case_id === caseId || (data.payload && data.payload.case_id === caseId)) {
        const claimedBy = data.claimed_by || (data.payload && data.payload.claimed_by) || 'another reviewer';
        _setFeedback(feedbackEl, 'info',
          `Case claimed by ${claimedBy}.`
        );
      }
    } catch { /* ignore */ }
  });

  es.addEventListener('broker:new_case', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      // Notify the reviewer that new cases are available
      liveStatus.textContent = `Live (new case: ${data.case_id || data.id || '?'})`;
    } catch { /* ignore */ }
  });

  es.onerror = () => {
    liveIndicator.classList.remove('lo-live-connected');
    liveStatus.textContent = 'Reconnecting...';
  };

  // Close the EventSource when the pane is removed from the DOM
  // (MutationObserver on the container's parent).
  if (typeof MutationObserver !== 'undefined' && container.parentNode) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const removed of m.removedNodes) {
          if (removed === container || removed.contains(container)) {
            es.close();
            observer.disconnect();
            return;
          }
        }
      }
    });
    observer.observe(container.parentNode, { childList: true });
  }
}

// ---------------------------------------------------------------------------
// Content rendering
// ---------------------------------------------------------------------------

/**
 * Render content adaptively based on detected format. Supports:
 *   - Plain text / markdown (as preformatted text)
 *   - JSON / JSON-LD (syntax-highlighted)
 *   - Turtle / RDF (preformatted with lang hint)
 *   - Embedding vectors (tabular)
 *   - Null / empty states
 */
function _renderContent(content) {
  if (!content && content !== 0) {
    return html`<p class="lo-empty">No content (new resource)</p>`;
  }

  // Object content — could be JSON-LD, embedding vector, or structured data
  if (typeof content === 'object') {
    // Embedding vector — array of numbers
    if (Array.isArray(content) && content.length > 0 && typeof content[0] === 'number') {
      return _renderEmbeddingVector(content);
    }
    // Structured object — render as formatted JSON
    return html`<pre class="lo-json lo-content-json">${JSON.stringify(content, null, 2)}</pre>`;
  }

  const str = String(content);

  // Turtle / N-Triples detection
  if (_looksLikeTurtle(str)) {
    return html`<pre class="lo-turtle lo-content-rdf">${str}</pre>`;
  }

  // JSON string detection
  if (_looksLikeJson(str)) {
    try {
      const parsed = JSON.parse(str);
      return html`<pre class="lo-json lo-content-json">${JSON.stringify(parsed, null, 2)}</pre>`;
    } catch { /* fall through to plain text */ }
  }

  // Plain text / markdown — preformatted
  return html`<pre class="lo-content-text">${str}</pre>`;
}

/**
 * Render an embedding vector as a compact summary table.
 * Full vector display is impractical; show dimensions + sample values.
 */
function _renderEmbeddingVector(vec) {
  const dims = vec.length;
  const head = vec.slice(0, 5).map((v) => v.toFixed(6));
  const tail = dims > 5 ? vec.slice(-3).map((v) => v.toFixed(6)) : [];
  return html`
    <div class="lo-embedding">
      <p><strong>${dims}</strong>-dimensional vector</p>
      <code class="lo-vector-sample">
        [${head.join(', ')}${tail.length ? html`, ..., ${tail.join(', ')}` : ''}]
      </code>
      <p class="lo-embedding-stats">
        min: ${Math.min(...vec).toFixed(6)},
        max: ${Math.max(...vec).toFixed(6)},
        L2 norm: ${Math.sqrt(vec.reduce((s, v) => s + v * v, 0)).toFixed(6)}
      </p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// DID rendering
// ---------------------------------------------------------------------------

/**
 * Render a DID as a clickable code element. did:nostr DIDs link to the
 * local pod's DID document; other DIDs link to the universal resolver.
 */
function _renderDid(did) {
  if (typeof did !== 'string' || !did) return html`<span>--</span>`;
  if (did.startsWith('did:nostr:')) {
    const hex = did.slice('did:nostr:'.length);
    const short = hex.length > 16 ? `${hex.slice(0, 8)}...${hex.slice(-8)}` : hex;
    return html`<a href="${`/lo/?resource=${encodeURIComponent('/.well-known/did.json')}`}" class="lo-did" title="${did}">did:nostr:${short}</a>`;
  }
  if (did.startsWith('did:')) {
    return html`<a href="${`https://uniresolver.io/#${encodeURIComponent(did)}`}" class="lo-did">${did}</a>`;
  }
  return html`<code class="lo-did">${did}</code>`;
}

// ---------------------------------------------------------------------------
// Format detection helpers
// ---------------------------------------------------------------------------

function _looksLikeTurtle(str) {
  // Quick heuristic: @prefix, common RDF predicates, or triple patterns
  return /^@prefix\s/m.test(str) ||
    /\b(?:rdf|rdfs|owl|skos|foaf|dcterms):/m.test(str) ||
    /\s+a\s+(?:owl:|rdfs:|skos:)/.test(str);
}

function _looksLikeJson(str) {
  const trimmed = str.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Infer the enrichment type from the content pair.
 */
function _inferType(source, proposed) {
  if (!source && proposed) {
    if (typeof proposed === 'object' && Array.isArray(proposed)) return 'new-embedding';
    return 'new-resource';
  }
  if (typeof proposed === 'object' && Array.isArray(proposed) && typeof proposed[0] === 'number') {
    return 'embedding-update';
  }
  if (typeof proposed === 'string' && _looksLikeTurtle(proposed)) return 'ontology-promotion';
  if (typeof proposed === 'string' && proposed.includes('ProposedEdge')) return 'proposed-edge';
  return 'enrichment';
}

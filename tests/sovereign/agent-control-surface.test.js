'use strict';

/**
 * Contract test for lib/agent-control-surface — the agentbox PRODUCER for the
 * Agent Control Surface Protocol (ACSP, kinds 31400-31405). Locks the wire
 * contract the nostr-bbs-core::governance consumer enforces:
 *   - correct kind per builder, sourced from the frozen nostr-bridge `kinds`
 *   - NIP-33 `["d", panelId]` addressing on every event
 *   - snake_case content keys (field_type, refresh_secs, context_url)
 *   - kebab-case enum values (schema/layout/field-type/style/capability)
 *   - ActionRequest priority as a TAG (string label), plus optional broker tags
 *   - unsigned shape only (no id/sig/pubkey — the signer adds those)
 *   - publishPanelEvent delegates to an injected bridge and never connects.
 */

const acs = require('../../management-api/lib/agent-control-surface');

const dtag = (ev) => (ev.tags.find((t) => t[0] === 'd') || [])[1];
const tag = (ev, name) => (ev.tags.find((t) => t[0] === name) || [])[1];

describe('agent-control-surface', () => {
  test('kinds are sourced from the single nostr-bridge enum (no re-declaration drift)', () => {
    const { kinds } = require('../../mcp/servers/nostr-bridge');
    expect(acs.kinds).toBe(kinds);
    expect(kinds.PANEL_DEFINITION).toBe(31400);
    expect(kinds.PANEL_STATE).toBe(31401);
    expect(kinds.ACTION_REQUEST).toBe(31402);
    expect(kinds.PANEL_UPDATE).toBe(31404);
    expect(kinds.PANEL_RETIRED).toBe(31405);
  });

  test('buildPanelDefinition → kind 31400, d-tag, serde-exact snake_case content', () => {
    const ev = acs.buildPanelDefinition({
      panelId: 'agent-inbox',
      title: 'Agent Inbox',
      description: 'Pending agent decisions',
      schema: 'action-inbox',
      layout: 'inbox-table',
      fields: [{ name: 'entity', fieldType: 'string', label: 'Entity URN' }],
      actions: [{ id: 'approve', label: 'Approve', style: 'primary' }],
      capabilities: ['bulk-action', 'filter'],
    });

    expect(ev.kind).toBe(31400);
    expect(dtag(ev)).toBe('agent-inbox');
    expect(typeof ev.created_at).toBe('number');
    // unsigned: signer adds these
    expect(ev.id).toBeUndefined();
    expect(ev.sig).toBeUndefined();
    expect(ev.pubkey).toBeUndefined();

    const body = JSON.parse(ev.content);
    expect(body).toEqual({
      title: 'Agent Inbox',
      description: 'Pending agent decisions',
      version: '1.0.0',
      schema: 'action-inbox',
      fields: [{ name: 'entity', field_type: 'string', label: 'Entity URN' }],
      actions: [{ id: 'approve', label: 'Approve', style: 'primary' }],
      layout: 'inbox-table',
      capabilities: ['bulk-action', 'filter'],
      refresh_secs: 30,
    });
  });

  test('buildPanelDefinition rejects out-of-domain enum values', () => {
    const ok = { panelId: 'p', title: 't', description: 'd', schema: 'dashboard', layout: 'kanban' };
    expect(() => acs.buildPanelDefinition({ ...ok, schema: 'bogus' })).toThrow(/schema/);
    expect(() => acs.buildPanelDefinition({ ...ok, layout: 'bogus' })).toThrow(/layout/);
    expect(() => acs.buildPanelDefinition({ ...ok, fields: [{ name: 'x', fieldType: 'nope', label: 'L' }] })).toThrow(/fieldType/);
    expect(() => acs.buildPanelDefinition({ ...ok, actions: [{ id: 'a', label: 'L', style: 'nope' }] })).toThrow(/style/);
    expect(() => acs.buildPanelDefinition({ ...ok, capabilities: ['nope'] })).toThrow(/capabilities/);
    expect(() => acs.buildPanelDefinition({ ...ok, title: '' })).toThrow(/title/);
    expect(() => acs.buildPanelDefinition({ ...ok, panelId: '' })).toThrow(/panelId/);
  });

  test('buildActionRequest → kind 31402, priority TAG, snake_case content, broker tags', () => {
    const ev = acs.buildActionRequest({
      panelId: 'case-42',
      fields: { entity: 'urn:agentbox:bead:abc' },
      reasoning: 'needs human sign-off',
      contextUrl: 'https://example/ctx',
      priority: 'high',
      category: 'workflow_review',
      subjectKind: 'work_artifact',
      subjectId: 'art-1',
      title: 'Review artifact',
    });

    expect(ev.kind).toBe(31402);
    expect(dtag(ev)).toBe('case-42');
    expect(tag(ev, 'priority')).toBe('high');
    expect(tag(ev, 'category')).toBe('workflow_review');
    expect(tag(ev, 'subject-kind')).toBe('work_artifact');
    expect(tag(ev, 'subject-id')).toBe('art-1');
    expect(tag(ev, 'title')).toBe('Review artifact');

    const body = JSON.parse(ev.content);
    expect(body).toEqual({
      fields: { entity: 'urn:agentbox:bead:abc' },
      reasoning: 'needs human sign-off',
      context_url: 'https://example/ctx',
    });
    // priority must NOT be in content — it is a tag
    expect(body.priority).toBeUndefined();
  });

  test('buildActionRequest defaults: medium priority, empty fields, null optionals', () => {
    const ev = acs.buildActionRequest({ panelId: 'c' });
    expect(tag(ev, 'priority')).toBe('medium');
    // no broker projection tags when not supplied
    expect(tag(ev, 'category')).toBeUndefined();
    const body = JSON.parse(ev.content);
    expect(body).toEqual({ fields: {}, reasoning: null, context_url: null });
  });

  test('buildActionRequest rejects out-of-domain priority', () => {
    expect(() => acs.buildActionRequest({ panelId: 'c', priority: 'urgent' })).toThrow(/priority/);
  });

  test('buildPanelState → kind 31401, content is the raw snapshot JSON', () => {
    const ev = acs.buildPanelState({ panelId: 'p', state: { rows: [1, 2], total: 2 } });
    expect(ev.kind).toBe(31401);
    expect(dtag(ev)).toBe('p');
    expect(JSON.parse(ev.content)).toEqual({ rows: [1, 2], total: 2 });
    expect(() => acs.buildPanelState({ panelId: 'p', state: null })).toThrow(/state/);
    expect(() => acs.buildPanelState({ panelId: 'p', state: [1, 2] })).toThrow(/state/);
  });

  test('buildPanelUpdate → kind 31404, content is the diff JSON', () => {
    const ev = acs.buildPanelUpdate({ panelId: 'p', diff: { total: 3 } });
    expect(ev.kind).toBe(31404);
    expect(dtag(ev)).toBe('p');
    expect(JSON.parse(ev.content)).toEqual({ total: 3 });
    expect(() => acs.buildPanelUpdate({ panelId: 'p', diff: 'x' })).toThrow(/diff/);
  });

  test('buildPanelRetired → kind 31405, empty content, d-tag only', () => {
    const ev = acs.buildPanelRetired({ panelId: 'p' });
    expect(ev.kind).toBe(31405);
    expect(dtag(ev)).toBe('p');
    expect(ev.content).toBe('');
  });

  test('createdAt override and extraTags are honoured', () => {
    const ev = acs.buildPanelRetired({ panelId: 'p', createdAt: 1700000000, extraTags: [['client', 'agentbox']] });
    expect(ev.created_at).toBe(1700000000);
    expect(tag(ev, 'client')).toBe('agentbox');
  });

  test('publishPanelEvent delegates to an injected bridge and never connects', async () => {
    const calls = [];
    const bridge = {
      publish: (event, signer) => { calls.push({ event, signer }); return Promise.resolve({ ...event, id: 'signed' }); },
      connect: () => { throw new Error('publishPanelEvent must not connect'); },
      disconnect: () => { throw new Error('publishPanelEvent must not disconnect'); },
    };
    const signer = { sign: (e) => Promise.resolve(e) };
    const ev = acs.buildPanelRetired({ panelId: 'p' });

    const signed = await acs.publishPanelEvent(bridge, signer, ev);
    expect(signed.id).toBe('signed');
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe(ev);
    expect(calls[0].signer).toBe(signer);
  });

  test('publishPanelEvent validates bridge, signer, and event shape', () => {
    const goodBridge = { publish: () => Promise.resolve({}) };
    const goodSigner = { sign: () => Promise.resolve({}) };
    const ev = acs.buildPanelRetired({ panelId: 'p' });
    expect(() => acs.publishPanelEvent({}, goodSigner, ev)).toThrow(/bridge/);
    expect(() => acs.publishPanelEvent(goodBridge, {}, ev)).toThrow(/signer/);
    expect(() => acs.publishPanelEvent(goodBridge, goodSigner, { nope: true })).toThrow(/unsignedEvent/);
  });
});

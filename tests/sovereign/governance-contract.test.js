'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../management-api/lib/governance-contract');
const { kinds } = require('../../mcp/servers/nostr-bridge');

const V1 = path.join(__dirname, '..', '..', 'contracts', 'governance', 'v1');

describe('governance-contract module', () => {
  test('exports the six governance kinds with the forum numbering', () => {
    expect(contract.KINDS).toEqual({
      PANEL_DEFINITION: 31400, PANEL_STATE: 31401, ACTION_REQUEST: 31402,
      ACTION_RESPONSE: 31403, PANEL_UPDATE: 31404, PANEL_RETIRED: 31405,
    });
    expect(contract.ACTION_REQUEST).toBe(31402);
    expect(contract.ACTION_RESPONSE).toBe(31403);
  });

  test('nostr-bridge kinds re-export the contract kinds, not a second copy', () => {
    for (const [name, kind] of Object.entries(contract.KINDS)) expect(kinds[name]).toBe(kind);
  });

  test('exposes enum values and rule constants from the manifest', () => {
    expect(contract.ENUMS.risk_tiers).toEqual(['low', 'medium', 'high', 'critical']);
    expect(contract.ENUMS.decision_actions).toContain('promote');
    expect(contract.MIN_HUMAN_RATIONALE_CHARS).toBe(20);
    expect(contract.RULES.rationale_required_tiers).toEqual(['high', 'critical']);
  });

  test('the manifest and every golden file are present and consistent', () => {
    for (const k of contract.manifest.kinds) {
      const ev = contract.loadExample(k.kind);
      expect(ev.kind).toBe(k.kind);
      expect(fs.existsSync(path.join(V1, k.file))).toBe(true);
    }
  });

  test('isGovernanceKind covers exactly the manifest range', () => {
    expect(contract.isGovernanceKind(31400)).toBe(true);
    expect(contract.isGovernanceKind(31405)).toBe(true);
    expect(contract.isGovernanceKind(31399)).toBe(false);
    expect(contract.isGovernanceKind(31406)).toBe(false);
  });

  test('the module is frozen', () => {
    expect(Object.isFrozen(contract.KINDS)).toBe(true);
    expect(Object.isFrozen(contract.manifest.enums.risk_tiers)).toBe(true);
  });
});

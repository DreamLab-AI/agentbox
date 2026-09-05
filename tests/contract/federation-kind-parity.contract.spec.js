'use strict';

/**
 * ADR-2061 — federation kind-map parity, agentbox (JS) half.
 *
 * The supported-kind list is ONE versioned artefact, `schema/federation-kinds.json`,
 * that both translators derive from. This suite asserts the JS translator
 * (`management-api/lib/bc20-provenance-bridge.js`) agrees with every row of that
 * artefact — both for *crossed* and for *refused*, and on the target grammar when
 * crossed. Its Rust twin is `federation_kind_artefact_matches_translator` in
 * VisionClaw `src/uri/mod.rs`, which embeds the same bytes through
 * `include_str!("../../agentbox/schema/federation-kinds.json")`.
 *
 * Nothing here hard-codes the kind list: every case is generated from the
 * artefact, so adding a kind to one translator without the other — or to the
 * artefact without either — fails rather than diverging silently.
 */

const path = require('path');
const bridge = require('../../management-api/lib/bc20-provenance-bridge');
const uris = require('../../management-api/lib/uris');

const ART = bridge.FEDERATION_KINDS;
const crossing = ART.kinds.filter((k) => k.crosses);
const refused = ART.kinds.filter((k) => !k.crosses);

// The VisionClaw target kinds this bridge actually has an arm for. A crossing
// row naming anything outside this set is an artefact row with no JS
// implementation — exactly the one-sided change ADR-2061 makes a test failure.
const JS_HANDLED_TARGETS = new Set(['execution', 'kg', 'bead', 'concept', 'did:nostr']);

// refusal_class -> the drop reason_class the bridge must report. This is what
// makes "deliberately closed" distinguishable from "not implemented" at runtime
// and not merely in prose.
const EXPECTED_DROP_CLASS = {
  deliberate: 'missing-args',
  'not-federated': 'unmapped-kind',
};

/** Capture the drop reason the bridge reports, instead of letting it hit stderr. */
function crossCapturingDrop(urn, opts = {}) {
  const drops = [];
  const res = bridge.toVisionclaw(urn, { ...opts, onDrop: (reason, u) => drops.push({ reason, urn: u }) });
  return { res, drops };
}

describe('ADR-2061 federation kind artefact — shape', () => {
  test('artefact is versioned and self-identifying', () => {
    expect(ART.artefact).toBe('federation-kinds');
    expect(ART.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ART.adr).toBe('ADR-2061');
  });

  test('the bridge reads the artefact from schema/federation-kinds.json', () => {
    expect(bridge.FEDERATION_KINDS_PATH)
      .toBe(path.join(__dirname, '..', '..', 'schema', 'federation-kinds.json'));
  });

  test('artefact enumerates exactly the uris.js KINDS — no kind escapes a federation decision', () => {
    // uris.js is the mint authority (every emitted @id goes through it), so a
    // kind it can mint but the artefact never mentions would cross or refuse by
    // accident. Set equality in both directions.
    const minted = Object.keys(uris.KINDS).sort();
    const declared = ART.kinds.map((k) => k.kind).sort();
    expect(declared).toEqual(minted);
  });

  test('every row is either a crossing with a target grammar or a refusal with a reason', () => {
    for (const row of ART.kinds) {
      if (row.crosses) {
        expect(typeof row.target_kind).toBe('string');
        expect(typeof row.target_grammar).toBe('string');
        expect(row.refusal_reason).toBeUndefined();
        expect(Object.keys(ART.crossing_forms)).toContain(row.crossing_form);
      } else {
        expect(typeof row.refusal_reason).toBe('string');
        expect(row.refusal_reason.length).toBeGreaterThan(20);
        expect(Object.keys(ART.refusal_classes)).toContain(row.refusal_class);
      }
      expect(typeof row.source_grammar).toBe('string');
      expect(row.fixture).toBeDefined();
    }
  });

  test('every crossing row names a target the JS bridge has an arm for', () => {
    for (const row of crossing) {
      expect(JS_HANDLED_TARGETS.has(row.target_kind)).toBe(true);
    }
  });

  test('the derived closed map is not transcribed — it equals the artefact rows', () => {
    const expected = Object.fromEntries(
      ART.kinds.filter((k) => k.target_kind && k.target_kind !== 'did:nostr')
        .map((k) => [k.kind, k.target_kind]),
    );
    expect(bridge.AGENTBOX_TO_VISIONCLAW).toEqual(expected);
    // and the inverse is a genuine bijection
    expect(Object.keys(bridge.VISIONCLAW_TO_AGENTBOX).sort())
      .toEqual([...new Set(Object.values(expected))].sort());
  });
});

describe('ADR-2061 — crossing rows translate to the declared target', () => {
  test.each(crossing.map((r) => [r.kind, r]))('%s crosses to the fixture target byte-for-byte', (_kind, row) => {
    const { res, drops } = crossCapturingDrop(row.fixture.input);
    expect(drops).toEqual([]);
    expect(res).not.toBeNull();
    // Byte-identical to the fixture the Rust side independently recomputes.
    expect(res.visionclaw_id).toBe(row.fixture.expect);
  });

  test.each(crossing.map((r) => [r.kind, r]))('%s output satisfies the declared target grammar', (_kind, row) => {
    const { res } = crossCapturingDrop(row.fixture.input);
    expect(res.visionclaw_id).toMatch(grammarToRegex(row.target_grammar));
  });

  test.each(crossing.filter((r) => r.requires_owner_scope && r.unscoped_fixture)
    .map((r) => [r.kind, r]))('%s refuses without a 64-hex owner scope', (_kind, row) => {
    const { res, drops } = crossCapturingDrop(row.unscoped_fixture.input);
    expect(res).toBeNull();
    expect(drops).toHaveLength(1);
  });

  test('structural crossings round-trip with no UrnMapping store', () => {
    // The property that distinguishes structural-passthrough / identity from
    // content-address-of-urn: no durable store is needed to recover the source.
    for (const row of crossing.filter((r) => r.crossing_form !== 'content-address-of-urn')) {
      expect(bridge.roundTrips(row.fixture.input)).toBe(true);
    }
  });
});

describe('ADR-2061 — refusal rows are refused, with a distinguishable reason', () => {
  test.each(refused.map((r) => [r.kind, r]))('%s is refused on the hot path', (_kind, row) => {
    const { res } = crossCapturingDrop(row.fixture.input);
    expect(res).toBeNull();
  });

  test.each(refused.map((r) => [r.kind, r]))('%s reports the drop class its refusal_class implies', (_kind, row) => {
    const { drops } = crossCapturingDrop(row.fixture.input);
    expect(drops).toHaveLength(1);
    const expectedClass = EXPECTED_DROP_CLASS[row.refusal_class];
    // 'deliberate' drops name the missing elevation arguments; 'not-federated'
    // drops name the unmapped kind. The prose reason must match the class.
    if (expectedClass === 'missing-args') {
      expect(drops[0].reason).toMatch(/needs \{domain, slug\}/);
    } else {
      expect(drops[0].reason).toMatch(/^unmapped kind/);
    }
  });

  test('the deliberate refusal is not "not implemented" — it names its unlock', () => {
    const deliberate = refused.filter((r) => r.refusal_class === 'deliberate');
    expect(deliberate.length).toBeGreaterThan(0);
    for (const row of deliberate) {
      // A deliberate refusal records the target it WOULD reach and what is missing.
      expect(typeof row.target_kind).toBe('string');
      expect(row.elevation).toBeDefined();
      expect(Array.isArray(row.elevation.required_args)).toBe(true);
      expect(row.elevation.required_args.length).toBeGreaterThan(0);
      // …and supplying exactly those arguments does cross it, proving the
      // refusal is a hot-path policy rather than an absent implementation.
      const opts = Object.fromEntries(row.elevation.required_args.map((a) => [a, `x-${a}`]));
      const { res } = crossCapturingDrop(row.fixture.input, opts);
      expect(res).not.toBeNull();
      expect(res.visionclaw_id).toMatch(grammarToRegex(row.target_grammar));
    }
  });
});

describe('ADR-2061 — identity pass-through', () => {
  test('a bare did:nostr recovers an agentbox agent identity (inbound direction)', () => {
    const { input } = ART.identity_passthrough.fixture;
    const back = bridge.toAgentbox(input);
    expect(back).toMatch(/^urn:agentbox:agent:[0-9a-f]{64}:/);
    // The agent crossing and the identity pass-through must agree on the DID.
    const agentRow = ART.kinds.find((k) => k.kind === 'agent');
    expect(agentRow.fixture.expect).toBe(ART.identity_passthrough.fixture.expect);
  });
});

/**
 * Turn a declared grammar such as `urn:visionclaw:kg:<pubkey>:<sha256-12>` into a
 * regex, so the artefact's prose grammar is itself executable rather than a
 * comment that can drift from the code.
 */
function grammarToRegex(grammar) {
  const placeholders = {
    '<pubkey>': '[0-9a-f]{64}',
    '<sha256-12>': 'sha256-12-[0-9a-f]{12}',
    '<domain>': '[a-z0-9._-]+',
    '<slug>': '[a-z0-9._-]+',
    '<local>': '[^:]+',
    '<name>': '[^:]+',
  };
  let out = '';
  let rest = grammar;
  while (rest.length) {
    const m = /<[a-z0-9-]+>/.exec(rest);
    if (!m) { out += escapeRe(rest); break; }
    out += escapeRe(rest.slice(0, m.index));
    const rep = placeholders[m[0]];
    if (!rep) throw new Error(`grammar placeholder ${m[0]} has no regex mapping`);
    out += rep;
    rest = rest.slice(m.index + m[0].length);
  }
  return new RegExp(`^${out}$`);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

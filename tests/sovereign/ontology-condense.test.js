'use strict';

const {
  readConfig, buildRequest, stripThinking, parseCondensed, condenseAll, SYSTEM_PROMPT,
} = require('../../mcp/servers/lib/ontology-condense');

describe('readConfig', () => {
  it('defaults to disabled, openai style, concurrency 1', () => {
    const c = readConfig({});
    expect(c.enabled).toBe(false);
    expect(c.style).toBe('openai');
    expect(c.concurrency).toBe(1);
  });
  it('parses ollama style + endpoint trim + enabled flags', () => {
    const c = readConfig({
      ONTOLOGY_CONDENSE_ENABLED: 'true',
      ONTOLOGY_CONDENSE_STYLE: 'OLLAMA',
      ONTOLOGY_CONDENSE_ENDPOINT: 'http://x:11434/',
      ONTOLOGY_CONDENSE_CONCURRENCY: '4',
    });
    expect(c.enabled).toBe(true);
    expect(c.style).toBe('ollama');
    expect(c.endpoint).toBe('http://x:11434');
    expect(c.concurrency).toBe(4);
  });
});

describe('stripThinking', () => {
  it('keeps content after the last channel marker (DiffusionGemma leak)', () => {
    const leaked = '<|channel>thought\n*  reasoning about the class...\n<|channel>final\nA revocable server-side session.\nSYNONYMS: cookie session';
    expect(stripThinking(leaked)).toMatch(/^A revocable server-side session\./);
    expect(stripThinking(leaked)).not.toMatch(/reasoning about/);
  });
  it('drops a leading reasoning scaffold word', () => {
    expect(stripThinking('thought: foo bar')).toBe('foo bar');
  });
  it('passes clean text through', () => {
    expect(stripThinking('Just an answer.')).toBe('Just an answer.');
  });
});

describe('parseCondensed', () => {
  it('splits the summary line and the SYNONYMS line', () => {
    const { summary, synonyms } = parseCondensed(
      'A server-side session keyed by an opaque cookie.\nSYNONYMS: cookie session, server-side session, sticky session'
    );
    expect(summary).toBe('A server-side session keyed by an opaque cookie.');
    expect(synonyms).toEqual(['cookie session', 'server-side session', 'sticky session']);
  });
  it('dedups + caps synonyms and survives a leaked answer', () => {
    const { summary, synonyms } = parseCondensed(
      '<|channel>final\nIdentity binding.\nSynonyms: did, did, decentralised identifier',
      2
    );
    expect(summary).toBe('Identity binding.');
    expect(synonyms).toEqual(['did', 'decentralised identifier']);
  });
  it('returns empty fields for garbage, never throws', () => {
    expect(parseCondensed('')).toEqual({ summary: '', synonyms: [] });
  });
});

describe('buildRequest', () => {
  const rec = { iri: 'urn:ngm:class:x', label: 'Session Continuity', domain: 'security', definition: 'd', relations: [{ type: 'requires', label: 'auth' }] };
  it('openai shape carries n_blocks + system prompt', () => {
    const r = buildRequest({ style: 'openai', model: 'm', nBlocks: 3 }, rec);
    expect(r.path).toBe('/chat/completions');
    expect(r.body.n_blocks).toBe(3);
    expect(r.body.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(r.body.messages[1].content).toMatch(/Session Continuity/);
  });
  it('ollama shape targets /api/chat', () => {
    const r = buildRequest({ style: 'ollama', model: 'm' }, rec);
    expect(r.path).toBe('/api/chat');
    expect(r.body.stream).toBe(false);
  });
});

describe('condenseAll (mock transport)', () => {
  const records = [
    { iri: 'urn:ngm:class:a', label: 'Alpha', domain: 'd' },
    { iri: 'urn:ngm:class:b', label: 'Beta', domain: 'd' },
    { iri: 'urn:ngm:class:c', label: 'Gamma', domain: 'd' },
  ];
  function mockFetch(answerFor) {
    return async (url, opts) => {
      const body = JSON.parse(opts.body);
      const label = body.messages[1].content.match(/Class: (\w+)/)[1];
      const text = answerFor(label);
      if (text === null) return { ok: false, status: 500, text: async () => 'boom' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) };
    };
  }

  it('builds an aliases map and counts ok/failed; one failure is fail-soft', async () => {
    const fetchImpl = mockFetch((label) =>
      label === 'Beta' ? null : `${label} is a thing.\nSYNONYMS: ${label.toLowerCase()}-syn, ${label.toLowerCase()}2`
    );
    const out = await condenseAll(records, {
      cfg: { style: 'openai', endpoint: 'http://mock', model: 'm', nBlocks: 2, concurrency: 1, timeoutMs: 1000, maxSynonyms: 12 },
      fetchImpl,
    });
    expect(out.total).toBe(3);
    expect(out.ok).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.aliases['urn:ngm:class:a']).toEqual(['alpha-syn', 'alpha2']);
    expect(out.aliases['urn:ngm:class:b']).toBeUndefined(); // failed → no aliases
    expect(out.condensed.find((c) => c.iri === 'urn:ngm:class:c').summary).toBe('Gamma is a thing.');
  });

  it('honours concurrency=1 by serialising (single-context safety)', async () => {
    let inFlight = 0, maxInFlight = 0;
    const fetchImpl = async (url, opts) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const label = JSON.parse(opts.body).messages[1].content.match(/Class: (\w+)/)[1];
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: `${label}.\nSYNONYMS: x` } }] }) };
    };
    await condenseAll(records, {
      cfg: { style: 'openai', endpoint: 'http://mock', model: 'm', nBlocks: 2, concurrency: 1, timeoutMs: 1000, maxSynonyms: 12 },
      fetchImpl,
    });
    expect(maxInFlight).toBe(1);
  });
});

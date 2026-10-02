'use strict';

/**
 * railConfig: the sidestr rail is keyed by chain name the way
 * config/sidechain/run-producer.sh, mirror-sync.sh and run-faucet.sh are
 * (SIDESTR_CHAIN, default port 3450 for dreamlab, [sidechain.<name>].port
 * otherwise), so one code path serves sidestr:dreamlab and
 * sidestr:dreamlab-txbt4.
 */

const { railConfig } = require('../../../management-api/lib/sidestr-rail');

const SIDECHAIN = {
  enabled: true,
  announce_mirror: 'https://dreamlab-ai.github.io/sidestr-dreamlab',
  'dreamlab-txbt4': { enabled: false, port: 3451, announce_mirror: 'https://dreamlab-ai.github.io/sidestr-dreamlab-txbt4' },
};
const m = (sidestr) => ({ sidechain: SIDECHAIN, payments: { sidestr: { enabled: true, max_sats_per_payment: 2000, ...sidestr } } });

describe('railConfig :: chain keying', () => {
  it('derives the txbt4 producer from [sidechain.dreamlab-txbt4].port', () => {
    const r = railConfig(m({ chain_id: 'sidestr:dreamlab-txbt4' }), {});
    expect(r).toMatchObject({
      enabled: true, chain_id: 'sidestr:dreamlab-txbt4', chain_name: 'dreamlab-txbt4',
      producer_url: 'http://127.0.0.1:3451', mirror_url: 'https://dreamlab-ai.github.io/sidestr-dreamlab-txbt4',
    });
    expect(r.chain.parent).toBe('txbt4');
  });

  it('derives the dreamlab producer on 3450, as run-producer.sh does', () => {
    expect(railConfig(m({ chain_id: 'sidestr:dreamlab' }), {})).toMatchObject({
      chain_id: 'sidestr:dreamlab', producer_url: 'http://127.0.0.1:3450', mirror_url: 'https://dreamlab-ai.github.io/sidestr-dreamlab',
    });
  });

  it('SIDESTR_CHAIN overrides the configured chain, and SIDESTR_PORT its port', () => {
    expect(railConfig(m({ chain_id: 'sidestr:dreamlab-txbt4' }), { SIDESTR_CHAIN: 'dreamlab' }).chain_id).toBe('sidestr:dreamlab');
    expect(railConfig(m({ chain_id: 'sidestr:dreamlab' }), { SIDESTR_CHAIN: 'dreamlab-txbt4', SIDESTR_PORT: '4001' }).producer_url)
      .toBe('http://127.0.0.1:4001');
  });

  it('an explicit producer_url applies to the configured chain only', () => {
    const cfg = m({ chain_id: 'sidestr:dreamlab', producer_url: 'http://10.0.0.5:3450/' });
    expect(railConfig(cfg, {}).producer_url).toBe('http://10.0.0.5:3450');
    expect(railConfig(cfg, { SIDESTR_CHAIN: 'dreamlab-txbt4' }).producer_url).toBe('http://127.0.0.1:3451');
  });

  it('refuses a SIDESTR_CHAIN that is not compiled in', () => {
    const r = railConfig(m({ chain_id: 'sidestr:dreamlab' }), { SIDESTR_CHAIN: 'mainnet-reserve' });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/not compiled in/);
  });

  it('refuses a chain whose producer port cannot be found', () => {
    const cfg = { sidechain: { enabled: true }, payments: { sidestr: { enabled: true, chain_id: 'sidestr:dreamlab-txbt4', max_sats_per_payment: 1 } } };
    expect(railConfig(cfg, {})).toMatchObject({ enabled: false, reason: expect.stringMatching(/producer/) });
  });

  it('does not read [sidechain.<name>].enabled: paying is not producing', () => {
    expect(railConfig(m({ chain_id: 'sidestr:dreamlab-txbt4' }), {}).enabled).toBe(true);
  });
});

describe('railConfig :: the shipped agentbox.toml through management-api\'s own loader', () => {
  it('enables the rail on the SC1 demo chain with its derived producer and mirror', () => {
    const path = require('path');
    const saved = process.env.AGENTBOX_MANIFEST_PATH;
    process.env.AGENTBOX_MANIFEST_PATH = path.join(__dirname, '..', '..', '..', 'agentbox.toml');
    try {
      const { loadManifest } = require('../../../management-api/adapters/manifest-loader');
      expect(railConfig(loadManifest(), {})).toMatchObject({
        enabled: true, chain_id: 'sidestr:dreamlab-txbt4', producer_url: 'http://127.0.0.1:3451',
        mirror_url: 'https://dreamlab-ai.github.io/sidestr-dreamlab-txbt4',
      });
    } finally {
      if (saved === undefined) delete process.env.AGENTBOX_MANIFEST_PATH; else process.env.AGENTBOX_MANIFEST_PATH = saved;
    }
  });
});

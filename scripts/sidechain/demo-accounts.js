#!/usr/bin/env node
'use strict';

/**
 * Mint (or load) the demo agents' identities and bound spend keys for one
 * chain, and write their account files (ADR-2097, ADR-2101 D3).
 *
 *   SIDESTR_CHAIN=dreamlab-txbt4 node scripts/sidechain/demo-accounts.js \
 *     [--profiles demo-a,demo-b] [--identity-dir <dir>] [--agents-dir <dir>]
 *
 * For each profile: agent-identity.loadOrMint gives the did:nostr key (k_id)
 * in <identity-dir>/agent-did-<profile>.key; sidestr-spend-key.loadOrMintSpend
 * gives an independent spend key (k_spend) beside it and the kind-38420
 * binding k_id signs. The account file
 * <agents-dir>/<profile>-<chain name>.json has alice.json's shape (key,
 * pubkey, challenge, address), where `key` is the spend-key FILE PATH and
 * `pubkey` the spend key, plus did, binding and chain. Addresses come from
 * `sidestr-agent address --prefix`, so no producer needs to be running.
 *
 * Defaults: SIDESTR_CHAIN dreamlab-txbt4 (the SC1 demo chain), identities in
 * $WORKSPACE/sidestr/agents/demo, account files in $WORKSPACE/sidestr/agents.
 * Idempotent: an existing key is loaded, never replaced. Prints public facts
 * only; no key is ever printed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MA = path.join(__dirname, '..', '..', 'management-api');
const agentIdentity = require(path.join(MA, 'lib', 'agent-identity'));
const spendKeys = require(path.join(MA, 'lib', 'sidestr-spend-key'));
const { SIDESTR_CHAINS } = require(path.join(MA, 'lib', 'pay402'));
const { createSidestrAgent } = require(path.join(MA, 'lib', 'sidestr-agent-cli'));

function opts() {
  const ws = process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
  const out = {
    profiles: ['demo-a', 'demo-b'],
    identityDir: path.join(ws, 'sidestr', 'agents', 'demo'),
    agentsDir: path.join(ws, 'sidestr', 'agents'),
  };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    if (a[i] === '--profiles') out.profiles = a[i + 1].split(',').map((x) => x.trim()).filter(Boolean);
    else if (a[i] === '--identity-dir') out.identityDir = a[i + 1];
    else if (a[i] === '--agents-dir') out.agentsDir = a[i + 1];
    else throw new Error(`unknown argument ${a[i]}`);
  }
  return out;
}

async function main() {
  const o = opts();
  delete process.env.AGENTBOX_AGENT_PRIVKEY_HEX; // one key per profile, never an env override
  const name = process.env.SIDESTR_CHAIN || 'dreamlab-txbt4';
  const chainId = `sidestr:${name}`;
  const chain = SIDESTR_CHAINS[chainId];
  if (!chain) throw new Error(`${chainId} is not compiled into pay402.js SIDESTR_CHAINS`);
  const agent = createSidestrAgent();
  const accounts = [];
  for (const profile of o.profiles) {
    if (!/^[a-z0-9-]{1,40}$/.test(profile)) throw new Error(`bad profile ${profile}`);
    const id = agentIdentity.loadOrMint({ profile, identityDir: o.identityDir });
    if (!id || !id.persisted) throw new Error(`could not mint or persist ${profile}`);
    const s = spendKeys.loadOrMintSpend({ identity: id, chainId });
    const names = await agent.address({ url: 'http://127.0.0.1:1', who: s.spendPubkey, prefix: chain.addressPrefix });
    if (names.pubkey !== s.spendPubkey || !names.address.startsWith(`${chain.addressPrefix}1p`)) {
      throw new Error(`sidestr-agent named the wrong key for ${profile}`);
    }
    const account = {
      key: s.spendKeyPath,
      pubkey: s.spendPubkey,
      challenge: names.script,
      address: names.address,
      did: id.did,
      binding: s.binding.id,
      chain: chainId,
    };
    const file = path.join(o.agentsDir, `${profile}-${name}.json`);
    fs.mkdirSync(o.agentsDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(account, null, 1)}\n`, { mode: 0o644 });
    accounts.push({ profile, file, did: id.did, spend_pubkey: s.spendPubkey, address: names.address, minted: s.minted, binding: s.binding.id });
  }
  process.stdout.write(`${JSON.stringify({ chain: chainId, accounts }, null, 1)}\n`);
}

main().catch((err) => { process.stderr.write(`demo-accounts: ${err.message}\n`); process.exit(1); });

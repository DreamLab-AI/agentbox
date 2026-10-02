#!/usr/bin/env node
'use strict';

/**
 * ADR-2097 acceptance: agent A pays agent B 1,000 test sats through a 402,
 * on the chain [payments.sidestr] names, and the receipt URN cites the txid
 * and the including block.
 *
 *   AGENTBOX_MANIFEST_PATH=agentbox.toml node scripts/activation/adr-2097-acceptance.js \
 *     --identity-dir <dir> --out <dir> [--fund-from <key file>] [--fund-sats 3000] \
 *     [--price 1000] [--fixture <path>]
 *
 * What is real: the producer and chain (producer_url), the sidestr-agent
 * binary, both agents' identity keys (agent-identity.loadOrMint) and spend
 * keys (minted beside them, bound by kind-38420 events), the classifier,
 * spend-policy, the payer, the payee's on-chain redemption, and an
 * ExecutionJournal over the local-jsonl events adapter (written under --out).
 * What is staged: A's route runs in a Fastify instance in this process (the
 * live management-api is not restarted), and the NIP-98 auth hook is replaced
 * by a hook that sets request.auth to A's verified identity. B's payee is a
 * plain HTTP server on 127.0.0.1 using lib/sidestr-payee.js.
 *
 * --fund-from pays A's spend address from a funded key when A holds less than
 * price + 1,000 sats. Keys are only ever passed as file paths; nothing here
 * prints a key. Writes <out>/receipt.json and, with --fixture, the 402 that A
 * paid as a pay402 contract fixture.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MA = path.join(ROOT, 'management-api');
const Fastify = require(path.join(MA, 'node_modules', 'fastify'));
const { loadManifest } = require(path.join(MA, 'adapters', 'manifest-loader'));
const agentIdentity = require(path.join(MA, 'lib', 'agent-identity'));
const spendKeys = require(path.join(MA, 'lib', 'sidestr-spend-key'));
const { railConfig, createProducer, waitForInclusion, PAYMENT_HEADER } = require(path.join(MA, 'lib', 'sidestr-rail'));
const { createSidestrAgent } = require(path.join(MA, 'lib', 'sidestr-agent-cli'));
const { createPayee } = require(path.join(MA, 'lib', 'sidestr-payee'));
const { createPaymentsStore } = require(path.join(MA, 'lib', 'sidestr-payments-store'));
const { ExecutionJournal } = require(path.join(MA, 'lib', 'execution-journal'));
const { LocalJsonlEventsAdapter } = require(path.join(MA, 'adapters', 'events', 'local-jsonl'));
const chainPayments = require(path.join(MA, 'routes', 'chain-payments'));

function args() {
  const out = { fundSats: 3000, price: 1000 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[k] = /^\d+$/.test(a[i + 1]) ? Number(a[i + 1]) : a[i + 1];
  }
  if (!out.identityDir || !out.out) throw new Error('--identity-dir and --out are required');
  return out;
}

const log = (...m) => process.stderr.write(`[adr-2097] ${m.join(' ')}\n`);
const quiet = { debug() {}, info() {}, warn: (o, m) => log('warn', m, JSON.stringify(o)), error: (o, m) => log('error', m, JSON.stringify(o)), child() { return this; } };

async function main() {
  const opt = args();
  delete process.env.AGENTBOX_AGENT_PRIVKEY_HEX; // two agents, two keys: no env override
  const manifest = loadManifest();
  const rail = railConfig(manifest);
  if (!rail.enabled) throw new Error(`[payments.sidestr] is off: ${rail.reason}`);
  fs.mkdirSync(opt.out, { recursive: true });
  const agent = createSidestrAgent();
  const producer = createProducer(rail.producer_url);
  const tipBefore = await producer.tip();
  log(`chain ${rail.chain_id} at ${rail.producer_url}, tip ${tipBefore.height}`);

  // ── Two agentbox agent identities, each with a spend key beside it ───────
  const mk = (profile) => {
    const id = agentIdentity.loadOrMint({ profile, identityDir: opt.identityDir });
    if (!id || !id.persisted) throw new Error(`could not mint ${profile}`);
    const s = spendKeys.loadOrMintSpend({ identity: id, chainId: rail.chain_id });
    return { profile, did: id.did, pubkey: id.pubkey, ...s };
  };
  const A = mk('adr2097-a');
  const B = mk('adr2097-b');
  if (A.spendPubkey === A.pubkey || B.spendPubkey === B.pubkey) throw new Error('k_spend equals k_id');
  log(`A ${A.did} spend ${A.spendPubkey}`);
  log(`B ${B.did} spend ${B.spendPubkey}`);
  const published = {
    A: await spendKeys.publishBinding(A.binding, rail.relays),
    B: await spendKeys.publishBinding(B.binding, rail.relays),
  };
  log(`bindings published: A ${published.A.ok}/${published.A.relays}, B ${published.B.ok}/${published.B.relays}`);

  // ── Fund A's spend address if it is short ────────────────────────────────
  const aNames = await agent.address({ url: rail.producer_url, who: A.spendPubkey });
  let funding = null;
  let balA = await agent.balance({ url: rail.producer_url, keyFile: A.spendKeyPath });
  if (balA.spendable < opt.price + 1000) {
    if (!opt.fundFrom) throw new Error(`A holds ${balA.spendable} sats; pass --fund-from`);
    log(`funding A with ${opt.fundSats} sats`);
    const f = await agent.send({ url: rail.producer_url, keyFile: opt.fundFrom, relays: rail.relays, to: aNames.address, amountSats: opt.fundSats });
    const inc = await waitForInclusion({ producer, script: aNames.script, txid: f.txid, minValue: opt.fundSats, timeoutMs: 180000, intervalMs: 3000 });
    if (!inc) throw new Error(`funding ${f.txid} not included`);
    funding = { txid: f.txid, fee: f.fee, block_hash: inc.blockHash, block_height: inc.height };
    balA = await agent.balance({ url: rail.producer_url, keyFile: A.spendKeyPath });
  }
  const balBBefore = await agent.balance({ url: rail.producer_url, keyFile: B.spendKeyPath });

  // ── B: a payee behind a 402 ──────────────────────────────────────────────
  const payee = createPayee({ rail, did: B.did, spend: B, agent, producer });
  const served402 = [];
  const redemptions = [];
  const server = http.createServer(async (req, res) => {
    try {
      const paid = req.headers[PAYMENT_HEADER];
      if (paid) {
        const r = await payee.redeem(paid, { resource: '/thing', timeoutMs: 60000, intervalMs: 2000 });
        redemptions.push(r);
        res.writeHead(r.ok ? 200 : 402, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(r.ok ? { thing: 'the paid resource', paid_by_txid: r.txid, block: r.blockHash } : { error: r.reason }));
      }
      const c = await payee.challenge({ resource: '/thing', amountSats: opt.price });
      const bytes = JSON.stringify(c.body);
      served402.push({ headers: c.headers, bytes });
      res.writeHead(c.status, c.headers);
      return res.end(bytes);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const thing = `http://127.0.0.1:${server.address().port}/thing`;

  // ── A: the rail route, journalled ────────────────────────────────────────
  const eventsDir = path.join(opt.out, 'events');
  const journal = new ExecutionJournal({ eventsAdapter: new LocalJsonlEventsAdapter({ eventsDir }) });
  const store = createPaymentsStore({ file: path.join(opt.out, 'sidestr-payments.json') });
  const app = Fastify();
  app.addHook('preValidation', async (req) => { req.auth = { mode: 'nip98', pubkey: A.pubkey }; });
  await app.register(chainPayments, {
    logger: quiet, manifest, agent, producer, store, mintAtBoot: false,
    identityDir: opt.identityDir, getPlane: () => ({ ready: true, journal }),
  });
  await app.ready();

  log(`A pays ${thing}`);
  const res = await app.inject({ method: 'POST', url: '/v1/chain/pay', payload: { url: thing, max_sats: opt.price } });
  const out = res.json();
  await app.close();
  server.close();
  if (res.statusCode !== 200 || !out.paid) throw new Error(`payment did not settle: ${res.statusCode} ${res.body}`);
  const p = out.payment;

  const balBAfter = await agent.balance({ url: rail.producer_url, keyFile: B.spendKeyPath });
  const coinsB = await producer.coins((await agent.address({ url: rail.producer_url, who: B.spendPubkey })).script);
  const onChain = coinsB.find((c) => c.outpoint.startsWith(`${p.txid}:`));
  const index = await producer.blocks();
  const block = index.blocks.find((b) => b.height === p.block_height);
  const events = fs.readdirSync(eventsDir).flatMap((f) => fs.readFileSync(path.join(eventsDir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
    .filter((e) => e.session_id === p.payment_urn).map((e) => ({ kind: e.kind, event_id: e.payload.event_id, causation: e.payload.causation || null, tool: e.payload.payload.tool, ok: e.payload.payload.ok ?? null }));

  const receipt = {
    adr: 'ADR-2097',
    run_at: new Date().toISOString(),
    chain_id: rail.chain_id,
    producer: rail.producer_url,
    tip_before: tipBefore.height,
    payer: { did: A.did, spend_pubkey: A.spendPubkey, binding_event: A.binding.id },
    payee: { did: B.did, spend_pubkey: B.spendPubkey, binding_event: B.binding.id, address: p.payee_address },
    bindings_published: published,
    funding,
    payment: p,
    payee_redemption: redemptions[redemptions.length - 1] || null,
    response: out.response,
    verified_on_chain: {
      payee_coin: onChain || null,
      block_at_height: block ? block.hash : null,
      block_matches: !!block && block.hash === p.block_hash,
      payee_balance_before: balBBefore.balance,
      payee_balance_after: balBAfter.balance,
    },
    journal: events,
  };
  fs.writeFileSync(path.join(opt.out, 'receipt.json'), `${JSON.stringify(receipt, null, 1)}\n`);

  if (opt.fixture) {
    const paidMemo = p.memo;
    const s = served402.find((x) => JSON.parse(x.bytes).accepts[0].memo === paidMemo);
    fs.writeFileSync(opt.fixture, `${JSON.stringify({ status: 402, headers: { 'Content-Type': s.headers['content-type'] }, body: JSON.parse(s.bytes) }, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, txid: p.txid, block: p.block_hash, height: p.block_height, receipt_urn: p.receipt_urn, payer: A.did, payee: B.did }, null, 1)}\n`);
}

main().catch((err) => { log('FAILED', err.message); process.exit(1); });

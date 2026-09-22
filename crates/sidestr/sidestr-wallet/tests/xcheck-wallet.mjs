// The reference engine (siding, Melvin Carvalho, AGPL-3.0) driven as the
// oracle for the wallet: `setup` opens a chain directory, seals its genesis
// from the document and produces N blocks so the genesis pegs mature;
// `submit` replays that directory and hands a transaction hex to
// `Siding.submit()` — the same mempool policy and signature check a
// producer applies to a `POST /tx` — then seals a block holding it.
//   SIDESTR_SIDING=<siding dir> SCHEMA=<schema-kernel> BLAKETESTNODE=<blaketestnode> \
//     node xcheck-wallet.mjs setup  <chain.json> <dir> <key file> <blocks>
//     node xcheck-wallet.mjs submit <chain.json> <dir> <key file> <tx hex>
import { readFile, mkdir } from 'node:fs/promises';
const siding = process.env.SIDESTR_SIDING;
const { loadEngine } = await import(`${siding}/lib/engine.mjs`);
const { makeSigner, loadKey } = await import(`${siding}/lib/sign.mjs`);
const { Siding } = await import(`${siding}/lib/chain.mjs`);
const [cmd, chainFile, dir, keyFile, arg] = process.argv.slice(2); await mkdir(dir, { recursive: true });
const chain = JSON.parse(await readFile(chainFile, 'utf8'));
const engine = await loadEngine(chain); const signer = makeSigner(engine);
const key = await loadKey(keyFile, { signer });
const s = await new Siding({ engine, chain, dir, signer }).open(key);
if (cmd === 'setup') {
  let last = null; for (let i = 0; i < Number(arg); i++) last = await s.produce(key);
  console.log(JSON.stringify({ genesisHash: s.genesisHash, height: s.height(), tip: s.tip().hash, coins: s.utxo.size, last: last?.hash ?? null }));
} else if (cmd === 'submit') {
  try {
    const r = await s.submit(arg);
    const b = await s.produce(key);
    console.log(JSON.stringify({ ok: true, txid: r.txid, fee: r.fee, vsize: r.vsize, dup: !!r.dup, height: b.height, txs: b.txs, coins: s.utxo.size }));
  } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); }
} else { console.error('setup|submit'); process.exit(2); }

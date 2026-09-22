// The reference engine (siding, Melvin Carvalho, AGPL-3.0) driven for the
// interop tests: `produce` seals one empty block with its Siding class,
// `replay` opens a directory, validates every block in it and lists the burns
// it recorded, `add` replays then offers one more block (hex in a file) to
// `Siding.addBlock` and reports the verdict. `markers` and `blocks` are the
// derived-record differential (audit F1, 2026-09-22): `markers` runs every
// marker parser over a JSON list of scripts, `blocks` offers each block of a
// JSON list to a fresh copy of a baseline directory and reports the verdict,
// the recorded burns and one claim's membership, so the Rust side can hold
// identical bytes to identical derived lists.
//   SIDESTR_SIDING=<siding dir> SCHEMA=<schema-kernel> BLAKETESTNODE=<blaketestnode> \
//     node xcheck.mjs produce|replay <chain.json> <dir> [<key file>]
//     node xcheck.mjs add <chain.json> <dir> <block hex file>
//     node xcheck.mjs markers <chain.json> <dir> <markers json>
//     node xcheck.mjs blocks <chain.json> <baseline dir> <blocks json>
import { readFile, mkdir, rm, cp } from 'node:fs/promises';
const siding = process.env.SIDESTR_SIDING;
const { loadEngine } = await import(`${siding}/lib/engine.mjs`);
const { makeSigner, loadKey } = await import(`${siding}/lib/sign.mjs`);
const { Siding } = await import(`${siding}/lib/chain.mjs`);
const [cmd, chainFile, dir, extra] = process.argv.slice(2); await mkdir(dir, { recursive: true });
const chain = JSON.parse(await readFile(chainFile, 'utf8'));
const engine = await loadEngine(chain); const signer = makeSigner(engine);
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
if (cmd === 'markers') {
  // every parser the reference text-decodes, and the two it compares as bytes
  const o = await import(`${siding}/lib/overlay.mjs`), r = await import(`${siding}/lib/records.mjs`);
  const m = await import(`${siding}/lib/parent.mjs`), c = await import(`${siding}/lib/checkpoint.mjs`);
  const cases = JSON.parse(await readFile(extra, 'utf8')); const out = [];
  for (const x of cases) {
    // an in-memory parent: one block with one transaction, `x.pay` (taproot) then the marker
    const parent = { rpc: async (method) => method === 'getblockhash' ? '00' : { tx: [{ txid: x.txid, vout: [{ n: 0, value: 0.001, scriptPubKey: { hex: x.pay, type: 'witness_v1_taproot' } }, { n: 1, value: 0, scriptPubKey: { hex: x.hex, type: 'nulldata' } }] }] } };
    const d = o.opReturnData(x.hex);
    out.push({
      name: x.name,
      data: d ? toHex(d) : null,
      pegout: o.parsePegout(x.hex),
      record: r.recordText(x.hex),
      pegin: await m.scanPegins(parent, { chainId: x.id, from: 42, to: 42 }),
      claim: o.parseClaims({ outputs: [{ value: 100000, scriptPubKey: x.pay }, { value: 0, scriptPubKey: x.hex }] }),
      ckpt: c.parseCheckpoint(x.hex, x.id),
    });
  }
  console.log(JSON.stringify(out));
} else if (cmd === 'blocks') {
  const cases = JSON.parse(await readFile(extra, 'utf8')); const out = [];
  for (const x of cases) {
    const copy = `${dir}-${x.name}`; await rm(copy, { recursive: true, force: true }); await cp(dir, copy, { recursive: true });
    // a fresh engine per case: the overlay's burn and claim maps live on it
    const fresh = await loadEngine(chain);
    const s = await new Siding({ engine: fresh, chain, dir: copy, signer: makeSigner(fresh) }).open();
    let error = null; try { await s.addBlock(x.hex); } catch (e) { error = String(e.message ?? e); }
    out.push({ name: x.name, ok: error === null, error, pegouts: s.pegouts(), claimed: s.claimed(x.claim.txid, x.claim.vout) });
    await rm(copy, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out));
} else {
  const key = cmd === 'produce' && extra ? await loadKey(extra, { signer }) : null;
  const s = await new Siding({ engine, chain, dir, signer }).open(key);
  const summary = () => ({ genesisHash: s.genesisHash, height: s.height(), tip: s.tip().hash, coins: s.utxo.size, pegouts: s.pegouts() });
  if (cmd === 'produce') { const r = await s.produce(key); console.log(JSON.stringify({ height: r.height, hash: r.hash, txs: r.txs })); }
  else if (cmd === 'add') { const hex = (await readFile(extra, 'utf8')).trim(); let verdict; try { const r = await s.addBlock(hex); verdict = { ok: true, hash: r.hash }; } catch (e) { verdict = { ok: false, error: String(e.message ?? e) }; } console.log(JSON.stringify({ ...summary(), verdict })); }
  else console.log(JSON.stringify(summary()));
}

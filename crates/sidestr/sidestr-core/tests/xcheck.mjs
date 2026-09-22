// The reference engine (siding, Melvin Carvalho, AGPL-3.0) driven for the
// interop tests: `produce` seals one empty block with its Siding class,
// `replay` opens a directory, validates every block in it and lists the burns
// it recorded, `add` replays then offers one more block (hex in a file) to
// `Siding.addBlock` and reports the verdict.
//   SIDESTR_SIDING=<siding dir> SCHEMA=<schema-kernel> BLAKETESTNODE=<blaketestnode> \
//     node xcheck.mjs produce|replay <chain.json> <dir> [<key file>]
//     node xcheck.mjs add <chain.json> <dir> <block hex file>
import { readFile, mkdir } from 'node:fs/promises';
const siding = process.env.SIDESTR_SIDING;
const { loadEngine } = await import(`${siding}/lib/engine.mjs`);
const { makeSigner, loadKey } = await import(`${siding}/lib/sign.mjs`);
const { Siding } = await import(`${siding}/lib/chain.mjs`);
const [cmd, chainFile, dir, extra] = process.argv.slice(2); await mkdir(dir, { recursive: true });
const chain = JSON.parse(await readFile(chainFile, 'utf8'));
const engine = await loadEngine(chain); const signer = makeSigner(engine);
const key = cmd === 'produce' && extra ? await loadKey(extra, { signer }) : null;
const s = await new Siding({ engine, chain, dir, signer }).open(key);
const summary = () => ({ genesisHash: s.genesisHash, height: s.height(), tip: s.tip().hash, coins: s.utxo.size, pegouts: s.pegouts() });
if (cmd === 'produce') { const r = await s.produce(key); console.log(JSON.stringify({ height: r.height, hash: r.hash, txs: r.txs })); }
else if (cmd === 'add') { const hex = (await readFile(extra, 'utf8')).trim(); let verdict; try { const r = await s.addBlock(hex); verdict = { ok: true, hash: r.hash }; } catch (e) { verdict = { ok: false, error: String(e.message ?? e) }; } console.log(JSON.stringify({ ...summary(), verdict })); }
else console.log(JSON.stringify(summary()));

// The reference engine (siding, Melvin Carvalho, AGPL-3.0) driven for the
// interop test: `produce` seals one empty block with its Siding class,
// `replay` opens a directory and validates every block in it.
//   SIDESTR_SIDING=<siding dir> SCHEMA=<schema-kernel> BLAKETESTNODE=<blaketestnode> \
//     node xcheck.mjs produce|replay <chain.json> <dir> [<key file>]
import { readFile, mkdir } from 'node:fs/promises';
const siding = process.env.SIDESTR_SIDING;
const { loadEngine } = await import(`${siding}/lib/engine.mjs`);
const { makeSigner, loadKey } = await import(`${siding}/lib/sign.mjs`);
const { Siding } = await import(`${siding}/lib/chain.mjs`);
const [cmd, chainFile, dir, keyFile] = process.argv.slice(2); await mkdir(dir, { recursive: true });
const chain = JSON.parse(await readFile(chainFile, 'utf8'));
const engine = await loadEngine(chain); const signer = makeSigner(engine);
const key = keyFile ? await loadKey(keyFile, { signer }) : null;
const s = await new Siding({ engine, chain, dir, signer }).open(key);
if (cmd === 'produce') { const r = await s.produce(key); console.log(JSON.stringify({ height: r.height, hash: r.hash, txs: r.txs })); }
else console.log(JSON.stringify({ genesisHash: s.genesisHash, height: s.height(), tip: s.tip().hash, coins: s.utxo.size }));

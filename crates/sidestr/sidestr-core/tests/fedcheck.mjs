// The reference engine (siding, Melvin Carvalho, AGPL-3.0) as oracle for the level-2 federation:
// derives the challenge for `signers`/`threshold`, seals the genesis with the given key files
// (zero auxiliary randomness, as `siding new` does), and prints everything sidestr-core must
// reproduce byte for byte. Output is stored as fixtures/fedtest/expected.json.
//   SIDESTR_SIDING=<siding dir> SCHEMA=<schema-kernel> BLAKETESTNODE=<blaketestnode> \
//     node fedcheck.mjs <chain.template.json> <threshold> <key file>... > expected.json
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const siding = process.env.SIDESTR_SIDING;
const { loadEngine } = await import(`${siding}/lib/engine.mjs`);
const { makeSigner } = await import(`${siding}/lib/sign.mjs`);
const { Siding } = await import(`${siding}/lib/chain.mjs`);
const { federation, partialSignature, verifyPartial, sealFederated, leafScript, numsKey } = await import(`${siding}/lib/federation.mjs`);
const { solutionOf, blockSigHash } = await import(`${siding}/lib/block.mjs`);
const [template, threshold, ...keyFiles] = process.argv.slice(2);
const base = JSON.parse(await readFile(template, 'utf8'));
const e0 = await loadEngine({ ...base, challenge: '5120' + '00'.repeat(32) });
const sg = makeSigner(e0);
const keys = await Promise.all(keyFiles.map(async (f) => (await readFile(f, 'utf8')).trim()));
const pubs = keys.map((k) => sg.pubkeyOf(k));
const doc = { ...base, signers: pubs, threshold: Number(threshold) };
doc.pegs = doc.pegs.map((p) => ({ ...p, script: '5120' + pubs[0] }));
const fed = federation(e0, doc); doc.challenge = fed.challenge;
const engine = await loadEngine(doc); const sg2 = makeSigner(engine);
const E = { ...engine, interpreter: engine.k.interpreter, schnorrSign: (m, k) => sg2.schnorrSign(m, k, new Uint8Array(32)) };
const sealWith = (block, which) => { const sigs = new Map(); for (const i of which) sigs.set(pubs[i], partialSignature(E, block, fed, keys[i])); return sealFederated(E, block, fed, sigs); };
const dir = await mkdtemp(join(tmpdir(), 'siding-fedcheck-'));
const s = await new Siding({ engine, chain: doc, dir, signer: sg2, log: () => {} }).open(null, { seal: (g) => sealWith(g, [0, 2]) });
const genesisHex = (await readFile(join(dir, 'blocks.dat'))).subarray(8).toString('hex');
const g = engine.k.codec.decode('Block', genesisHex);
// block 1 sealed by signers 2 and 3, then block 2 by 1 and 2: two different subsets accepted by the reference
const { block: b1 } = await s.buildNext({ time: s.tip().time + 1 }); const s1 = sealWith(b1, [1, 2]); await s.addSealed(s1);
const { block: b2 } = await s.buildNext({ time: s.tip().time + 1 }); const s2 = sealWith(b2, [0, 1]); await s.addSealed(s2);
const partial0 = partialSignature(E, b2, fed, keys[0]);
console.log(JSON.stringify({
  document: doc, signers: pubs, threshold: Number(threshold),
  federation: { script: fed.script, leafHash: fed.leafHash, internalKey: fed.internalKey, outputKey: fed.outputKey, challenge: fed.challenge, controlBlock: fed.controlBlock, nums: numsKey(e0, doc.id) },
  genesis: { hex: genesisHex, hash: s.genesisHash, witness: solutionOf(g).witness },
  block1: { hex: engine.k.codec.encodeHex('Block', s1), hash: engine.k.codec.blockHash(s1.header), sealedBy: [1, 2] },
  block2: { unsignedHex: engine.k.codec.encodeHex('Block', b2), hex: engine.k.codec.encodeHex('Block', s2), hash: engine.k.codec.blockHash(s2.header), sealedBy: [0, 1],
    sighash: Buffer.from(blockSigHash({ k: engine.k, hash: engine.hash, interpreter: engine.k.interpreter }, b2, fed.challenge, engine.hash.hexToBytes(fed.leafHash))).toString('hex'),
    partial0, partial0Verifies: verifyPartial(E, b2, fed, pubs[0], partial0) },
  height: s.height(),
}, null, 1));
await rm(dir, { recursive: true, force: true });

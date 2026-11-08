# nostr-receipt

Signed `did:nostr` receipts for disclosures and revocations, verifiable by people and by agents.

A receipt is an ordinary Nostr event (NIP-01) signed with BIP-340 Schnorr through
`nostr-bbs-core` with its `did` feature, so `did:nostr` identifiers and DID documents come from
solid-pod-rs's canonical types. AGPL-3.0-only, like solid-pod-rs and agentbox. The issuer is the
event pubkey, written `did:nostr:<hex>`.

| Kind (provisional) | Attests | Commits to |
|---|---|---|
| 8810 disclosure | an answer was released from a memory | salted question hash, answer hash, optional requester DID |
| 8811 revocation | a document was removed from a memory | document hash |

Both carry the memory commitment, the mechanism (`mech`: name, sigma, clip), the per-document
guarantee (`dp`: epsilon, delta) and an optional `prev` link chaining the issuer's log. The
`content` is a plain-English rendering of the tags and must match them.

A valid signature proves who issued the statement and that it is unaltered. It does not prove
the mechanism was applied. Receipts can reveal who asked whom, so send them gift-wrapped (NIP-59),
not in the clear on a public relay.

## Use

```sh
nostr-receipt keygen   --out issuer.key
nostr-receipt disclose --key issuer.key --memory <hex> --salt <hex> --query "..." --answer "..." \
                       --sigma 1.5 --clip 1 --epsilon 6.13 --delta 1e-5 > receipt.json
nostr-receipt verify   --file receipt.json [--salt <hex> --query "..." --answer "..."] [--human]
nostr-receipt revoke   --key issuer.key --memory <hex> --document "..." --sigma ... --prev <id>
nostr-receipt did      --did did:nostr:<hex>     # issuer DID document (solid-pod-rs tier 1)
nostr-receipt bench
```

`verify` prints a JSON verdict (or sentences with `--human`) and exits 0 only if the receipt is
valid and any supplied question and answer match. In agentbox, sign through the identity port with
`CommandSigner` instead of holding a key file.

## Checks

`cargo test`: all 19 official BIP-340 vectors (signing and verification), issue/verify round
trips, rejection of every single-field tamper, rejection of validly signed non-receipts, an
external signer whose output is checked, and the shared `did:nostr` grammar fixtures
(`fixtures/did-nostr.json`), which `tests/contract/did-nostr-parity.node-test.js` also runs against
`management-api/lib/uris.js`. Measured: 780-byte receipts, about 77 µs to verify.

Not published: the tag set is a bespoke format until a draft NIP settles it.

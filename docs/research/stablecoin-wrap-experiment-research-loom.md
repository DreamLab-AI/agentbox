Backends: loom (SPARQL over the reasoned closure, POST http://192.168.2.132:8084/loom/sparql; generation visionGraph@ae913f93a23e7cd604f4c5ec94d0d48dfee8aec8, content digest 543df171f0fe58d529ebfd90912899454a5073367d6e193a5eb2c3e12172a3f6)

# Loom grounding — what the estate's own ontology says (lead)

## Findings

- The ontology models a wrapped token as requiring a mint-burn mechanism and a custodian [501], and a lock-and-mint bridge as locking the original in custody and minting a synthetic on the destination chain [503]; a burn-and-mint bridge contrasts with it and keeps total supply constant across chains [502].
- Proof of reserves requires custody and transparency and supports stablecoins; it relates to Tether and USDC [504].
- A two-way peg implements sidechain and cross-chain bridge, using threshold signatures, SPV verification and Merkle proofs [507]. Liquid requires a two-way peg, a federation and functionaries [509].
- Stablecoins on Bitcoin are defined as price-stable tokens on Bitcoin-based protocols such as Taproot Assets, Liquid or RGB [500]; Taproot Assets supports Tether USDT on Lightning and machine-to-machine payments [506]; RGB uses client-side validation with AluVM and single-use seals (tapret/opret) [505].
- Corpus gap: the USDT class lists Tron, Solana and Ethereum as what it uses and nothing on Bitcoin layers [510], although stablecoins-on-bitcoin and taproot-assets relate it to them [500][506]. Candidate governed enrichment (vault propose), not part of this run.

## Sources

### [500] Loom class stablecoins-on-bitcoin
URL: https://narrativegoldmine.com/class/stablecoins-on-bitcoin
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/stablecoins-on-bitcoin" retrieved="2026-09-23">
> sourceDomain: blockchain
> relatedTo: taproot-assets
> relatedTo: btc-layer-3
> qualityScore: 0.72
> hasMaturity: https://narrativegoldmine.com/individual/maturity-emerging
> label: Stablecoins on Bitcoin
> comment: Stablecoins on Bitcoin are price-stable tokens issued and transferred on Bitcoin-based protocols such as Taproot Assets, Liquid, or RGB, rather than on smart-contract chains like Ethereum. They aim to bring dollar-denominated value transfer to the Bitcoin ecosystem, leveraging Bitcoin's settlement security and, where c
</untrusted-source>

### [501] Loom class wrapped-token
URL: https://narrativegoldmine.com/class/wrapped-token
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/wrapped-token" retrieved="2026-09-23">
> uses: threshold-signature-scheme
> uses: smart-contract
> uses: multi-party-computation
> uses: erc-20-token-standard
> sourceDomain: blockchain
> requires: mint-burn-mechanism
> requires: custodian
> relatedTo: peg-mechanism
> relatedTo: liquid-staking-token
> relatedTo: cross-chain-bridge
> relatedTo: cross-chain-asset-transfer
> relatedTo: blockchain-interoperability
</untrusted-source>

### [502] Loom class burn-and-mint-bridge
URL: https://narrativegoldmine.com/class/burn-and-mint-bridge
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/burn-and-mint-bridge" retrieved="2026-09-23">
> uses: cryptographic-proof
> uses: cross-chain-messaging
> sourceDomain: blockchain
> relatedTo: tokenomics
> qualityScore: 0.8
> hasMaturity: https://narrativegoldmine.com/individual/maturity-emerging
> enables: cross-chain-asset-transfer
> enables: blockchain-interoperability
> contrastsWith: lock-and-mint-bridge
> label: Burn-and-Mint Bridge
> comment: A Burn-and-Mint Bridge is a cross-chain asset transfer mechanism in which tokens are irreversibly destroyed (burned) on the source blockchain and an equivalent quantity of canonical tokens is newly created (minted) on the destination blockchain, ensuring that the total circulating supply across chains remains constant.
</untrusted-source>

### [503] Loom class lock-and-mint-bridge
URL: https://narrativegoldmine.com/class/lock-and-mint-bridge
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/lock-and-mint-bridge" retrieved="2026-09-23">
> uses: wrapped-token
> uses: smart-contract
> uses: bridge-contract
> sourceDomain: blockchain
> relatedTo: blockchain-security
> qualityScore: 0.8
> hasMaturity: https://narrativegoldmine.com/individual/maturity-established
> enables: cross-chain-interoperability
> enables: cross-chain-asset-transfer
> label: Lock-and-Mint Bridge
> comment: A lock-and-mint bridge is a cross-chain interoperability mechanism that transfers asset value between blockchains by locking the original asset in a custodial smart contract on the source chain and minting an equivalent synthetic (wrapped) representation on the destination chain, with the peg maintained by a network of
</untrusted-source>

### [504] Loom class proof-of-reserves
URL: https://narrativegoldmine.com/class/proof-of-reserves
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/proof-of-reserves" retrieved="2026-09-23">
> uses: zero-knowledge-proof
> uses: hash-function
> uses: cryptographic-hash
> supports: stablecoin
> sourceDomain: blockchain
> requires: transparency
> requires: custody
> relatedTo: usdc
> relatedTo: tether
> relatedTo: reserve-asset
> relatedTo: digital-asset-custody
> relatedTo: cryptocurrency
</untrusted-source>

### [505] Loom class rgb-and-client-side-validation
URL: https://narrativegoldmine.com/class/rgb-and-client-side-validation
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/rgb-and-client-side-validation" retrieved="2026-09-23">
> uses: zk-aluvm
> uses: tapret
> uses: strict-types
> uses: stark
> uses: pedersen-commitments
> uses: pedersen-commitment
> uses: opret
> uses: hash-time-locked-contracts
> uses: hash-time-locked-contract
> uses: contractum-language
> uses: bifrost-protocol
> uses: alu-vm
</untrusted-source>

### [506] Loom class taproot-assets
URL: https://narrativegoldmine.com/class/taproot-assets
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/taproot-assets" retrieved="2026-09-23">
> uses: utxo-model
> uses: universe-servers
> uses: tlv-encoding
> uses: taproot-transactions
> uses: schnorr-signatures
> uses: schnorr-signature
> uses: lightning-channels
> uses: htlc
> supports: tether-usdt-on-lightning
> supports: stablecoins-on-bitcoin
> supports: programmable-assets
> supports: machine-to-machine-payments
</untrusted-source>

### [507] Loom class two-way-peg
URL: https://narrativegoldmine.com/class/two-way-peg
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/two-way-peg" retrieved="2026-09-23">
> uses: threshold-signature-scheme
> uses: spv-verification
> uses: merkle-proof
> sourceDomain: blockchain
> requires: smart-contract
> requires: cryptographic-proof
> relatedTo: zero-knowledge-rollup
> relatedTo: optimistic-rollup
> relatedTo: atomic-swap
> qualityScore: 0.62
> implements: sidechain
> implements: cross-chain-bridge
</untrusted-source>

### [508] Loom class stablecoin-regulation
URL: https://narrativegoldmine.com/class/stablecoin-regulation
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/stablecoin-regulation" retrieved="2026-09-23">
> uses: smart-contract
> uses: reserve-asset
> uses: hash-function
> uses: distributed-ledger
> uses: digital-signature
> uses: blockchain-network
> supports: tether
> supports: micropayments
> supports: digital-identity-wallet
> supports: cross-border-compliance
> supports: circle
> supports: cbdcs
</untrusted-source>

### [509] Loom class liquid-network
URL: https://narrativegoldmine.com/class/liquid-network
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/liquid-network" retrieved="2026-09-23">
> uses: multisig
> uses: elements-project
> sourceDomain: blockchain
> requires: two-way-peg
> requires: functionary
> requires: federation
> requires: bitcoin-proof-of-work-protocol
> relatedTo: transaction-privacy
> relatedTo: peg-mechanism
> relatedTo: blockstream
> qualityScore: 0.72
> isPartOf: bitcoin-proof-of-work-protocol-layer-2
</untrusted-source>

### [510] Loom class usdt
URL: https://narrativegoldmine.com/class/usdt
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/usdt" retrieved="2026-09-23">
> uses: tron-blockchain
> uses: solana
> uses: ethereum
> uses: erc-20-token-standard
> sourceDomain: blockchain
> requires: usd
> requires: tether
> requires: custody-infrastructure
> relatedTo: liquidity-provision
> relatedTo: automated-market-maker
> qualityScore: 0.72
> isPartOf: stablecoin
</untrusted-source>

### [511] Loom class tether
URL: https://narrativegoldmine.com/class/tether
Retrieved: 2026-09-23
Status: verified
Found via: loom
<untrusted-source url="https://narrativegoldmine.com/class/tether" retrieved="2026-09-23">
> uses: tron-blockchain
> uses: smart-contract
> uses: proof-of-reserves
> uses: ethereum
> supports: liquidity
> supports: cryptocurrency-exchange
> sourceDomain: finance
> requires: reserve-backing
> requires: fiat-currency
> requires: custodian
> requires: blockchain
> relatedTo: stablecoin-regulation
</untrusted-source>

## Open questions

- The USDT class's Bitcoin-layer relations are missing; propose an enrichment after this run.

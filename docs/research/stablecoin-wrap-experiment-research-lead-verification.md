Backends: WebFetch (direct page reads of The Block and Halborn by the synthesis writer, 2026-09-23), local (agentbox worktree at bfda4d4e4). Leads for the Liquid incident came from the Lead Researcher's verification round (The Block, Liquid's incident report on X, Halborn, CoinDesk, The Hacker News); only the pages below were re-opened by the writer and only those are cited.

# Lead verification: the Liquid incident of 6 September 2026, and the estate's prior RGB position

Slug: `stablecoin-wrap-experiment` · Retrieved: 2026-09-23 · Numbering: [600] and above.

## Findings

- **The Liquid incident is confirmed by two independent publishers re-read today.** The Block attributes the bug to "the caching of range proof verifications in Elements", reports about 4,000 LBTC created without backing, a standard peg-out through SideSwap's peg-out authorisation key, no keys compromised, roughly 3,400 BTC returned on 7 September, about 598.5 BTC not returned, and peg-outs still disabled [600]. Halborn, an independent security firm, dates its explainer 9 September 2026 and describes the same mechanism: roughly 4,000 L-BTC minted without authorisation, then swapped for BTC through the legitimate peg-out process [601]. Halborn does not say whether keys were compromised [601]. (verified)
- **Liquid's own incident report** is on X at the URL below; the Lead Researcher's round records block 4,050,336 at 15:53:10 UTC. The writer did not re-open it, so it is a lead and is cited only as corroboration that the operator itself published a report [602]. (unresolved at writer level)
- **The estate's 21 September position** on RGB and USD₮ is the fact base of the PRD-024 research pack: announcement only, launch window "end of summer to mid-September 2026", not confirmed live [603]. PRD-024 records USDT as paused with the bridge scaffolded and no asset bridged [604]. ADR-2112 moved the sidestr crates to DreamLab-AI/sidestr-rs and left the internal `sidestr-bridge` crate unwritten and unplaced [605]. (verified)

## Sources

### [600] The Block — 'Return the bitcoin': Blockstream refuses ransom demand for remaining 600 BTC from Liquid exploit (2026-09-11)
URL: https://www.theblock.co/news/ecosystems/2026-09-11-return-the-bitcoin-blockstream-refuses-ransom-demand-for-remaining-600-btc-from-liquid-exploit-414247
Retrieved: 2026-09-23
Status: verified (re-read by the synthesis writer; same page as [116], read independently)
Found via: lead verification → WebFetch

<untrusted-source url="https://www.theblock.co/news/ecosystems/2026-09-11-return-the-bitcoin-blockstream-refuses-ransom-demand-for-remaining-600-btc-from-liquid-exploit-414247" retrieved="2026-09-23">
> the vulnerability was in the caching of range proof verifications in Elements, the underlying software used to run the Liquid Network.
> About 4,000 LBTC was created without backing by bitcoin held in reserve.
> The exploiter then used the Liquid Network wallet and trading platform SideSwap, which, as a Liquid Federation member, holds a peg-out authorization key, to convert the unbacked LBTC to BTC through a standard peg-out.
> Liquid said its network operators were not hacked and no keys were compromised.
> On Sept. 7, the exploiter returned roughly 3,400 BTC following an earlier onchain message telling Blockstream to 'fix the bug first.'
> However, about 598.5 BTC was not returned.
> peg-outs remain disabled as a precautionary measure
</untrusted-source>

### [601] Halborn — Explained: The Liquid Network Hack (September 2026)
URL: https://www.halborn.com/blog/post/explained-the-liquid-network-hack-september-2026
Retrieved: 2026-09-23
Status: verified
Found via: lead verification → WebFetch

<untrusted-source url="https://www.halborn.com/blog/post/explained-the-liquid-network-hack-september-2026" retrieved="2026-09-23">
> Post date: 09.09.2026
> The root cause of the incident is believed to be a flaw in the proof verification code that Liquid Network used for Confidential Transactions.
> The Liquid Network hack involved the unauthorized minting of approximately 4,000 L-BTC worth about $320 million.
> Once the fake L-BTC were created, the attacker was able to use the legitimate peg-out process to swap them for BTC on Bitcoin.
> The purported whitehat hacker returned 3,400 of the 4,000 stolen Bitcoin
</untrusted-source>

### [602] Liquid Network — incident report on X
URL: https://x.com/Liquid_BTC/status/2097404704028545175
Retrieved: 2026-09-23
Status: unresolved at writer level (reported by the Lead Researcher's verification round; not re-opened here, X pages do not render without a session)
Found via: lead verification

### [603] agentbox — PRD-024 research pack, coordinator fact base (2026-09-21)
URL: https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/proposals/sovereign-settlement-research/BRIEF-fact-base.md
Retrieved: 2026-09-23
Status: verified
Found via: local

<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/proposals/sovereign-settlement-research/BRIEF-fact-base.md" retrieved="2026-09-23">
> Tether announced USD₮ on RGB 2025-08-28 ("plans to launch"). Commercial rollout led by UTEXO
> launch window "end of summer to mid-September 2026". Not confirmed live as of 2026-09-21.
> RGB v0.11.1 on mainnet since July 2025; used by Iris Wallet, BitMask, KaleidoSwap, LNFI, Utexo.
</untrusted-source>

### [604] agentbox — PRD-024 Sovereign settlement (docs/proposals/sovereign-settlement.md)
URL: https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/proposals/sovereign-settlement.md
Retrieved: 2026-09-23
Status: verified
Found via: local

<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/proposals/sovereign-settlement.md" retrieved="2026-09-23">
> Testnet first; mainnet and real USDT only behind an implemented P21 owner-and-legal gate
> rgb-lib only inside an isolated bridge process
> **USDT.** Paused: bridge scaffolded and framed, no asset bridged, no claim (ADR-2102).
</untrusted-source>

### [605] agentbox — ADR-2112, the sidestr crates live in sidestr-rs
URL: https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/adr/ADR-2112-sidestr-crates-live-in-sidestr-rs.md
Retrieved: 2026-09-23
Status: verified
Found via: local

<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/adr/ADR-2112-sidestr-crates-live-in-sidestr-rs.md" retrieved="2026-09-23">
> The planned internal crates (`sidestr-producer`, `-bridge`, `-mcp`) are
> not written yet; this record does not decide where they go.
</untrusted-source>

### [606] agentbox — config/sidechain/README.md, Interim producer and mirror
URL: https://github.com/DreamLab-AI/agentbox/blob/a2fd86cb4/config/sidechain/README.md
Retrieved: 2026-09-23
Status: verified
Found via: local

<untrusted-source url="https://github.com/DreamLab-AI/agentbox/blob/a2fd86cb4/config/sidechain/README.md" retrieved="2026-09-23">
> (10 s with transactions), the five default public relays, peg-ins scanned on the estate's
> `--announce-mirror <https url>` to publish the kind-33333 tip after every block; the
> `blocks.json` into a GitHub Pages checkout and pushes on change; Pages serves them with
</untrusted-source>

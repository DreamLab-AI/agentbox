Backends: perplexity (perplexity_search ×9) · WebFetch/curl direct to primary pages (fca.org.uk, handbook.fca.org.uk, legislation.gov.uk, gov.uk, tether.to, circle.com, developers.circle.com, esma.europa.eu via perplexity extract, gnu.org, mozilla.org) · web-researcher/scrape_page (eur-lex: empty extraction, fell back to perplexity extract of the eur-lex page) · ceramic (2 queries: one HTTP 422, one returned only irrelevant testnet press pages; nothing cited from it) · local (agentbox review doc, `gh api`, `cargo tree` over a fresh rgb-lib clone at `bb3bdad6`, 2026-09-18). All retrievals 2026-09-23.

# Stablecoin wrap experiment: legal, regulatory, issuer terms and labelling (researcher E)

**This is source-gathering, not legal advice.** Every "does not touch" statement below is an inference from published text, and it needs counsel's confirmation before the owner relies on it.

## 0. Status of the dates in the adversarial review

The review states that the FCA regime commences on 25 October 2027, that applications open on 30 September 2026, and that CARF due diligence starts on 1 January 2026 [REVIEW-adversarial-gpt6-astra.md:517–521]. All three dates still hold as of 2026-09-23.

- **Regime commencement and application window (verified).** The regime starts on **25 October 2027**. The application window opens on **30 September 2026**, one week after this report, and closes on **28 February 2027** [400][401]. The FCA published the final rules on 30 June 2026 in PS26/9 to PS26/13; PS26/10 covers stablecoin issuance [401]. The perimeter guidance, PS26/18 (the new PERG 18), was finalised on 16 September 2026 [403].
- **CARF (verified).** Due diligence starts on 1 January 2026. The first reports are due by 31 May 2027 [408].
- **Review's claim that "a wrapped claim is a claim on the bridge operator" (verified).** Both issuers' own terms support it. Tether's terms say wrapped or bridged tokens "are not Tether Tokens" and "cannot be redeemed with Tether" [410]. Circle's terms say "Bridged USDC is not USDC" and Circle "does not issue or redeem Bridged USDC" [413].

## 1. UK position

### 1.1 Regime status (verified)
- The Cryptoassets Regulations 2026 were passed on 4 February 2026 [401].
- From 25 October 2027, authorisation is needed to carry on any of these activities by way of business in the UK [401][402][403]:
  - issuing a qualifying stablecoin;
  - safeguarding qualifying cryptoassets;
  - operating a trading platform;
  - dealing;
  - arranging;
  - staking.
- The FCA will not regulate issuance from a non-UK establishment directly. Overseas-issued stablecoins such as USDT and USDC are caught through two routes: the Admissions and Disclosures designated activities regime, and the ordinary dealing, arranging and custody activities when these are carried on in the UK [402].

### 1.2 Would a testnet token be a "cryptoasset"? (inferred; needs counsel)
- **Relevant definitions (verified).**
  - FSMA s.417 and MLR reg. 14A both define a cryptoasset as a "cryptographically secured digital representation of **value or contractual rights**" [404][405].
  - A **qualifying** cryptoasset must also be fungible and transferable, and must not be "solely a record of value or contractual rights" [403].
  - A qualifying stablecoin must also involve "the holding of fiat currency and/or other assets … for the purpose of maintaining that stable value" [403].
- **What PERG 18 does not say (verified).** It has **no guidance on testnet or test tokens, or on tokens of no value** [403].
- **Where the FCA points instead (verified).** Its "solely a record" test asks whether the controller can exercise the value or rights, and whether transfer is the mechanism by which value moves [403]. Freshfields summarises the FCA's proposed factors: "no observable price or pricing mechanism" and "no expectation among holders … that it can be used to generate value" [406, secondary].
- **Inference.** A signet-anchored token that is minted without any real USDT or USDC locked, cannot be redeemed, and has no price arguably:
  - represents no value;
  - has no backing assets, so it cannot be a *qualifying stablecoin*.
- **Where the inference breaks.** The analysis changes the moment either of these happens:
  - **Real USDT or USDC is locked on a mainnet to back it, even £1.** The token then represents a claim on that asset, and the operator is holding assets on behalf of the token holders. That points towards custody or safeguarding and possibly issuance.
  - **Anyone outside DreamLab can receive it and trade it for anything.**

  **Keep the experiment strictly unbacked, or backed only by testnet USDC [412] and testnet USDT where either exists.**

### 1.3 MLR 2017 registration (verified text; applicability inferred)
- **Who must register.** Reg. 14A covers exchange providers and custodian wallet providers acting "**by way of business**", in the course of business carried on in the UK [404][405].
- **Why a closed testnet trial probably does not qualify (inferred).** It is internal, holds no customer assets and has no fee or commercial relationship, so it is plausibly neither "by way of business" nor dealing in a "representation of value".
- **What would change that.** The regime would come into play if any of these were added:
  - custody of third parties' real stablecoins;
  - exchange of the wrapped token for money or other cryptoassets;
  - operating the bridge as a service for others.
- **Penalty (unresolved).** The FCA page I read does not state the penalty for unregistered operation [405].

### 1.4 Financial promotions (verified)
- **Scope.** The s.21 restriction applies to promotions of qualifying cryptoassets that originate outside the UK if they are "capable of having an effect in the UK". A promotion does not need to target UK consumers to be caught [407].
- **Lawful routes and penalty.** There are four lawful routes. A breach is a criminal offence carrying up to 2 years' imprisonment and/or an unlimited fine [407].
- **Implication (inferred).** Public material such as a README, blog post or Nostr note that invites people to "wrap your USDT into our sidechain" could be an inducement to engage in investment activity *if* the token is a qualifying cryptoasset.
  - Material describing a no-value testnet mechanism, with no invitation to acquire anything of value, is much safer.
  - Wording must never suggest that mainnet deposits are accepted.

### 1.5 Sandbox (verified)
- **The Regulatory Sandbox is "not regulatory exempt".** Regulated activity still needs authorisation or registration, which may be restricted authorisation [409].
- **Crypto applications are closed.** New crypto-related Innovation Services applications are closed. The only exception is MLR-registered prospective UK stablecoin issuers seeking Digital Securities Sandbox settlement [409].
- **Stablecoin cohort.** The 2026 cohort (Monee, ReStabilise, Revolut, VVTX) closed on 18 January 2026 [409].

**Conclusion:** the sandbox offers no route for this experiment, and it is not needed for no-value testnet work.

### 1.6 CARF and sanctions
- CARF applies to "reporting cryptoasset service providers" [408].
- Inference: a no-value internal testnet has no reportable transactions. Revisit this at any real-value step.
- The OFSI point in the review stands and was not re-researched here [REVIEW:521].

## 2. Issuer terms: exact clauses

### 2.1 Tether Terms of Service (last updated 26 February 2026) [410]
Tether's page generates its section numbers automatically, so clauses are cited by heading.

| Heading | Effect |
|---|---|
| Risk of Wrapped or Bridged Tokens | Third-party wrapped or bridged tokens "are not Tether Tokens… cannot be redeemed with Tether… Tether assumes no liability". |
| Forks | Only tokens on blockchains Tether "announces on the Site as being supported" are Tether Tokens. |
| Issuances and Redemptions | Only a "verified customer of Tether" may redeem. Redemption has ceased on Omni, BCH-SLP, Kusama, EOS and Algorand (from 1 September 2025). |
| Intellectual Property (Marks) | No use of the Marks "without express, prior, written permission… including… on a website… in meta data or code, or in any other manner". |
| Prohibited Assets | Domains, handles and marks "featuring intellectual property owned by Tether" are "automatically transferred and assigned to Tether". |
| Prohibited Use sanctions; Right to Use | Tether may freeze tokens, "blacklist any Digital Tokens Address", and seize and deliver property to authorities. |

**Governing law:** British Virgin Islands.

**Implications:**
- The terms do not *prohibit* third-party wrapping. They disclaim it.
- The trademark clause, including "in meta data or code", is the binding constraint on naming.
- The freeze powers mean that a mainnet reserve address holding real USD₮ can be frozen whatever the sidechain says.

### 2.2 Circle USDC Terms (last updated 12 December 2025) [411], and Third-Party Bridged USDC Terms (12 December 2025) [413]

| § | Effect |
|---|---|
| 2 | Only a holder "eligible to, and does, register a Circle Mint account" can redeem. |
| 8, "Copies, Forks & Advanced Protocols Not Supported" | Circle recognises that unaffiliated parties may create a "copy" or a "wrapper" of USDC. Circle "is under no obligation to support" either and "assumes no responsibility". |
| 12, "Limited License; IP Rights" | "Circle" and the logos are marks. Nobody may "copy, imitate, or use them without Circle's prior written consent". |
| 13 (Third Parties / Risk) | Third-party support for USDC "does not imply any endorsement by Circle". |
| 13, "Blocked Addresses" | Circle may "block" addresses and freeze USDC. A holder "may forfeit any rights… including the ability to redeem". |
| Bridged Terms §1 | "Bridged USDC is not USDC"; it is "not backed by US dollars or any of Circle's USDC-related reserves". |

**Implications:**
- **Circle is the more permissive issuer.** It publishes a Bridged USDC Standard for third-party deployers, with an option (not an obligation) for Circle to take over the contract [414]. That standard is EVM-only, so it does not fit an RGB, Taproot Assets or sidestr asset.
- **Naming.** Circle's own convention for a non-Circle bridged token is a distinct ticker, "USDC.e", "not issued or backed by Circle" [412].
- **Word mark.** Section 12 names "Circle" and the logos rather than the word "USDC". Whether "USDC" is a registered UK word mark is **unresolved**.

## 3. EU MiCA
- **Art. 48(1) (verified).** Nobody may offer an EMT to the public or seek its admission to trading unless they are the issuer and are authorised as a credit institution or EMI. Other persons may do so only "upon the written consent of the issuer" [415].
- **Recital 22 (verified).** Services provided "in a fully decentralised manner without any intermediary" are out of scope [415].
- **USDC (verified).** It is issued as an EMT by Circle France in the EEA. Anyone offering it to the public or seeking admission needs Circle France's written consent [416].
- **USDT (secondary witnesses only; primary register not checked).**
  - Tether is not an authorised EMT issuer. USDT is absent from ESMA's EMT register.
  - EU CASPs delisted it between December 2024 and March 2025.
  - The CASP transitional period ended on 1 July 2026 [418].
- **Custody and transfer (verified).** ESMA's 17 January 2025 statement set end-Q1 2025 for CASPs to stop trading and offering services in non-compliant EMTs. It also says "mere custody and transfer of these crypto-assets should remain possible" [417].
- **Relevance to a UK operator shipping open-source tools (inferred).** Publishing code is not an offer to the public of an EMT. The EU risk falls on:
  - DreamLab itself, if it runs a live bridge serving EU users;
  - EU parties who deploy the tools as a CASP.
- **Mainnet asymmetry.**
  - A real *wrapped USDC* offered to EU users would need Circle France's consent under Art. 48, or would amount to Circle's "wrapper", which is not USDC.
  - A real *wrapped USDT* could not be listed by any EU CASP.
- **Mitigations to add.** The README should warn EU deployers about both points. Keep the experiment testnet-only and avoid geo-marketing.

## 4. Naming and disclaimers
**Recommended ticker and name for a no-value testnet token:**
- Choose a ticker that contains neither "USDT", "USD₮", "Tether" nor "USDC". Examples: `tDLUSD`, `DLT-TEST`, or `XTEST`.
- Put a description such as "test dollar-unit — no value, not issued, backed or endorsed by Tether or Circle" in the RGB or Taproot Assets contract metadata.

Why:
1. Tether's Marks clause explicitly covers "meta data or code" [410].
2. Circle forbids use of its marks without consent [411].
3. Even Circle's own non-native bridged tokens carry a different ticker ("USDC.e") [412].
4. A ticker such as "USDT" in on-chain metadata is permanent, and indexers can copy it.

Nominative, descriptive use in prose, such as "a test of wrapping USD₮-like assets", is lower risk (inferred). **Counsel should confirm this.**

**Disclaimer model to copy.** Circle's own testnet wording: "Testnet tokens have no financial value… are not backed by real US dollars" [412]. Suggested disclaimer text for the README, the genesis `pin:` note and the wallet UI:
> "Testnet only. This asset has no value, is not redeemable, is not USD₮ or USDC and is not issued, backed or endorsed by Tether or Circle. Do not send mainnet assets."

## 5. Licensing (local verification, 2026-09-23)
- **rgb-lib (verified).**
  - The crate is `license = "MIT"`, v0.3.0-beta.7, commit `bb3bdad6` [419].
  - I resolved the Linux normal and build graph (default features): 473 lines. It has no GPL, LGPL or AGPL dependencies.
  - The RGB protocol crates it depends on (`rgb-consensus`, `rgb-ops`, `rgb-invoicing`, `rgb-schemas`, `rgb-aluvm`, `rgb-strict-*`, `rgb-ascii-armor`) are **Apache-2.0** [419][420].
  - Other non-plain licences present:
    - MPL-2.0: `webpki-roots` 0.25.4, via `electrum-client`;
    - `CDLA-Permissive-2.0`: `webpki-roots` 1.x;
    - `MITNFA`: `hex_lit`;
    - `Unicode-3.0`: ICU;
    - `BSL-1.0` alternatives;
    - `ring` (Apache-2.0 AND ISC);
    - `aws-lc-sys` (compound permissive).
- **Flag (verified fact; legal effect unresolved).** `base85` 2.0.0 is pulled in through `rgb-ascii-armor` → `rgb-aluvm` → `rgb-consensus`. crates.io declares it as **`MPL-2.0-no-copyleft-exception`** [421].
  - That SPDX identifier means Exhibit B, "Incompatible With Secondary Licenses", is applied.
  - Under MPL §3.3, Exhibit B **removes** the route that lets MPL code be combined into a GPL- or AGPL-licensed "Larger Work" [422][423].
  - The crate's `LICENSE` contains only the standard MPL template, and `lib.rs` says "released under the Mozilla Public License 2.0". I did not find a per-file Exhibit B notice. The SPDX metadata may therefore overstate the restriction.
  - **Consequence:** if one bridge binary statically links rgb-lib (and so base85) *and* the `AGPL-3.0-only` sidestr crates, this becomes a real compatibility question.
  - **Fixes:** process separation (the review already recommends it for other reasons), or upstream clarification or replacement of base85.
- **tapd, taproot-assets (verified).** MIT. Its direct Go dependencies include lnd and lndclient (MIT) and btcd (ISC) [424]. I did not scan the full Go module graph, so that part is **inferred** permissive.
- **sidestr crates (verified local).** All five are `AGPL-3.0-only`.
  - MIT and Apache-2.0 code may be combined *into* an AGPL work, and the combined binary is then conveyed under the AGPL.
  - AGPL §13 requires that a *modified* version offer Corresponding Source to "all users interacting with it remotely through a computer network" [425].
  - A bridge daemon that links modified sidestr and serves remote users must therefore offer source. This matches the review's AGPL finding [REVIEW:531–547].

## Questions for counsel
1. Is a token that is unbacked, non-redeemable and testnet-anchored, and that DreamLab itself issues only to itself or to invited testers, a "cryptoasset" under FSMA s.417 or MLR reg. 14A? Does inviting external testers change the answer?
2. At what point does backing with real mainnet USD₮ or USDC, even a nominal amount, make DreamLab:
   - a custodian wallet provider under the MLRs now;
   - a person "safeguarding" or "issuing a qualifying stablecoin" from 25 October 2027?
   Should DreamLab file in the 30 September 2026 to 28 February 2027 window as a precaution?
3. Would public README, blog or Nostr material describing the experiment be a financial promotion (s.21 / FPO para 26F)? What wording keeps it outside?
4. Can "USDT", "USD₮", "Tether" or "USDC" appear in contract metadata, tickers or documentation, including nominatively? What is the UK trade-mark position for these word marks? Should written consent be sought from Tether or Circle?
5. Tether's "Prohibited Assets" clause claims automatic assignment of marks, domains and handles "featuring" its IP. Is that enforceable under English law against a UK entity?
6. If EU parties run DreamLab's open-source bridge, does DreamLab bear any MiCA exposure, for example through Art. 48 "seek admission to trading", or through Recital 22 if DreamLab operates any intermediary component?
7. Is the `base85` `MPL-2.0-no-copyleft-exception` declaration effective without per-file Exhibit B notices? Is process separation between rgb-lib and the AGPL sidestr crates a sufficient boundary?
8. For AGPL §13: which "users interacting remotely" does a federation bridge have, and what is an adequate source offer for a containerised deployment?

## Open questions
- I did not check the primary ESMA EMT register (CSV) for USDT's absence. The claim rests on four secondary witnesses [418].
- Whether "USDC" and "USDT" are UK-registered word marks, and who owns them (Tether's terms say the marks are "used by Tether under licence").
- Does a testnet USDT exist from Tether, the way Circle runs a testnet USDC faucet? This decides whether a "testnet-backed" variant is possible for USDT at all.
- The penalty for unregistered MLR cryptoasset business is not stated on the FCA page I read.
- The full tapd Go module licence graph has not been scanned.

---

## Sources

### [400] FCA — Cryptoassets regime information
URL: https://www.fca.org.uk/firms/cryptoassets-information
Retrieved: 2026-09-23
Status: verified
Found via: websearch (direct WebFetch)
<untrusted-source url="https://www.fca.org.uk/firms/cryptoassets-information" retrieved="2026-09-23">
> "25 October 2027" … Opens: "30 September 2026" … Closes: "28 February 2027"
</untrusted-source>

### [401] FCA — Overview of our cryptoassets regime policy statements (updated 30/06/2026)
URL: https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime
Retrieved: 2026-09-23
Status: verified
Found via: websearch (direct WebFetch); perplexity
<untrusted-source url="https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime" retrieved="2026-09-23">
> The full scope of regulated activities under the regime will expand from 25 October 2027.
> passed by Parliament on 4 February 2026
> PS26/10 – Stablecoin Issuance
</untrusted-source>

### [402] Bank of England — BoE and FCA approach to joint regulation of systemic stablecoin issuers (June 2026)
URL: https://www.bankofengland.co.uk/paper/2026/boe-and-fcas-approach-to-joint-regulation-of-systemic-stablecoin-issuers
Retrieved: 2026-09-23
Status: verified (via perplexity page extract)
Found via: perplexity
<untrusted-source url="https://www.bankofengland.co.uk/paper/2026/boe-and-fcas-approach-to-joint-regulation-of-systemic-stablecoin-issuers" retrieved="2026-09-23">
> Overseas-issued stablecoins will be captured through the Admissions and Disclosure Designated Activities Regime (DAR) and as regulated activities for which FCA authorisation is required under the Financial Promotions Order (FPO). If the dealing and arranging of overseas issued stablecoins is carried out by way of business in the UK the new regulated cryptoasset activities will apply. The FCA will not directly regulate overseas issuance.
</untrusted-source>

### [403] FCA Handbook — PERG 18.4 New specified investments (PS26/18, 16 Sep 2026)
URL: https://handbook.fca.org.uk/handbook/perg18/perg18s4
Retrieved: 2026-09-23
Status: verified
Found via: perplexity; websearch (direct WebFetch)
<untrusted-source url="https://handbook.fca.org.uk/handbook/perg18/perg18s4" retrieved="2026-09-23">
> A cryptoasset will be excluded by article 88F(2)(c) of the Regulated Activities Order where, notwithstanding that it may be cryptographically secured and electronically transferable or storable, it is solely a record of value or contractual rights (including rights in another cryptoasset) and does not function in practice as an asset in its own right.
> A qualifying stablecoin … is a qualifying cryptoasset that seeks or purports to maintain a stable value by reference to a single fiat currency and involves the holding of fiat currency and/or other assets (often referred to as 'backing assets') for the purpose of maintaining that stable value.
</untrusted-source>
(WebFetch of the page reported no guidance on testnet or test tokens or tokens of no value.)

### [404] legislation.gov.uk — MLR 2017 reg. 14A
URL: https://www.legislation.gov.uk/uksi/2017/692/regulation/14A
Retrieved: 2026-09-23
Status: verified
Found via: websearch (direct WebFetch)
<untrusted-source url="https://www.legislation.gov.uk/uksi/2017/692/regulation/14A" retrieved="2026-09-23">
> "a cryptographically secured digital representation of value or contractual rights that uses a form of distributed ledger technology and can be transferred, stored or traded electronically"
> "a firm or sole practitioner who by way of business provides services to safeguard, or to safeguard and administer" cryptoassets or private cryptographic keys on behalf of customers
</untrusted-source>

### [405] FCA — Cryptoassets: AML/CTF regime (updated 12/02/2026)
URL: https://www.fca.org.uk/firms/financial-crime/money-laundering-terrorist-financing/cryptoassets-aml-ctf-regime
Retrieved: 2026-09-23
Status: verified
Found via: websearch (direct WebFetch)
<untrusted-source url="https://www.fca.org.uk/firms/financial-crime/money-laundering-terrorist-financing/cryptoassets-aml-ctf-regime" retrieved="2026-09-23">
> "in the course of business carried on by them in the UK."
</untrusted-source>

### [406] Freshfields — Drawing the Line: Navigating the FCA's New Cryptoasset Perimeter Guidance (secondary)
URL: https://www.freshfields.com/en/our-thinking/blogs/risk-and-compliance/drawing-the-line-navigating-the-fcas-new-cryptoasset-perimeter-guidance-102mv4u
Retrieved: 2026-09-23
Status: inferred (secondary summary of the CP26/13 proposal; not re-read at source)
Found via: perplexity
<untrusted-source url="https://www.freshfields.com/en/our-thinking/blogs/risk-and-compliance/drawing-the-line-navigating-the-fcas-new-cryptoasset-perimeter-guidance-102mv4u" retrieved="2026-09-23">
> Factors which indicate that a cryptoasset is solely a record include there being no observable price or pricing mechanism, or there being no expectation among holders of the cryptoasset that it can be used to generate value.
</untrusted-source>

### [407] FCA — Cryptoasset financial promotions and fiat-to-crypto ramp services (updated 06/02/2026)
URL: https://www.fca.org.uk/firms/cryptoasset-financial-promotions-and-fiat-crypto-ramp-services
Retrieved: 2026-09-23
Status: verified
Found via: perplexity; websearch (direct WebFetch)
<untrusted-source url="https://www.fca.org.uk/firms/cryptoasset-financial-promotions-and-fiat-crypto-ramp-services" retrieved="2026-09-23">
> The restriction now applies to financial promotions involving certain cryptoassets if the communication originates: in the UK, or outside the UK but is capable of having an effect in the UK
> Financial promotions do not need to be expressly targeted towards UK consumers to be capable of having an effect in the UK and subject to the financial promotion regime.
> Promotions not made using 1 of these 4 routes will be in breach of section 21 of FSMA, which is a criminal offence punishable by up to 2 years' imprisonment, an unlimited fine, or both.
</untrusted-source>

### [408] HMRC — IEIM8000050 CARF commencement
URL: https://www.gov.uk/hmrc-internal-manuals/international-exchange-of-information/ieim8000050
Retrieved: 2026-09-23
Status: verified
Found via: local (review citation) + websearch (direct WebFetch)
<untrusted-source url="https://www.gov.uk/hmrc-internal-manuals/international-exchange-of-information/ieim8000050" retrieved="2026-09-23">
> The CARF and the domestic reporting of UK tax resident cryptoasset users commences in the UK on 1 January 2026.
> The reports for the first reportable period of 1 January 2026 to 31 December 2026 will be due by 31 May 2027.
</untrusted-source>

### [409] FCA — Regulatory Sandbox; Apply to the Regulatory Sandbox; Stablecoins cohort
URL: https://www.fca.org.uk/firms/innovation/regulatory-sandbox
Retrieved: 2026-09-23
Status: verified (perplexity page extracts of fca.org.uk; also https://www.fca.org.uk/firms/innovation/regulatory-sandbox/apply and …/stablecoins-cohort)
Found via: perplexity
<untrusted-source url="https://www.fca.org.uk/firms/innovation/regulatory-sandbox" retrieved="2026-09-23">
> The Regulatory Sandbox is not regulatory exempt. This means that if you will be carrying out a regulated activity you will need to be appropriately authorised or registered first.
> We're not currently accepting new cryptoasset-related applications for FCA Innovation Services support. The only exception is for firms that are registered with the FCA under the … MLRs as prospective UK stablecoin issuers, and wish to be permitted as a settlement asset in the Digital Securities Sandbox (DSS).
</untrusted-source>

### [410] Tether — Terms of Service (Last updated: February 26, 2026)
URL: https://tether.to/en/legal
Retrieved: 2026-09-23
Status: verified (full page downloaded and grepped)
Found via: websearch (direct fetch)
<untrusted-source url="https://tether.to/en/legal" retrieved="2026-09-23">
> Risk of Wrapped or Bridged Tokens: It is also possible that a third-party could create a Digital Token which claims to be an alternative version of Tether Tokens, such as by "wrapping" or "bridging" Tether Tokens. These Digital Tokens are not Tether Tokens. They are not sold or issued through the Site or supported by Tether, they cannot be redeemed with Tether or otherwise used with the Site and Tether assumes no liability or responsibility whatsoever for any Losses or other issues that might arise from use of such Digital Tokens.
> In order to cause Tether Tokens to be issued or redeemed by Tether, you must be a verified customer of Tether.
> in the event of a fork only the Digital Tokens on the particular blockchain or protocol that Tether or its Affiliate announces on the Site as being supported by Tether or such Affiliate are Tether Tokens.
> You agree not to appropriate, copy, display, reverse engineer, or use the Marks or other content without express, prior, written permission from Tether or the owner of the Marks, including as a domain name, as social media profile/handle, on a website, in an advertisement or other marketing, as or in connection with a phone number, as or in connection with an email address, in internet search results, in meta data or code, or in any other manner.
> Such sanction may include … freezing or confiscation of any Fiat, funds, property, proceeds, Tether Tokens or any Digital Tokens in any Tether Tokens Wallet or other User Wallet; blacklisting any Digital Tokens Address which holds Tether Tokens
> If Tether becomes aware that you own or control any Prohibited Assets, the Prohibited Asset(s) will be automatically transferred and assigned to Tether, its nominated Associate or its licensor(s)
</untrusted-source>

### [411] Circle — USDC Terms (Last Updated: December 12, 2025)
URL: https://www.circle.com/legal/usdc-terms
Retrieved: 2026-09-23
Status: verified (full page downloaded and grepped)
Found via: websearch (direct fetch)
<untrusted-source url="https://www.circle.com/legal/usdc-terms" retrieved="2026-09-23">
> §8: it is possible that a party unaffiliated with Circle could create an alternative, equivalent version of USDC either on one of the USDC Supported Blockchains or on an unsupported blockchain (a "copy") that operate independently from USDC. Similarly, it is possible that a party unaffiliated with Circle may create an asset and purport that such asset is collateralized by or otherwise incorporates USDC into its design (a "wrapper"). Circle supports only USDC and is under no obligation to support any copies of USDC or wrappers and assumes no responsibility for any value that might be lost as a result of this lack of support of copies of USDC.
> §12: "Circle.com", "Circle", and all logos related to the USDC Services are either trademarks, or registered marks of Circle or its licensors. Whether or not you have a Circle Mint account, you may not copy, imitate, or use them without Circle's prior written consent.
> §13: Circle reserves the right to "block" certain USDC addresses and, if such addresses are Circle custodied addresses, freeze associated USDC (temporarily or permanently) … you may forfeit any rights associated with your USDC, including the ability to redeem USDC for USD.
> §2: sending USDC to another address automatically transfers and assigns to the owner of that address (a "Holder"), and any subsequent Holder, the right to redeem USDC for USD funds so long as the Holder is eligible to, and does, register a Circle Mint account.
</untrusted-source>

### [412] Circle Docs — USDC contract addresses
URL: https://developers.circle.com/stablecoins/usdc-contract-addresses
Retrieved: 2026-09-23
Status: verified
Found via: perplexity; websearch (direct WebFetch)
<untrusted-source url="https://developers.circle.com/stablecoins/usdc-contract-addresses" retrieved="2026-09-23">
> Testnet tokens have no financial value. Because the testnets listed below are used only for testing, the USDC tokens in circulation on these networks have no financial value, and are not backed by real US dollars.
> X Layer also has a separate bridged USDC representation, labeled `USDC.e`, which is not issued or backed by Circle.
</untrusted-source>

### [413] Circle — Third-Party Bridged USDC Terms (Last Updated: December 12, 2025)
URL: https://www.circle.com/legal/bridged-usdc-terms
Retrieved: 2026-09-23
Status: verified
Found via: local (link from [411]) + direct fetch
<untrusted-source url="https://www.circle.com/legal/bridged-usdc-terms" retrieved="2026-09-23">
> Bridged USDC is not USDC
> While Circle participated in the creation of USDC and is an issuer of USDC, Circle does not issue or redeem Bridged USDC. Bridged USDC is not backed by US dollars or any of Circle's USDC-related reserves.
</untrusted-source>

### [414] Circle — Bridged USDC Standard
URL: https://www.circle.com/bridged-usdc
Retrieved: 2026-09-23
Status: verified
Found via: local (link from [411]) + direct fetch
<untrusted-source url="https://www.circle.com/bridged-usdc" retrieved="2026-09-23">
> Circle's specification and process for deploying bridged USDC on EVM blockchains enables optionality for a future upgrade to native issuance.
> No. Bridged USDC Standard grants Circle the option, but not the obligation, to obtain ownership of the token contract and upgrade to native USDC.
</untrusted-source>

### [415] EUR-Lex — Regulation (EU) 2023/1114 (MiCA), Recital 22 and Art. 48
URL: https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng
Retrieved: 2026-09-23
Status: verified (via perplexity extract of the eur-lex page; direct scrape returned empty)
Found via: perplexity
<untrusted-source url="https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng" retrieved="2026-09-23">
> Where crypto-asset services are provided in a fully decentralised manner without any intermediary, they should not fall within the scope of this Regulation.
> 1. A person shall not make an offer to the public or seek the admission to trading of an e-money token, within the Union, unless that person is the issuer of such e-money token and: (a) is authorised as a credit institution or as an electronic money institution; and (b) has notified a crypto-asset white paper to the competent authority and has published that crypto-asset white paper in accordance with Article 51. Notwithstanding the first subparagraph, upon the written consent of the issuer, other persons may offer to the public or seek the admission to trading of the e-money token.
</untrusted-source>

### [416] Circle — Written Consent to offer to the public/seek admission to trading for EURC/USDC under MiCA (Last Updated: January 23, 2025)
URL: https://www.circle.com/legal/obtaining-written-consent-under-mica
Retrieved: 2026-09-23
Status: verified
Found via: local (link from [413]) + direct fetch
<untrusted-source url="https://www.circle.com/legal/obtaining-written-consent-under-mica" retrieved="2026-09-23">
> Since both EURC and USDC are issued as EMTs by Circle France in the EEA, any legal person needs Circle France's written consent before it can offer EURC and/or USDC to the public or seek their admission to trading.
</untrusted-source>

### [417] ESMA — Public Statement on the provision of certain crypto-asset services in relation to non-MiCA compliant ARTs and EMTs (ESMA75-223375936-6099, 17/01/2025)
URL: https://www.esma.europa.eu/sites/default/files/2025-01/ESMA75-223375936-6099_Statement_on_stablecoins.pdf
Retrieved: 2026-09-23
Status: verified (via perplexity extract of the ESMA PDF)
Found via: perplexity
<untrusted-source url="https://www.esma.europa.eu/sites/default/files/2025-01/ESMA75-223375936-6099_Statement_on_stablecoins.pdf" retrieved="2026-09-23">
> NCAs should ensure compliance by CASPs regarding non-compliant ARTs or EMTs as soon as possible and no later than the end of Q1 2025.
> For instance, while mere custody and transfer of these crypto-assets should remain possible, EU investors should be clearly informed of the restrictions attached to the provision of crypto-asset services involving non-MiCA compliant ARTs and EMTs
</untrusted-source>

### [418] Secondary witnesses — USDT not MiCA-authorised; EU delistings; transitional end 1 July 2026
URL: https://www.scorechain.com/blog/eu-stablecoin-regulation-mica (also https://stablemint.io/blog/usdt-after-mica-eu-settlement/ ; https://www.ledger.com/academy/topics/economics-and-regulation/mica-regulation-explained ; https://www.eupersonalfinance.eu/articles/usdt-banned-in-europe-what-happened-under-mica)
Retrieved: 2026-09-23
Status: inferred (secondary; the primary ESMA register was not checked)
Found via: perplexity
<untrusted-source url="https://www.scorechain.com/blog/eu-stablecoin-regulation-mica" retrieved="2026-09-23">
> Tether's USDT is the largest stablecoin globally by market capitalization, but it has not pursued MiCA authorization.
> Circle's USDC is authorized as an e-money token under MiCA, issued through Circle's EU-authorized entity (Circle SAS, France).
</untrusted-source>

### [419] rgb-lib — Cargo.toml and resolved dependency licences (commit bb3bdad6, 2026-09-18)
URL: https://github.com/RGB-Tools/rgb-lib
Retrieved: 2026-09-23
Status: verified (`gh api` licence = MIT; `cargo tree -e normal,build --target x86_64-unknown-linux-gnu -f '{p}|{l}' --locked`)
Found via: local
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/master/Cargo.toml" retrieved="2026-09-23">
> name = "rgb-lib"
> version = "0.3.0-beta.7"
> license = "MIT"
</untrusted-source>

### [420] rgb-protocol/rgb-consensus — repository licence
URL: https://github.com/rgb-protocol/rgb-consensus
Retrieved: 2026-09-23
Status: verified (`gh api` → Apache-2.0; per-crate Apache-2.0 confirmed in the cargo tree)
Found via: local
<untrusted-source url="https://github.com/rgb-protocol/rgb-consensus" retrieved="2026-09-23">
> license: Apache-2.0
</untrusted-source>

### [421] crates.io — base85 2.0.0 licence metadata; crate source
URL: https://crates.io/api/v1/crates/base85
Retrieved: 2026-09-23
Status: verified (metadata); legal effect unresolved
Found via: local
<untrusted-source url="https://crates.io/api/v1/crates/base85" retrieved="2026-09-23">
> ('2.0.0', 'MPL-2.0-no-copyleft-exception')
> //! A library for Base85 encoding as described in RFC1924 and released under the Mozilla Public License 2.0.
</untrusted-source>

### [422] Mozilla Public License 2.0 — §3.3 and Exhibit B
URL: https://www.mozilla.org/en-US/MPL/2.0/
Retrieved: 2026-09-23
Status: verified
Found via: local (direct fetch)
<untrusted-source url="https://www.mozilla.org/en-US/MPL/2.0/" retrieved="2026-09-23">
> If the Larger Work is a combination of Covered Software with a work governed by one or more Secondary Licenses, and the Covered Software is not Incompatible With Secondary Licenses, this License permits You to additionally distribute such Covered Software under the terms of such Secondary License(s)
> Exhibit B - "Incompatible With Secondary Licenses" Notice
</untrusted-source>

### [423] FSF — Various Licenses and Comments about Them (MPL-2.0 entry)
URL: https://www.gnu.org/licenses/license-list.html
Retrieved: 2026-09-23
Status: verified
Found via: local (direct fetch)
<untrusted-source url="https://www.gnu.org/licenses/license-list.html#MPL-2.0" retrieved="2026-09-23">
> Section 3.3 provides indirect compatibility between this license and the GNU GPL version 2.0, the GNU LGPL version 2.1, the GNU AGPL version 3, and all later versions of those licenses.
</untrusted-source>

### [424] lightninglabs/taproot-assets — LICENSE and go.mod
URL: https://github.com/lightninglabs/taproot-assets
Retrieved: 2026-09-23
Status: verified (MIT; lnd MIT, lndclient MIT, btcd ISC via `gh api`); full Go graph inferred
Found via: local
<untrusted-source url="https://github.com/lightninglabs/taproot-assets/blob/main/LICENSE" retrieved="2026-09-23">
> MIT License
> Copyright (c) 2022 Lightning Labs
</untrusted-source>

### [425] GNU AGPL v3 — §13
URL: https://www.gnu.org/licenses/agpl-3.0.txt
Retrieved: 2026-09-23
Status: verified
Found via: local (direct fetch)
<untrusted-source url="https://www.gnu.org/licenses/agpl-3.0.txt" retrieved="2026-09-23">
> Notwithstanding any other provision of this License, if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network (if your version supports such interaction) an opportunity to receive the Corresponding Source of your version by providing access to the Corresponding Source
</untrusted-source>

### [426] Local — agentbox adversarial review, §5 Regulatory and licensing
URL: file:///home/devuser/workspace/project/agentbox/docs/proposals/sovereign-settlement-research/REVIEW-adversarial-gpt6-astra.md (lines 494–551)
Retrieved: 2026-09-23
Status: verified (read; dates re-checked against [400][401][408])
Found via: local
<untrusted-source url="file:///home/devuser/workspace/project/agentbox/docs/proposals/sovereign-settlement-research/REVIEW-adversarial-gpt6-astra.md" retrieved="2026-09-23">
> As of this review date, the FCA describes the broader regime as commencing on **25 October 2027**, with an application period beginning **30 September 2026**.
> **rgb-lib should not be assigned a fictional AGPL problem.** The current upstream repository identifies rgb-lib as MIT-licensed.
</untrusted-source>

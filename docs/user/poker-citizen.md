# Running the poker house seat

`[poker_citizen]` runs `nostr-bbs-poker-citizen` (forum ADR-2020), the house seat of the forum poker table. It deals
hands over the forum relay and settles each one with a transfer on its sidestr chain. This page covers what an
operator does when a payout debt halts. Its keys are documented in `schema/agentbox.toml.schema.json` and the comments on `[poker_citizen]` in
`agentbox.toml`; the runner is `config/poker/run-citizen.sh`.

## Where the seat's state and logs are

| What | Where |
|---|---|
| Program | `poker-citizen` (DREAM), `poker-citizen-<name>` for a further chain |
| Logs | `/var/log/poker-citizen.error.log` (stderr: alerts, `HALTED debt …`, payout lines) |
| State file | `[poker_citizen].state`, or the default `run-citizen.sh` picks (workspace `sidestr/agents/poker-citizen.json`; the custody ledger under `[security].role_isolation`). It is mode 0600: it holds live hands' secrets |

## Halted payout debts

When the house loses a hand it owes the member a transfer with the memo `hand:<root>`. The house signs that payout
once, saves it, and resends the same bytes until the chain shows it. If the chain shows the payout rejected by the
asset rules twice, or the payout has been replaced too often, the debt is **halted**: the house signs no further
payout for it.

A halted debt:

- stays owed. The member has not been paid and the hand is not settled;
- **holds back its amount** from new buy-ins: the house counts it against its balance and its daily cap when it
  decides whether it can cover another hand;
- is not retried and is not cleared by a restart. There is **no unhalt command**.

### Clear it

1. Read the halted debts. At startup the seat prints `HALTED debt for hand <root prefix>…: <why>` to stderr, and the
   state file lists them: each entry of `owing` with a non-null `halted` has the full `root`, the member's `hero`
   pubkey and the `amount`.
2. Pay the member yourself, on-chain, from a wallet that holds the asset: send at least `amount` units of the seat's
   asset to the member (`hero`) on the seat's chain with the memo `hand:<root>` (the full 64-hex root).
3. Wait for the producer to include it. The seat re-reads the chain every poll, sees the `hand:<root>` payment, and
   `payments_seen` clears the debt and releases the held-back amount. Nothing else is needed, and the seat does not
   need a restart.

Do not edit the state file by hand while the seat runs, and do not pay twice: the chain payment is what clears the
debt, so a second transfer is simply lost.

## Alerts

The seat raises an alert for a halted debt, and every fifth time the producer refuses a payout. Each alert goes to:

1. **stderr**, always (`ALERT: …` in `/var/log/poker-citizen.error.log`);
2. **a gift-wrapped NIP-17 DM** to the operator key, when `alert_pubkey` is set.

```toml
[poker_citizen]
alert_pubkey = "npub1…"      # or 64 hex; unset or empty ⇒ stderr only
```

`alert_pubkey` reaches the seat as `POKER_CITIZEN_ALERT_PUBKEY` (set per seat in `[poker_citizen.<name>]` too). The DM
is sent from the house key over the forum relay, and **the relay decides whether it arrives**: the forum relay admits
a gift wrap only when its recipient is whitelisted (or is a registered inbox key of a member). Use the operator's own
forum account, or a key the relay admits as a recipient. A wrap the relay refuses appears as `relay refused …` in
stderr only, and that alert is not retried for the rest of its window. To read the DM, the operator's NIP-17 client
must read from the forum relay (list it as a DM relay, kind 10050).

Each debt and cause is sent once per six hours, at most twenty alerts per window go out, and one summary DM is sent at
startup if any debt is halted. A suppressed alert still reaches stderr. The alert option needs a seat binary built
from a forum pin later than `8a0ca41`; an older binary ignores the variable. The change is REBUILD-class like the rest
of `[poker_citizen]`.

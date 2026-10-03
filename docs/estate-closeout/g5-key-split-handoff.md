# G-5 key split: owner handoff

Date: 2026-10-03 · Branch: `custody/w8-key-split` (not merged) · TODO row G-5 · Design: custody design §11

## What this is about

One Nostr key, `11ed6422…663c`, does several jobs. It is the container's identity, the forum
house admin, the identity VisionClaw signs governance requests with, and the identity the
browser sidecar logs in as. Its private half sits in three places: agentbox `.env`, VisionClaw
`.env` and the browsercontainer Podkey vault. Anyone who gets any one of those copies can do
every one of those jobs. The split keeps `11ed6422…` as the container identity and gives each
other job its own key, so that the two copies outside agentbox can be deleted.

## Done on this branch (no behaviour changes)

1. **Q15 is answered: VisionClaw signs with the house key `11ed6422…663c`.** Evidence, read
   without opening any `.env`:
   - VisionClaw takes its governance signer from `ACSP_PANEL_NOSTR_PRIVKEY`, falling back to
     `VISIONCLAW_NOSTR_PRIVKEY` (`src/actors/elevation_actor.rs:199-200`,
     `decision_elevation_actor.rs:183-184`, `app_state.rs:1362-1363`).
   - The dreamlab relay holds 21 events of kinds 31400-31403. The VisionClaw-shaped 31402s
     carry the `priority`/`category`/`subject-kind` tags that `src/services/acsp/events.rs`
     writes, and they are signed by `11ed6422…663c`. The latest is dated 2026-08-11.
   - `b4165401…2f7a` signs only 31403 *decisions*, as the responder. It is your operator
     NIP-07 key (`[sovereign_mesh.operator]`). The `agentbox.toml` comments that called it the
     "visionclaw-server governance publisher" were wrong and are corrected.
   - The rest of the governance traffic is JunkieJarvis (`2de44d56…16e9`), which is not part
     of G-5.

   So VisionClaw needs a key of its own (K_broker).
2. **The phone mirror key is pinned.** `services/nostr-pod-bridge/src/mirror_key.rs` contains
   the Rust version of the derivation in `nostr-live-mirror.cjs:200-221`. Seven known-answer tests
   prove that it gives byte-for-byte the same result. The phone key does not change. One trap is
   now caught by a test: the derivation must use the hex exactly as `.env` holds it, not the
   even-y-normalised copy the identity file stores. For roughly half of all keys those two differ.
3. **Zone migrator: already unused, nothing to delete.** In the forum repo,
   `nostr-bbs-zone-migrate` reads its key from the environment each time it runs. It holds no
   key and runs no service, and nothing in agentbox calls it. To retire it, withdraw
   `11ed6422…`'s admin role at the forum (step E below). Keep the tool: re-sealing history (Q16)
   would need it.

## Held: decisions before any key is minted

Nothing has been minted. D2 is decided; D1 is waiting on you; D3 is open.

- **D1. Where are the backups encrypted to?** The repo records no operator age recipient
  (`age1…`). Without one, the age backup can only be keyed by something that also lives in the
  container, and that protects nothing. Please supply a public `age1…` recipient. Its private
  identity stays with you. To make the restore test meaningful, it will also use a second
  throw-away recipient that is destroyed after the check.
- **D2. Decided (lead, 2026-10-03): you create the forum admin key (K_admin) yourself, in your
  NIP-07 browser extension.** The design (§11.2, Q17) takes precedence over the earlier brief.
  K_admin is never minted in, copied into or backed up from any container. Only its public key
  comes back, so it can be added to the forum admin list.
- **D3. Where do K_broker and K_browser start out?** `sudo` is blocked in this container, so a
  key minted here would be a devuser-owned 0600 file. Every agent process runs as devuser and
  could read it until you move it. The alternative is to mint each one in its holder (the
  VisionClaw environment, the Podkey vault), using the same `nostr-bbs-core` path.

## The new keys

| Key | Job | Created by, where | Public key |
|---|---|---|---|
| K_admin | forum house admin (replaces `11ed6422…` there) | you, in your NIP-07 extension (D2) | not yet created: you send it after creating the key |
| K_broker | VisionClaw governance signer (31400/31402) | agent, after D1 and D3 | not yet minted |
| K_browser | browser sidecar login (Podkey vault) | agent, after D1 and D3 | not yet minted |

## What remains, in order (no flag day)

| Step | Who | What |
|---|---|---|
| A | you; agent after D1 and D3 | You create K_admin in your extension and send its **public** key only. The agent mints K_broker and K_browser, backs them up with `agentbox-secret-backup` to your age recipient, and test-restores them. |
| B | agent | Add the new pubkeys *beside* `11ed6422…`, each with a test. The agentbox verifiers are K_browser → `[interaction_plane.proxy].allowed_pubkeys` (`agentbox.toml`, boot-class, no rebuild) and K_broker → `[sovereign_mesh.relay].allowed_pubkeys` (baked by `flake.nix:1619-1621`), if VisionClaw also publishes to the embedded relay. K_broker's main verifier and the forum admin list are in the forum deploy, not in this repo. |
| C | **you: rebuild 1** | `./scripts/launch.sh rebuild dev` from tab 6. This bakes the new relay allowlist. Afterwards both old and new keys must be admitted. |
| D | you | Switch the signers one at a time: put K_broker in VisionClaw's `.env` as `ACSP_PANEL_NOSTR_PRIVKEY`, put K_browser in the Podkey vault, and put K_admin in the forum admin config. Check from the relay that the new key's events are accepted. |
| E | agent, then **you: rebuild 2** | Withdraw `11ed6422…` from forum admin, VisionClaw governance and the browser login. The relay keeps it, because it stays the container identity. Then confirm the old key is *refused* for each withdrawn job, including after a restart. |
| F | **you** | Delete the two outside copies: the house key in **VisionClaw `.env`**, and in the **browsercontainer Podkey vault**. The private half then exists only in agentbox `.env`, its runtime copy and the age backup. |

## The part that cannot be undone

`11ed6422…` was the forum house admin and still holds the zone2/zone3 **epoch-1 zone secrets**.
Whoever holds that key can read the **sealed forum history** in zones 2-4, and taking the key
off the admin list does not change that. Moving to new epochs under K_admin protects only posts
written after the change. The only fix for the old posts is to re-seal them under new zone keys.
That is Q16, together with the plaintext pre-purge forum backups on `/mnt/dell`. Until Q16 is
decided, treat agentbox `.env` as able to read every sealed forum post written so far.

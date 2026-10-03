# G-5 key split: owner handoff

Date: 2026-10-03 · Branch: `custody/w8-key-split` (not merged) · TODO row G-5 · Design: custody design §11

## What this is about

One Nostr key, `11ed6422…663c`, does several jobs: it is the container's identity, the forum
house admin, the identity VisionClaw signs with, and (by its label) the browser sidecar's login.
Its private half is in agentbox `.env`, in VisionClaw `.env`, and reportedly in the browser
sidecar. Whoever has any one copy can do every one of those jobs. The split keeps `11ed6422…`
as the container identity only. Each other job gets its own new key, created where it will be
used, and then the outside copies of the house key are deleted.

## Already done on this branch (nothing changes behaviour)

1. **Q15: VisionClaw signs with the house key `11ed6422…663c`.** VisionClaw sets only
   `VISIONCLAW_NOSTR_PRIVKEY`; `ACSP_PANEL_NOSTR_PRIVKEY` is unset (variable names checked,
   never values). That one variable feeds three signers: governance (via the fallback in
   `elevation_actor.rs:199-200`, `decision_elevation_actor.rs:183-184`, `app_state.rs:1362-1363`),
   the NostrBridge (`nostr_bridge.rs:37`) and the bead publisher (`nostr_bead_publisher.rs:40`).
   On the dreamlab relay, VisionClaw's 31402s are signed by `11ed6422…`. `b4165401…2f7a` signs
   only 31403 decisions: it is your NIP-07 operator key, and the `agentbox.toml` comments are
   corrected to say so.
2. **The phone mirror key is pinned** by seven known-answer tests
   (`services/nostr-pod-bridge/tests/mirror_key.rs`). The phone key does not change.
3. **The zone migrator is already unused.** `nostr-bbs-zone-migrate` (forum repo) takes its key
   per run and holds none. Retiring it means withdrawing `11ed6422…` as forum admin (step 6).
   Keep the tool, because re-sealing history (Q16) would need it.
4. **Verifier tests are ready for your public keys.** `config/custody/g5-key-split.json` is the
   one place the new **public** keys go. `tests/sovereign/g5-key-split.node-test.js` then checks
   each one in four ways: it is a real key; it is new; it is in the agentbox allowlist next to
   the house key; and the running login proxy lets it in and turns a stranger away. Until you
   supply a key its two checks are skipped, and a made-up key exercises the same path.

## Decisions (2026-10-03)

- **D1, waiting for you:** your age recipient (`age1…`).
- **D2:** you create K_admin yourself in your NIP-07 extension. No container ever holds it.
- **D3:** each key is created where it will live, never in agentbox. This repo only ever sees
  public keys.

Because of D3, the agent never sees K_broker or K_browser, so it cannot run the backup on them.
**You back them up**, with the age recipient from D1, at the moment you create them. You hold
the age identity, so you are also the one who can test the restore. The steps are below.

## The new keys

| Key | Job | Created by, where | Public key |
|---|---|---|---|
| K_admin | forum house admin | you, in your NIP-07 extension | not yet created |
| K_broker | VisionClaw signer (governance, NostrBridge, beads) | you, inside `visionclaw_container`, from tab 6 | not yet created |
| K_browser | browser sidecar login at the :8444 proxy | you, in a NIP-07 signer inside browsercontainer | not yet created |

## Creating K_broker inside VisionClaw (tab 6, VisionClaw checkout on the host)

VisionClaw has no key-minting command of its own, and its docs suggest `openssl rand -hex 32`.
Use the library generator that ships in VisionClaw's own container instead (`nostr-tools`, built
on `@noble/curves`). The secret goes straight into a 0600 file and is never shown on screen.

```sh
umask 077
docker exec visionclaw_container node -e '
  const t = require("/app/client/node_modules/nostr-tools");
  const sk = t.generateSecretKey();
  process.stderr.write("K_broker pubkey: " + t.getPublicKey(sk) + "\n");
  process.stdout.write(Buffer.from(sk).toString("hex"));' > k_broker.hex
age -r age1…YOUR-RECIPIENT -o k_broker.hex.age k_broker.hex      # backup (D1)
age -d -i YOUR-IDENTITY k_broker.hex.age | cmp - k_broker.hex && echo restore-ok
```

Send the printed **pubkey** only. Hold off on the `.env` swap until step 4 below.

## Creating K_browser, and the "Podkey vault" copy

- **What is actually in the sidecar today (seen 2026-10-03; vault contents not read):**
  browsercontainer's only browser profile is `/tmp/chrome-profile`. It is not on a volume, so it
  is wiped whenever the container is recreated. It has three extensions: Google Docs Offline,
  Chrome Web Store Payments and **Proton Pass**. There is no Podkey extension. The
  `agentbox.toml` label "browsercontainer Podkey vault" is the only record of a house-key copy
  there.
- **Please confirm where the house key really is.** It may be a Podkey install elsewhere, or an
  entry in a **Proton Pass vault**. If it is in Proton Pass, that copy is also synced to
  Proton's cloud and to every device signed into that account. Deleting it is then a Proton
  account action, not a container clean-up.
- **To create K_browser:**
  1. Install a NIP-07 signer in the sidecar's Chromium. Podkey is the estate's choice.
  2. Create a new key in that signer (do not import one).
  3. Back the key up with `age` as for K_broker, if the signer lets you export it. A
     passkey-derived Podkey key can be re-derived from its passkey instead.
  4. Send the pubkey.
- **Keep the profile.** Because it lives in `/tmp`, a recreate loses the signer and its key.
  Either put `/tmp/chrome-profile` on a named volume before you create K_browser, or accept
  creating a new key (and a new allowlist change) after every recreate.

## What remains, in order (no flag day)

| Step | Who | What |
|---|---|---|
| 1 | you | Create K_admin, K_broker and K_browser as above, back up the two that can be exported, and send the three **public** keys. |
| 2 | agent | Add each pubkey to `config/custody/g5-key-split.json`. Put K_browser in `[interaction_plane.proxy].allowed_pubkeys` next to `11ed6422…`. The tests must then pass with no skips. K_broker and K_admin have no verifier in agentbox: theirs are the forum relay whitelist and the forum admin config, in the forum deploy. |
| 3 | **you: forum deploy, then agentbox restart** | Add K_broker to the forum relay whitelist and K_admin to the forum admins (forum deploy). The proxy allowlist is applied at boot, so agentbox needs a restart rather than an image rebuild. Both old and new keys must then be accepted. |
| 4 | you | Switch one signer at a time. **VisionClaw:** `awk -v f=k_broker.hex 'BEGIN{getline k < f} /^VISIONCLAW_NOSTR_PRIVKEY=/{print "VISIONCLAW_NOSTR_PRIVKEY=" k; next} {print}' .env > .env.new && chmod --reference=.env .env.new && mv .env.new .env && shred -u k_broker.hex`. awk reads the secret from the file, so it never appears in a command line or in `ps`. Check that `grep -c '^VISIONCLAW_NOSTR_PRIVKEY=' .env` prints 1, then recreate VisionClaw. This one edit also removes VisionClaw's copy of the house key. No rollback copy is needed, because the house key stays in agentbox `.env`. **Sidecar:** log in with K_browser. **Forum:** act as admin with K_admin. Then check the relay: new 31402s must be signed by K_broker and accepted. |
| 5 | agent, then **you: forum deploy and agentbox restart** | Add the withdrawn roles to `house_key_withdrawn_from`, and remove `11ed6422…` from the proxy allowlist and from the forum admins. The tests then require the old key to be **refused**. The relay keeps `11ed6422…`, because it stays the container identity. |
| 6 | **you** | Delete the remaining outside copy: the sidecar's (Podkey or Proton Pass, as you confirmed above). VisionClaw's copy already went in step 4. The private half then exists only in agentbox `.env`, its runtime copy and its existing backups. |

VisionClaw's NostrBridge and bead publisher will sign as K_broker after step 4. Anything that
checks bead provenance against `11ed6422…` needs K_broker added too. No such checker exists in
agentbox.

## The part that cannot be undone

`11ed6422…` was the forum house admin and still holds the zone2/zone3 **epoch-1 zone secrets**.
Whoever holds that key can read the **sealed forum history** in zones 2-4, and taking it off the
admin list does not change that. New epochs under K_admin protect only posts written after the
change. The only fix for old posts is to re-seal them under new zone keys. That is Q16, together
with the plaintext pre-purge forum backups on `/mnt/dell`. Until Q16 is decided, treat agentbox
`.env` as able to read every sealed forum post written so far.

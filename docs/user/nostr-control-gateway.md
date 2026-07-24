# Nostr control gateway — drive the tmux fleet from your phone

The [live Nostr session mirror](nostr-relay.md) streams each Claude turn **out** to
your phone as gift-wrapped DMs. The **control gateway** is the inbound half: it
lets you send **commands back in** from Amethyst (or any Nostr client) and have
them executed against the agentbox tmux fleet, with replies DM'd to your phone.

Prefix everything with `/`, then just talk. `/tabs` lists the running agents.
`/report` gives a one-line Sonnet summary of what every Claude tab is doing.
`/run the tests on the website tab` — no tab number needed — is **routed by a
Sonnet command-and-control agent** that reads the fleet, picks the right tab, and
types it in immediately; it only asks you a question if it genuinely can't tell.

## How it works

```
 Amethyst (you, signing as the operator key)
   │  /run the tests on the website   ← a DM in your mirror thread
   ▼
 dreamlab cloud relay (NIP-42 AUTH-gated)
   │  kind-1059 gift wrap, #p = operator
   ▼
 ┌─ nostr-gateway daemon (supervised) ─────────────────────────────┐
 │  AUTHs as operator · unwraps · authorises                       │
 │   • reads  (/tabs, /peek)        → capture-pane   ZERO tokens    │
 │   • /report                      → one Sonnet call (read-only)   │
 │   • free-form instruction        → Sonnet C2 routes to a tab,    │
 │                                    sends it, or asks if unsure   │
 │   • /tab <n>, /say               → send immediately (no confirm) │
 │  replies via gift wrap → your phone (echoes what it sent where)  │
 └─────────────────────────────────────────────────────────────────┘
```

The gateway is a Node daemon (`config/nostr-gateway/gateway.cjs`) that reuses the
mirror's key derivation and the vendored `nostr-tools`. It runs as the supervised
`[program:nostr-gateway]` and is also self-healed by the `SessionStart` hook.
Reporting and instruction-routing each spend one bounded headless **Sonnet** call
(Sonnet minimum — Haiku misreads noisy pane scrollback); `/tabs` and `/peek` are
zero-token.

## Setup

Nothing to add on your phone. You already read the mirror thread with the
operator key (loaded from the toml); the gateway uses the **same** identity, so
commands are a **self-DM** in that same thread. No new contact, no new key.

Add the relay as a **DM / private-messaging relay** in Amethyst (the NIP-17
`kind:10050` list) so it fetches gift wraps — the same relay the mirror uses:
`wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev`.

## Commands

Everything is prefixed with `/`. Reads never touch a tab; instructions are routed
by the C2 agent and execute immediately.

**Ask** — read-only, never disturbs a running agent:

| Command | Effect | Cost |
|---------|--------|------|
| `/tabs` | list the fleet with live state (● busy · ⏸ waiting · ○ idle) | none |
| `/report` | one-line Sonnet summary of each Claude tab | one Sonnet call |
| `/report <n>` | deep read-only report on tab _n_ | one Sonnet call |
| `/report <question>` | answer a question from the panes | one Sonnet call |
| `/peek <n> [k]` | raw last _k_ lines of tab _n_ (default 20) | none |
| `/help` | list commands | none |

**Instruct** — the C2 agent routes it and sends it, echoing what it did:

| Command | Effect | Cost |
|---------|--------|------|
| `/<instruction>` | free-form — the Sonnet C2 agent picks the tab and sends it, asking only if unsure | one Sonnet call |
| `/tab <n> <text>` | force a specific tab (skips routing) | none |
| `/say <text>` | broadcast to every Claude tab | none |

There is **no `/confirm` gate**. An instruction runs immediately and the reply
echoes exactly what was typed into which tab, with that tab's pre-send state, so
you course-correct with a follow-up rather than pre-approving every line. The
router will **not** blind-send into a tab that is ⏸ waiting on a permission dialog
— it asks first, because typed text there would answer the dialog.

## Security

Every inbound wrap must pass, in order:

1. **Relay AUTH (NIP-42)** as the operator key — the relay only serves kind-1059
   to a reader AUTH'd as the recipient.
2. **Authorised sender** — the sealed sender must be the **operator** pubkey. Any
   other sender (e.g. website signup DMs, which are also operator-addressed) is
   dropped. This is the RCE gate: a command types into a live Claude tab, so only
   your own key may issue one.
3. **Sigil** — only messages starting with `/` are commands. This is also what
   stops the daemon ingesting its **own** replies (they never start with `/`).
4. **Replay guard** — see the timestamp note below.

Instead of a pre-execution `/confirm`, writes are guarded by **transparency-after
and reversibility**: every send echoes the exact text and target tab, and the C2
router refuses to blind-send into a tab mid-permission-dialog (it asks first).

The daemon fails open: any missing precondition (no operator key, deps absent)
exits 0, so it is never a hard dependency of the box. Off switch:
`AGENTBOX_NOSTR_GATEWAY=0`.

## The gift-wrap timestamp gotcha (important)

NIP-59 **randomizes the gift-wrap `created_at` up to ~2 days into the past** for
metadata privacy. A subscription with a tight `since` window silently drops every
wrap — the relay filters both the stored query and live push by `since`. The
gateway therefore subscribes with `since = now − 50h` and gates replay a different
way: gift-wrap timestamps are unreliable, so it **executes only commands that
arrive after the first `EOSE`** (genuinely new), marking the initial history batch
seen-but-skipped. A restart never replays two days of commands.

If you extend or fork this, do **not** re-introduce a short `since` window or a
`created_at`-based freshness check — that is the single most common way to make
gift-wrap delivery mysteriously stop working.

## Configuration

| Env | Default | Meaning |
|-----|---------|---------|
| `AGENTBOX_NOSTR_GATEWAY` | `1` | `0` disables the daemon entirely |
| `AGENTBOX_GATEWAY_IDENTITY` | `operator` | `operator` = self-DM (recommended); `gateway` = a dedicated whitelisted bot key you DM as a contact |
| `AGENTBOX_GATEWAY_KEY_TAG` | `agentbox-gateway-v1` | HMAC tag for the derived key in `gateway` mode |
| `AGENTBOX_GATEWAY_REPLY_TO` | operator pubkey | where replies are sent |
| `NOSTR_GATEWAY_MODEL` | `claude-sonnet-5` | C2 model for `/report` and instruction-routing (Sonnet minimum — Haiku misreads pane state) |
| `NOSTR_MIRROR_RELAY` | dreamlab cloud relay | relay override (shared with the mirror) |

### Dedicated-identity mode

`AGENTBOX_GATEWAY_IDENTITY=gateway` gives the daemon its own derived key so the
control channel is a separate DM thread with a "bot" contact instead of your
self-DM. That key must be whitelisted as a gift-wrap recipient on the relay
(`POST /api/whitelist/add`, NIP-98 admin auth) and added as a contact in Amethyst.
The default `operator` mode needs neither — the operator key is already whitelisted.

## Persistence

- **Daemon:** supervised `[program:nostr-gateway]` in `flake.nix` (auto-start,
  auto-restart). Baked on rebuild.
- **Tab naming + self-heal:** the `fleet-session-start.sh` `SessionStart` hook,
  registered idempotently by `entrypoint-unified.sh` on every container start.
- **Scripts:** `config/nostr-gateway/` and `config/hooks/fleet-*.sh`, baked into
  `/opt/agentbox` at build time.

A rebuild re-applies all of the above. Between edits and a rebuild, the daemon
runs from the workspace copy and the hook self-heals it.

## Tab naming

Claude working tabs are auto-named by project (git remote → toplevel → cwd
basename) via the same `SessionStart` hook, so `/tabs` is human-readable. Curated
utility/profile tab names (`OpenRouter`, `ZAI`, …) are left untouched because only
Claude sessions fire the hook.

## Troubleshooting

- **Commands don't arrive:** confirm the relay is a DM relay in Amethyst; check
  `~/.claude/nostr-inbox/gateway.log` for `armed — now live`. Run with `GW_DEBUG=1`
  to log every relay frame. A silent daemon that shows only `EOSE` and no `EVENT`
  after you send is almost always the `since`-window mistake above.
- **Replies don't come back:** the reply publish logs `reply:` then a `frame OK
  […,true]`. A `false` OK means the recipient isn't whitelisted.
- **`nostr-send.cjs "text"`** sends a one-off DM to your phone from any tab — handy
  for agents to push a status line deliberately (vs. the per-turn mirror).

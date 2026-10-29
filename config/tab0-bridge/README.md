# tab0-bridge — voice/nostr meta-controller for the tmux plane

Canonical source for the bridge that fronts the coordinator Claude Code session
to every remote surface: the Unmute voice loop (OpenAI-compatible
`/v1/chat/completions`), the browser voice console (`/feed` websocket,
`/tab0/send`, read-only `/tabs/:n` captures, `/sessions` status list), and
the Nostr plane (`/nostr/status`, `/nostr/events`, `/nostr/send`).

## Injection seam — owned session plane (ADR-2153)

`sendToTab0()` sends `{op:"send", slug:"tab0", text}` to the peer-authorised
unix socket at `/run/agentbox-sessions/sessions.sock`. The daemon serialises
mutations and preserves the paste-burst delay before Enter. If unavailable,
the bridge logs the degradation and uses its existing tmux fallback.

`GET /sessions` lists daemon states. The spoken controller is restricted to
`scripts/session-control.cjs list` and `send <text>`: fleet reads and coordinator
sends only, without create/close or arbitrary-session commands. Read-only tmux
captures remain available. There is no :9095 listener or AoE bearer token.

The external HTTP and WebSocket auth contract below is retained.

## Auth model and bind (ADR-044 finding 1)

The bridge fronts the coordinator `claude -p` backend and the `/tab0/send`
injection seam, so an unauthenticated non-loopback listener is a remote code
path. Auth is therefore global, with two carriers and one hard startup gate:

- **`BRIDGE_TOKEN`** — when set, every surface **except `/health`** requires it,
  including the Unmute LLM contract (`/v1/chat/completions`, `/v1/models`), the
  `/feed` WebSocket, `/tab0/send`, `/nostr/*`, `/turns`, `/tabs*`, and
  `/sessions`. Missing/wrong token → `401` (HTTP) or a rejected upgrade (WS).
- **Bearer header** — `Authorization: Bearer <BRIDGE_TOKEN>`. Carried by:
  - the **Unmute backend**, which sends `KYUTAI_LLM_API_KEY=$BRIDGE_TOKEN` as the
    OpenAI-style bearer when it calls `/v1/chat/completions` over the docker
    network (set in `agentbox/voice/unmute-override.yml`);
  - the **console via Caddy**, which forwards `Authorization` on `/bridge/*` and `/feed`.;
  - any CLI caller.
- **`?token=<BRIDGE_TOKEN>` query param** — direct bridge compatibility only.
  The console goes through the identity proxy, using its NIP-07 session cookie,
  `?auth=<signed-event>`, or the opt-in `?access_token=` break-glass carrier.
  For signed requests forwarded by the loopback proxy, the bridge verifies the
  public `X-Forwarded-Host` and restores the stripped `/bridge` prefix; `/feed`
  is forwarded unchanged. The signature and signer allowlist remain enforced.
- **`BRIDGE_BIND`** (default `0.0.0.0`) — the listen interface. `0.0.0.0` keeps
  the bridge reachable at `agentbox:8971` for the Unmute backend. A **non-loopback
  bind with no `BRIDGE_TOKEN` set is refused at startup** (`process.exit(1)`) —
  that would expose the injection seam and the `claude -p` backend to the network
  unauthenticated. A loopback bind (`127.0.0.1`/`::1`/`localhost`) is the
  token-optional dev path; there the gate is open.

### BRIDGE_TOKEN — one shared source of truth (security audit Finding 2)

`BRIDGE_TOKEN` is a **single secret** minted once and read by every party:

- **`agentbox.sh up`** generates it (`openssl rand -hex 32`) and persists it to
  the repo **`.env`** on first use (idempotent). `.env` is the compose
  `env_file`, so the value flows `.env → compose → PID 1 → supervisord →
  [program:tab0-bridge]` and the in-container bridge inherits it — it is **never**
  written into the generated supervisor text.
- **`agentbox.sh voice up`** reads the **same** `.env` value and exports it as
  `KYUTAI_LLM_API_KEY` (the Unmute backend's bearer) and
  `NIP98_PROXY_ALLOW_BEARER` (the console break-glass bearer the in-container
  nip98-proxy honours). It **fails fast** (non-zero exit) when the token is
  missing — the old warn-and-continue shipped a stack that 401'd on every call.
- For a container started outside `agentbox.sh` (direct `docker compose up`) whose
  `.env` has no token, `entrypoint-unified.sh` self-heals: it mints a **stable**
  token into the secrets volume (`/var/lib/agentbox/secrets/bridge-token`) and
  exports it so the bridge still starts authenticated. Set that value in `.env`
  to let `voice up`/console reach it.

To key the console break-glass off the same secret, set
`NIP98_PROXY_ALLOW_BEARER=${BRIDGE_TOKEN}` in `.env` so the supervised
nip98-proxy inside the container accepts it.

**Deploy target is the workspace volume, not this directory.** The bridge
runs from `~/workspace/tab0-bridge` (persistent volume, survives image
rebuilds) so its Claude CLI OAuth cwd and `node_modules` stay stable.

**Lifecycle is supervisor-owned (security audit Finding 3), edit HERE, never
the workspace copy.** `flake.nix` ships a manifest-gated `[program:tab0-bridge]`
supervisor block (gate `[sovereign_mesh].enabled`) that is the **canonical
owner**: it runs `deploy.sh reconcile` (copy this canonical source into the
`~/workspace/tab0-bridge` volume via md5 compare — the image has no cmp/diff —
and install prod deps) and then execs `node server.mjs` in the foreground so
`autorestart` applies. A clean checkout/rebuild therefore always has a committed
launcher.

`deploy.sh` has two modes:

- `deploy.sh reconcile` — copy source + install deps only (what supervisor runs).
- `deploy.sh` — reconcile, then **belt-and-braces** launch **only** when
  supervisor does not own the process. When `AGENTBOX_TAB0_BRIDGE_SUPERVISED=1`
  (set in `imageEnv` on the same gate) it reconciles files and defers the
  process lifecycle to supervisor, so there is never a double launch.

`config/hooks/fleet-session-start.sh` (Job 3) invokes `deploy.sh` fire-and-forget
on every Claude SessionStart as belt-and-braces reconciliation — a no-op for the
running process under supervisor, still a full launch on a non-supervised
deployment. Off switch: `AGENTBOX_TAB0_BRIDGE=0`. Manual run is always safe:

```sh
bash config/tab0-bridge/deploy.sh   # idempotent; defers to supervisor when it owns the bridge
```

Claude Code hooks (`Stop`/`UserPromptSubmit` → `turn-sink.cjs` at the
workspace path) are registered idempotently by `entrypoint-unified.sh` at
boot, alongside the mirror and fleet hooks.

Key behaviours (see server.mjs header for the full surface list):

- LLM backend is headless `claude -p` on the subscription OAuth; an empty
  `ANTHROPIC_API_KEY` poisons the SDK credential chain, so the child env
  deletes it.
- The meta-controller relays intents into window 0 only, and is prompt- and
  code-gated to stay **quiet unless called upon**: the voice backend's `"..."`
  silence-marker turns short-circuit to an empty reply without an LLM call.
- Outbound Nostr rides `config/nostr-gateway/nostr-send.cjs` (fail-open);
  inbound audit is read from `~/.claude/nostr-inbox/commands.jsonl`.

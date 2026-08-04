# tab0-bridge — voice/nostr meta-controller for the tmux plane

Canonical source for the bridge that fronts the coordinator Claude Code session
to every remote surface: the Unmute voice loop (OpenAI-compatible
`/v1/chat/completions`), the browser voice console (`/feed` websocket,
`/tab0/send`, read-only `/tabs/:n` captures, `/aoe/sessions` status list), and
the Nostr plane (`/nostr/status`, `/nostr/events`, `/nostr/send`).

## Injection seam — repointed onto Agent of Empires (ADR-044)

The single write path is repointed off raw `tmux send-keys -t agentbox:0` onto
the Agent of Empires interaction plane ([ADR-044](../../docs/reference/adr/ADR-044-voice-plane-aoe-repoint.md),
WS5 of [PRD-021](../../docs/reference/prd/PRD-021-interaction-surface-consolidation.md)):

- `sendToTab0()` POSTs the intent to `POST /api/sessions/{id}/send` on the
  loopback AoE daemon (`AGENTBOX_INTERACTION_PLANE_PORT`, default `:9095`),
  which honours the per-agent paste-burst delay and **serialises** concurrent
  callers so voice and nostr injections cannot interleave keystrokes (D1).
- The coordinator session id is **resolved at start** via `GET /api/sessions`,
  matching the seed title `AOE_COORDINATOR_TITLE` (default `coordinator`,
  case-insensitive), pinned for the process lifetime, and **re-resolved on a
  404** (session drift after a daemon restart/reseed) (D2). A 30s interval
  re-resolves while unpinned so the id is picked up if AoE starts after the
  bridge.
- **FAIL-OPEN (D3):** when AoE is unreachable (refused, 404, transient) the seam
  degrades to the byte-identical legacy `tmux send-keys` path and logs the
  degradation — a down daemon never mutes the voice loop. The fallback is the
  degraded path (unaccounted, races AoE's watcher), never the steady state.
- The meta-controller's Bash allowlist (`metaAllowedTools()`) migrates from
  tmux send-keys to **curl against the AoE API**, with `send`/`output` pinned to
  the resolved coordinator id (send never targets an arbitrary session); the
  read-only `tmux list-windows`/`capture-pane` commands stay for legacy windows
  on the shared socket (D6).
- Loopback, no token: the daemon runs `--auth none --behind-proxy`, so a
  same-host POST needs no auth (D8 route 2, direct-loopback break-glass). The
  NIP-98 reverse proxy that is the sole ingress to `:9095` (ADR-043 D6) is a
  deployment concern in front of the bridge, not implemented here.
- **Untouched (D9):** the *shape* of the Unmute `/v1/chat/completions` +
  `/v1/models` LLM contract, the `/hook/turn` sink, `/feed`/`/turns`, and the
  `/nostr/*` surface. The injection seam itself (`sendToTab0()` fail-open to
  tmux) is byte-for-byte preserved. These surfaces now sit behind the global
  auth gate below, but the request/response bodies are unchanged.

## Auth model and bind (ADR-044 finding 1)

The bridge fronts the coordinator `claude -p` backend and the `/tab0/send`
injection seam, so an unauthenticated non-loopback listener is a remote code
path. Auth is therefore global, with two carriers and one hard startup gate:

- **`BRIDGE_TOKEN`** — when set, every surface **except `/health`** requires it,
  including the Unmute LLM contract (`/v1/chat/completions`, `/v1/models`), the
  `/feed` WebSocket, `/tab0/send`, `/nostr/*`, `/turns`, `/tabs*`, and
  `/aoe/sessions`. Missing/wrong token → `401` (HTTP) or a rejected upgrade (WS).
- **Bearer header** — `Authorization: Bearer <BRIDGE_TOKEN>`. Carried by:
  - the **Unmute backend**, which sends `KYUTAI_LLM_API_KEY=$BRIDGE_TOKEN` as the
    OpenAI-style bearer when it calls `/v1/chat/completions` over the docker
    network (set in `agentbox/voice/unmute-override.yml`);
  - the **console via Caddy**, which forwards `Authorization` on `/aoe/*` etc.;
  - any CLI caller.
- **`?token=<BRIDGE_TOKEN>` query param** — for **browser WebSocket** clients,
  which cannot set request headers on the `/feed` upgrade. Connect to
  `wss://…/feed?token=<TOKEN>`. Accepted on any surface as a fallback to the
  header.
- **`BRIDGE_BIND`** (default `0.0.0.0`) — the listen interface. `0.0.0.0` keeps
  the bridge reachable at `agentbox:8971` for the Unmute backend. A **non-loopback
  bind with no `BRIDGE_TOKEN` set is refused at startup** (`process.exit(1)`) —
  that would expose the injection seam and the `claude -p` backend to the network
  unauthenticated. A loopback bind (`127.0.0.1`/`::1`/`localhost`) is the
  token-optional dev path; there the gate is open.

Note the AoE-daemon "loopback, no token" line in the injection-seam section above
is about the bridge → AoE hop (`:9095`), a separate loopback concern, and is not
affected by the bridge's own inbound auth.

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
